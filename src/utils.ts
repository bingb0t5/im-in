import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const DEFAULT_EVENT_TIMEZONE = 'Asia/Ho_Chi_Minh';

export const EVENT_TIMEZONE_OPTIONS = [
  { value: 'Asia/Ho_Chi_Minh', label: 'Vietnam (Ho Chi Minh City)' },
  { value: 'Asia/Bangkok', label: 'Thailand (Bangkok)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Australia/Sydney', label: 'Australia (Sydney)' },
  { value: 'Pacific/Auckland', label: 'New Zealand (Auckland)' },
  { value: 'UTC', label: 'UTC' },
];

function formatInTimeZone(
  date: string | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Date(date).toLocaleString('en-US', {
    timeZone,
    ...options,
  });
}

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '00';

  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number(pick('hour')),
    minute: Number(pick('minute')),
    second: Number(pick('second')),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const tz = getDatePartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(tz.year, tz.month - 1, tz.day, tz.hour, tz.minute, tz.second);
  return asUtc - date.getTime();
}

export function formatDate(date: string | Date, timeZone = DEFAULT_EVENT_TIMEZONE) {
  return formatInTimeZone(date, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDay(date: string | Date, timeZone = DEFAULT_EVENT_TIMEZONE) {
  return formatInTimeZone(date, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(date: string | Date, timeZone = DEFAULT_EVENT_TIMEZONE) {
  return formatInTimeZone(date, timeZone, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateWithTimeZone(date: string | Date, timeZone = DEFAULT_EVENT_TIMEZONE) {
  const timestamp = formatDate(date, timeZone);
  return `${timestamp} (${timeZone})`;
}

export function formatDurationMinutes(durationMinutes?: number | null) {
  const normalized = Math.max(15, durationMinutes || 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function buildDurationOptions(maxMinutes = 360, stepMinutes = 15) {
  const options: number[] = [];
  for (let value = stepMinutes; value <= maxMinutes; value += stepMinutes) {
    options.push(value);
  }
  return options;
}

export function eventLocalToUtcIso(localDateTime: string, timeZone = DEFAULT_EVENT_TIMEZONE) {
  // localDateTime format expected from datetime-local input: YYYY-MM-DDTHH:mm
  const [datePart, timePart] = localDateTime.split('T');
  if (!datePart || !timePart) {
    throw new Error('Invalid date/time input.');
  }
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error('Invalid date/time input.');
  }

  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guessUtcMs = targetLocalMs;

  // Iterate to resolve offset for chosen timezone.
  for (let i = 0; i < 3; i += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(guessUtcMs), timeZone);
    guessUtcMs = targetLocalMs - offsetMs;
  }

  return new Date(guessUtcMs).toISOString();
}

export function utcIsoToEventLocalInput(utcIso: string | null | undefined, timeZone = DEFAULT_EVENT_TIMEZONE) {
  if (!utcIso) return '';
  const parts = getDatePartsInTimeZone(new Date(utcIso), timeZone);
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  const hour = String(parts.hour).padStart(2, '0');
  const minute = String(parts.minute).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function toUtcIsoFromStartAndDuration(
  startsAtLocal: string,
  durationMinutes: number,
  timeZone = DEFAULT_EVENT_TIMEZONE,
) {
  const startsAtUtcIso = eventLocalToUtcIso(startsAtLocal, timeZone);
  const endsAtUtcMs = new Date(startsAtUtcIso).getTime() + durationMinutes * 60 * 1000;
  return {
    startsAtUtcIso,
    endsAtUtcIso: new Date(endsAtUtcMs).toISOString(),
  };
}

export function deriveDurationMinutes(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt || !endsAt) return 60;
  const durationMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 60;
  const roundedToQuarterHour = Math.round(durationMs / (15 * 60 * 1000)) * 15;
  return Math.min(360, Math.max(15, roundedToQuarterHour));
}

export function generateSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-');
}

function toGoogleCalendarUtcStamp(value: string | Date) {
  const iso = new Date(value).toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

interface GoogleCalendarUrlInput {
  title: string;
  startsAtIso: string;
  endsAtIso?: string | null;
  durationMinutes?: number | null;
  timezone?: string;
  location?: string | null;
  details?: string | null;
}

export function buildGoogleCalendarEventUrl(input: GoogleCalendarUrlInput) {
  const {
    title,
    startsAtIso,
    endsAtIso,
    durationMinutes = 60,
    timezone = DEFAULT_EVENT_TIMEZONE,
    location,
    details,
  } = input;

  const start = new Date(startsAtIso);
  const end = endsAtIso
    ? new Date(endsAtIso)
    : new Date(start.getTime() + Math.max(15, durationMinutes || 60) * 60 * 1000);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toGoogleCalendarUtcStamp(start)}/${toGoogleCalendarUtcStamp(end)}`,
    ctz: timezone,
  });

  if (location?.trim()) params.set('location', location.trim());
  if (details?.trim()) params.set('details', details.trim());

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
