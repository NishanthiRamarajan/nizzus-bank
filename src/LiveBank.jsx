import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField,
} from '@mui/material';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BadgeCheck, BriefcaseBusiness, Building2,
  CircleHelp, Clock3, CreditCard, Download, FileText, Landmark, LayoutDashboard, LogOut,
  Plus, RefreshCw, Send, ShieldCheck, Trash2, WalletCards,
} from 'lucide-react';
import bank from './bank-config';
import { toPaise } from './amount';
import { bankApi, serviceConfigured, localFunctionConfigured } from './services/bank-api';
import { workerApi } from './services/worker-api';
import { lookupFirebaseUser, readFirebaseClaims, sendPasswordReset, sendVerification, signInFirebase, signUp } from './services/auth-service';
import './live.css';

const money = minor => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((Number(minor) || 0) / 100);
const dateTime = value => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value?.toDate ? value.toDate() : value)) : '—';
const statusText = status => ({ PENDING: 'Pending', PROCESSING: 'Processing', COMPLETED: 'Completed', REJECTED: 'Rejected', MANUAL_REVIEW: 'Manual review', HOLD: 'Needs attention', APPROVED: 'Approved', WITHDRAWN: 'Withdrawn' })[status] || status || 'Unknown';
const accountName = a => a.label || `Account ••${String(a.accountNumber || '').slice(-4)}`;
const safeRows = rows => Array.isArray(rows) ? rows : [];
const escapeCsv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const pendingStorageKey = uid => `nizzus-pending-transfer:${uid}`;

function Field({ label, value, onChange, ...props }) {
  return <TextField fullWidth label={label} value={value} onChange={e => onChange(e.target.value)} {...props} />;
}

function SectionTitle({ title, description, icon: Icon, action }) {
  return <div className="section-title"><div className="section-icon">{Icon && <Icon size={19} />}</div><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="section-action">{action}</div>}</div>;
}

function EmptyState({ icon: Icon = CircleHelp, title, message }) {
  return <div className="empty"><Icon size={24} /><strong>{title}</strong><p>{message}</p></div>;
}

function Accounts({ accounts }) {
  return <div className="account-grid">{accounts.map((account, index) => <article className={`account-card ${index === 0 ? 'primary-account' : 'light-account'}`} key={account.accountId}>
    <div className="account-head"><span>{accountName(account)}</span><Landmark size={19} /></div>
    <div><div className="account-balance-label">Available balance</div><div className="account-value">{money(account.availableMinor)}</div></div>
    <div className="account-facts"><span>Posted <b>{money(account.postedBalanceMinor)}</b></span><span>On hold <b>{money(account.heldMinor)}</b></span><span>{account.status || '—'}</span></div>
  </article>)}</div>;
}

function TransfersTable({ rows, directory, onSelect }) {
  const bankTitle = id => directory.find(item => item.bankId === id)?.bankName || id || '—';
  return <div className="table-scroll"><table><thead><tr><th>Transfer</th><th>Route</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map(row => <tr key={row.transferId}>
    <td><button className="text-action mono" onClick={() => onSelect(row)}>{row.transferId}</button><small>{dateTime(row.createdAt)}</small></td>
    <td><strong>{bankTitle(row.sourceBankId)} → {bankTitle(row.destinationBankId)}</strong><small>{row.type === 'INTERNAL' ? 'Same bank' : row.direction === 'CREDIT' ? 'Incoming' : 'Outgoing'}</small></td>
    <td className={`amount ${row.direction === 'CREDIT' ? 'positive' : ''}`}>{row.direction === 'CREDIT' ? '+' : row.direction === 'DEBIT' ? '−' : ''}{money(row.amountMinor)}</td>
    <td><Chip size="small" label={statusText(row.status)} className={`status-chip status-${String(row.status || '').toLowerCase()}`} />{row.code && <small>{String(row.code).toLowerCase().replaceAll('_', ' ')}</small>}</td>
  </tr>)}</tbody></table></div>;
}

