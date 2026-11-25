import { FIREBASE_PROJECT_ID } from '../config/api-config';

const root = () => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/databases/(default)/documents`;
const encodedPath = path => path.split('/').map(encodeURIComponent).join('/');
const segment = value => encodeURIComponent(value);
const fields = value => Object.fromEntries(Object.entries(value).map(([key,item]) => [key,toValue(item)]));
function toValue(value) {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  return { mapValue: { fields: fields(value) } };
}
function fromValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields || {});
  return undefined;
}
const fromFields = value => Object.fromEntries(Object.entries(value).map(([key,item]) => [key,fromValue(item)]));
function fromDocument(doc) {
  const id = doc.name?.split('/').at(-1);
  return { id, ...fromFields(doc.fields || {}), _updateTime: doc.updateTime };
}
function tokenClaims(token) {
  try {
    const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
  } catch { throw new Error('Your bank session is invalid. Sign in again.'); }
}

async function firestore(path, { token, method = 'GET', body, query = '' } = {}) {
  if (!FIREBASE_PROJECT_ID) throw new Error('Set VITE_FIREBASE_PROJECT_ID to use Nizzus bank data without Cloud Functions.');
  const signal = AbortSignal.timeout(15000);
  let response;
  try {
    response = await fetch(`${root()}${path.startsWith(':') ? path : `/${encodedPath(path)}`}${query}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      credentials: 'omit', redirect: 'error', signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    const error = new Error('Could not reach Nizzus Firestore. Check the Firebase project, network and security rules.');
    error.uncertain = method !== 'GET' && method !== 'DELETE';
    throw error;
  }
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    if (status === 401 && token && typeof window !== 'undefined') window.dispatchEvent(new Event('nizzus-session-expired'));
    const firestoreStatus = ['FAILED_PRECONDITION','ALREADY_EXISTS','ABORTED'].includes(data.error?.status) ? 409 : status;
    const error = new Error(status === 403 ? 'Nizzus Firestore denied this action. Deploy the provided Firestore security rules and sign in again.'
      : status === 404 ? 'The Nizzus Firestore document or collection was not found.'
        : status === 409 || status === 412 ? 'This record changed in another session. Refresh and try again.'
          : status >= 500 ? 'Nizzus Firestore is temporarily unavailable. Refresh before retrying.'
            : `Nizzus Firestore returned HTTP ${status}.`);
    error.status = firestoreStatus;
    error.uncertain = status >= 500 && method !== 'GET';
    error.code = data.error?.status;
    throw error;
  }
  return data;
}

const docPath = (collection, id) => `${collection}/${segment(id)}`;
async function getDocument(path, token, optional = false) {
  try { return fromDocument(await firestore(path, { token })); }
  catch (error) { if (optional && error.status === 404) return null; throw error; }
}
async function listCollection(path, token) {
  const output = []; let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const result = await firestore(path, { token, query: `?${query}` });
    output.push(...(result.documents || []).map(fromDocument));
    pageToken = result.nextPageToken || '';
  } while (pageToken && output.length < 1000);
  return output;
}
async function queryLoans(uid, token) {
  const result = await firestore(':runQuery', { token, method: 'POST', body: { structuredQuery: {
    from: [{ collectionId: 'nizzus_loans' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: toValue(uid) } },
    limit: 100,
  } } });
  return (Array.isArray(result) ? result : []).filter(item => item.document).map(item => fromDocument(item.document));
}
function write(documentPath, data, { updateTime, exists, mask } = {}) {
  return { update: { name: `${root()}/${encodedPath(documentPath)}`, fields: fields(data) },
    ...(mask ? { updateMask: { fieldPaths: mask } } : {}),
    ...(updateTime ? { currentDocument: { updateTime } } : exists !== undefined ? { currentDocument: { exists } } : {}) };
}
async function commit(token, writes) {
  return firestore(':commit', { token, method: 'POST', body: { writes } });
}
const now = () => new Date();
function requireAdmin(token) {
  if (tokenClaims(token).nexusAdmin !== true) throw new Error('Bank administrator access is required.');
}
function validMoney(value, max = 100000000000) { return Number.isSafeInteger(value) && value > 0 && value <= max; }

async function me(token) {
  const { sub, email, email_verified: emailVerified, nexusAdmin } = tokenClaims(token);
  const app = await getDocument(docPath('nizzus_applications', sub), token, true);
  const positions = await listCollection(`nizzus_customers/${segment(sub)}/positions`, token);
  const loans = await queryLoans(sub, token);
  return { admin: nexusAdmin === true, email, emailVerified: emailVerified === true,
    application: app ? Object.fromEntries(Object.entries(app).filter(([key]) => key !== '_updateTime')) : null, positions, loans };
}

