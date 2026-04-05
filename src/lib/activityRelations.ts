import { ActivityRelationshipState, Event } from '../types';
import { BookingRow, groupBookingsByEvent } from './bookings';
import { isOnOrAfterTodayInTimeZone } from '../utils';

export type ActivityRelationshipGroup = {
  state: ActivityRelationshipState;
  events: Event[];
};

export function dedupeEventsById(events: Event[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!event?.id || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

export function mapJoinedBookingsToEvents(bookings: BookingRow[]) {
  return groupBookingsByEvent(bookings).map((booking) => booking.events as Event);
}

export function pickNextUpcomingActivity(groups: ActivityRelationshipGroup[]) {
  return pickUpcomingActivities(groups, 1)[0] || null;
}

export function pickUpcomingActivities(groups: ActivityRelationshipGroup[], limit = 3) {
  const upcomingEvents = dedupeEventsById(
    groups.flatMap((group) =>
      group.events.filter((event) => isOnOrAfterTodayInTimeZone(event.starts_at, event.timezone)),
    ),
  ).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  return upcomingEvents.slice(0, Math.max(1, limit));
}

export function filterEventsForQuery(events: Event[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return events;

  return events.filter((event) =>
    [event.title, event.description, event.public_summary, event.location_text, event.public_location_text, event.join_code]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
  );
}
