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

type SupabaseAuthStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function readCookie(name: string) {
  if (typeof document === 'undefined') return null;
  const encodedName = encodeURIComponent(name);
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for (const part of parts) {
    if (!part.startsWith(`${encodedName}=`)) continue;
    const rawValue = part.slice(encodedName.length + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === 'undefined') return;
  const encodedName = encodeURIComponent(name);
  const encodedValue = encodeURIComponent(value);
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${encodedName}=${encodedValue}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

function deleteCookie(name: string) {
  if (typeof document === 'undefined') return;
  const encodedName = encodeURIComponent(name);
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${encodedName}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function createSupabaseDualSessionStorage(): SupabaseAuthStorageLike {
  const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

  // iOS Safari and iOS standalone app mode can diverge in web storage behavior.
  // Dual-write keeps Supabase auth in localStorage and a same-origin cookie so either
  // context can recover session state from the other.
  return {
    getItem(key: string) {
      if (typeof window === 'undefined') return null;
      try {
        const fromLocalStorage = window.localStorage.getItem(key);
        if (fromLocalStorage) return fromLocalStorage;
      } catch {
        // Continue to cookie fallback if localStorage is unavailable.
      }

      const fromCookie = readCookie(key);
      if (!fromCookie) return null;

      try {
        window.localStorage.setItem(key, fromCookie);
      } catch {
        // Best-effort sync only.
      }
      return fromCookie;
    },
    setItem(key: string, value: string) {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Best-effort write only.
      }
      writeCookie(key, value, COOKIE_MAX_AGE_SECONDS);
    },
    removeItem(key: string) {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // Best-effort removal only.
        }
      }
      deleteCookie(key);
    },
  };
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
