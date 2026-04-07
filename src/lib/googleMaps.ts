export type GoogleMapsCoordinates = {
  lat: number;
  lng: number;
};

export type ParsedGoogleMapsLocation = {
  normalizedUrl: string;
  exactLocation: string | null;
  publicLocation: string | null;
  coordinates: GoogleMapsCoordinates | null;
};

export type LocationAutofillFields = {
  google_maps_url: string;
  location_text: string;
  public_location_text: string;
};

export type GoogleMapsAutofillOptions = {
  lockedPublicLocation?: string;
};

const GOOGLE_MAPS_SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co'] as const;
const GENERIC_VENUE_WORDS = new Set([
  'apartments',
  'bar',
  'beach',
  'cafe',
  'calm',
  'camp',
  'center',
  'centre',
  'club',
  'court',
  'farm',
  'gym',
  'hall',
  'home',
  'hostel',
  'hotel',
  'house',
  'kitchen',
  'market',
  'park',
  'resort',
  'restaurant',
  'school',
  'spot',
  'station',
  'store',
  'studio',
  'villa',
  'yoga',
]);

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeText(value: string | null | undefined) {
  return (value || '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGoogleHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isCoordinatePair(value: string) {
  return /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(value.trim());
}

function cleanLocationCandidate(value: string | null | undefined) {
  const normalized = normalizeText(safeDecode(value || ''));
  if (!normalized || isCoordinatePair(normalized)) return null;
  return normalized;
}

function extractCoordinates(url: URL): GoogleMapsCoordinates | null {
  const path = url.pathname;

  const atMatch = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    return {
      lat: Number(atMatch[1]),
      lng: Number(atMatch[2]),
    };
  }

  const bangMatch = path.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (bangMatch) {
    return {
      lat: Number(bangMatch[1]),
      lng: Number(bangMatch[2]),
    };
  }

  const ll = url.searchParams.get('ll') || url.searchParams.get('center');
  if (ll && isCoordinatePair(ll)) {
    const [lat, lng] = ll.split(',').map((part) => Number(part.trim()));
    return { lat, lng };
  }

  return null;
}

function extractPathPlaceCandidate(url: URL) {
  const segments = url.pathname.split('/').filter(Boolean);
  const placeIndex = segments.findIndex((segment) => segment === 'place');
  if (placeIndex === -1 || !segments[placeIndex + 1]) return null;
  return cleanLocationCandidate(segments[placeIndex + 1]);
}

function extractQueryPlaceCandidate(url: URL) {
  const queryKeys = ['q', 'query', 'destination', 'daddr'];

  for (const key of queryKeys) {
    const value = url.searchParams.get(key);
    const cleaned = cleanLocationCandidate(value);
    if (cleaned) return cleaned;
  }

  return null;
}

export function isGoogleMapsUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    const host = normalizeGoogleHostname(url.hostname);
    return (
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      GOOGLE_MAPS_SHORT_HOSTS.includes(host as (typeof GOOGLE_MAPS_SHORT_HOSTS)[number])
    );
  } catch {
    return false;
  }
}

export function isGoogleMapsShortUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    const host = normalizeGoogleHostname(url.hostname);
    return GOOGLE_MAPS_SHORT_HOSTS.includes(host as (typeof GOOGLE_MAPS_SHORT_HOSTS)[number]);
  } catch {
    return false;
  }
}

export function normalizeGoogleMapsUrl(rawUrl: string) {
  const normalized = rawUrl.trim();
  const url = new URL(normalized);
  const host = normalizeGoogleHostname(url.hostname);

  if (
    host !== 'google.com' &&
    !host.endsWith('.google.com') &&
    !GOOGLE_MAPS_SHORT_HOSTS.includes(host as (typeof GOOGLE_MAPS_SHORT_HOSTS)[number])
  ) {
    throw new Error('Please use a Google Maps share link.');
  }

  return url.toString();
}

export function derivePublicLocationText(exactLocation: string | null | undefined) {
  const cleaned = cleanLocationCandidate(exactLocation);
  if (!cleaned) return null;

  const parts = cleaned
    .split(',')
    .map((part) => normalizeText(part.replace(/\b\d{4,6}\b/g, '')))
    .filter(Boolean);

  if (parts.length >= 2) {
    const generalizedParts = parts.slice(1);
    const limitedParts =
      generalizedParts.length > 3
        ? generalizedParts.slice(generalizedParts.length - 3)
        : generalizedParts;

    if (limitedParts.length > 0) {
      return limitedParts.join(', ');
    }
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 4) return null;

  const trailingWords = words.slice(-2);
  const normalizedTrailingWords = trailingWords.map((word) => word.toLowerCase());
  if (normalizedTrailingWords.some((word) => GENERIC_VENUE_WORDS.has(word))) {
    return null;
  }

  return trailingWords.join(' ');
}

export function parseGoogleMapsLocation(rawUrl: string): ParsedGoogleMapsLocation {
  const normalizedUrl = normalizeGoogleMapsUrl(rawUrl);
  const url = new URL(normalizedUrl);

  const exactLocation = extractQueryPlaceCandidate(url) || extractPathPlaceCandidate(url);
  const publicLocation = derivePublicLocationText(exactLocation);
  const coordinates = extractCoordinates(url);

  return {
    normalizedUrl,
    exactLocation,
    publicLocation,
    coordinates,
  };
}

export function applyGoogleMapsAutofill(
  currentFields: LocationAutofillFields,
  parsedLocation: ParsedGoogleMapsLocation,
  options?: GoogleMapsAutofillOptions,
): LocationAutofillFields {
  return {
    google_maps_url: parsedLocation.normalizedUrl || currentFields.google_maps_url,
    location_text: parsedLocation.exactLocation || currentFields.location_text,
    public_location_text:
      options?.lockedPublicLocation
        ? options.lockedPublicLocation
        : parsedLocation.publicLocation || currentFields.public_location_text,
  };
}