function TransferPage({ accounts, directory, onSubmit, busy, uncertain, retry, activity }) {
  const [source, setSource] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [validation, setValidation] = useState('');
  const [lookupIfsc, setLookupIfsc] = useState(''); const [lookupError, setLookupError] = useState(''); const [lookupBusy, setLookupBusy] = useState(false);
  const usable = accounts.filter(a => a.status === 'ACTIVE');
  const sourceId = usable.some(a => a.accountId === source) ? source : usable[0]?.accountId || '';
  const targetBank = directory.find(b => b.ifsc === ifsc);
  const amountMinor = toPaise(amount);
  function continueToConfirm(event) {
    event.preventDefault(); setValidation('');
    if (uncertain) { setValidation('Resolve the previous payment by refreshing or retrying the exact same request before starting another transfer.'); return; }
    if (!sourceId || !targetBank || !accountNumber.trim() || !/^[A-Za-z0-9-]{4,40}$/.test(accountNumber.trim()) || amountMinor === null) {
      setValidation('Choose an account and destination, enter a valid account number and a positive amount with up to two decimal places.'); return;
    }
    if (amountMinor > Number(usable.find(a => a.accountId === sourceId)?.availableMinor || 0)) {
      setValidation('The amount is higher than this account’s available balance. The bank also checks its current transfer limits during settlement.'); return;
    }
    if (targetBank.bankId === bank.id && usable.find(a => a.accountId === sourceId)?.accountNumber === accountNumber.trim()) {
      setValidation('You cannot send a transfer to the same account.'); return;
    }
    setConfirm(true);
  }
  const payload = { fromAccountId: sourceId, destinationIfsc: ifsc.trim().toUpperCase(), destinationAccountNumber: accountNumber.trim(), amountMinor, currency: 'INR' };
  async function lookupDestination() {
    setLookupError(''); const value=lookupIfsc.trim().toUpperCase();
    if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(value)) return setLookupError('Enter an 11-character IFSC code.');
    setLookupBusy(true); try { const result=await workerApi(`/directory/ifsc/${encodeURIComponent(value)}`); const active=directory.find(item=>item.ifsc===result.ifsc&&item.bankId===result.bankId&&item.status==='ACTIVE'); if(!active) throw new Error('This IFSC is not listed for an active bank in the directory.'); setIfsc(result.ifsc); setValidation(''); } catch(e) { setLookupError(e.message); } finally { setLookupBusy(false); }
  }
  return <>
    <section className="panel"><SectionTitle icon={Send} title="New transfer" description="Same-bank and interbank payments use the SharedBank transfer service." />
      <form className="form-grid" onSubmit={continueToConfirm}>
        <TextField select required fullWidth label="From account" value={sourceId} onChange={e => setSource(e.target.value)} disabled={!usable.length || busy || Boolean(uncertain)}>
          {usable.map(a => <MenuItem key={a.accountId} value={a.accountId}>{accountName(a)} · {money(a.availableMinor)} available</MenuItem>)}
        </TextField>
        <TextField select required fullWidth label="Destination bank" value={ifsc} onChange={e => setIfsc(e.target.value)} disabled={busy || Boolean(uncertain)}>
          {directory.filter(item => item.status === 'ACTIVE').map(item => <MenuItem key={item.ifsc} value={item.ifsc}>{item.bankName} · {item.ifsc}{item.bankId === bank.id ? ' (same bank)' : ''}</MenuItem>)}
        </TextField>
        <div className="ifsc-lookup"><Field label="Or look up an IFSC" value={lookupIfsc} onChange={v=>setLookupIfsc(v.toUpperCase())} disabled={busy||Boolean(uncertain)} inputProps={{maxLength:11}}/><Button type="button" variant="outlined" onClick={lookupDestination} disabled={lookupBusy||busy||Boolean(uncertain)}>{lookupBusy?'Checking…':'Verify IFSC'}</Button></div>
        {lookupError&&<Alert severity="error">{lookupError}</Alert>}
        <Field required label="Destination account number" value={accountNumber} onChange={setAccountNumber} disabled={busy || Boolean(uncertain)} inputProps={{ maxLength: 40, autoComplete: 'off' }} />
        <Field required label="Amount (INR)" value={amount} onChange={setAmount} disabled={busy || Boolean(uncertain)} inputProps={{ inputMode: 'decimal' }} />
        {amountMinor && sourceId && <p className="form-hint">Transfer amount {money(amountMinor)}. The handbook lists defaults of ₹5,000 per transfer and ₹7,000 daily; custom limits may differ. The backend is authoritative during settlement.</p>}
        {validation && <Alert severity="error">{validation}</Alert>}
        <div><Button type="submit" variant="contained" startIcon={<ArrowLeftRight size={17} />} disabled={!usable.length || !directory.length || busy || Boolean(uncertain)}>Review transfer</Button></div>
        {!usable.length && <Alert severity="info">No active source account is available for transfers.</Alert>}
      </form>
    </section>
    {uncertain && <Alert severity="warning" action={<Button color="inherit" onClick={retry} disabled={busy}>Retry same request</Button>}>
      The transfer outcome is uncertain. Refresh activity or retry using the same transfer ID and unchanged details.
    </Alert>}
    <section className="panel"><SectionTitle icon={Clock3} title="Recent activity" description="Check status before retrying a transfer." />
      {activity.length ? <TransfersTable rows={activity.slice(0, 8)} directory={directory} onSelect={() => {}} /> : <EmptyState title="No transfer activity" message="Your transfer status will appear here after a request is submitted." />}
    </section>
    <Dialog open={confirm} onClose={() => !busy && setConfirm(false)} fullWidth maxWidth="xs">
      <DialogTitle>Confirm transfer</DialogTitle><DialogContent><div className="confirm-details"><span>From</span><b>{accountName(usable.find(a => a.accountId === sourceId) || {})}</b><span>To</span><b>{targetBank?.bankName} · {ifsc.toUpperCase()} / {accountNumber}</b><span>Amount</span><b className="confirm-amount">{money(amountMinor)}</b></div><Alert severity="info">The payment may remain pending while the bank processes it. A submitted transfer is not treated as completed until its status says COMPLETED.</Alert></DialogContent>
      <DialogActions><Button onClick={() => setConfirm(false)} disabled={busy}>Edit</Button><Button variant="contained" onClick={() => onSubmit(payload).then(() => { setConfirm(false); setAmount(''); setAccountNumber(''); }).catch(() => {})} disabled={busy}>Submit payment</Button></DialogActions>
    </Dialog>
  </>;
}

