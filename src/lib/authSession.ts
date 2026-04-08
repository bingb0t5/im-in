import type { Session } from '@supabase/supabase-js';

export type SessionLoadOptions = {
  attempts?: number;
  delayMs?: number;
};

export type SessionLoadResult = {
  session: Session | null;
  error: Error | null;
  clearedInvalidRefreshToken: boolean;
  recoveredWithRefresh: boolean;
  lastCheck: 'getSession' | 'refreshSession' | null;
};

type SupabaseAuthLike = {
  getSession: () => Promise<{
    data: {
      session: Session | null;
    };
    error: Error | null;
  }>;
  refreshSession?: () => Promise<{
    data: {
      session: Session | null;
    };
    error: Error | null;
  }>;
  signOut: (options?: { scope?: 'global' | 'local' | 'others' }) => Promise<{
    error: Error | null;
  }>;
};

const INVALID_REFRESH_TOKEN_RE = /invalid refresh token|refresh token not found/i;

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function toError(error: unknown) {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error.trim()) return new Error(error);

  const message =
    typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
      ? error.message
      : 'Could not read the current session.';
  return new Error(message);
}

export function buildSupabaseAuthStorageKey(url: string) {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

export function isInvalidRefreshTokenErrorMessage(message?: string | null) {
  return INVALID_REFRESH_TOKEN_RE.test(message || '');
}

export async function clearLocalSupabaseSession(auth: Pick<SupabaseAuthLike, 'signOut'>) {
  await auth.signOut({ scope: 'local' });
}

async function confirmSessionViaRefresh(auth: SupabaseAuthLike): Promise<SessionLoadResult | null> {
  if (!auth.refreshSession) return null;

  try {
    const {
      data: { session },
      error,
    } = await auth.refreshSession();

    if (session) {
      return {
        session,
        error: null,
        clearedInvalidRefreshToken: false,
        recoveredWithRefresh: true,
        lastCheck: 'refreshSession',
      };
    }

    const refreshError = error ? toError(error) : null;
    if (refreshError && isInvalidRefreshTokenErrorMessage(refreshError.message)) {
      await clearLocalSupabaseSession(auth);
      return {
        session: null,
        error: refreshError,
        clearedInvalidRefreshToken: true,
        recoveredWithRefresh: false,
        lastCheck: 'refreshSession',
      };
    }

    return {
      session: null,
      error: refreshError,
      clearedInvalidRefreshToken: false,
      recoveredWithRefresh: false,
      lastCheck: 'refreshSession',
    };
  } catch (error) {
    const refreshError = toError(error);
    if (isInvalidRefreshTokenErrorMessage(refreshError.message)) {
      await clearLocalSupabaseSession(auth);
      return {
        session: null,
        error: refreshError,
        clearedInvalidRefreshToken: true,
        recoveredWithRefresh: false,
        lastCheck: 'refreshSession',
      };
    }

    return {
      session: null,
      error: refreshError,
      clearedInvalidRefreshToken: false,
      recoveredWithRefresh: false,
      lastCheck: 'refreshSession',
    };
  }
}

export async function loadSessionWithRecovery(
  auth: SupabaseAuthLike,
  {
    attempts = 2,
    delayMs = 160,
  }: SessionLoadOptions = {},
): Promise<SessionLoadResult> {
  let lastError: Error | null = null;
  let lastCheck: SessionLoadResult['lastCheck'] = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastCheck = 'getSession';
      const {
        data: { session },
        error,
      } = await auth.getSession();

      if (session) {
        return {
          session,
          error: null,
          clearedInvalidRefreshToken: false,
          recoveredWithRefresh: false,
          lastCheck: 'getSession',
        };
      }

      if (error) {
        lastError = toError(error);
        if (isInvalidRefreshTokenErrorMessage(lastError.message)) {
          const refreshed = await confirmSessionViaRefresh(auth);
          if (refreshed) {
            lastCheck = refreshed.lastCheck;
            if (refreshed.session || refreshed.clearedInvalidRefreshToken) {
              return refreshed;
            }
            lastError = refreshed.error ?? lastError;
          } else {
            await clearLocalSupabaseSession(auth);
            return {
              session: null,
              error: lastError,
              clearedInvalidRefreshToken: true,
              recoveredWithRefresh: false,
              lastCheck: 'getSession',
            };
          }
        }
      }
    } catch (error) {
      lastError = toError(error);
      if (isInvalidRefreshTokenErrorMessage(lastError.message)) {
        const refreshed = await confirmSessionViaRefresh(auth);
        if (refreshed) {
          lastCheck = refreshed.lastCheck;
          if (refreshed.session || refreshed.clearedInvalidRefreshToken) {
            return refreshed;
          }
          lastError = refreshed.error ?? lastError;
        } else {
          await clearLocalSupabaseSession(auth);
          return {
            session: null,
            error: lastError,
            clearedInvalidRefreshToken: true,
            recoveredWithRefresh: false,
            lastCheck: 'getSession',
          };
        }
      }
    }

    if (attempt === attempts - 1) {
      const refreshed = await confirmSessionViaRefresh(auth);
      if (refreshed) {
        lastCheck = refreshed.lastCheck;
        if (refreshed.session || refreshed.clearedInvalidRefreshToken) {
          return refreshed;
        }
        lastError = refreshed.error ?? lastError;
      }
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }

  return {
    session: null,
    error: lastError,
    clearedInvalidRefreshToken: false,
    recoveredWithRefresh: false,
    lastCheck,
  };
}
