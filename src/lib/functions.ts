import { supabase } from '../supabase';
import { clearLocalSupabaseSession, isInvalidRefreshTokenErrorMessage, loadSessionWithRecovery } from './authSession';

const TRANSIENT_FUNCTION_INVOKE_ERROR_RE = /failed to send a request to the edge function|networkerror|load failed|fetch failed/i;

function extractFunctionErrorMessage(error: unknown) {
  const response = (error as { context?: Response }).context;
  if (response instanceof Response) {
    return response.statusText || 'Function call failed.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Function call failed.';
}

async function readFunctionErrorMessage(error: unknown) {
  const response = (error as { context?: Response }).context;

  if (response instanceof Response) {
    try {
      const cloned = response.clone();
      const json = await cloned.json();
      if (typeof json?.error === 'string') {
        return json.error;
      }
      if (typeof json?.message === 'string') {
        return json.message;
      }
      return JSON.stringify(json);
    } catch {
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        if (text) return text;
      } catch {
        // Fall back to default extraction below.
      }
    }
  }

  return extractFunctionErrorMessage(error);
}

async function throwDetailedFunctionError(error: unknown) {
  throw new Error(await readFunctionErrorMessage(error));
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTransientFunctionInvokeError(message: string) {
  return TRANSIENT_FUNCTION_INVOKE_ERROR_RE.test(message);
}

async function waitForSessionAccessToken({
  attempts = 6,
  delayMs = 250,
}: {
  attempts?: number;
  delayMs?: number;
} = {}) {
  let lastSessionError: string | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { session, error: sessionError, clearedInvalidRefreshToken } = await loadSessionWithRecovery(
      supabase.auth,
      { attempts: 1, delayMs },
    );

    if (sessionError) {
      lastSessionError = clearedInvalidRefreshToken
        ? 'Your session expired. Please sign in again.'
        : sessionError.message || 'Could not read the current session.';
    }

    if (session?.access_token) {
      return session.access_token;
    }

    if (clearedInvalidRefreshToken) {
      break;
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }

  throw new Error(lastSessionError || 'No active session token found. Try refreshing the page and signing in again.');
}

export async function invokeAuthedFunction<T = unknown>(name: string, body: unknown) {
  const invokeWithToken = async (accessToken: string) =>
    supabase.functions.invoke(name, {
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

  let accessToken = await waitForSessionAccessToken();
  let { data, error } = await invokeWithToken(accessToken);

  if (error) {
    const errorMessage = await readFunctionErrorMessage(error);
    if (/invalid jwt/i.test(errorMessage)) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session?.access_token) {
        const refreshMessage = refreshError?.message || errorMessage || 'Could not refresh your session. Try signing in again.';
        if (isInvalidRefreshTokenErrorMessage(refreshMessage)) {
          await clearLocalSupabaseSession(supabase.auth);
          throw new Error('Your session expired. Please sign in again.');
        }
        throw new Error(refreshMessage);
      }

      accessToken = refreshed.session.access_token;
      ({ data, error } = await invokeWithToken(accessToken));
    } else if (isTransientFunctionInvokeError(errorMessage)) {
      await sleep(600);
      accessToken = await waitForSessionAccessToken({ attempts: 8, delayMs: 300 });
      ({ data, error } = await invokeWithToken(accessToken));
    }
  }

  if (error) {
    await throwDetailedFunctionError(error);
  }

  return data as T;
}

export async function invokePublicFunction<T = unknown>(name: string, body: unknown) {
  const { data, error } = await supabase.functions.invoke(name, {
    body,
  });

  if (error) {
    await throwDetailedFunctionError(error);
  }

  return data as T;
}
