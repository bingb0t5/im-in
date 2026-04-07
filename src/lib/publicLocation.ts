export const LOCKED_PUBLIC_LOCATION_OPTIONS = ['Hoi An, Vietnam'] as const;

export const LOCKED_PUBLIC_LOCATION = LOCKED_PUBLIC_LOCATION_OPTIONS[0];

export function normalizePublicLocationText(_value?: string | null) {
  return LOCKED_PUBLIC_LOCATION;
}
