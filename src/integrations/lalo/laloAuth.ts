import { supabase } from '../../supabase';
import { laloClient, type LaloCompleteResponse, type LaloStatusResponse } from './laloClient';

const LALO_ATTEMPT_STORAGE_KEY = 'im_in_lalo_auth_attempt';
const LALO_COMPLETION_STORAGE_KEY = 'im_in_lalo_auth_completion';
const LALO_VERIFY_UI_STORAGE_KEY_PREFIXES = ['im_in_lalo_verify_ui_', 'im_in_lalo_verify_create_event_', 'lalo_verify_'];
const LALO_COMPLETION_STORAGE_TTL_MS = 30 * 60 * 1000;

export const LALO_AUTH_POLL_INTERVAL_MS = 1500;

export type LaloAuthMode = 'sign_in' | 'link_account';

export type StoredLaloAuthAttempt = {
  attemptId: string;
  whatsappUrl: string;
  expiresAt: string;
  redirectTo: string;
  mode: LaloAuthMode;
  whatsappNumber?: string | null;
};

type StoredLaloCompletion = Pick<
  LaloCompleteResponse,
  'sign_in_email' | 'auth_session' | 'sign_in_password' | 'is_new_user' | 'lalo_user_id' | 'wa_id'
> & {
  attemptId: string;
  redirectTo: string;
  mode: LaloAuthMode;
};

type FinalizedLaloAuthResult = {
  isNewUser: boolean;
  laloUserId: string;
  redirectTo: string;
  mode: LaloAuthMode;
  linked: boolean;
  merged?: boolean;
  waId?: string | null;
  whatsappNumber?: string | null;
};

type ExpiringStoredValue<T> = {
  value: T;
  expiresAtMs: number;
};

function isBrowser() {
  return typeof window !== 'undefined';
}

function parseStoredValue<T>(raw: string | null) {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ExpiringStoredValue<T> | T;
  } catch {
    return null;
  }
}

function resolveStorageTtlMs(key: string, value: unknown) {
  if (key === LALO_ATTEMPT_STORAGE_KEY) {
    const expiresAt = typeof (value as StoredLaloAuthAttempt | null | undefined)?.expiresAt === 'string'
      ? new Date((value as StoredLaloAuthAttempt).expiresAt).getTime()
      : Number.NaN;
    if (Number.isFinite(expiresAt)) {
      return Math.max(0, expiresAt - Date.now());
    }
  }

  return LALO_COMPLETION_STORAGE_TTL_MS;
}

function readJson<T>(key: string): T | null {
  if (!isBrowser()) return null;

  const localRaw = window.localStorage.getItem(key);
  const localParsed = parseStoredValue<T>(localRaw);
  if (localParsed && typeof localParsed === 'object' && 'value' in localParsed && 'expiresAtMs' in localParsed) {
    if (localParsed.expiresAtMs > Date.now()) {
      return localParsed.value;
    }
    window.localStorage.removeItem(key);
  } else if (localParsed) {
    return localParsed as T;
  }

  const sessionRaw = window.sessionStorage.getItem(key);
  const sessionParsed = parseStoredValue<T>(sessionRaw);
  if (!sessionParsed) {
    window.sessionStorage.removeItem(key);
    return null;
  }

  const migratedValue =
    typeof sessionParsed === 'object' && 'value' in sessionParsed && 'expiresAtMs' in sessionParsed
      ? sessionParsed.value
      : (sessionParsed as T);

  writeJson(key, migratedValue);
  window.sessionStorage.removeItem(key);
  return migratedValue;
}

function writeJson(key: string, value: unknown) {
  if (!isBrowser()) return;

  const ttlMs = resolveStorageTtlMs(key, value);
  const payload: ExpiringStoredValue<unknown> = {
    value,
    expiresAtMs: Date.now() + ttlMs,
  };
  window.localStorage.setItem(key, JSON.stringify(payload));
}

function clearStorage(key: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(key);
  window.sessionStorage.removeItem(key);
}

function clearStorageByPrefix(prefixes: string[]) {
  if (!isBrowser()) return;

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (!key) continue;
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Ignore session storage cleanup failures.
  }
}

export function isLaloWhatsAppAuthEnabled() {
  return String(import.meta.env.VITE_LALO_VERIFY_WHATSAPP_AUTH_BETA || import.meta.env.VITE_LALO_WHATSAPP_AUTH_BETA || '')
    .toLowerCase() === 'true';
}

export function getStoredLaloAuthAttempt() {
  return readJson<StoredLaloAuthAttempt>(LALO_ATTEMPT_STORAGE_KEY);
}

export function clearLaloAuthAttempt() {
  clearStorage(LALO_ATTEMPT_STORAGE_KEY);
}

function getStoredLaloCompletion() {
  return readJson<StoredLaloCompletion>(LALO_COMPLETION_STORAGE_KEY);
}

function saveLaloAuthAttempt(attempt: StoredLaloAuthAttempt) {
  writeJson(LALO_ATTEMPT_STORAGE_KEY, attempt);
}

