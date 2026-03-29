const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_MAPS_SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });
}

function normalizeHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isAllowedGoogleMapsHost(hostname: string) {
  const host = normalizeHost(hostname);
  return host === 'google.com' || host.endsWith('.google.com') || GOOGLE_MAPS_SHORT_HOSTS.has(host);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await request.json();

    if (typeof url !== 'string' || !url.trim()) {
      return json({ error: 'A Google Maps link is required.' }, { status: 400 });
    }

    let candidate: URL;
    try {
      candidate = new URL(url.trim());
    } catch {
      return json({ error: 'Please paste a valid URL.' }, { status: 400 });
    }

    if (!isAllowedGoogleMapsHost(candidate.hostname)) {
      return json({ error: 'Please use a Google Maps share link.' }, { status: 400 });
    }

    const initialHost = normalizeHost(candidate.hostname);
    if (!GOOGLE_MAPS_SHORT_HOSTS.has(initialHost)) {
      return json({ resolvedUrl: candidate.toString() });
    }

    const response = await fetch(candidate.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const resolvedUrl = response.url || candidate.toString();

    let resolved: URL;
    try {
      resolved = new URL(resolvedUrl);
    } catch {
      return json({ error: 'Google Maps returned an unreadable link.' }, { status: 422 });
    }

    if (!isAllowedGoogleMapsHost(resolved.hostname)) {
      return json({ error: 'Resolved link was not a Google Maps URL.' }, { status: 422 });
    }

    return json({ resolvedUrl: resolved.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not resolve the Google Maps link.';
    return json({ error: message }, { status: 500 });
  }
});
