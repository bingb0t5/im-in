import { Event } from '../types';
import { supabase } from '../supabase';
import { guestService } from '../services/guestService';

export type EventForView = Event & {
  can_view_full_details?: boolean;
};

async function fetchEventForViewOnce(
  slug: string,
  accessCode?: string | null,
) {
  const { data, error } = await supabase.rpc('get_event_for_view', {
    p_slug: slug,
    p_access_code: accessCode || null,
    p_session_token: guestService.getStoredSession(),
  });

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return data[0] as EventForView;
}

export async function fetchEventForView(
  slug: string,
  accessCode?: string | null,
) {
  const requestedSlug = slug.trim();
  if (!requestedSlug) {
    return null;
  }

  const exactMatch = await fetchEventForViewOnce(requestedSlug, accessCode);
  if (exactMatch) {
    return exactMatch;
  }

  const lowercaseSlug = requestedSlug.toLowerCase();
  if (lowercaseSlug !== requestedSlug) {
    return fetchEventForViewOnce(lowercaseSlug, accessCode);
  }

  return null;
}
