import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { loadSessionWithRecovery } from '../lib/authSession';
import { supabase } from '../supabase';

type SyncTrigger = 'bootstrap' | 'visibility' | 'focus' | 'visibility_retry' | 'focus_retry';

export function useSupabaseSession() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const resumeRetryTimeoutRef = useRef<number | null>(null);
  currentUserRef.current = user;

  useEffect(() => {
    let cancelled = false;

    const clearResumeRetry = () => {
      if (resumeRetryTimeoutRef.current !== null) {
        window.clearTimeout(resumeRetryTimeoutRef.current);
        resumeRetryTimeoutRef.current = null;
      }
    };

    const scheduleResumeRetry = (trigger: 'visibility' | 'focus') => {
      clearResumeRetry();
      const retryTrigger: SyncTrigger = trigger === 'visibility' ? 'visibility_retry' : 'focus_retry';
      resumeRetryTimeoutRef.current = window.setTimeout(() => {
        resumeRetryTimeoutRef.current = null;
        void syncSession(retryTrigger, 4, 240);
      }, 260);
    };

    const syncSession = async (trigger: SyncTrigger, attempts = 2, delayMs = 160) => {
      try {
        const result = await loadSessionWithRecovery(supabase.auth, {
          attempts,
          delayMs,
        });

        if (cancelled) return;

        if (result.recoveredWithRefresh) {
          console.info('Recovered Supabase session during auth sync.', {
            trigger,
            lastCheck: result.lastCheck,
          });
        }

        if (result.clearedInvalidRefreshToken) {
          console.warn('Cleared stale Supabase session after a confirmed invalid refresh token.', {
            trigger,
            lastCheck: result.lastCheck,
          });
        } else if (result.error) {
          console.warn('Auth sync hit a recoverable session error.', {
            trigger,
            lastCheck: result.lastCheck,
            message: result.error.message,
          });
        }

        const nextUser = result.session?.user ?? null;
        const hadUser = !!currentUserRef.current;
        const allowResumeGraceRetry = trigger === 'visibility' || trigger === 'focus';
        if (!nextUser && hadUser && !result.clearedInvalidRefreshToken && allowResumeGraceRetry) {
          console.info('Preserving existing auth user while iPhone resume session recovery settles.', {
            trigger,
            lastCheck: result.lastCheck,
            hadUser,
          });
          scheduleResumeRetry(trigger);
          setConfigError(null);
          return;
        }

        clearResumeRetry();
        setUser(nextUser);
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
      void syncSession('bootstrap', 3, 180);

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          console.info('Supabase auth state changed.', {
            event,
            hasSession: !!session,
          });
        }
        clearResumeRetry();
        setUser(session?.user ?? null);
        setConfigError(null);
        setLoading(false);
      });

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          void syncSession('visibility', 2, 180);
        }
      };

      const handleWindowFocus = () => {
        void syncSession('focus', 2, 120);
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleWindowFocus);

      return () => {
        cancelled = true;
        clearResumeRetry();
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
        clearResumeRetry();
      };
    }
  }, []);

  return {
    user,
    loading,
    configError,
  };
}
