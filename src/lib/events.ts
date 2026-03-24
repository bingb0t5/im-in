import { Event } from '../types';

type EventWithAttendeeStatuses = Event & {
  event_attendees?: Array<{ status?: string }>;
};

export function withConfirmedCounts(events: EventWithAttendeeStatuses[]): Event[] {
  return events.map((event) => ({
    ...event,
    confirmed_count: event.event_attendees?.filter((a) => a.status === 'confirmed').length || 0,
  }));
}

export function buildEventPath(
  event: Pick<Event, 'slug' | 'visibility' | 'is_public' | 'access_code'>,
  options?: { preferPrivateAccess?: boolean },
) {
  const base = `/events/${event.slug}`;
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
  const preferPrivateAccess = !!options?.preferPrivateAccess;

  if (preferPrivateAccess && visibility === 'semi_public' && event.access_code) {
    return `${base}?access=${event.access_code}`;
  }

  return base;
}