function ActivityPage({ rows, directory, onSelect }) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('ALL'); const [direction, setDirection] = useState('ALL'); const [type, setType] = useState('ALL'); const [fromDate, setFromDate] = useState(''); const [toDate, setToDate] = useState('');
  const filtered = useMemo(() => rows.filter(row => {
    const query = search.toLowerCase(); const time = new Date(row.createdAt || 0).getTime();
    return (!query || String(row.transferId || '').toLowerCase().includes(query)) && (status === 'ALL' || row.status === status) && (direction === 'ALL' || row.direction === direction) && (type === 'ALL' || row.type === type) && (!fromDate || time >= new Date(`${fromDate}T00:00:00+05:30`).getTime()) && (!toDate || time <= new Date(`${toDate}T23:59:59+05:30`).getTime());
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)), [rows, search, status, direction, type, fromDate, toDate]);
  function exportCsv() {
    const headings = ['Transfer ID', 'Date', 'Source bank', 'Destination bank', 'Amount minor', 'Currency', 'Transaction type', 'Direction', 'Status', 'Code'];
    const lines = filtered.map(r => [r.transferId, dateTime(r.createdAt), r.sourceBankId, r.destinationBankId, r.amountMinor, r.currency, r.type, r.direction, r.status, r.code].map(escapeCsv).join(','));
    const url = URL.createObjectURL(new Blob([[headings.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'nizzus-transfer-history.csv'; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="panel"><SectionTitle icon={FileText} title="Transaction history" description={`${filtered.length} of ${rows.length} available activity records`} action={<Button onClick={exportCsv} startIcon={<Download size={16} />} disabled={!filtered.length}>Export CSV</Button>} />
    <div className="filters"><Field label="Transfer ID" value={search} onChange={setSearch} size="small" /><TextField select label="Status" size="small" value={status} onChange={e => setStatus(e.target.value)}><MenuItem value="ALL">All statuses</MenuItem>{['PENDING','PROCESSING','COMPLETED','REJECTED','MANUAL_REVIEW'].map(s => <MenuItem value={s} key={s}>{statusText(s)}</MenuItem>)}</TextField><TextField select label="Direction" size="small" value={direction} onChange={e => setDirection(e.target.value)}><MenuItem value="ALL">All directions</MenuItem><MenuItem value="DEBIT">Outgoing</MenuItem><MenuItem value="CREDIT">Incoming</MenuItem></TextField><TextField select label="Transaction type" size="small" value={type} onChange={e => setType(e.target.value)}><MenuItem value="ALL">All types</MenuItem><MenuItem value="INTERNAL">Same bank</MenuItem><MenuItem value="INTERBANK">Interbank</MenuItem></TextField><Field type="date" label="From" value={fromDate} onChange={setFromDate} size="small" InputLabelProps={{ shrink: true }} /><Field type="date" label="To" value={toDate} onChange={setToDate} size="small" InputLabelProps={{ shrink: true }} /></div>
    {filtered.length ? <TransfersTable rows={filtered} directory={directory} onSelect={onSelect} /> : <EmptyState title="No matching transfers" message="Try changing your search or filters." />}
  </section>;
}

function ApplicationPage({ me, token, onChanged, notify }) {
  const app = me?.application; const canApply = !app || app.status === 'HOLD';
  const [name, setName] = useState(''); const [address, setAddress] = useState(''); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const verified = me?.emailVerified === true;
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!verified) return setError('Verify your email address, then sign in again before submitting an application.');
    if (!name.trim() || name.length > 120 || !address.trim() || address.length > 300 || !file) return setError('Enter your name and address and select a proof document.');
    if (!['application/pdf','image/png','image/jpeg'].includes(file.type) || file.size > 256 * 1024) return setError('Choose a PDF, PNG or JPEG file no larger than 256 KiB.');
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      const isPng = [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!(isPdf || isPng || isJpeg)) throw new Error('The selected file content does not match a PDF, PNG or JPEG document.');
      let binary = ''; for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i, i+0x8000));
      await bankApi('/application', { token, method: 'POST', body: { name: name.trim(), address: address.trim(), document: { type: file.type, data: btoa(binary) } } });
      await onChanged(); notify('Application submitted. The bank team will review it.'); setFile(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="panel"><SectionTitle icon={BadgeCheck} title="Account application" description="Submit your account application and follow its review status." />
    {app && <div className="application-status"><div><span className="eyebrow">APPLICATION STATUS</span><h3>{statusText(app.status)}</h3><p>Revision {app.revision} · Updated {dateTime(app.updatedAt)}</p></div><Chip label={statusText(app.status)} className={`status-chip status-${String(app.status).toLowerCase()}`} />{app.note && <Alert severity={app.status === 'HOLD' ? 'warning' : 'info'}>{app.note}</Alert>}</div>}
    {!app && <div className="inline-note">You can start your application once you have created and verified your sign-in email.</div>}
    {canApply && <form className="form-grid" onSubmit={submit}><Field required label="Full name" value={name} onChange={setName} inputProps={{ maxLength: 120 }} /><Field required label="Address" value={address} onChange={setAddress} multiline minRows={3} inputProps={{ maxLength: 300 }} /><div className="file-input"><label htmlFor="proof-file">Proof document (PDF, PNG or JPEG · max 256 KiB)</label><input id="proof-file" type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0] || null)} /><small>{file?.name || 'No file selected'}</small></div>{!verified && <Alert severity="warning">Email verification is required for an application.</Alert>}{error && <Alert severity="error">{error}</Alert>}<div><Button variant="contained" type="submit" disabled={busy || !verified}>{busy ? 'Submitting…' : app ? 'Resubmit application' : 'Submit application'}</Button></div></form>}
    {app?.status === 'APPROVED' && <Alert severity="success">Your application is approved. An authorized bank operator must provision the account in SharedBank before it appears in Accounts.</Alert>}
  </section>;
}

