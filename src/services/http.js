export async function request(base, path, { method = 'GET', token, body, key, signal, timeoutMs = 15000 } = {}) {
  if (!base) throw new Error('This service is not configured yet. Add its URL in the deployment environment.');
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (key) headers.set('Idempotency-Key', key);
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method, headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'error', credentials: 'omit',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const failure = new Error(timeout.aborted ? 'The request timed out. Refresh before retrying.' : 'Could not reach the service. Check your connection and service configuration.');
    failure.uncertain = method !== 'GET';
    throw failure;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token && typeof window !== 'undefined') window.dispatchEvent(new Event('nizzus-session-expired'));
    const message = response.status === 401 ? 'Your sign-in has expired. Sign in again to continue.'
      : response.status >= 500 ? 'The service is temporarily unavailable. Refresh activity before trying again.'
        : data?.error?.message || data?.error || `The service returned HTTP ${response.status}.`;
    const failure = new Error(typeof message === 'string' ? message : `The service returned HTTP ${response.status}.`);
    failure.status = response.status;
    failure.code = data?.error?.code;
    failure.uncertain = response.status >= 500 && method !== 'GET';
    throw failure;
  }
  return data;
}
