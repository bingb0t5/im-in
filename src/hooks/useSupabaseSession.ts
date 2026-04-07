import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { loadSessionWithRecovery } from '../lib/authSession';
import { supabase } from '../supabase';

export function useSupabaseSession() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const syncSession = async (attempts = 2, delayMs = 160) => {
      try {
        const result = await loadSessionWithRecovery(supabase.auth, {
          attempts,
          delayMs,
        });

        if (cancelled) return;

        if (result.error && !result.clearedInvalidRefreshToken) {
          console.error('Error loading auth session:', result.error);
        }

        if (result.clearedInvalidRefreshToken) {
          console.warn('Cleared stale Supabase session after an invalid refresh token.');
        }

        setUser(result.session?.user ?? null);
        setConfigError(null);
      } catch (error: unknown) {
        if (cancelled) return;

        if (error instanceof Error && error.message.includes('Supabase configuration missing')) {
          setConfigError(error.message);
        } else {
          console.error('Unexpected error during auth bootstrap:', error);
        }

        setUser(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    try {
      void syncSession(3, 180);

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return;
        setUser(session?.user ?? null);
        setConfigError(null);
        setLoading(false);
      });

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          void syncSession(2, 180);
        }
      };

      const handleWindowFocus = () => {
        void syncSession(2, 120);
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleWindowFocus);

      return () => {
        cancelled = true;
        subscription.unsubscribe();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleWindowFocus);
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Supabase configuration missing')) {
        setConfigError(error.message);
      } else {
        console.error('Unexpected error during initialization:', error);
      }
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
  }, []);

  return {
    user,
    loading,
    configError,
  };
}
