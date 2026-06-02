import { detectRuntimeEnvironment } from '../utils/runtimeEnvironment';
import { supabase } from '../supabase';
import {
  getExistingPushSubscription,
  getPushAvailability,
  refreshPushSubscriptionHeartbeat,
} from './pushNotifications';
import { registerAppServiceWorker } from './serviceWorker';
import { AttendeeProfile } from '../services/guestService';

const RECEIPTS_CACHE_NAME = 'im-in-push-receipts-v1';

export type PushReceipt = {
  notificationId: string;
  idempotencyKey: string;
  correlationId?: string | null;
  receivedAt: string;
  displayedAt?: string | null;
  skipReason?: string | null;
};

export type PushDiagnosticsSnapshot = {
  permission: NotificationPermission | 'unsupported';
  serviceWorkerSupported: boolean;
  serviceWorkerState: string | null;
  pushSubscriptionPresent: boolean;
  subscriptionEndpointHash: string | null;
  isStandalone: boolean;
  lastLocalPushReceivedAt: string | null;
  lastServerDispatchSuccessAt: string | null;
  lastSubscriptionSyncAt: string | null;
  guidance: string[];
};

function receiptCacheUrl(idempotencyKey: string) {
  return `https://im-in.local/push-receipt/${encodeURIComponent(idempotencyKey)}`;
}

async function hashPushEndpoint(endpoint: string): Promise<string | null> {
  if (!endpoint.trim() || !globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint.trim()));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function loadLocalPushReceipts(): Promise<PushReceipt[]> {
  if (typeof window === 'undefined' || !('caches' in window)) return [];

  const cache = await caches.open(RECEIPTS_CACHE_NAME);
  const keys = await cache.keys();
  const receipts: PushReceipt[] = [];

  for (const request of keys) {
    const response = await cache.match(request);
    if (!response) continue;
    try {
      receipts.push(await response.json() as PushReceipt);
    } catch {
      // Ignore malformed receipt payloads.
    }
  }

  return receipts.sort(
    (left, right) => Date.parse(right.receivedAt || '0') - Date.parse(left.receivedAt || '0'),
  );
}

async function clearLocalPushReceipt(idempotencyKey: string) {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const cache = await caches.open(RECEIPTS_CACHE_NAME);
  await cache.delete(receiptCacheUrl(idempotencyKey));
}

export async function syncLocalPushReceiptsToServer(platform?: string) {
  const receipts = await loadLocalPushReceipts();
  if (receipts.length === 0) return { synced: 0 };

  let synced = 0;
  for (const receipt of receipts) {
    const { error } = await supabase.rpc('record_my_push_delivery_receipt', {
      p_notification_id: receipt.notificationId,
      p_idempotency_key: receipt.idempotencyKey,
      p_received_at: receipt.receivedAt,
      p_displayed_at: receipt.displayedAt || null,
      p_skip_reason: receipt.skipReason || null,
      p_client_platform: platform || null,
    });

    if (!error) {
      synced += 1;
      await clearLocalPushReceipt(receipt.idempotencyKey);
    }
  }

  return { synced };
}

function readServerTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function collectPushDiagnostics(profile: AttendeeProfile | null): Promise<PushDiagnosticsSnapshot> {
  const env = detectRuntimeEnvironment();
  const availability = getPushAvailability(profile);
  const guidance: string[] = [];

  let permission: NotificationPermission | 'unsupported' = 'unsupported';
  if (typeof window !== 'undefined' && 'Notification' in window) {
    permission = Notification.permission;
  }

  let serviceWorkerState: string | null = null;
  if ('serviceWorker' in navigator) {
    const registration = await registerAppServiceWorker();
    serviceWorkerState = registration?.active?.state || registration?.installing?.state || registration?.waiting?.state || null;
  }

  const browserSubscription = await getExistingPushSubscription();
  const localReceipts = await loadLocalPushReceipts();
  const lastLocalPushReceivedAt = localReceipts[0]?.receivedAt || null;

  let lastServerDispatchSuccessAt: string | null = null;
  let lastSubscriptionSyncAt: string | null = null;
  let subscriptionEndpointHash: string | null = null;
  let activeServerSubscriptionCount = 0;

  try {
    const { data, error } = await supabase.rpc('get_my_push_diagnostics');
    if (!error && data && typeof data === 'object') {
      const payload = data as Record<string, unknown>;
      lastServerDispatchSuccessAt = readServerTimestamp(payload.last_dispatch_success_at);

      const subscriptions = Array.isArray(payload.subscriptions)
        ? payload.subscriptions as Array<{ revoked_at?: string | null; endpoint_hash?: string | null; last_seen_at?: string | null }>
        : [];
      const activeSubscriptions = subscriptions.filter((row) => !row.revoked_at);
      activeServerSubscriptionCount = activeSubscriptions.length;
      const currentSubscription = activeSubscriptions[0];
      subscriptionEndpointHash = readServerTimestamp(currentSubscription?.endpoint_hash);
      lastSubscriptionSyncAt = readServerTimestamp(currentSubscription?.last_seen_at);
    }
  } catch {
    // Server diagnostics are optional for the local snapshot.
  }

  if (!subscriptionEndpointHash && browserSubscription?.endpoint) {
    subscriptionEndpointHash = await hashPushEndpoint(browserSubscription.endpoint);
  }

  if (!availability.isStandalone) {
    guidance.push('Open the installed home-screen app, not the browser tab, for reliable Android push delivery.');
  }
  if (permission !== 'granted') {
    guidance.push('Notification permission is not granted. Re-enable push in Profile settings.');
  }
  if (!browserSubscription) {
    guidance.push('This device does not currently have an active browser push subscription.');
  }
  if (serviceWorkerState !== 'activated' && serviceWorkerState !== 'activating') {
    guidance.push('The service worker is not active yet. Close and reopen the installed app once.');
  }
  if (env.platform === 'android') {
    guidance.push('Android may still block delivery if battery optimisation is enabled for Chrome/your browser, or if I\'m In notifications are disabled in system settings.');
  }
  if (activeServerSubscriptionCount > 1) {
    guidance.push('Multiple active server push subscriptions were found. Tap Refresh here after opening the installed app.');
  }

  return {
    permission,
    serviceWorkerSupported: 'serviceWorker' in navigator,
    serviceWorkerState,
    pushSubscriptionPresent: Boolean(browserSubscription),
    subscriptionEndpointHash,
    isStandalone: availability.isStandalone,
    lastLocalPushReceivedAt,
    lastServerDispatchSuccessAt,
    lastSubscriptionSyncAt,
    guidance,
  };
}

export async function maintainPushSubscriptionHealth(profile: AttendeeProfile | null) {
  const availability = getPushAvailability(profile);
  if (!availability.supported || !availability.isStandalone || !availability.hasWhatsAppLink) {
    return null;
  }

  const subscription = await getExistingPushSubscription();
  if (!subscription) return null;

  const env = detectRuntimeEnvironment();
  const synced = await refreshPushSubscriptionHeartbeat();
  await syncLocalPushReceiptsToServer(env.platform === 'android' ? 'android-standalone' : 'standalone');

  return synced;
}

export function listenForPushReceipts(onReceipt: (receipt: PushReceipt) => void) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    if (event.data?.type !== 'push-receipt' || !event.data?.receipt) return;
    onReceipt(event.data.receipt as PushReceipt);
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}

export function formatDiagnosticTimestamp(value: string | null) {
  if (!value) return 'none recorded yet';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export function formatEndpointHash(value: string | null) {
  if (!value) return 'unknown';
  return `${value.slice(0, 12)}…`;
}
