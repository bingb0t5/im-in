export const PUSH_MAX_STALENESS_MS = 6 * 60 * 60 * 1000;

export const PUSH_EVENT_END_GRACE_MS = 60 * 60 * 1000;

export type PushDeliverySkipReason =
  | 'missing_idempotency_key'
  | 'stale'
  | 'already_sent'
  | 'event_past'
  | 'event_cancelled'
  | 'event_missing';

export type PushDeliveryDecision =
  | { action: 'deliver' }
  | { action: 'skip'; reason: PushDeliverySkipReason };

export type PushNotificationPayload = {
  notificationId?: string | null;
  idempotencyKey?: string | null;
  createdAt?: string | null;
  eventId?: string | null;
  eventStatus?: string | null;
  eventEndsAt?: string | null;
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

export function evaluatePushDelivery(input: {
  payload: PushNotificationPayload;
  nowMs: number;
  alreadyShownKeys?: ReadonlySet<string>;
  maxStalenessMs?: number;
  eventEndGraceMs?: number;
}): PushDeliveryDecision {
  const idempotencyKey = buildPushIdempotencyKey({
    notificationId: input.payload.notificationId,
    idempotencyKey: input.payload.idempotencyKey,
  });

  if (!idempotencyKey) {
    return { action: 'skip', reason: 'missing_idempotency_key' };
  }

  if (input.alreadyShownKeys?.has(idempotencyKey)) {
    return { action: 'skip', reason: 'already_sent' };
  }

  if (isPushNotificationStale(input.payload.createdAt, input.nowMs, input.maxStalenessMs)) {
    return { action: 'skip', reason: 'stale' };
  }

  const eventStatus = input.payload.eventStatus?.trim().toLowerCase();
  if (eventStatus === 'cancelled') {
    return { action: 'skip', reason: 'event_cancelled' };
  }

  if (input.payload.eventId && !input.payload.eventEndsAt && eventStatus === 'completed') {
    return { action: 'skip', reason: 'event_past' };
  }

  if (input.payload.eventId && isEventPastForPush(input.payload.eventEndsAt, input.nowMs, input.eventEndGraceMs)) {
    return { action: 'skip', reason: 'event_past' };
  }

  return { action: 'deliver' };
}

export function logPushDecision(
  stage: 'schedule' | 'dispatch' | 'display',
  details: Record<string, unknown>,
) {
  console.info(`[push:${stage}]`, details);
}
