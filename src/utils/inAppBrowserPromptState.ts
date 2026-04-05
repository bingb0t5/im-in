const BANNER_STATE_KEY = 'im_in_webview_prompt_state_v1';
const POST_VERIFY_SUCCESS_KEY = 'im_in_webview_post_verify_success_v1';

export type PromptKind = 'verify_whatsapp' | 'add_to_home_screen';

type PersistedPromptState = {
  dismissals: Partial<Record<PromptKind, number>>;
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
  window.sessionStorage.setItem(POST_VERIFY_SUCCESS_KEY, '1');
}

export function isPostVerifySuccessPending() {
  if (!canUseStorage()) return false;
  return window.sessionStorage.getItem(POST_VERIFY_SUCCESS_KEY) === '1';
}

export function clearPostVerifySuccessPending() {
  if (!canUseStorage()) return;
  window.sessionStorage.removeItem(POST_VERIFY_SUCCESS_KEY);
}
