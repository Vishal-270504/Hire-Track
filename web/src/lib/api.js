/**
 * The one place the UI talks to the server. Errors become ApiError with the server's
 * message, code and per-field messages, so forms can show each problem next to its input.
 */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? 'Something went wrong. Please try again.');
    this.status = status;
    this.code = body?.code ?? 'unknown';
    this.fields = body?.fields ?? {};
    this.details = body?.details ?? null;
  }
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new ApiError(0, { error: 'Cannot reach the server. Check that it is running, then try again.', code: 'offline' });
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const patch = (url, body) => api('PATCH', url, body);
export const put = (url, body) => api('PUT', url, body);
export const del = (url) => api('DELETE', url);

/** Copies server-side field errors onto a react-hook-form instance. */
export function applyFieldErrors(setError, err) {
  for (const [field, message] of Object.entries(err.fields ?? {})) {
    if (field !== '_') setError(field, { type: 'server', message });
  }
}
