/** Turn Supabase / network errors into messages a researcher can act on. */
export interface AppErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
  name?: string;
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String((e as AppErrorLike)?.message ?? e ?? '');
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|ERR_INTERNET|ECONNRESET|AuthRetryableFetchError/i.test(msg)
    || (e as AppErrorLike)?.name === 'AuthRetryableFetchError';
}

export function isAuthError(e: unknown): boolean {
  const err = e as AppErrorLike;
  const msg = String(err?.message ?? '');
  return err?.code === 'PGRST301' || err?.code === 'PGRST303' || err?.status === 401 || /jwt expired|invalid jwt|not authenticated/i.test(msg);
}

export function friendlyError(e: unknown, fallback = 'Something went wrong.'): string {
  if (!e) return fallback;
  const err = e as AppErrorLike;
  const msg = String(err.message ?? e);
  if (isNetworkError(e)) return 'Network problem — could not reach the server. Check your internet connection and try again.';
  if (isAuthError(e)) return 'Your session has expired. Please sign in again.';
  switch (err.code) {
    case '42501': return 'You do not have permission to do that (this data belongs to another account or project).';
    case '23505': return 'That already exists (duplicate name).';
    case '23503': return 'This item is linked to other data and cannot be changed that way.';
    case '23514': return 'One of the values is not allowed.';
    case '22P02': return 'Invalid identifier or value.';
    case 'P0002': return 'Not found — it may have been deleted.';
    case '22023': return msg;
    case '57014': return 'The server took too long to respond. Try a smaller batch or try again.';
    case 'PGRST116': return 'Not found, or you do not have access to it.';
  }
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email address first — check your inbox for the confirmation link.';
  if (/user already registered/i.test(msg)) return 'An account with this email already exists. Try signing in instead.';
  if (/password should be at least/i.test(msg)) return msg;
  if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/payload too large|413/i.test(msg)) return 'The file is too large.';
  return msg && msg.length < 200 ? msg : fallback;
}

/** Throw if a Supabase response has an error; otherwise return data. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}
