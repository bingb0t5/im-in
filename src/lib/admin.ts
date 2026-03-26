export function parseEmailAllowlist(raw?: string | null) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailInAllowlist(email: string | null | undefined, rawAllowlist?: string | null) {
  if (!email) return false;
  return parseEmailAllowlist(rawAllowlist).includes(email.trim().toLowerCase());
}

export function isModerationAdminEmail(email: string | null | undefined) {
  return isEmailInAllowlist(email, import.meta.env.VITE_MODERATION_ADMIN_EMAILS);
}
