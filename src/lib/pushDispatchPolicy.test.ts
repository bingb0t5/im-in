import { describe, expect, it } from 'vitest';
import {
  evaluatePushDispatch,
  resolveWebPushOptions,
  selectActivePushSubscriptions,
} from '../../supabase/functions/_shared/pushNotificationPolicy.ts';

describe('push dispatch policy', () => {
  const nowMs = Date.parse('2026-06-02T12:00:00.000Z');

  it('skips stale queue rows before sending push payloads', () => {
    expect(
      evaluatePushDispatch({
        notificationId: 'notification-1',
        createdAt: new Date(nowMs - 7 * 60 * 60 * 1000).toISOString(),
        eventId: 'event-1',
        eventStatus: 'scheduled',
        eventEndsAt: new Date(nowMs + 60 * 60 * 1000).toISOString(),
        nowMs,
      }),
    ).toEqual({ action: 'skip', reason: 'stale' });
  });

  it('uses high urgency and shorter TTL for host notifications', () => {
    expect(resolveWebPushOptions('host_join', 'notification:abc')).toEqual({
      TTL: 3600,
      urgency: 'high',
      topic: 'notification:abc',
    });

    expect(resolveWebPushOptions('activity_shared', 'notification:def')).toEqual({
      TTL: 86400,
      urgency: 'normal',
      topic: 'notification:def',
    });
  });

  it('limits duplicate subscriptions to the most recently seen endpoints', () => {
    const selected = selectActivePushSubscriptions([
      { endpoint: 'a', last_seen_at: '2026-06-01T10:00:00.000Z' },
      { endpoint: 'b', last_seen_at: '2026-06-02T10:00:00.000Z' },
      { endpoint: 'a', last_seen_at: '2026-06-02T11:00:00.000Z' },
    ], nowMs);

    expect(selected).toHaveLength(2);
    expect(selected.map((row) => row.endpoint)).toEqual(['a', 'b']);
  });

  it('drops subscriptions that have not checked in recently', () => {
    const selected = selectActivePushSubscriptions([
      { endpoint: 'stale', last_seen_at: '2025-01-01T10:00:00.000Z' },
      { endpoint: 'fresh', last_seen_at: '2026-06-02T10:00:00.000Z' },
    ], nowMs);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.endpoint).toBe('fresh');
  });
});
