import { assertLaloConfigured, corsHeaders, json, laloStartWhatsAppAuth } from '../_shared/lalo.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, { status: 405 });
    }

    assertLaloConfigured();
    const response = await laloStartWhatsAppAuth();
    return json(response);
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number' ? (error as { status: number }).status : 500;
    const message = error instanceof Error ? error.message : 'Could not start WhatsApp sign in.';
    return json({ error: message }, { status });
  }
});
