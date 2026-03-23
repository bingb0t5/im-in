import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

/**
 * Lazy-initialized Supabase client.
 * Throws a descriptive error if environment variables are missing when accessed.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(target, prop, receiver) {
    if (!_supabase) {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!url || !key) {
        const error = new Error('Supabase configuration missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
        // Log to console for easier debugging
        console.error(error.message);
        throw error;
      }
      
      _supabase = createClient(url, key);
    }
    return Reflect.get(_supabase, prop, receiver);
  }
});
