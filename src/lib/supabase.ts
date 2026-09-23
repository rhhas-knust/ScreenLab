import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the two required environment variables are present. */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://invalid.localhost', anonKey ?? 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  // No hidden automatic retries (up to ~7 s when offline): ScreenLab retries
  // itself — the save queue for writes and React Query for reads — and shows
  // the user an honest connection status straight away.
  db: { retry: false },
});

export const PDF_BUCKET = 'full-texts';
