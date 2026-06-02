import { describe, expect, it } from 'vitest';
import {
  PUSH_EVENT_END_GRACE_MS,
  PUSH_MAX_STALENESS_MS,
  buildPushIdempotencyKey,
  evaluatePushDelivery,
  isEventPastForPush,
  isPushNotificationStale,
} from './pushNotificationPolicy';

describe('pushNotificationPolicy', () => {
  const nowMs = Date.parse('2026-06-02T12:00:00.000Z');

  it('builds a stable idempotency key from notification id', () => {
    expect(buildPushIdempotencyKey({ notificationId: 'abc-123' })).toBe('notification:abc-123');
    expect(buildPushIdempotencyKey({ idempotencyKey: 'custom:key' })).toBe('custom:key');
  });

  it('skips stale notifications after the max staleness window', () => {
    const createdAt = new Date(nowMs - PUSH_MAX_STALENESS_MS - 1).toISOString();

    expect(isPushNotificationStale(createdAt, nowMs)).toBe(true);
    expect(
      evaluatePushDelivery({
        payload: { notificationId: 'n1', createdAt },
        nowMs,
      }),
    ).toEqual({ action: 'skip', reason: 'stale' });
  });

  it('skips notifications that were already shown on this device', () => {
    const decision = evaluatePushDelivery({
      payload: { notificationId: 'n1', createdAt: new Date(nowMs).toISOString() },
      nowMs,
      alreadyShownKeys: new Set(['notification:n1']),
    });

    expect(decision).toEqual({ action: 'skip', reason: 'already_sent' });
  });

  it('skips notifications for cancelled or past events', () => {
    expect(
      evaluatePushDelivery({
        payload: {
          notificationId: 'n2',
          createdAt: new Date(nowMs).toISOString(),
          eventId: 'event-1',
          eventStatus: 'cancelled',
        },
        nowMs,
      }),
    ).toEqual({ action: 'skip', reason: 'event_cancelled' });

    const pastEndsAt = new Date(nowMs - PUSH_EVENT_END_GRACE_MS - 1).toISOString();
    expect(isEventPastForPush(pastEndsAt, nowMs)).toBe(true);
    expect(
      evaluatePushDelivery({
        payload: {
          notificationId: 'n3',
          createdAt: new Date(nowMs).toISOString(),
          eventId: 'event-2',
          eventEndsAt: pastEndsAt,
        },
        nowMs,
      }),
    ).toEqual({ action: 'skip', reason: 'event_past' });
  });

  it('delivers fresh notifications for upcoming events', () => {
    const futureEndsAt = new Date(nowMs + 60 * 60 * 1000).toISOString();

    expect(
      evaluatePushDelivery({
        payload: {
          notificationId: 'n4',
          createdAt: new Date(nowMs).toISOString(),
          eventId: 'event-3',
          eventEndsAt: futureEndsAt,
        },
        nowMs,
      }),
    ).toEqual({ action: 'deliver' });
  });

  it('simulates Android resume flooding by deduping repeated processing', () => {
    const shown = new Set<string>();
    const payload = {
      notificationId: 'repeat-me',
      createdAt: new Date(nowMs).toISOString(),
    };

    const first = evaluatePushDelivery({ payload, nowMs, alreadyShownKeys: shown });
    expect(first).toEqual({ action: 'deliver' });

    shown.add(buildPushIdempotencyKey(payload)!);

    const second = evaluatePushDelivery({ payload, nowMs, alreadyShownKeys: shown });
    expect(second).toEqual({ action: 'skip', reason: 'already_sent' });
  });

  it('simulates app open after missing several windows by skipping stale backlog', () => {
    const staleCreatedAt = new Date(nowMs - 8 * 60 * 60 * 1000).toISOString();
    const decisions = ['n-a', 'n-b', 'n-c'].map((notificationId) =>
      evaluatePushDelivery({
        payload: { notificationId, createdAt: staleCreatedAt },
        nowMs,
      }),
    );

    expect(decisions.every((decision) => decision.action === 'skip' && decision.reason === 'stale')).toBe(true);
  });

  it('handles host-with-many-events backlog without delivering stale host joins', () => {
    const shown = new Set<string>();
    const eventIds = Array.from({ length: 20 }, (_, index) => `event-${index}`);
    const staleCreatedAt = new Date(nowMs - 7 * 60 * 60 * 1000).toISOString();

    const decisions = eventIds.map((eventId) =>
      evaluatePushDelivery({
        payload: {
          notificationId: `host-join-${eventId}`,
          createdAt: staleCreatedAt,
          eventId,
          eventEndsAt: new Date(nowMs + 2 * 60 * 60 * 1000).toISOString(),
        },
        nowMs,
        alreadyShownKeys: shown,
      }),
    );

    expect(decisions.every((decision) => decision.action === 'skip' && decision.reason === 'stale')).toBe(true);
  });
});