async function submitApplication(token, body) {
  const { sub, email, email_verified: verified } = tokenClaims(token);
  if (verified !== true) throw new Error('Verify your email address and sign in again before applying.');
  const name = String(body?.name || '').trim(), address = String(body?.address || '').trim();
  const document = body?.document;
  if (!name || name.length > 120 || !address || address.length > 300) throw new Error('Enter a valid name and address.');
  if (!document || !['application/pdf','image/png','image/jpeg'].includes(document.type) || typeof document.data !== 'string' || document.data.length > 349528) throw new Error('Attach a PDF, PNG or JPEG proof document smaller than 256 KiB.');
  const appPath = docPath('nizzus_applications', sub);
  const app = await getDocument(appPath, token, true);
  const proofPath = `${appPath}/documents/proof`;
  const proof = await getDocument(proofPath, token, true);
  if (!app) {
    await commit(token, [
      write(appPath, { uid: sub, email, name, address, status: 'PENDING', revision: 1, updatedAt: now() }, { exists: false }),
      write(proofPath, { type: document.type, data: document.data }, { exists: false }),
    ]);
  } else {
    if (app.status !== 'HOLD') { const error = new Error('This application cannot be resubmitted in its current status.'); error.status = 409; throw error; }
    if (!proof?._updateTime) throw new Error('The existing application proof is missing. Contact bank support before resubmitting.');
    await commit(token, [
      write(appPath, { name, address, status: 'PENDING', revision: app.revision + 1, note: '', updatedAt: now() }, { updateTime: app._updateTime, mask: ['name','address','status','revision','note','updatedAt'] }),
      write(proofPath, { type: document.type, data: document.data }, { updateTime: proof._updateTime }),
    ]);
  }
  return { status: 'PENDING' };
}

