import { supabase } from '../supabase';

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

export async function invokeAuthedFunction<T = unknown>(name: string, body: unknown) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(sessionError.message || 'Could not read the current session.');
  }

  if (!session?.access_token) {
    throw new Error('No active session token found. Try refreshing the page and signing in again.');
  }

  const invokeWithToken = async (accessToken: string) =>
    supabase.functions.invoke(name, {
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

  let { data, error } = await invokeWithToken(session.access_token);

  if (error) {
    const errorMessage = await readFunctionErrorMessage(error);
    if (/invalid jwt/i.test(errorMessage)) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session?.access_token) {
        throw new Error(refreshError?.message || errorMessage || 'Could not refresh your session. Try signing in again.');
      }

      ({ data, error } = await invokeWithToken(refreshed.session.access_token));
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
