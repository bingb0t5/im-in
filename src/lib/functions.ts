import { supabase } from '../supabase';

function extractFunctionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Function call failed.';
}

export async function invokeAuthedFunction<T = unknown>(name: string, body: unknown) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(sessionError.message || 'Could not read the current session.');
  }

  if (!session?.access_token) {
    throw new Error('No active session token found. Try refreshing the page and signing in again.');
  }

  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    const response = (error as { context?: Response }).context;

    if (response instanceof Response) {
      try {
        const cloned = response.clone();
        const json = await cloned.json();
        if (typeof json?.error === 'string') {
          throw new Error(json.error);
        }
        if (typeof json?.message === 'string') {
          throw new Error(json.message);
        }
        throw new Error(JSON.stringify(json));
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message) {
          throw parseError;
        }

        try {
          const text = await response.text();
          if (text) {
            throw new Error(text);
          }
        } catch {
          // Fall back to the outer error message below.
        }
      }
    }

    throw new Error(extractFunctionErrorMessage(error));
  }

  return data as T;
}
