import { describe, expect, it, vi } from 'vitest';
import {
  buildSupabaseAuthStorageKey,
  isInvalidRefreshTokenErrorMessage,
  loadSessionWithRecovery,
} from './authSession';

describe('authSession helpers', () => {
  it('builds the same auth storage key Supabase would use by default', () => {
    expect(buildSupabaseAuthStorageKey('https://qxktbdjzhctfxnafiaxk.supabase.co')).toBe(
      'sb-qxktbdjzhctfxnafiaxk-auth-token',
    );
  });

  it('detects invalid refresh token errors', () => {
    expect(isInvalidRefreshTokenErrorMessage('Invalid Refresh Token: Refresh Token Not Found')).toBe(true);
    expect(isInvalidRefreshTokenErrorMessage('Could not read the current session.')).toBe(false);
  });

  it('retries session loading before giving up', async () => {
    const session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: Math.round(Date.now() / 1000) + 3600,
      user: { id: 'user-1' },
    } as any;

    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        data: { session: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { session },
        error: null,
      });

    const signOut = vi.fn().mockResolvedValue({ error: null });

    const result = await loadSessionWithRecovery(
      {
        getSession,
        signOut,
      },
      {
        attempts: 2,
        delayMs: 0,
      },
    );

    expect(result).toEqual({
      session,
      error: null,
      clearedInvalidRefreshToken: false,
      recoveredWithRefresh: false,
      lastCheck: 'getSession',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the local session when Supabase rejects the refresh token', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const refreshSession = vi.fn().mockResolvedValue({
      data: { session: null },
      error: new Error('Invalid Refresh Token: Refresh Token Not Found'),
    });

    const result = await loadSessionWithRecovery(
      {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: new Error('Invalid Refresh Token: Refresh Token Not Found'),
        }),
        refreshSession,
        signOut,
      },
      {
        attempts: 1,
      },
    );

    expect(result.session).toBeNull();
    expect(result.clearedInvalidRefreshToken).toBe(true);
    expect(result.recoveredWithRefresh).toBe(false);
    expect(result.lastCheck).toBe('refreshSession');
    expect(result.error?.message).toContain('Invalid Refresh Token');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does not clear local auth for non-refresh session errors', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });

    const result = await loadSessionWithRecovery(
      {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: new Error('Network request failed'),
        }),
        signOut,
      },
      {
        attempts: 1,
      },
    );

    expect(result.session).toBeNull();
    expect(result.clearedInvalidRefreshToken).toBe(false);
    expect(result.recoveredWithRefresh).toBe(false);
    expect(result.error?.message).toBe('Network request failed');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('recovers the session with an explicit refresh before clearing local auth', async () => {
    const session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: Math.round(Date.now() / 1000) + 3600,
      user: { id: 'user-1' },
    } as any;
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const refreshSession = vi.fn().mockResolvedValue({
      data: { session },
      error: null,
    });

    const result = await loadSessionWithRecovery(
      {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: new Error('Invalid Refresh Token: Refresh Token Not Found'),
        }),
        refreshSession,
        signOut,
      },
      {
        attempts: 1,
      },
    );

    expect(result).toEqual({
      session,
      error: null,
      clearedInvalidRefreshToken: false,
      recoveredWithRefresh: true,
      lastCheck: 'refreshSession',
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('tries one final refresh when getSession stays empty on the last attempt', async () => {
    const session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: Math.round(Date.now() / 1000) + 3600,
      user: { id: 'user-1' },
    } as any;
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const refreshSession = vi.fn().mockResolvedValue({
      data: { session },
      error: null,
    });

    const result = await loadSessionWithRecovery(
      {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
        refreshSession,
        signOut,
      },
      {
        attempts: 1,
        delayMs: 0,
      },
    );

    expect(result).toEqual({
      session,
      error: null,
      clearedInvalidRefreshToken: false,
      recoveredWithRefresh: true,
      lastCheck: 'refreshSession',
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});
