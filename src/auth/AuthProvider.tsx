import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { outbox } from '../lib/outbox';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** True while the user arrived from a password-reset email link. */
  recovering: boolean;
}

const Ctx = createContext<AuthState>({ session: null, user: null, loading: true, recovering: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, user: null, loading: true, recovering: false });
  const qc = useQueryClient();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      outbox.setUser(data.session?.user.id ?? null);
      setState((s) => ({ ...s, session: data.session, user: data.session?.user ?? null, loading: false }));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') qc.clear();
      outbox.setUser(session?.user.id ?? null);
      setState((s) => ({
        session,
        user: session?.user ?? null,
        loading: false,
        recovering: event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' ? false : s.recovering,
      }));
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [qc]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
