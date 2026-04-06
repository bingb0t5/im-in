import { describe, expect, it } from 'vitest';
import { shouldRestorePersistedVerify, type PersistedVerifyBundle } from './LaloVerifyPanel';

function makeBundle(overrides: Partial<PersistedVerifyBundle> = {}): PersistedVerifyBundle {
  return {
    sessionState: {
      clientSessionId: 'login-123',
      startData: {
        attempt_id: 'attempt-1',
        expires_at: '2026-04-07T10:00:00.000Z',
        whatsapp_login_message: 'hello',
        whatsapp_deep_link: null,
      },
      status: {
        status: 'pending',
        expiresAt: '2026-04-07T10:00:00.000Z',
      },
    },
    verifyPhase: 'waiting',
    ...overrides,
  };
}

describe('shouldRestorePersistedVerify', () => {
  it('restores a pending non-expired flow', () => {
    const bundle = makeBundle();
    const nowMs = new Date('2026-04-07T09:59:59.000Z').getTime();

    expect(shouldRestorePersistedVerify(bundle, nowMs)).toBe(true);
  });

  it('rejects previously verified phase', () => {
    const bundle = makeBundle({ verifyPhase: 'verified' });
    const nowMs = new Date('2026-04-07T09:59:59.000Z').getTime();

    expect(shouldRestorePersistedVerify(bundle, nowMs)).toBe(false);
  });

  it('rejects completed status even when not expired', () => {
    const bundle = makeBundle({
      sessionState: {
        clientSessionId: 'login-123',
        startData: {
          attempt_id: 'attempt-1',
          expires_at: '2026-04-07T10:00:00.000Z',
          whatsapp_login_message: 'hello',
          whatsapp_deep_link: null,
        },
        status: {
          status: 'completed',
          expiresAt: '2026-04-07T10:00:00.000Z',
        },
      },
    });
    const nowMs = new Date('2026-04-07T09:59:59.000Z').getTime();

    expect(shouldRestorePersistedVerify(bundle, nowMs)).toBe(false);
  });

  it('rejects expired pending flow', () => {
    const bundle = makeBundle();
    const nowMs = new Date('2026-04-07T10:01:00.000Z').getTime();

    expect(shouldRestorePersistedVerify(bundle, nowMs)).toBe(false);
  });
});