function PortfolioPage({ positions, token, onChanged, notify }) {
  const [name, setName] = useState(''); const [amount, setAmount] = useState(''); const [editing, setEditing] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const total = positions.reduce((sum,p) => sum + (Number(p.valueMinor) || 0), 0);
  async function save(e) { e.preventDefault(); setError(''); const value = toPaise(amount); const title = name.trim(); if (!title || title.length > 120 || value === null || value > 100000000000) return setError('Enter a name and a positive value up to ₹1,000,000,000.'); setBusy(true); try { await bankApi(`/positions/${encodeURIComponent(editing?.id || crypto.randomUUID())}`, { token, method: 'PUT', body: { name: title, valueMinor: value } }); await onChanged(); setName(''); setAmount(''); setEditing(null); notify('Portfolio updated.'); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }
  async function remove(item) { if (!window.confirm(`Remove ${item.name} from your portfolio?`)) return; setBusy(true); setError(''); try { await bankApi(`/positions/${encodeURIComponent(item.id)}`, { token, method: 'DELETE' }); await onChanged(); notify('Holding removed.'); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  return <><section className="panel"><SectionTitle icon={BriefcaseBusiness} title="Portfolio" description="Estimated holdings recorded in your profile; these do not move money." /><div className="portfolio-total"><span>Total estimated value</span><strong>{money(total)}</strong></div>
    <form className="form-grid compact-form" onSubmit={save}><Field required label="Holding name" value={name} onChange={setName} inputProps={{ maxLength: 120 }} /><Field required label="Value (INR)" value={amount} onChange={setAmount} inputProps={{ inputMode: 'decimal' }} /><div className="action-row"><Button type="submit" variant="contained" startIcon={<Plus size={16} />} disabled={busy}>{editing?'Save changes':'Add holding'}</Button>{editing&&<Button onClick={()=>{setEditing(null);setName('');setAmount('');}}>Cancel</Button>}</div>{error && <Alert severity="error">{error}</Alert>}</form>
    {positions.length ? <div className="table-scroll"><table><thead><tr><th>Holding</th><th>Estimated value</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{positions.map(item => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{money(item.valueMinor)}</td><td>{dateTime(item.updatedAt)}</td><td><div className="action-row"><Button size="small" onClick={()=>{setEditing(item);setName(item.name);setAmount((item.valueMinor/100).toFixed(2));}}>Edit</Button><Button color="error" size="small" startIcon={<Trash2 size={15} />} onClick={() => remove(item)} disabled={busy}>Remove</Button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={BriefcaseBusiness} title="No holdings yet" message="Add an estimate to track it in your portfolio." />}
  </section></>;
}

function LoansPage({ loans, token, onChanged, notify }) {
  const [purpose, setPurpose] = useState(''); const [amount, setAmount] = useState(''); const [months, setMonths] = useState('12'); const [editing, setEditing] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function create(e) { e.preventDefault(); setError(''); const amountMinor = toPaise(amount); if (!purpose.trim() || purpose.length > 120 || amountMinor === null || amountMinor > 100000000000 || !/^\d+$/.test(months) || Number(months) < 1 || Number(months) > 360) return setError('Enter a purpose, positive amount up to ₹1,000,000,000 and a term between 1 and 360 months.'); setBusy(true); try { await bankApi(`/loans/${encodeURIComponent(editing?.id || crypto.randomUUID())}`, { token, method: 'PUT', body: { purpose: purpose.trim(), amountMinor, months: Number(months), version: editing?.version ?? 0 } }); await onChanged(); setPurpose(''); setAmount(''); setEditing(null); notify(editing ? 'Loan request updated.' : 'Loan application submitted.'); } catch(e) { setError(e.status===409?'This loan request changed. Refresh your data before editing again.':e.message); } finally { setBusy(false); } }
  async function withdraw(loan) { setError(''); setBusy(true); try { await bankApi('/loans/withdraw', { token, method: 'POST', body: { id: loan.id, version: loan.version } }); await onChanged(); notify('Loan request withdrawn.'); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  return <section className="panel"><SectionTitle icon={CreditCard} title="Loans" description="Request or update a loan application. Approval does not disburse funds." /><form className="form-grid" onSubmit={create}><Field required label="Purpose" value={purpose} onChange={setPurpose} inputProps={{ maxLength: 120 }} /><Field required label="Amount (INR)" value={amount} onChange={setAmount} inputProps={{ inputMode: 'decimal' }} /><Field required label="Term (months)" type="number" value={months} onChange={setMonths} inputProps={{ min: 1, max: 360, step: 1 }} />{error && <Alert severity="error">{error}</Alert>}<div className="action-row"><Button variant="contained" type="submit" disabled={busy}>{editing?'Save changes':'Submit loan request'}</Button>{editing&&<Button onClick={()=>{setEditing(null);setPurpose('');setAmount('');}}>Cancel edit</Button>}</div></form>
    {loans.length ? <div className="table-scroll"><table><thead><tr><th>Request</th><th>Amount</th><th>Term</th><th>Status</th><th></th></tr></thead><tbody>{loans.map(loan => <tr key={loan.id}><td><strong>{loan.purpose}</strong><small>Version {loan.version}</small></td><td>{money(loan.amountMinor)}</td><td>{loan.months} months</td><td><Chip size="small" label={statusText(loan.status)} className={`status-chip status-${String(loan.status).toLowerCase()}`} /></td><td>{loan.status === 'PENDING' && <div className="action-row"><Button onClick={()=>{setEditing(loan);setPurpose(loan.purpose);setAmount((loan.amountMinor/100).toFixed(2));setMonths(String(loan.months));}} disabled={busy}>Edit</Button><Button color="error" onClick={() => withdraw(loan)} disabled={busy}>Withdraw</Button></div>}</td></tr>)}</tbody></table></div> : <EmptyState icon={CreditCard} title="No loan requests" message="Submitted requests will appear here." />}
  </section>;
}

function AdminPage({ me, token, onChanged, notify }) {
  const [queue, setQueue] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [note, setNote] = useState(''); const [review, setReview] = useState(null); const [limitAccount, setLimitAccount] = useState(''); const [perTransfer, setPerTransfer] = useState('5000'); const [daily, setDaily] = useState('7000');
  const [partner, setPartner] = useState({ id:'', name:'', ifsc:'', address:'' });
  const load = useCallback(async () => { const result = await bankApi('/admin/queue', { token }); setQueue(result); }, [token]);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  async function decide(app, status) { setBusy(true); setError(''); try { await bankApi('/admin/review', { token, method: 'POST', body: { id: app.id, revision: app.revision, status, ...(status !== 'APPROVED' ? { note: note.trim() } : {}) } }); await load(); await onChanged(); notify(`Application ${status.toLowerCase()}.`); setReview(null); setNote(''); } catch(e) { setError(e.status === 409 ? 'This application changed or is already closed. The queue has been refreshed.' : e.message); if (e.status === 409) await load().catch(() => {}); } finally { setBusy(false); } }
  async function download(docId) { setBusy(true); setError(''); let url; try { const doc = await bankApi(`/admin/document/${encodeURIComponent(docId)}`, { token }); const binary = atob(doc.data); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0)); const blob = new Blob([bytes], { type: doc.type }); url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=`application-proof-${docId}.${doc.type === 'application/pdf' ? 'pdf' : doc.type === 'image/png' ? 'png' : 'jpg'}`; a.click(); notify('Document downloaded.'); } catch(e) { setError(e.message); } finally { if(url) setTimeout(() => URL.revokeObjectURL(url), 1000); setBusy(false); } }
  async function setLimits(e) { e.preventDefault(); setError(''); const p=toPaise(perTransfer), d=toPaise(daily); if (!limitAccount.trim() || p===null || d===null || d<p || p>100000000000 || d>100000000000) return setError('Enter a valid account ID and positive limits; daily limit must be at least the per-transfer limit.'); setBusy(true); try { await bankApi('/admin/limits', { token, method:'POST', body:{ accountId:limitAccount.trim(), perTransferMinor:p, dailyMinor:d } }); notify('Transfer limits updated.'); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  async function savePartner(e) { e.preventDefault(); setError(''); if(!/^P\d{3}$/.test(partner.id) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(partner.ifsc.toUpperCase()) || !partner.name.trim() || !partner.address.trim()) return setError('Enter a P### ID, valid IFSC, name and address.'); setBusy(true); try { await bankApi('/admin/partners',{token,method:'POST',body:{...partner,id:partner.id.toUpperCase(),ifsc:partner.ifsc.toUpperCase(),name:partner.name.trim(),address:partner.address.trim()}}); await load(); setPartner({id:'',name:'',ifsc:'',address:''}); notify('Local partner contact saved.'); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  async function deletePartner(id) { setBusy(true); setError(''); try { await bankApi(`/admin/partners/${encodeURIComponent(id)}`,{token,method:'DELETE'}); await load(); notify('Local partner contact removed.'); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  async function decideLoan(loan,status) { setBusy(true); setError(''); try { await bankApi('/admin/loans',{token,method:'POST',body:{id:loan.id,version:loan.version,status}}); await load(); notify(`Loan ${status.toLowerCase()}.`); } catch(e) { setError(e.status===409?'This loan changed or is no longer pending. Refreshing the queue.':e.message); await load().catch(()=>{}); } finally { setBusy(false); } }
  if (me?.admin !== true) return <Alert severity="error">Administrator access is required.</Alert>;
  return <div className="admin-stack"><Alert severity="info">Admin actions are authorized by the local Firebase service. Partner records below are local contacts and do not register a bank on the central network.</Alert>{error && <Alert severity="error">{error}</Alert>}
    <section className="panel"><SectionTitle icon={ShieldCheck} title="Application review" description="Use the current revision for every decision." action={<Button startIcon={<RefreshCw size={16}/>} onClick={() => load().catch(e=>setError(e.message))}>Refresh queue</Button>} />
      {queue?.applications?.length ? <div className="table-scroll"><table><thead><tr><th>Applicant</th><th>Status</th><th>Revision</th><th>Submitted</th><th>Proof</th><th>Decision</th></tr></thead><tbody>{queue.applications.map(app=><tr key={app.id}><td><strong>{app.name}</strong><small>{app.email || app.id}</small></td><td>{statusText(app.status)}</td><td>{app.revision}</td><td>{dateTime(app.updatedAt)}</td><td><Button size="small" startIcon={<Download size={15}/>} onClick={()=>download(app.id)} disabled={busy}>Download</Button></td><td>{['PENDING','HOLD'].includes(app.status) && <div className="action-row"><Button size="small" onClick={()=>decide(app,'APPROVED')} disabled={busy}>Approve</Button><Button size="small" onClick={()=>{setReview({app,status:'HOLD'});setNote('')}} disabled={busy}>Hold</Button><Button size="small" color="error" onClick={()=>{setReview({app,status:'REJECTED'});setNote('')}} disabled={busy}>Reject</Button></div>}</td></tr>)}</tbody></table></div> : <EmptyState icon={BadgeCheck} title="No applications waiting" message="New account applications will appear here." />}
    </section>
    <section className="panel"><SectionTitle icon={ArrowLeftRight} title="Transfer limits" description="No account picker or limit retrieval endpoint is provided; enter an account document ID."/>{localFunctionConfigured?<form className="form-grid" onSubmit={setLimits}><Field required label="Account document ID" value={limitAccount} onChange={setLimitAccount}/><Field required label="Per-transfer limit (INR)" value={perTransfer} onChange={setPerTransfer} inputProps={{inputMode:'decimal'}}/><Field required label="Daily limit (INR)" value={daily} onChange={setDaily} inputProps={{inputMode:'decimal'}}/><div><Button type="submit" variant="contained" disabled={busy}>Save limits</Button></div></form>:<div className="form-grid"><Alert severity="warning">Transfer limits are server-managed and cannot be changed through browser Firestore. This action remains available only when the authorized Nizzus bank service is configured.</Alert></div>}</section>
    <section className="panel"><SectionTitle icon={Building2} title="Partner contacts" description="These contacts are stored locally and do not affect SharedBank routing."/><form className="form-grid" onSubmit={savePartner}><Field required label="Partner ID (P###)" value={partner.id} onChange={v=>setPartner({...partner,id:v})}/><Field required label="Bank name" value={partner.name} onChange={v=>setPartner({...partner,name:v})}/><Field required label="IFSC" value={partner.ifsc} onChange={v=>setPartner({...partner,ifsc:v.toUpperCase()})}/><Field required label="Address" value={partner.address} onChange={v=>setPartner({...partner,address:v})}/><div><Button type="submit" variant="contained" disabled={busy}>Save contact</Button></div></form>{queue?.partners?.length ? <div className="table-scroll"><table><thead><tr><th>Bank</th><th>IFSC</th><th>Address</th><th></th></tr></thead><tbody>{queue.partners.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.id}</small></td><td>{p.ifsc}</td><td>{p.address}</td><td><Button color="error" onClick={()=>deletePartner(p.id)} disabled={busy}>Delete</Button></td></tr>)}</tbody></table></div>:<div className="empty compact-empty"><p>No partner contacts recorded.</p></div>}</section>
    <section className="panel"><SectionTitle icon={CreditCard} title="Loan review" description="Approval records a decision only; it does not disburse funds."/>{queue?.loans?.length ? <div className="table-scroll"><table><thead><tr><th>Loan</th><th>Customer</th><th>Amount</th><th>Term</th><th>Status</th><th>Decision</th></tr></thead><tbody>{queue.loans.map(loan=><tr key={loan.id}><td><strong>{loan.purpose}</strong><small>v{loan.version} · {loan.id}</small></td><td>{loan.uid}</td><td>{money(loan.amountMinor)}</td><td>{loan.months} months</td><td>{statusText(loan.status)}</td><td>{loan.status==='PENDING'&&<div className="action-row"><Button size="small" onClick={()=>decideLoan(loan,'APPROVED')} disabled={busy}>Approve</Button><Button size="small" color="error" onClick={()=>decideLoan(loan,'REJECTED')} disabled={busy}>Reject</Button></div>}</td></tr>)}</tbody></table></div>:<EmptyState icon={CreditCard} title="No loan applications" message="Customer loan requests will appear here."/>}</section>
    <Dialog open={Boolean(review)} onClose={()=>!busy&&setReview(null)} fullWidth maxWidth="xs"><DialogTitle>{review?.status === 'HOLD' ? 'Place application on hold' : 'Reject application'}</DialogTitle><DialogContent><p className="dialog-help">A short note is required and will be visible to the applicant.</p><TextField fullWidth required multiline minRows={3} label="Note" value={note} onChange={e=>setNote(e.target.value)} inputProps={{maxLength:300}} /></DialogContent><DialogActions><Button onClick={()=>setReview(null)}>Cancel</Button><Button variant="contained" color={review?.status==='REJECTED'?'error':'primary'} disabled={busy||!note.trim()} onClick={()=>decide(review.app,review.status)}>{review?.status}</Button></DialogActions></Dialog>
  </div>;
}

function ReceiptDialog({ row, onClose, directory }) {
  const title = id => directory.find(b => b.bankId === id)?.bankName || id || '—';
  return <Dialog open={Boolean(row)} onClose={onClose} fullWidth maxWidth="xs"><DialogTitle>Transfer status confirmation</DialogTitle><DialogContent>{row && <div className="receipt"><div className="receipt-mark"><Landmark size={21}/><b>{bank.name}</b></div><div className="receipt-amount">{money(row.amountMinor)}</div><Chip label={statusText(row.status)} className={`status-chip status-${String(row.status).toLowerCase()}`}/><dl><dt>Transfer ID</dt><dd className="mono">{row.transferId}</dd><dt>Date</dt><dd>{dateTime(row.createdAt)}</dd><dt>From bank</dt><dd>{title(row.sourceBankId)}</dd><dt>To bank</dt><dd>{title(row.destinationBankId)}</dd><dt>Currency</dt><dd>{row.currency || 'INR'}</dd>{row.code && <><dt>Result code</dt><dd>{row.code}</dd></>}</dl><p className="form-hint">This confirmation reflects the status returned by the bank service.</p></div>}</DialogContent><DialogActions><Button onClick={onClose}>Close</Button></DialogActions></Dialog>;
}

export default function LiveBank({ switchUrl }) {
  const [session, setSession] = useState(null); const [authMode, setAuthMode] = useState('signin'); const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [authError,setAuthError]=useState(''); const [notice,setNotice]=useState(''); const [loadingAuth,setLoadingAuth]=useState(false); const [loading,setLoading]=useState(false);
  const [dashboard,setDashboard]=useState({bank:null,accounts:[],transfers:[]}); const [dashboardLoaded,setDashboardLoaded]=useState(false); const [directory,setDirectory]=useState([]); const [me,setMe]=useState(null); const [page,setPage]=useState('overview'); const [selectedTransfer,setSelectedTransfer]=useState(null); const [uncertain,setUncertain]=useState(null); const [transferBusy,setTransferBusy]=useState(false);
  const inFlight=useRef(false); const activeToken=useRef(null); const lastTransfer=useRef(null); const pendingActivity=useRef(false);
  const prefix=`/banks/${bank.id}`;
  const activity=safeRows(dashboard.transfers);
  const accounts=safeRows(dashboard.accounts);
  const visibleRows=useMemo(()=>activity.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)),[activity]);
  pendingActivity.current=Boolean(lastTransfer.current)||activity.some(r=>['PENDING','PROCESSING'].includes(r.status));
  const refresh=useCallback(async ({quiet=false}={})=>{
    if(!session || inFlight.current) return;
    inFlight.current=true; if(!quiet) setLoading(true);
    try {
      const value=await workerApi(`${prefix}/dashboard`,{token:session.token});
      if(activeToken.current!==session.token) return;
      setDashboard({bank:value.bank||null,accounts:safeRows(value.accounts),transfers:safeRows(value.transfers)});
      setDashboardLoaded(true);
      setAuthError('');
      const outstanding=lastTransfer.current && safeRows(value.transfers).find(r=>r.transferId===lastTransfer.current.transferId);
      if(outstanding && ['COMPLETED','REJECTED','MANUAL_REVIEW'].includes(outstanding.status)) { lastTransfer.current=null; setUncertain(null); try{sessionStorage.removeItem(pendingStorageKey(session.uid));}catch{} }
    } catch(e) {
      if(activeToken.current!==session.token) return;
      if(e.status===401){setSession(null);setMe(null);setDashboard({bank:null,accounts:[],transfers:[]});setDashboardLoaded(false);setAuthError('Your session expired. Please sign in again.');}
      else setAuthError(e.message);
    } finally { inFlight.current=false; if(!quiet) setLoading(false); }
  },[prefix,session]);
  const refreshMe=useCallback(async()=>{
    if(!session||!serviceConfigured){setMe(null);return null;}
    const value=await bankApi('/me',{token:session.token}); setMe(value); return value;
  },[session]);
  const refreshAll=useCallback(async()=>{await refresh(); if(serviceConfigured) await refreshMe().catch(e=>setAuthError(e.message));},[refresh,refreshMe]);

  useEffect(()=>{activeToken.current=session?.token||null;},[session]);
  useEffect(()=>{
    if(!session) return undefined;
    const abort=new AbortController();
    let timer;
    async function poll(){if(document.visibilityState!=='visible')return; await refresh({quiet:true}); const interval=pendingActivity.current?15000:60000; timer=setTimeout(poll,interval);}
    refresh(); if(serviceConfigured) refreshMe().catch(e=>setAuthError(e.message));
    workerApi('/directory/banks',{signal:abort.signal}).then(v=>setDirectory(safeRows(v.banks))).catch(e=>{if(!abort.signal.aborted)setAuthError(e.message);});
    timer=setTimeout(poll,60000);
    const onVisibility=()=>{if(document.visibilityState==='visible'){clearTimeout(timer); poll();}};
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{clearTimeout(timer);abort.abort();document.removeEventListener('visibilitychange',onVisibility);};
  },[session,refresh,refreshMe]);

  function logout(){setSession(null);setMe(null);setDashboard({bank:null,accounts:[],transfers:[]});setDashboardLoaded(false);setNotice('');setUncertain(null);lastTransfer.current=null;setPage('overview');}
  useEffect(()=>{const onExpired=()=>{logout();setAuthError('Your session expired. Please sign in again.');};window.addEventListener('nizzus-session-expired',onExpired);return()=>window.removeEventListener('nizzus-session-expired',onExpired);},[]);
  async function authenticate(e){e.preventDefault();setLoadingAuth(true);setAuthError('');setNotice('');try{
    let user;
    if(authMode==='signup'){
      const created=await signUp(email.trim(),password);
      await sendVerification(created.idToken);
      setNotice('Your account was created. Check your email for a verification link, then return here to sign in.');setAuthMode('signin');return;
    }
    const value=await workerApi(`${prefix}/sign-in`,{method:'POST',body:{email:email.trim(),password}});
    let emailVerified=readFirebaseClaims(value.token).email_verified===true;
    try { user=await lookupFirebaseUser(value.token); emailVerified=Boolean(user?.emailVerified); } catch { /* The signed Worker token carries the verification claim; Firestore rules verify it server-side. */ }
    setDashboardLoaded(false); setSession({ ...value, emailVerified });
    try { const pending=JSON.parse(sessionStorage.getItem(pendingStorageKey(value.uid)) || 'null'); if(pending?.key && pending?.body) {lastTransfer.current=pending;if(pending.uncertain)setUncertain(pending);} } catch { /* Ignore malformed tab-scoped retry state. */ }
  }catch(e){setAuthError(e.message);}finally{setPassword('');setLoadingAuth(false);}}
  async function resendVerification(){setAuthError('');setNotice('');try { const fb=await signInFirebase(email.trim(),password); await sendVerification(fb.idToken); setNotice('A verification email was sent. After verifying, sign in again to refresh your verification status.'); } catch(e){setAuthError(e.message);} }
  async function forgotPassword(){setAuthError('');setNotice('');if(!email.trim())return setAuthError('Enter your email address first.');try{await sendPasswordReset(email.trim());setNotice('If an account exists for this email, Firebase will send password reset instructions.');}catch(e){setAuthError(e.message);}}
  async function submitTransfer(body, retry=false){
    const pendingKey=pendingStorageKey(session.uid); let intent=retry?lastTransfer.current:null;
    if(!intent){intent={body,key:crypto.randomUUID()};lastTransfer.current=intent;try{sessionStorage.setItem(pendingKey,JSON.stringify({...intent,uncertain:true}));}catch{}}
    setTransferBusy(true);setAuthError('');setNotice('');setUncertain(null);
    try {
      const result=await workerApi(`${prefix}/transfers`,{method:'POST',token:session.token,body:intent.body,key:intent.key});
      lastTransfer.current={...intent,transferId:result.transferId};
      try{sessionStorage.setItem(pendingKey,JSON.stringify({...lastTransfer.current,uncertain:false}));}catch{}
      setNotice(`${statusText(result.status)} · ${result.transferId}${result.status==='MANUAL_REVIEW'?' — contact bank support with this transfer ID.':''}`);
      if(['COMPLETED','REJECTED','MANUAL_REVIEW'].includes(result.status)){lastTransfer.current=null;try{sessionStorage.removeItem(pendingKey);}catch{}}
      await refresh({quiet:true});
    }catch(e){if(e.uncertain){const unresolved={...intent,uncertain:true};lastTransfer.current=unresolved;setUncertain(unresolved);try{sessionStorage.setItem(pendingKey,JSON.stringify(unresolved));}catch{}setAuthError('The service did not confirm the result. Refresh activity or retry this exact request; its idempotency key and details have been retained.');}else {lastTransfer.current=null;try{sessionStorage.removeItem(pendingKey);}catch{}setAuthError(e.message);}throw e;}finally{setTransferBusy(false);}
  }
  const navItems=[['overview','Overview',LayoutDashboard],['accounts','Accounts',WalletCards],['transfer','Transfer',Send],['history','History',FileText],['application','Application',BadgeCheck],['portfolio','Portfolio',BriefcaseBusiness],['loans','Loans',CreditCard],...(me?.admin===true?[['admin','Administration',ShieldCheck]]:[])];
  const displayName=session?.email?.split('@')[0]||'Customer';

  if(!session) return <div className="auth-shell"><div className="auth-brand"><span className="brand-icon"><Landmark size={24}/></span><div><strong>{bank.wordmark}</strong><small>PERSONAL BANKING</small></div></div><div className="auth-layout"><section className="auth-copy"><span className="eyebrow">BANKING, MADE CLEAR</span><h1>Your money,<br/>in good hands.</h1><p>Manage your accounts and keep track of every transfer with Nizzus Bank.</p><div className="auth-trust"><span><ShieldCheck size={17}/> Secure bank sign-in</span><span><ArrowLeftRight size={17}/> Clear transfer status</span></div><span className="auth-ifsc">IFSC&nbsp; {bank.ifsc}</span></section><section className="auth-card"><div className="auth-card-heading"><span className="eyebrow">WELCOME TO {bank.name.toUpperCase()}</span><h2>{authMode==='signin'?'Sign in to your account':'Create your account'}</h2><p>{authMode==='signin'?'Use your bank’s customer login to continue.':'Create an account using your email address.'}</p></div>
      {authError&&<Alert severity="error">{authError}</Alert>}{notice&&<Alert severity="success">{notice}</Alert>}
      <form className="form-grid" onSubmit={authenticate}><Field required label="Email address" type="email" value={email} onChange={setEmail} autoComplete="username"/><Field required label="Password" type="password" value={password} onChange={setPassword} autoComplete={authMode==='signin'?'current-password':'new-password'} inputProps={authMode==='signup'?{minLength:6}:undefined}/><Button type="submit" variant="contained" size="large" disabled={loadingAuth}>{loadingAuth?(authMode==='signin'?'Signing in…':'Creating account…'):(authMode==='signin'?'Sign in securely':'Create account')}</Button></form>
      <div className="auth-switch">{authMode==='signin'?<>New to Nizzus Bank? <button onClick={()=>{setAuthMode('signup');setAuthError('');setNotice('');}}>Create account</button></>:<>Already registered? <button onClick={()=>{setAuthMode('signin');setAuthError('');setNotice('');}}>Sign in</button></>}</div>
      {authMode==='signin'&&<div className="auth-links"><button className="resend-link" onClick={forgotPassword}>Forgot password?</button><button className="resend-link" onClick={resendVerification} disabled={!password}>Resend verification email</button></div>}
      <p className="auth-footnote">Banking session tokens stay in memory and expire when you sign out or the session ends.</p>
    </section></div><footer className="auth-footer"><span>© {new Date().getFullYear()} {bank.name}</span><a href={switchUrl} target="_blank" rel="noreferrer">SharedBank network</a></footer></div>;

  return <div className="layout live-bank-layout"><aside className="sidebar"><a href="#overview" className="brand"><span className="brand-icon"><Landmark size={23}/></span><span><strong>{bank.wordmark}</strong><small>PERSONAL BANKING</small></span></a><nav aria-label="Main navigation">{navItems.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon size={18}/>{label}</button>)}</nav><div className="sidebar-bottom"><a className="switch-link" href={switchUrl} target="_blank" rel="noreferrer"><Landmark size={16}/> SharedBank network</a><button className="signout-button" onClick={logout}><LogOut size={17}/> Sign out</button></div></aside>
    <div className="main"><header className="topbar"><div><strong>{bank.name}</strong><span className="topbar-separator">/</span><span>{navItems.find(i=>i[0]===page)?.[1] || 'Banking'}</span></div><div className="topbar-right"><span className="secure-label"><ShieldCheck size={15}/> Secure session</span><button className="avatar" title={session.email}>{displayName.slice(0,1).toUpperCase()}</button></div></header>
      <main className="content live-bank-content">{authError&&<Alert severity={authError.includes('expired')?'warning':'error'} onClose={()=>setAuthError('')}>{authError}</Alert>}{notice&&<Alert severity="success" onClose={()=>setNotice('')}>{notice}</Alert>}
        <div className="page-head"><div><span className="eyebrow">{new Intl.DateTimeFormat('en-IN',{weekday:'long',day:'numeric',month:'long',timeZone:bank.timeZone}).format(new Date())}</span><h1>{page==='overview'?`Good day, ${displayName}`:navItems.find(i=>i[0]===page)?.[1]}</h1><p>{page==='overview'?`Welcome to ${bank.name}. Here’s your account overview.`:page==='transfer'?'Send money to an account in the SharedBank network.':`Your ${navItems.find(i=>i[0]===page)?.[1].toLowerCase()} at ${bank.name}.`}</p></div><Button onClick={()=>refreshAll()} startIcon={<RefreshCw size={16}/>} disabled={loading}>{loading?'Refreshing…':'Refresh'}</Button></div>
        {!serviceConfigured&&session&&<Alert severity="info">SharedBank accounts and transfers remain available. To enable Nizzus applications, portfolio, loans and bank administration without Cloud Functions, configure <code>VITE_FIREBASE_PROJECT_ID</code> and deploy the included Firestore security rules.</Alert>}
        {!dashboardLoaded ? <section className="panel"><EmptyState icon={RefreshCw} title="Loading your banking details" message="Your accounts and recent transfer activity are being retrieved securely."/></section> : <>
        {page==='overview'&&<><section className="overview-hero"><div><span className="eyebrow">TOTAL AVAILABLE BALANCE</span><div className="hero-balance">{money(accounts.reduce((sum,a)=>sum+(Number(a.availableMinor)||0),0))}</div><p>Across {accounts.length} {accounts.length===1?'account':'accounts'} · {bank.name}</p></div><div className="hero-badge"><ShieldCheck size={18}/> Balances from your bank</div></section><div className="overview-stats"><div className="stat-card"><span>Accounts</span><strong>{accounts.length}</strong><small>Available to you</small></div><div className="stat-card"><span>Available funds</span><strong>{money(accounts.reduce((sum,a)=>sum+(Number(a.availableMinor)||0),0))}</strong><small>Ready to use</small></div><div className="stat-card"><span>On hold</span><strong>{money(accounts.reduce((sum,a)=>sum+(Number(a.heldMinor)||0),0))}</strong><small>Reserved by pending items</small></div></div>{accounts.length?<section className="panel"><SectionTitle icon={WalletCards} title="Your accounts" description="Balance information supplied by the bank." action={<Button onClick={()=>setPage('accounts')}>All accounts</Button>}/><Accounts accounts={accounts.slice(0,2)}/></section>:<section className="panel"><EmptyState icon={WalletCards} title="No accounts linked yet" message="If you have submitted an account application, check its review status in Application."/><div className="empty-action"><Button variant="contained" onClick={()=>setPage('application')}>Apply for an account</Button></div></section>}<section className="panel"><SectionTitle icon={Clock3} title="Recent transfers" description="Latest activity returned by SharedBank." action={<Button onClick={()=>setPage('history')}>View history</Button>}/>{visibleRows.length?<TransfersTable rows={visibleRows.slice(0,5)} directory={directory} onSelect={setSelectedTransfer}/>:<EmptyState title="No recent transfers" message="Transfer activity will appear here when available."/>}</section><div className="quick-actions"><button onClick={()=>setPage('transfer')}><Send size={18}/><span><b>Transfer money</b><small>Send to a bank account</small></span></button><button onClick={()=>setPage('application')}><BadgeCheck size={18}/><span><b>Account application</b><small>Apply or check your status</small></span></button><button onClick={()=>setPage('portfolio')}><BriefcaseBusiness size={18}/><span><b>Portfolio</b><small>Manage estimated holdings</small></span></button></div></>}
        {page==='accounts'&&(accounts.length?<><Accounts accounts={accounts}/><section className="panel"><SectionTitle icon={CircleHelp} title="Account details" description="Account identifiers and status received from the bank."/><div className="table-scroll"><table><thead><tr><th>Account</th><th>Account ID</th><th>Status</th><th>Currency</th><th>Posted</th><th>Held</th><th>Available</th></tr></thead><tbody>{accounts.map(a=><tr key={a.accountId}><td><strong>{accountName(a)}</strong><small>{a.accountNumber}</small></td><td className="mono">{a.accountId}</td><td>{a.status}</td><td>{a.currency}</td><td>{money(a.postedBalanceMinor)}</td><td>{money(a.heldMinor)}</td><td><strong>{money(a.availableMinor)}</strong></td></tr>)}</tbody></table></div></section></>:<section className="panel"><EmptyState icon={WalletCards} title="No bank accounts yet" message="Approved applications open an account through the bank service."/><div className="empty-action"><Button variant="contained" onClick={()=>setPage('application')}>Start application</Button></div></section>)}
        {page==='transfer'&&<TransferPage accounts={accounts} directory={directory} onSubmit={submitTransfer} busy={transferBusy} uncertain={uncertain} retry={()=>submitTransfer(uncertain.body,true)} activity={visibleRows}/>}
        {page==='history'&&<ActivityPage rows={visibleRows} directory={directory} onSelect={setSelectedTransfer}/>}
        {page==='application'&&(serviceConfigured?<ApplicationPage me={{...me,emailVerified:session.emailVerified}} token={session.token} onChanged={refreshMe} notify={setNotice}/>:<Alert severity="warning">Configure <code>VITE_FIREBASE_PROJECT_ID</code> and deploy the included Firestore rules to enable Nizzus account applications.</Alert>)}
        {page==='portfolio'&&(serviceConfigured?<PortfolioPage positions={safeRows(me?.positions)} token={session.token} onChanged={refreshMe} notify={setNotice}/>:<Alert severity="warning">Configure the Nizzus Firebase project to use portfolio features.</Alert>)}
        {page==='loans'&&(serviceConfigured?<LoansPage loans={safeRows(me?.loans)} token={session.token} onChanged={refreshMe} notify={setNotice}/>:<Alert severity="warning">Configure the Nizzus Firebase project to use loan features.</Alert>)}
        {page==='admin'&&(serviceConfigured?<AdminPage me={me} token={session.token} onChanged={refreshMe} notify={setNotice}/>:<Alert severity="warning">Configure the Nizzus Firebase project and staff custom claim to enable administration.</Alert>)}
        </>}
        <footer className="page-footer"><span><ShieldCheck size={14}/> Your session is protected</span><span>{bank.name} · {bank.id} · INR</span></footer>
      </main>
    </div><ReceiptDialog row={selectedTransfer} onClose={()=>setSelectedTransfer(null)} directory={directory}/>
  </div>;
}