async function putPosition(token, pathId, body) {
  const uid = tokenClaims(token).sub, id = pathId;
  const name = String(body?.name || '').trim(), valueMinor = Number(body?.valueMinor);
  if (!id || id.length > 128 || !name || name.length > 120 || !validMoney(valueMinor)) throw new Error('Enter a valid holding name and positive value.');
  const path = `nizzus_customers/${segment(uid)}/positions/${segment(id)}`;
  const current = await getDocument(path, token, true);
  await commit(token, [write(path, { name, valueMinor, updatedAt: now() }, current?{updateTime:current._updateTime}:{exists:false})]);
  return { id };
}
async function deletePosition(token, id) {
  const path=`nizzus_customers/${segment(tokenClaims(token).sub)}/positions/${segment(id)}`;
  const current=await getDocument(path,token);
  await firestore(path,{token,method:'DELETE',query:`?currentDocument.updateTime=${encodeURIComponent(current._updateTime)}`});
  return {};
}
async function putLoan(token, id, body) {
  const uid=tokenClaims(token).sub, path=docPath('nizzus_loans',id), current=await getDocument(path,token,true);
  const purpose=String(body?.purpose||'').trim(), amountMinor=Number(body?.amountMinor), months=Number(body?.months);
  if (!purpose||purpose.length>120||!validMoney(amountMinor)||!Number.isInteger(months)||months<1||months>360) throw new Error('Enter a valid loan purpose, amount and term.');
  if (!current) {
    if (body.version!==0) throw new Error('New loan requests must start at version 0.');
    await commit(token,[write(path,{uid,purpose,amountMinor,months,status:'PENDING',version:0,updatedAt:now()},{exists:false})]);
  } else {
    if (current.uid!==uid||current.status!=='PENDING'||current.version!==body.version) { const error=new Error('This loan changed or is no longer pending. Refresh and try again.');error.status=409;throw error; }
    await commit(token,[write(path,{purpose,amountMinor,months,version:current.version+1,updatedAt:now()},{updateTime:current._updateTime,mask:['purpose','amountMinor','months','version','updatedAt']})]);
  }
  return { id };
}
async function withdrawLoan(token, body) {
  const uid=tokenClaims(token).sub,path=docPath('nizzus_loans',body?.id),loan=await getDocument(path,token);
  if(loan.uid!==uid||loan.status!=='PENDING'||loan.version!==body.version){const error=new Error('This loan changed or is no longer pending.');error.status=409;throw error;}
  await commit(token,[write(path,{status:'WITHDRAWN',version:loan.version+1,updatedAt:now()},{updateTime:loan._updateTime,mask:['status','version','updatedAt']})]);
  return { status:'WITHDRAWN' };
}
async function adminQueue(token) {
  requireAdmin(token);
  const [applications,loans,partners]=await Promise.all([
    listCollection('nizzus_applications',token),listCollection('nizzus_loans',token),listCollection('nizzus_partners',token),
  ]);
  return { applications,loans,partners };
}
async function reviewApplication(token, body) {
  requireAdmin(token);
  const status=body?.status,note=String(body?.note||'').trim();
  if(!['APPROVED','HOLD','REJECTED'].includes(status)||(['HOLD','REJECTED'].includes(status)&&(!note||note.length>300))) throw new Error('Choose a valid review decision and provide a note for Hold or Reject.');
  const path=docPath('nizzus_applications',body.id),app=await getDocument(path,token);
  if(app.revision!==body.revision||!['PENDING','HOLD'].includes(app.status)){const error=new Error('This application revision is stale or closed. Refresh the review queue.');error.status=409;throw error;}
  await commit(token,[write(path,{status,note:status==='APPROVED'?'':note,reviewedBy:tokenClaims(token).sub,updatedAt:now()},{updateTime:app._updateTime,mask:['status','note','reviewedBy','updatedAt']})]);
  return { status };
}
async function savePartner(token, body) {
  requireAdmin(token);
  const id=String(body?.id||'').toUpperCase(),name=String(body?.name||'').trim(),ifsc=String(body?.ifsc||'').toUpperCase(),address=String(body?.address||'').trim();
  if(!/^P\d{3}$/.test(id)||!name||name.length>120||!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)||!address||address.length>300) throw new Error('Enter a valid partner ID, IFSC, name and address.');
  const path=docPath('nizzus_partners',id),current=await getDocument(path,token,true);
  await commit(token,[write(path,{name,ifsc,address},current?{updateTime:current._updateTime}:{exists:false})]);
  return { id };
}
async function deletePartner(token,id) {
  requireAdmin(token);const path=docPath('nizzus_partners',id),current=await getDocument(path,token);
  await firestore(path,{token,method:'DELETE',query:`?currentDocument.updateTime=${encodeURIComponent(current._updateTime)}`});return {};
}
async function decideLoan(token,body) {
  requireAdmin(token);const path=docPath('nizzus_loans',body?.id),loan=await getDocument(path,token);
  if(!['APPROVED','REJECTED'].includes(body?.status)||loan.status!=='PENDING'||loan.version!==body.version){const error=new Error('This loan changed or is no longer pending.');error.status=409;throw error;}
  await commit(token,[write(path,{status:body.status,version:loan.version+1,updatedAt:now()},{updateTime:loan._updateTime,mask:['status','version','updatedAt']})]);return {status:body.status};
}

export async function firestoreBankApi(path, options = {}) {
  const { token, method = 'GET', body }=options;
  const parts=path.split('/').filter(Boolean).map(decodeURIComponent);
  if(path==='/me'&&method==='GET') return me(token);
  if(path==='/application'&&method==='POST') return submitApplication(token,body);
  if(parts[0]==='positions'&&parts.length===2&&method==='PUT') return putPosition(token,parts[1],body);
  if(parts[0]==='positions'&&parts.length===2&&method==='DELETE') return deletePosition(token,parts[1]);
  if(parts[0]==='loans'&&parts.length===2&&method==='PUT') return putLoan(token,parts[1],body);
  if(path==='/loans/withdraw'&&method==='POST') return withdrawLoan(token,body);
  if(path==='/admin/queue'&&method==='GET') return adminQueue(token);
  if(parts[0]==='admin'&&parts[1]==='document'&&parts.length===3&&method==='GET') { requireAdmin(token);const proof=await getDocument(`nizzus_applications/${segment(parts[2])}/documents/proof`,token);return {type:proof.type,data:proof.data}; }
  if(path==='/admin/review'&&method==='POST') return reviewApplication(token,body);
  if(path==='/admin/partners'&&method==='POST') return savePartner(token,body);
  if(parts[0]==='admin'&&parts[1]==='partners'&&parts.length===3&&method==='DELETE') return deletePartner(token,parts[2]);
  if(path==='/admin/loans'&&method==='POST') return decideLoan(token,body);
  if(path==='/admin/limits'&&method==='POST') throw new Error('Transfer limits are server-managed. Configure them through the authorized bank service; this browser-only Firestore mode cannot edit transfer_limits.');
  throw new Error(`The Nizzus Firestore adapter does not support ${method} ${path}.`);
}
