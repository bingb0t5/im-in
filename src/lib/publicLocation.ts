export const LOCKED_PUBLIC_LOCATION_OPTIONS = ['Hoi An, Vietnam', 'Da Nang, Vietnam'] as const;

export const LOCKED_PUBLIC_LOCATION = LOCKED_PUBLIC_LOCATION_OPTIONS[0];

export function normalizePublicLocationText(value?: string | null) {
  if (
    value &&
    LOCKED_PUBLIC_LOCATION_OPTIONS.includes(
      value as (typeof LOCKED_PUBLIC_LOCATION_OPTIONS)[number],
    )
  ) {
    return value;
  }

  return LOCKED_PUBLIC_LOCATION;
}
