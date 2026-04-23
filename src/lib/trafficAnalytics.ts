declare global {
  interface Window {
    umami?: {
      track: (payload?: unknown) => void;
    };
  }
}

const UMAMI_WEBSITE_ID = (import.meta.env.VITE_UMAMI_WEBSITE_ID || '').trim();
const UMAMI_SCRIPT_URL = (import.meta.env.VITE_UMAMI_SCRIPT_URL || '').trim();
const UMAMI_HOST_URL = (import.meta.env.VITE_UMAMI_HOST_URL || '').trim();
const UMAMI_SCRIPT_ID = 'im-in-umami-script';

const PUBLIC_TRAFFIC_PATHS = new Set([
  '/',
  '/explore',
  '/calendar',
  '/changelog',
  '/moderation',
]);

let lastTrackedPath: string | null = null;

function shouldTrackTrafficPath(pathname: string) {
  if (PUBLIC_TRAFFIC_PATHS.has(pathname)) {
    return true;
  }

  return pathname.startsWith('/s/');
}

export function initTrafficAnalytics() {
  if (
    typeof document === 'undefined' ||
    !UMAMI_WEBSITE_ID ||
    !UMAMI_SCRIPT_URL ||
    document.getElementById(UMAMI_SCRIPT_ID)
  ) {
    return;
  }

  const script = document.createElement('script');
  script.id = UMAMI_SCRIPT_ID;
  script.defer = true;
  script.src = UMAMI_SCRIPT_URL;
  script.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
  script.setAttribute('data-auto-track', 'false');

  if (UMAMI_HOST_URL) {
    script.setAttribute('data-host-url', UMAMI_HOST_URL);
  }

  script.addEventListener('load', () => {
    trackTrafficPageview(window.location.pathname);
  });

  document.head.appendChild(script);
}

export function trackTrafficPageview(pathname: string) {
  if (
    typeof window === 'undefined' ||
    !window.umami ||
    !shouldTrackTrafficPath(pathname) ||
    lastTrackedPath === pathname
  ) {
    return;
  }

  window.umami.track();
  lastTrackedPath = pathname;
}
