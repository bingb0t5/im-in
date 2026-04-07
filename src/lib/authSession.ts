import type { Session } from '@supabase/supabase-js';

export type SessionLoadOptions = {
  attempts?: number;
  delayMs?: number;
};

export type SessionLoadResult = {
  session: Session | null;
  error: Error | null;
  clearedInvalidRefreshToken: boolean;
};

type SupabaseAuthLike = {
  getSession: () => Promise<{
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

export async function loadSessionWithRecovery(
  auth: SupabaseAuthLike,
  {
    attempts = 2,
    delayMs = 160,
  }: SessionLoadOptions = {},
): Promise<SessionLoadResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const {
        data: { session },
        error,
      } = await auth.getSession();

      if (session) {
        return {
          session,
          error: null,
          clearedInvalidRefreshToken: false,
        };
      }

      if (error) {
        lastError = toError(error);
        if (isInvalidRefreshTokenErrorMessage(lastError.message)) {
          await clearLocalSupabaseSession(auth);
          return {
            session: null,
            error: lastError,
            clearedInvalidRefreshToken: true,
          };
        }
      }
    } catch (error) {
      lastError = toError(error);
      if (isInvalidRefreshTokenErrorMessage(lastError.message)) {
        await clearLocalSupabaseSession(auth);
        return {
          session: null,
          error: lastError,
          clearedInvalidRefreshToken: true,
        };
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
  };
}
