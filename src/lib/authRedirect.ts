function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

export function buildAuthRedirectUrl(path: string = '/') {
  const configuredBase = import.meta.env.VITE_APP_URL as string | undefined;
  const baseUrl = configuredBase ? normalizeBaseUrl(configuredBase) : window.location.origin;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

