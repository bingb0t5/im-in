const BANNER_STATE_KEY = 'im_in_webview_prompt_state_v1';
const POST_VERIFY_SUCCESS_KEY = 'im_in_webview_post_verify_success_v1';

export type PromptKind = 'verify_whatsapp' | 'add_to_home_screen';

type PersistedPromptState = {
  dismissals: Partial<Record<PromptKind, number>>;
};

type PersistedPostVerifySuccess = {
  pending: boolean;
  userId?: string | null;
  requestedAt?: number;
};

function canUseStorage() {
  return typeof window !== 'undefined';
}

function readState(): PersistedPromptState {
  if (!canUseStorage()) return { dismissals: {} };
  const raw = window.localStorage.getItem(BANNER_STATE_KEY);
  if (!raw) return { dismissals: {} };
  try {
    const parsed = JSON.parse(raw) as PersistedPromptState;
    return {
      dismissals: parsed.dismissals || {},
    };
  } catch {
    return { dismissals: {} };
  }
}

function writeState(next: PersistedPromptState) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(BANNER_STATE_KEY, JSON.stringify(next));
}

export function isPromptDismissed(kind: PromptKind, nowMs = Date.now()) {
  const state = readState();
  const dismissedUntil = state.dismissals[kind] || 0;
  return dismissedUntil > nowMs;
}

export function dismissPromptForDays(kind: PromptKind, days: number) {
  const state = readState();
  const until = Date.now() + days * 24 * 60 * 60 * 1000;
  state.dismissals[kind] = until;
  writeState(state);
}

export function clearPromptDismissal(kind: PromptKind) {
  const state = readState();
  delete state.dismissals[kind];
  writeState(state);
}

export function markPostVerifySuccessPending() {
  if (!canUseStorage()) return;
  const payload: PersistedPostVerifySuccess = {
    pending: true,
    requestedAt: Date.now(),
  };
  window.sessionStorage.setItem(POST_VERIFY_SUCCESS_KEY, JSON.stringify(payload));
}

export function markPostVerifySuccessPendingForUser(userId?: string | null) {
  if (!canUseStorage()) return;
  const payload: PersistedPostVerifySuccess = {
    pending: true,
    userId: userId || null,
    requestedAt: Date.now(),
  };
  window.sessionStorage.setItem(POST_VERIFY_SUCCESS_KEY, JSON.stringify(payload));
}

export function isPostVerifySuccessPending(currentUserId?: string | null) {
  if (!canUseStorage()) return false;
  const raw = window.sessionStorage.getItem(POST_VERIFY_SUCCESS_KEY);
  if (!raw) return false;

  if (raw === '1') return true;

  try {
    const parsed = JSON.parse(raw) as PersistedPostVerifySuccess;
    if (!parsed.pending) return false;
    if (!parsed.userId || !currentUserId) return true;
    return parsed.userId === currentUserId;
  } catch {
    return false;
  }
}

export function clearPostVerifySuccessPending() {
  if (!canUseStorage()) return;
  window.sessionStorage.removeItem(POST_VERIFY_SUCCESS_KEY);
}
