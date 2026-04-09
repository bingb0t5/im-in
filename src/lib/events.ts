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

export function getPublicEventSlug(
  event: Pick<Event, 'slug' | 'public_slug'>,
) {
  return event.public_slug || event.slug;
}

export function getPrivateEventSlug(
  event: Pick<Event, 'slug' | 'private_slug' | 'join_code'>,
) {
  return event.private_slug || event.join_code || event.slug;
}

export function buildEventPath(
  event: Pick<Event, 'slug' | 'public_slug' | 'private_slug' | 'join_code' | 'visibility' | 'is_public' | 'access_code'>,
  options?: { preferPrivateAccess?: boolean },
) {
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
  const preferPrivateAccess = !!options?.preferPrivateAccess;
  const publicSlug = getPublicEventSlug(event);
  const privateSlug = getPrivateEventSlug(event);
  /** Semi-public discoverability uses the public slug; full details use the private slug capability link. */
  const usePrivatePath =
    preferPrivateAccess || (visibility !== 'public' && visibility !== 'semi_public');
  const selectedSlug = usePrivatePath ? privateSlug : publicSlug;
  const base = `/events/${selectedSlug}`;

  if (!selectedSlug) {
    return '/';
  }

  return base;
}