function saveLaloCompletion(completion: StoredLaloCompletion) {
  writeJson(LALO_COMPLETION_STORAGE_KEY, completion);
}

export function clearLaloCompletion() {
  clearStorage(LALO_COMPLETION_STORAGE_KEY);
}

export function clearAllLaloAuthState() {
  clearLaloAuthAttempt();
  clearLaloCompletion();
}

export function clearPersistedLaloVerifyUiState() {
  clearStorageByPrefix(LALO_VERIFY_UI_STORAGE_KEY_PREFIXES);
}

export function clearAllLaloStateForSignOut() {
  clearAllLaloAuthState();
  clearPersistedLaloVerifyUiState();
}

export function isStoredLaloAttemptExpired(attempt?: StoredLaloAuthAttempt | null) {
  if (!attempt?.expiresAt) return true;
  const expiresAtMs = new Date(attempt.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return true;
  return Date.now() >= expiresAtMs;
}

export async function startLaloWhatsAppAuth(
  redirectTo = '/my-activities',
  options?: { mode?: LaloAuthMode; whatsappNumber?: string | null },
) {
  const response = await laloClient.startWhatsAppAuth();
  const attempt: StoredLaloAuthAttempt = {
    attemptId: response.attempt_id,
    whatsappUrl: response.whatsapp_url,
    expiresAt: response.expires_at,
    redirectTo,
    mode: options?.mode || 'sign_in',
    whatsappNumber: options?.whatsappNumber?.trim() || null,
  };

  clearLaloCompletion();
  saveLaloAuthAttempt(attempt);
  return attempt;
}

export async function getLaloWhatsAppStatus(attemptId: string) {
  return laloClient.getWhatsAppAuthStatus(attemptId);
}

async function signInWithCompletion(completion: StoredLaloCompletion) {
  if (completion.auth_session?.access_token && completion.auth_session?.refresh_token) {
    // WhatsApp completion now returns a pre-minted browser session so we do not have to rotate the user's password.
    const { error } = await supabase.auth.setSession({
      access_token: completion.auth_session.access_token,
      refresh_token: completion.auth_session.refresh_token,
    });

    if (error) {
      throw new Error(error.message || 'Could not finish signing in with WhatsApp.');
    }
  } else if (completion.sign_in_password) {
    const { error } = await supabase.auth.signInWithPassword({
      email: completion.sign_in_email,
      password: completion.sign_in_password,
    });

    if (error) {
      throw new Error(error.message || 'Could not finish signing in with WhatsApp.');
    }
  } else {
    throw new Error('WhatsApp verification succeeded, but no browser session was returned.');
  }

  clearAllLaloAuthState();

  return {
    isNewUser: completion.is_new_user,
    laloUserId: completion.lalo_user_id,
    redirectTo: completion.redirectTo,
    mode: completion.mode,
    linked: false,
    waId: completion.wa_id,
    whatsappNumber: completion.wa_id,
  };
}

async function linkCurrentAccountWithCompletion(attempt: StoredLaloAuthAttempt): Promise<FinalizedLaloAuthResult> {
  const response = await laloClient.linkWhatsAppToCurrentAccount(attempt.attemptId, attempt.whatsappNumber || null);
  clearAllLaloAuthState();

  return {
    isNewUser: false,
    laloUserId: response.lalo_user_id,
    redirectTo: attempt.redirectTo,
    mode: attempt.mode,
    linked: true,
    merged: !!response.merged,
    waId: response.wa_id,
    whatsappNumber: response.wa_id ?? response.whatsapp_number,
  };
}

export async function finalizeLaloWhatsAppAuth(attempt: StoredLaloAuthAttempt): Promise<FinalizedLaloAuthResult> {
  if (attempt.mode === 'link_account') {
    return linkCurrentAccountWithCompletion(attempt);
  }

  const storedCompletion = getStoredLaloCompletion();
  if (storedCompletion?.attemptId === attempt.attemptId && storedCompletion.mode === attempt.mode) {
    return signInWithCompletion(storedCompletion);
  }

  const completion = await laloClient.completeWhatsAppAuth(attempt.attemptId);
  const nextCompletion: StoredLaloCompletion = {
    attemptId: attempt.attemptId,
    redirectTo: attempt.redirectTo,
    mode: attempt.mode,
    is_new_user: completion.is_new_user,
    lalo_user_id: completion.lalo_user_id,
    wa_id: completion.wa_id,
    sign_in_email: completion.sign_in_email,
    auth_session: completion.auth_session,
    sign_in_password: completion.sign_in_password,
  };

  saveLaloCompletion(nextCompletion);
  return signInWithCompletion(nextCompletion);
}

export function mapLaloStatusToMessage(status: LaloStatusResponse['status']) {
  if (status === 'expired') return 'This login expired, try again.';
  if (status === 'cancelled') return 'This login was cancelled. Start again when you are ready.';
  return 'Please send the message in WhatsApp.';
}
