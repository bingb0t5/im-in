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

export function isFeedbackAdminEmail(email: string | null | undefined) {
  return (
    isEmailInAllowlist(email, import.meta.env.VITE_FEEDBACK_ADMIN_EMAILS)
    || isModerationAdminEmail(email)
  );
}

export function isWhatsAppAdminEmail(email: string | null | undefined) {
  return (
    isEmailInAllowlist(email, import.meta.env.VITE_WHATSAPP_ADMIN_EMAILS)
    || isFeedbackAdminEmail(email)
    || isModerationAdminEmail(email)
  );
}

export function isAnyAdminEmail(email: string | null | undefined) {
  return isModerationAdminEmail(email) || isFeedbackAdminEmail(email) || isWhatsAppAdminEmail(email);
}

export function hasFrontendAdminAllowlist() {
  return (
    parseEmailAllowlist(import.meta.env.VITE_MODERATION_ADMIN_EMAILS).length > 0
    || parseEmailAllowlist(import.meta.env.VITE_FEEDBACK_ADMIN_EMAILS).length > 0
    || parseEmailAllowlist(import.meta.env.VITE_WHATSAPP_ADMIN_EMAILS).length > 0
  );
}

export function canAccessModerationAdminFrontend(email: string | null | undefined) {
  if (!hasFrontendAdminAllowlist()) return true;
  return isModerationAdminEmail(email);
}

export function canAccessFeedbackAdminFrontend(email: string | null | undefined) {
  if (!hasFrontendAdminAllowlist()) return true;
  return isFeedbackAdminEmail(email);
}

export function canAccessWhatsAppAdminFrontend(email: string | null | undefined) {
  if (!hasFrontendAdminAllowlist()) return true;
  return isWhatsAppAdminEmail(email);
}

export function canAccessAnyAdminFrontend(email: string | null | undefined) {
  if (!hasFrontendAdminAllowlist()) return true;
  return isAnyAdminEmail(email);
}
