export const PUSH_MAX_STALENESS_MS = 6 * 60 * 60 * 1000;
export const PUSH_EVENT_END_GRACE_MS = 60 * 60 * 1000;
export const PUSH_MAX_SUBSCRIPTIONS_PER_USER = 3;
export const PUSH_SUBSCRIPTION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export const HIGH_URGENCY_NOTIFICATION_TYPES = new Set([
  'host_join',
  'host_message',
  'guest_reply',
  'waitlist_promoted',
  'activity_updated',
]);

export type PushDeliverySkipReason =
  | 'missing_idempotency_key'
  | 'stale'
  | 'event_past'
  | 'event_cancelled'
  | 'event_missing';

export type PushDeliveryDecision =
  | { action: 'deliver' }
  | { action: 'skip'; reason: PushDeliverySkipReason };

export type WebPushDeliveryOptions = {
  TTL: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string;
};

export function buildPushIdempotencyKey(input: {
  notificationId?: string | null;
  idempotencyKey?: string | null;
}): string | null {
  const explicit = input.idempotencyKey?.trim();
  if (explicit) return explicit;

  const notificationId = input.notificationId?.trim();
  if (notificationId) return `notification:${notificationId}`;

  return null;
}

export function resolveWebPushOptions(
  notificationType: string | null | undefined,
  idempotencyKey: string,
): WebPushDeliveryOptions {
  const normalizedType = notificationType?.trim().toLowerCase() || '';
  const isHighUrgency = HIGH_URGENCY_NOTIFICATION_TYPES.has(normalizedType);

  return {
    TTL: isHighUrgency ? 3600 : 86400,
    urgency: isHighUrgency ? 'high' : 'normal',
    topic: idempotencyKey.slice(0, 32),
  };
}

export function isPushNotificationStale(
  createdAt: string | null | undefined,
  nowMs: number,
  maxStalenessMs: number = PUSH_MAX_STALENESS_MS,
): boolean {
  if (!createdAt?.trim()) return false;

  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return false;

  return nowMs - createdMs > maxStalenessMs;
}

export function isEventPastForPush(
  eventEndsAt: string | null | undefined,
  nowMs: number,
  graceMs: number = PUSH_EVENT_END_GRACE_MS,
): boolean {
  if (!eventEndsAt?.trim()) return false;

  const endsMs = Date.parse(eventEndsAt);
  if (!Number.isFinite(endsMs)) return false;

  return nowMs > endsMs + graceMs;
}

export function evaluatePushDispatch(input: {
  notificationId: string;
  createdAt: string;
  eventId?: string | null;
  eventStatus?: string | null;
  eventEndsAt?: string | null;
  nowMs: number;
}): PushDeliveryDecision {
  const idempotencyKey = buildPushIdempotencyKey({ notificationId: input.notificationId });
  if (!idempotencyKey) {
    return { action: 'skip', reason: 'missing_idempotency_key' };
  }

  if (isPushNotificationStale(input.createdAt, input.nowMs)) {
    return { action: 'skip', reason: 'stale' };
  }

  if (!input.eventId) {
    return { action: 'deliver' };
  }

  const eventStatus = input.eventStatus?.trim().toLowerCase();
  if (!eventStatus) {
    return { action: 'skip', reason: 'event_missing' };
  }

  if (eventStatus === 'cancelled') {
    return { action: 'skip', reason: 'event_cancelled' };
  }

  if (!input.eventEndsAt && eventStatus === 'completed') {
    return { action: 'skip', reason: 'event_past' };
  }

  if (isEventPastForPush(input.eventEndsAt, input.nowMs)) {
    return { action: 'skip', reason: 'event_past' };
  }

  return { action: 'deliver' };
}

export function selectActivePushSubscriptions<T extends { endpoint: string; last_seen_at: string }>(
  subscriptions: T[],
  nowMs: number = Date.now(),
  maxSubscriptions: number = PUSH_MAX_SUBSCRIPTIONS_PER_USER,
): T[] {
  const dedupedByEndpoint = new Map<string, T>();
  for (const subscription of subscriptions) {
    const lastSeenMs = Date.parse(subscription.last_seen_at);
    if (!Number.isFinite(lastSeenMs)) continue;
    if (nowMs - lastSeenMs > PUSH_SUBSCRIPTION_MAX_AGE_MS) continue;
    dedupedByEndpoint.set(subscription.endpoint, subscription);
  }

  return Array.from(dedupedByEndpoint.values())
    .sort((left, right) => Date.parse(right.last_seen_at) - Date.parse(left.last_seen_at))
    .slice(0, maxSubscriptions);
}

export function logPushDispatchDecision(details: Record<string, unknown>) {
  console.info('[push:dispatch]', details);
}

export async function hashPushEndpoint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint.trim()));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export type DeliveryTraceEntry = {
  at: string;
  endpointHash: string;
  status: 'attempted' | 'sent' | 'failed';
  statusCode?: number;
  error?: string;
};

export function appendDeliveryTrace(
  existing: DeliveryTraceEntry[] | null | undefined,
  entry: DeliveryTraceEntry,
): DeliveryTraceEntry[] {
  return [...(existing || []), entry].slice(-20);
}
