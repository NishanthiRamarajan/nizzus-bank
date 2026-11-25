import { FIREBASE_API_KEY } from '../config/api-config';

const endpoint = action => `https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(FIREBASE_API_KEY)}`;

export function readFirebaseClaims(idToken) {
  try {
    const payload=idToken.split('.')[1].replaceAll('-','+').replaceAll('_','/');
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length/4)*4,'=')));
  } catch { return {}; }
}

async function firebaseRequest(action, body) {
  if (!FIREBASE_API_KEY) throw new Error('Firebase Authentication is not configured. Set VITE_FIREBASE_API_KEY.');
  let response;
  try {
    response = await fetch(endpoint(action), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', signal: AbortSignal.timeout(15000), body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach Firebase Authentication. Check your connection and configuration.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data?.error?.message || '';
    const messages = {
      EMAIL_EXISTS: 'An account already exists for this email.',
      EMAIL_NOT_FOUND: 'No account was found for this email.',
      INVALID_PASSWORD: 'The password is incorrect.',
      INVALID_LOGIN_CREDENTIALS: 'The email or password is incorrect.',
      WEAK_PASSWORD: 'Choose a stronger password (at least 6 characters).',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please wait and try again.',
    };
    throw new Error(messages[code] || 'Firebase Authentication could not complete this request.');
  }
  return data;
}

export async function signUp(email, password) {
  return firebaseRequest('signUp', { email, password, returnSecureToken: true });
}
export async function signInFirebase(email, password) {
  return firebaseRequest('signInWithPassword', { email, password, returnSecureToken: true });
}
export async function sendVerification(idToken) {
  return firebaseRequest('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken });
}
export async function sendPasswordReset(email) {
  return firebaseRequest('sendOobCode', { requestType: 'PASSWORD_RESET', email });
}
export async function lookupFirebaseUser(idToken) {
  const data = await firebaseRequest('lookup', { idToken });
  return data.users?.[0] || null;
}
