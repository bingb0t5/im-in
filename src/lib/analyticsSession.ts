const APP_SESSION_STORAGE_KEY = 'im_in_app_session_id';

function buildSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `im-in-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getAnalyticsSessionId() {
  if (typeof window === 'undefined') {
    return 'server';
  }

  try {
    const existing = window.sessionStorage.getItem(APP_SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const next = buildSessionId();
    window.sessionStorage.setItem(APP_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return buildSessionId();
  }
}
