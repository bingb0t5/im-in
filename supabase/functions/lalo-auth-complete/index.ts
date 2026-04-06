import {
  assertLaloConfigured,
  corsHeaders,
  createAdminClient,
  createOrLinkLaloUser,
  json,
  laloExchangeCompletedAttempt,
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
    const body = await request.json();
    const attemptId = typeof body?.attempt_id === 'string' ? body.attempt_id.trim() : '';

    if (!attemptId) {
      return json({ error: 'An attempt_id is required.' }, { status: 400 });
    }

    const exchange = await laloExchangeCompletedAttempt(attemptId);
    if (exchange.trusted !== true || !exchange.lalo_user_id) {
      return json({ error: 'Lalo did not return a trusted identity.' }, { status: 403 });
    }

    const admin = createAdminClient();
    const linkedUser = await createOrLinkLaloUser(admin, exchange.lalo_user_id, exchange.wa_id ?? null);

    return json({
      trusted: true,
      lalo_user_id: exchange.lalo_user_id,
      is_new_user: exchange.is_new_user,
      wa_id: exchange.wa_id ?? null,
      auth_provider: linkedUser.authProvider,
      sign_in_email: linkedUser.signInEmail,
      sign_in_password: linkedUser.signInPassword,
    });
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number' ? (error as { status: number }).status : 500;
    const message = error instanceof Error ? error.message : 'Could not finish WhatsApp sign in.';
    return json({ error: message }, { status });
  }
});
