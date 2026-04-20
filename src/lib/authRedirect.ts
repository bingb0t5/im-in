function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function isLocalDevelopmentHost(hostname: string) {
  return (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.test')
  );
}

export function buildAuthRedirectUrl(path: string = '/') {
  const configuredBase = import.meta.env.VITE_APP_URL as string | undefined;
  if (configuredBase) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizeBaseUrl(configuredBase)}${normalizedPath}`;
  }

  const origin = window.location.origin;
  const hostname = window.location.hostname;
  if (isLocalDevelopmentHost(hostname)) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${origin}${normalizedPath}`;
  }

  throw new Error('VITE_APP_URL is required for hosted auth redirects outside local development.');
}

