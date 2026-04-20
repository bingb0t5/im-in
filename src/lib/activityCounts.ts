import { supabase } from '../supabase';
import { Event } from '../types';
import { dedupeEventsById } from './activityRelations';
import { guestService } from '../services/guestService';

type EventAttendeeViewRow = {
  status?: string | null;
};

type EventInterestViewRow = {
  id?: string | null;
};

function needsCountBackfill(event: Event) {
  return typeof event.confirmed_count !== 'number' || typeof event.thinking_count !== 'number';
}

function buildAccessCodeForView(event: Event) {
  return event.access_code || event.private_slug || event.join_code || null;
}

function getGuestSessionToken() {
  return guestService.getStoredSession();
}

async function fetchFallbackCountsForEvent(event: Event) {
  const [attendeeCountResult, interestCountResult] = await Promise.all([
    supabase
      .from('event_attendees')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('status', 'confirmed'),
    supabase
      .from('event_interests')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id),
  ]);

  if (!attendeeCountResult.error && !interestCountResult.error) {
    return {
      confirmed_count: Number(attendeeCountResult.count || 0),
      thinking_count: Number(interestCountResult.count || 0),
    };
  }

  const p_access_code = buildAccessCodeForView(event);
  const [attendeesResult, interestsResult] = await Promise.all([
    supabase.rpc('list_event_attendees_for_view', {
      p_event_id: event.id,
      p_access_code,
      p_session_token: getGuestSessionToken(),
    }),
    supabase.rpc('list_event_interests_for_view', {
      p_event_id: event.id,
      p_access_code,
      p_session_token: getGuestSessionToken(),
    }),
  ]);

  if (attendeesResult.error || interestsResult.error) {
    console.warn('Could not backfill activity counts from event view RPCs.', {
      eventId: event.id,
      attendeeCountError: attendeeCountResult.error?.message || null,
      interestCountError: interestCountResult.error?.message || null,
      attendeeError: attendeesResult.error?.message || null,
      interestError: interestsResult.error?.message || null,
    });
    return null;
  }

  const confirmedCount = ((attendeesResult.data || []) as EventAttendeeViewRow[]).filter(
    (row) => row.status === 'confirmed',
  ).length;
  const thinkingCount = ((interestsResult.data || []) as EventInterestViewRow[]).length;

  return {
    confirmed_count: confirmedCount,
    thinking_count: thinkingCount,
  };
}

export async function hydrateMissingEventCounts(events: Event[]) {
  const eventsNeedingBackfill = dedupeEventsById(events).filter(needsCountBackfill);
  if (eventsNeedingBackfill.length === 0) {
    return events;
  }

  const countsByEventId = new Map<
    string,
    {
      confirmed_count: number;
      thinking_count: number;
    }
  >();

  await Promise.all(
    eventsNeedingBackfill.map(async (event) => {
      const counts = await fetchFallbackCountsForEvent(event);
      if (counts) {
        countsByEventId.set(event.id, counts);
      }
    }),
  );

  return events.map((event) => {
    const fallbackCounts = countsByEventId.get(event.id);
    if (!fallbackCounts) return event;

    return {
      ...event,
      confirmed_count:
        typeof event.confirmed_count === 'number'
          ? event.confirmed_count
          : fallbackCounts.confirmed_count,
      thinking_count:
        typeof event.thinking_count === 'number'
          ? event.thinking_count
          : fallbackCounts.thinking_count,
    };
  });
}
