import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthRedirectUrl } from './authRedirect';

describe('buildAuthRedirectUrl', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('falls back to the current origin when no app URL is configured', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          origin: 'https://local.im-in.test',
          hostname: 'local.im-in.test',
        },
      },
    });

    expect(buildAuthRedirectUrl('/create-event')).toBe('https://local.im-in.test/create-event');
  });

  it('uses the configured app URL when present', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          origin: 'https://local.im-in.test',
          hostname: 'local.im-in.test',
        },
      },
    });

    vi.stubEnv('VITE_APP_URL', 'https://im-in.pages.dev///');

    expect(buildAuthRedirectUrl('profile')).toBe('https://im-in.pages.dev/profile');
  });

  it('throws for hosted origins when VITE_APP_URL is missing', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          origin: 'https://joinimin.com',
          hostname: 'joinimin.com',
        },
      },
    });

    expect(() => buildAuthRedirectUrl('/login')).toThrow(
      'VITE_APP_URL is required for hosted auth redirects outside local development.',
    );
  });
});
