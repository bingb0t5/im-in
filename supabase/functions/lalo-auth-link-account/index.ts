import {
  assertLaloConfigured,
  corsHeaders,
  createAdminClient,
  getAuthenticatedUser,
  json,
  laloExchangeCompletedAttempt,
  linkExistingUserToLaloIdentity,
} from '../_shared/lalo.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, { status: 405 });
    }

    assertLaloConfigured();
    const user = await getAuthenticatedUser(request);
    const body = await request.json();
    const attemptId = typeof body?.attempt_id === 'string' ? body.attempt_id.trim() : '';
    const whatsappNumber = typeof body?.whatsapp_number === 'string' ? body.whatsapp_number.trim() : '';

    if (!attemptId) {
      return json({ error: 'An attempt_id is required.' }, { status: 400 });
    }

    const exchange = await laloExchangeCompletedAttempt(attemptId);
    if (exchange.trusted !== true || !exchange.lalo_user_id) {
      return json({ error: 'Lalo did not return a trusted identity.' }, { status: 403 });
    }

    const admin = createAdminClient();
    const linkedResult = await linkExistingUserToLaloIdentity(
      admin,
      user,
      exchange.lalo_user_id,
      whatsappNumber || null,
    );

    return json({
      trusted: true,
      linked: true,
      merged: !!linkedResult.merged,
      lalo_user_id: linkedResult.laloUserId,
      whatsapp_number: linkedResult.whatsappNumber,
    });
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number' ? (error as { status: number }).status : 500;
    const message = error instanceof Error ? error.message : 'Could not link WhatsApp to this account.';
    return json({ error: message }, { status });
  }
});
