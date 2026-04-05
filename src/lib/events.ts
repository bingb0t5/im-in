import { Event } from '../types';

type EventWithAttendeeStatuses = Event & {
  event_attendees?: Array<{ status?: string }>;
  event_interests?: Array<{ id?: string }>;
};

export function withConfirmedCounts(events: EventWithAttendeeStatuses[]): Event[] {
  return events.map((event) => ({
    ...event,
    confirmed_count: event.event_attendees?.filter((a) => a.status === 'confirmed').length || 0,
    thinking_count: event.event_interests?.length || 0,
  }));
}

export function buildEventPath(
  event: Pick<Event, 'slug' | 'public_slug' | 'private_slug' | 'join_code' | 'visibility' | 'is_public' | 'access_code'>,
  options?: { preferPrivateAccess?: boolean },
) {
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
  const preferPrivateAccess = !!options?.preferPrivateAccess;
  const publicSlug = event.public_slug || event.slug;
  const privateSlug = event.private_slug || event.join_code || event.slug;
  const usePrivatePath = preferPrivateAccess || visibility !== 'public';
  const selectedSlug = usePrivatePath ? privateSlug : publicSlug;
  const base = `/events/${selectedSlug}`;

  if (!selectedSlug) {
    return '/';
  }

  if (preferPrivateAccess && visibility === 'semi_public' && event.access_code && privateSlug === publicSlug) {
    return `${base}?access=${event.access_code}`;
  }

  return base;
}
