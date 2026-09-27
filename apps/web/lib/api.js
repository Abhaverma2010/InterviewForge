// Thin client for the Express API (reached through this app's /api rewrite).
// Every failure becomes an ApiError carrying the server's code and message,
// so components can react to codes (VERSION_CONFLICT, UNAUTHENTICATED...)
// and show messages without parsing anything.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const listeners = new Set();
/** Called whenever the API says the session is gone, so the app can send the user to login. */
export function onUnauthenticated(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (e.g. the API is down and a proxy answered).
  }
  if (!res.ok) {
    const error = data?.error ?? {};
    const apiError = new ApiError(
      res.status,
      error.code ?? 'HTTP_ERROR',
      error.message ?? `The server answered ${res.status}. Please try again.`,
      error.details,
    );
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
      listeners.forEach((listener) => listener(apiError));
    }
    throw apiError;
  }
  return data;
}

/** Field-level messages from a 400 response, keyed by field path. */
export function fieldErrors(error) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  return Object.fromEntries(error.details.map((d) => [d.path, d.message]));
}
