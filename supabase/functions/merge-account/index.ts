import {
  corsHeaders,
  createAdminClient,
  getAuthenticatedUser,
  json,
  mergeLaloAccountIntoUser,
  normalizeEmail,
  type AttendeeProfileRow,
} from '../_shared/lalo.ts';

type MergeAccountRequestRow = {
  id: string;
  source_user_id: string;
  target_email: string;
  expires_at: string;
  consumed_at: string | null;
};

async function getLatestProfileByUserId(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await admin
    .from('attendee_profiles')
    .select('id, email, user_id, lalo_user_id, auth_provider, first_name, last_name, whatsapp_number, whatsapp_verified_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    throw Object.assign(new Error(error.message), { status: 500 });
  }

  return (data?.[0] as AttendeeProfileRow | null) || null;
}

async function getBestTargetProfile(admin: ReturnType<typeof createAdminClient>, userId: string, email: string) {
  const { data: byUserId, error: byUserIdError } = await admin
    .from('attendee_profiles')
    .select('id, email, user_id, lalo_user_id, auth_provider, first_name, last_name, whatsapp_number, whatsapp_verified_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (byUserIdError) {
    throw Object.assign(new Error(byUserIdError.message), { status: 500 });
  }

  if (byUserId?.[0]) {
    return byUserId[0] as AttendeeProfileRow;
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const { data: byEmail, error: byEmailError } = await admin
    .from('attendee_profiles')
    .select('id, email, user_id, lalo_user_id, auth_provider, first_name, last_name, whatsapp_number, whatsapp_verified_at')
    .eq('email', normalizedEmail)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (byEmailError) {
    throw Object.assign(new Error(byEmailError.message), { status: 500 });
  }

  return (byEmail?.[0] as AttendeeProfileRow | null) || null;
}

async function startMerge(request: Request) {
  const user = await getAuthenticatedUser(request);
  const body = await request.json();
  const targetEmail = normalizeEmail(typeof body?.email === 'string' ? body.email : '');

  if (!targetEmail) {
    return json({ error: 'An email address is required.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const sourceProfile = await getLatestProfileByUserId(admin, user.id);
  const sourceLaloUserId =
    sourceProfile?.lalo_user_id ||
    (typeof user.user_metadata?.lalo_user_id === 'string' ? user.user_metadata.lalo_user_id.trim() : '');

  if (!sourceLaloUserId) {
    return json({ error: 'This account does not have a WhatsApp identity available to merge.' }, { status: 409 });
  }

  if (targetEmail === normalizeEmail(user.email)) {
    return json({ error: 'Use a different email account to merge into.' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('account_merge_requests')
    .insert({
      source_user_id: user.id,
      target_email: targetEmail,
    })
    .select('id, target_email, expires_at')
    .single();

  if (error || !data?.id) {
    throw Object.assign(new Error(error?.message || 'Could not start account merge.'), { status: 500 });
  }

  return json({
    started: true,
    request_id: data.id,
    target_email: data.target_email,
    expires_at: data.expires_at,
  });
}

async function completeMerge(request: Request) {
  const targetUser = await getAuthenticatedUser(request);
  const body = await request.json();
  const requestId = typeof body?.request_id === 'string' ? body.request_id.trim() : '';

  if (!requestId) {
    return json({ error: 'A request_id is required.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('account_merge_requests')
    .select('id, source_user_id, target_email, expires_at, consumed_at')
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message), { status: 500 });
  }

  const mergeRequest = data as MergeAccountRequestRow | null;
  if (!mergeRequest) {
    return json({ error: 'That merge request could not be found.' }, { status: 404 });
  }

  if (mergeRequest.consumed_at) {
    return json({ error: 'That merge request has already been used.' }, { status: 409 });
  }

  const expiresAtMs = new Date(mergeRequest.expires_at).getTime();
  if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
    return json({ error: 'That merge request has expired. Start again from your profile.' }, { status: 410 });
  }

  const normalizedTargetEmail = normalizeEmail(targetUser.email);
  if (!normalizedTargetEmail || normalizedTargetEmail !== normalizeEmail(mergeRequest.target_email)) {
    return json({ error: 'You must open the magic link from the exact email account you chose to merge.' }, { status: 403 });
  }

  if (mergeRequest.source_user_id === targetUser.id) {
    return json({ error: 'That merge request points back to the current account.' }, { status: 409 });
  }

  const sourceProfile = await getLatestProfileByUserId(admin, mergeRequest.source_user_id);
  if (!sourceProfile?.lalo_user_id) {
    return json({ error: 'The WhatsApp account to merge could not be found anymore.' }, { status: 404 });
  }

  const targetProfile = await getBestTargetProfile(admin, targetUser.id, targetUser.email || '');
  const mergeResult = await mergeLaloAccountIntoUser(
    admin,
    targetUser,
    sourceProfile,
    targetProfile,
    sourceProfile.lalo_user_id,
    sourceProfile.whatsapp_number || null,
    sourceProfile.whatsapp_verified_at || new Date().toISOString(),
  );

  const { error: consumeError } = await admin
    .from('account_merge_requests')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', mergeRequest.id);

  if (consumeError) {
    throw Object.assign(new Error(consumeError.message), { status: 500 });
  }

  return json({
    merged: true,
    target_user_id: targetUser.id,
    target_email: normalizedTargetEmail,
    profile_id: mergeResult.profileId,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, { status: 405 });
    }

    const clonedRequest = request.clone();
    const body = await clonedRequest.json();
    const action = typeof body?.action === 'string' ? body.action.trim() : '';

    if (action === 'start') {
      return startMerge(request);
    }

    if (action === 'complete') {
      return completeMerge(request);
    }

    return json({ error: 'A valid action is required.' }, { status: 400 });
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number' ? (error as { status: number }).status : 500;
    const message = error instanceof Error ? error.message : 'Could not merge accounts.';
    return json({ error: message }, { status });
  }
});
