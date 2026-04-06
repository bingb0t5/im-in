import { assertLaloConfigured, corsHeaders, json, laloGetWhatsAppAuthStatus } from '../_shared/lalo.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, { status: 405 });
    }

    assertLaloConfigured();
    const body = await request.json();
    const attemptId = typeof body?.attempt_id === 'string' ? body.attempt_id.trim() : '';

    if (!attemptId) {
      return json({ error: 'An attempt_id is required.' }, { status: 400 });
    }

    const response = await laloGetWhatsAppAuthStatus(attemptId);
    return json(response);
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number' ? (error as { status: number }).status : 500;
    const message = error instanceof Error ? error.message : 'Could not check WhatsApp sign in.';
    return json({ error: message }, { status });
  }
});
