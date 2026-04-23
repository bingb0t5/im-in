import { Event } from '../types';
import {
  buildGoogleCalendarEventUrl,
  buildIcsEventContent,
  formatDate,
  generateSlug,
} from '../utils';
import { getPrivateEventSlug } from './events';

type ShareableEvent = Pick<
  Event,
  | 'id'
  | 'title'
  | 'slug'
  | 'private_slug'
  | 'join_code'
  | 'starts_at'
  | 'ends_at'
  | 'timezone'
  | 'duration_minutes'
  | 'description'
  | 'location_text'
  | 'google_maps_url'
  | 'status'
>;

export type EventShortcutKind = 'loc' | 'gcal' | 'ical';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function buildAbsoluteUrl(origin: string, path: string) {
  const normalizedOrigin = trimTrailingSlash(origin);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedOrigin}${normalizedPath}`;
}

export function buildPrivateActivityUrl(origin: string, event: ShareableEvent) {
  return buildAbsoluteUrl(origin, `/events/${getPrivateEventSlug(event)}`);
}

export function buildEventShortcutUrl(origin: string, kind: EventShortcutKind, event: ShareableEvent) {
  return buildAbsoluteUrl(origin, `/${kind}/${getPrivateEventSlug(event)}`);
}

export function buildCalendarLocation(event: Pick<Event, 'google_maps_url' | 'location_text'>) {
  const mapsUrl = event.google_maps_url?.trim() || '';
  if (mapsUrl) {
    return mapsUrl;
  }
  return event.location_text?.trim() || '';
}

export function buildCalendarDetails(
  event: Pick<Event, 'description' | 'location_text' | 'google_maps_url'>,
  activityUrl: string,
) {
  return [
    event.description?.trim() || '',
    event.location_text?.trim() ? `Exact location: ${event.location_text.trim()}` : '',
    '',
    `View activity: ${activityUrl}`,
    event.google_maps_url?.trim() ? `Directions: ${event.google_maps_url.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildGoogleCalendarShortcutTarget(origin: string, event: ShareableEvent) {
  const activityUrl = buildPrivateActivityUrl(origin, event);
  return buildGoogleCalendarUrlForActivity(event, activityUrl);
}

export function buildGoogleCalendarUrlForActivity(
  event: ShareableEvent,
  activityUrl: string,
) {
  return buildGoogleCalendarEventUrl({
    title: event.title,
    startsAtIso: event.starts_at,
    endsAtIso: event.ends_at || null,
    durationMinutes: event.duration_minutes || 60,
    timezone: event.timezone,
    location: buildCalendarLocation(event),
    details: buildCalendarDetails(event, activityUrl),
  });
}

export function buildIcsDownload(origin: string, event: ShareableEvent) {
  const activityUrl = buildPrivateActivityUrl(origin, event);
  return buildIcsDownloadForActivity(event, activityUrl);
}

export function buildIcsDownloadForActivity(
  event: ShareableEvent,
  activityUrl: string,
) {
  const startsAtStamp = new Date(event.starts_at).toISOString().replace(/\W/g, '').slice(0, 12);
  const uid = `${event.id}.${startsAtStamp}@joinimin.com`;
  const content = buildIcsEventContent({
    uid,
    title: event.title,
    startsAtIso: event.starts_at,
    endsAtIso: event.ends_at || null,
    durationMinutes: event.duration_minutes || 60,
    location: buildCalendarLocation(event),
    description: buildCalendarDetails(event, activityUrl),
    url: activityUrl,
    status: event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
  });

  return {
    filename: `${generateSlug(event.title || 'activity')}.ics`,
    content,
  };
}

export function buildPrivateWhatsappShareText(
  origin: string,
  event: ShareableEvent,
  activityUrlOverride?: string,
) {
  const mapsUrl = event.google_maps_url?.trim();
  const exactLocation = event.location_text?.trim();
  const signUpUrl = activityUrlOverride || buildPrivateActivityUrl(origin, event);
  const mapsShortcutUrl = buildEventShortcutUrl(origin, 'loc', event);
  const gcalShortcutUrl = buildEventShortcutUrl(origin, 'gcal', event);
  const icalShortcutUrl = buildEventShortcutUrl(origin, 'ical', event);
  const lines = [
    event.title,
    `Activity Date/Time: ${formatDate(event.starts_at, event.timezone)}`,
    'Sign up here:',
    signUpUrl,
    mapsUrl
      ? ['Google Maps Location:', mapsShortcutUrl].join('\n')
      : exactLocation
        ? `Google Maps Location: ${exactLocation}`
        : null,
    ['Add to Google Calendar:', gcalShortcutUrl].join('\n'),
    ['Add to Apple Cal (.ics):', icalShortcutUrl].join('\n'),
  ].filter(Boolean);

  return lines.join('\n\n');
}
