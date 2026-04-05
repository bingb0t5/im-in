import { createClient, type SupabaseClient, type User as SupabaseUser } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LALO_PROVIDER = 'lalo_whatsapp';

type LaloEnv = {
  laloBaseUrl: string;
  laloApiKey: string;
  laloAuthEnabled: boolean;
  laloAppId: string;
};

type LaloStartResponse = {
  attempt_id: string;
  whatsapp_url: string;
  expires_at: string;
};

type LaloStatusResponse =
  | {
      status: 'pending';
    }
  | {
      status: 'completed';
      lalo_user_id: string;
      is_new_user: boolean;
    }
  | {
      status: 'expired' | 'cancelled';
    };

type LaloExchangeResponse = {
  trusted: true;
  lalo_user_id: string;
  is_new_user: boolean;
};

export type AttendeeProfileRow = {
  id: string;
  email: string | null;
  user_id: string | null;
  lalo_user_id: string | null;
  auth_provider: string | null;
  first_name?: string | null;
  last_name?: string | null;
  whatsapp_number?: string | null;
  whatsapp_verified_at?: string | null;
};

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function parseBooleanEnv(value: string | undefined, fallback = false) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function generatePassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function normalizeEmail(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function normalizeWhatsappNumber(value: string | null | undefined) {
  const trimmed = (value || '').trim();
  return trimmed || null;
}

function buildLaloSyntheticEmail(laloUserId: string) {
  return `lalo+${laloUserId.toLowerCase()}@auth.im-in.local`;
}

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });
}

export function getLaloEnv(): LaloEnv {
  const laloBaseUrl = normalizeBaseUrl(Deno.env.get('LALO_BASE_URL') || '');
  const laloApiKey = (Deno.env.get('LALO_PLATFORM_API_KEY') || '').trim();
  const laloAuthEnabled = parseBooleanEnv(Deno.env.get('LALO_WHATSAPP_AUTH_BETA'), false);
  const laloAppId = (Deno.env.get('LALO_APP_ID') || 'im_in').trim() || 'im_in';

  return {
    laloBaseUrl,
    laloApiKey,
    laloAuthEnabled,
    laloAppId,
  };
}

export function assertLaloConfigured() {
  const env = getLaloEnv();

  if (!env.laloAuthEnabled) {
    throw Object.assign(new Error('WhatsApp sign in is not enabled yet.'), { status: 403 });
  }

  if (!env.laloBaseUrl || !env.laloApiKey) {
    throw Object.assign(new Error('Lalo Verify is not configured on the backend.'), { status: 500 });
  }

  return env;
}

async function readErrorMessage(response: Response) {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.message === 'string') return data.message;
    return JSON.stringify(data);
  } catch {
    const text = await response.text();
    return text || `Lalo request failed with ${response.status}.`;
  }
}

async function callLalo<T>(path: string, init: RequestInit) {
  const { laloApiKey, laloBaseUrl } = assertLaloConfigured();
  const response = await fetch(`${laloBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${laloApiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw Object.assign(new Error(message), { status: response.status });
  }

  return (await response.json()) as T;
}

export async function laloStartWhatsAppAuth() {
  const { laloAppId } = assertLaloConfigured();
  return callLalo<LaloStartResponse>('/api/platform/auth/whatsapp/start', {
    method: 'POST',
    body: JSON.stringify({ app: laloAppId }),
  });
}

export async function laloGetWhatsAppAuthStatus(attemptId: string) {
  const params = new URLSearchParams({ attempt_id: attemptId.trim() });
  return callLalo<LaloStatusResponse>(`/api/platform/auth/whatsapp/status?${params.toString()}`, {
    method: 'GET',
  });
}

export async function laloExchangeCompletedAttempt(attemptId: string) {
  const { laloAppId } = assertLaloConfigured();
  return callLalo<LaloExchangeResponse>('/api/platform/auth/exchange', {
    method: 'POST',
    body: JSON.stringify({
      app: laloAppId,
      attempt_id: attemptId.trim(),
    }),
  });
}

export function createAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw Object.assign(new Error('Supabase admin environment is not configured.'), { status: 500 });
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getAuthenticatedUser(request: Request) {
  const authorizationHeader = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!authorizationHeader || !supabaseUrl || !supabaseAnonKey) {
    throw Object.assign(new Error('You need to be signed in to continue.'), { status: 401 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authorizationHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw Object.assign(new Error(error?.message || 'You need to be signed in to continue.'), { status: 401 });
  }

  return data.user;
}

function deriveLinkedAuthProvider(user: SupabaseUser, profile?: AttendeeProfileRow | null) {
  const currentProvider = (profile?.auth_provider || '').trim();
  if (currentProvider && currentProvider !== LALO_PROVIDER) {
    return currentProvider;
  }

  const provider = String(user.app_metadata?.provider || '').trim().toLowerCase();
  if (provider === 'google') return 'google';
  if (provider === 'email') return 'email';
  return currentProvider || 'email';
}

function hasProfileName(profile?: AttendeeProfileRow | null) {
  return !!`${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
}

function pickMergedProfileEmail(
  targetProfile: AttendeeProfileRow | null,
  sourceProfile: AttendeeProfileRow | null,
  normalizedCurrentEmail: string,
) {
  return targetProfile?.email?.trim() || normalizedCurrentEmail || sourceProfile?.email?.trim() || null;
}

async function deleteEventSharedDuplicates(admin: SupabaseClient, sourceUserId: string, targetUserId: string) {
  const { data: sourceRows, error: sourceError } = await admin
    .from('event_shared_with_users')
    .select('event_id')
    .eq('user_id', sourceUserId);

  if (sourceError) {
    throw Object.assign(new Error(sourceError.message), { status: 500 });
  }

  const { data: targetRows, error: targetError } = await admin
    .from('event_shared_with_users')
    .select('event_id')
    .eq('user_id', targetUserId);

  if (targetError) {
    throw Object.assign(new Error(targetError.message), { status: 500 });
  }

  const targetEventIds = new Set((targetRows || []).map((row: { event_id: string }) => row.event_id));
  const duplicateEventIds = (sourceRows || [])
    .map((row: { event_id: string }) => row.event_id)
    .filter((eventId: string) => targetEventIds.has(eventId));

  if (duplicateEventIds.length === 0) return;

  const { error: deleteError } = await admin
    .from('event_shared_with_users')
    .delete()
    .eq('user_id', sourceUserId)
    .in('event_id', duplicateEventIds);

  if (deleteError) {
    throw Object.assign(new Error(deleteError.message), { status: 500 });
  }
}

async function deleteEventHostDuplicates(admin: SupabaseClient, sourceUserId: string, targetUserId: string) {
  const { data: sourceRows, error: sourceError } = await admin
    .from('event_hosts')
    .select('event_id')
    .eq('user_id', sourceUserId);

  if (sourceError) {
    throw Object.assign(new Error(sourceError.message), { status: 500 });
  }

  const { data: targetRows, error: targetError } = await admin
    .from('event_hosts')
    .select('event_id')
    .eq('user_id', targetUserId);

  if (targetError) {
    throw Object.assign(new Error(targetError.message), { status: 500 });
  }

  const targetEventIds = new Set((targetRows || []).map((row: { event_id: string }) => row.event_id));
  const duplicateEventIds = (sourceRows || [])
    .map((row: { event_id: string }) => row.event_id)
    .filter((eventId: string) => targetEventIds.has(eventId));

  if (duplicateEventIds.length === 0) return;

  const { error: deleteError } = await admin
    .from('event_hosts')
    .delete()
    .eq('user_id', sourceUserId)
    .in('event_id', duplicateEventIds);

  if (deleteError) {
    throw Object.assign(new Error(deleteError.message), { status: 500 });
  }
}

async function mergeProfileRecords(
  admin: SupabaseClient,
  sourceProfile: AttendeeProfileRow,
  targetProfile: AttendeeProfileRow,
  nextUserId: string,
  nextAuthProvider: string,
  laloUserId: string,
  whatsappNumber: string | null,
  verifiedAt: string,
  normalizedCurrentEmail: string,
) {
  if (sourceProfile.id !== targetProfile.id) {
    const operations = await Promise.all([
      admin
        .from('event_interests')
        .delete()
        .eq('attendee_profile_id', sourceProfile.id)
        .in(
          'event_id',
          (
            await admin
              .from('event_interests')
              .select('event_id')
              .eq('attendee_profile_id', targetProfile.id)
          ).data?.map((row: { event_id: string }) => row.event_id) || ['00000000-0000-0000-0000-000000000000'],
        ),
      admin
        .from('event_join_requests')
        .delete()
        .eq('attendee_profile_id', sourceProfile.id)
        .eq('status', 'pending')
        .in(
          'event_id',
          (
            await admin
              .from('event_join_requests')
              .select('event_id')
              .eq('attendee_profile_id', targetProfile.id)
              .eq('status', 'pending')
          ).data?.map((row: { event_id: string }) => row.event_id) || ['00000000-0000-0000-0000-000000000000'],
        ),
      admin.from('event_attendees').update({ attendee_profile_id: targetProfile.id }).eq('attendee_profile_id', sourceProfile.id),
      admin
        .from('event_attendees')
        .update({ added_by_attendee_profile_id: targetProfile.id })
        .eq('added_by_attendee_profile_id', sourceProfile.id),
      admin.from('event_interests').update({ attendee_profile_id: targetProfile.id }).eq('attendee_profile_id', sourceProfile.id),
      admin.from('event_join_requests').update({ attendee_profile_id: targetProfile.id }).eq('attendee_profile_id', sourceProfile.id),
      admin.from('attendee_sessions').update({ attendee_profile_id: targetProfile.id }).eq('attendee_profile_id', sourceProfile.id),
    ]);

    const failedOperation = operations.find((result) => result.error);
    if (failedOperation?.error) {
      throw Object.assign(new Error(failedOperation.error.message), { status: 500 });
    }
  }

  const mergedFirstName = hasProfileName(targetProfile) ? targetProfile.first_name : sourceProfile.first_name;
  const mergedLastName = hasProfileName(targetProfile) ? targetProfile.last_name : sourceProfile.last_name;
  const mergedEmail = pickMergedProfileEmail(targetProfile, sourceProfile, normalizedCurrentEmail);

  const { error: updateProfileError } = await admin
    .from('attendee_profiles')
    .update({
      user_id: nextUserId,
      email: mergedEmail,
      first_name: mergedFirstName,
      last_name: mergedLastName,
      auth_provider: nextAuthProvider,
      lalo_user_id: laloUserId,
      whatsapp_number: whatsappNumber,
      whatsapp_verified_at: verifiedAt,
    })
    .eq('id', targetProfile.id);

  if (updateProfileError) {
    throw Object.assign(new Error(updateProfileError.message), { status: 500 });
  }

  if (sourceProfile.id !== targetProfile.id) {
    const { error: deleteSourceProfileError } = await admin
      .from('attendee_profiles')
      .delete()
      .eq('id', sourceProfile.id);

    if (deleteSourceProfileError) {
      throw Object.assign(new Error(deleteSourceProfileError.message), { status: 500 });
    }
  }
}

async function mergeUserLinkedRecords(
  admin: SupabaseClient,
  sourceUserId: string,
  targetUserId: string,
) {
  if (!sourceUserId || sourceUserId === targetUserId) return;

  await deleteEventSharedDuplicates(admin, sourceUserId, targetUserId);
  await deleteEventHostDuplicates(admin, sourceUserId, targetUserId);

  const updates = await Promise.all([
    admin.from('events').update({ host_user_id: targetUserId }).eq('host_user_id', sourceUserId),
    admin.from('event_hosts').update({ user_id: targetUserId }).eq('user_id', sourceUserId),
    admin.from('event_hosts').update({ added_by_user_id: targetUserId }).eq('added_by_user_id', sourceUserId),
    admin.from('event_attendees').update({ user_id: targetUserId }).eq('user_id', sourceUserId),
    admin.from('event_interests').update({ user_id: targetUserId }).eq('user_id', sourceUserId),
    admin.from('event_join_requests').update({ user_id: targetUserId }).eq('user_id', sourceUserId),
    admin.from('event_join_requests').update({ reviewed_by_user_id: targetUserId }).eq('reviewed_by_user_id', sourceUserId),
    admin.from('event_shared_with_users').update({ user_id: targetUserId }).eq('user_id', sourceUserId),
    admin.from('attendee_profiles').update({ user_id: targetUserId }).eq('user_id', sourceUserId),
  ]);

  const failedUpdate = updates.find((result) => result.error);
  if (failedUpdate?.error) {
    throw Object.assign(new Error(failedUpdate.error.message), { status: 500 });
  }
}

export async function mergeLaloAccountIntoUser(
  admin: SupabaseClient,
  currentUser: SupabaseUser,
  sourceProfile: AttendeeProfileRow,
  targetProfile: AttendeeProfileRow | null,
  laloUserId: string,
  whatsappNumber: string | null,
  verifiedAt: string,
) {
  const nextAuthProvider = deriveLinkedAuthProvider(currentUser, targetProfile || sourceProfile);
  const profileToKeep = targetProfile || sourceProfile;
  const sourceUserId = sourceProfile.user_id;

  await mergeUserLinkedRecords(admin, sourceUserId || '', currentUser.id);
  await mergeProfileRecords(
    admin,
    sourceProfile,
    profileToKeep,
    currentUser.id,
    nextAuthProvider,
    laloUserId,
    whatsappNumber,
    verifiedAt,
    normalizeEmail(currentUser.email),
  );

  const providers = Array.from(
    new Set(
      [
        currentUser.app_metadata?.provider,
        ...(Array.isArray(currentUser.app_metadata?.providers) ? currentUser.app_metadata.providers : []),
        LALO_PROVIDER,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

  const { error: updateCurrentUserError } = await admin.auth.admin.updateUserById(currentUser.id, {
    user_metadata: {
      ...(currentUser.user_metadata || {}),
      lalo_user_id: laloUserId,
      whatsapp_number: whatsappNumber,
      whatsapp_verified_at: verifiedAt,
    },
    app_metadata: {
      ...(currentUser.app_metadata || {}),
      providers,
    },
  });

  if (updateCurrentUserError) {
    throw Object.assign(new Error(updateCurrentUserError.message), { status: 500 });
  }

  if (sourceUserId && sourceUserId !== currentUser.id) {
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(sourceUserId);
    if (deleteUserError) {
      throw Object.assign(new Error(deleteUserError.message), { status: 500 });
    }
  }

  return {
    merged: !!sourceUserId && sourceUserId !== currentUser.id,
    profileId: profileToKeep.id,
  };
}

export async function createOrLinkLaloUser(admin: SupabaseClient, laloUserId: string) {
  const syntheticEmail = buildLaloSyntheticEmail(laloUserId);
  const temporaryPassword = generatePassword();
  const verifiedAt = new Date().toISOString();

  let profile: AttendeeProfileRow | null = null;

  const { data: existingByLalo, error: existingByLaloError } = await admin
    .from('attendee_profiles')
    .select('id, email, user_id, lalo_user_id, auth_provider')
    .eq('lalo_user_id', laloUserId)
    .maybeSingle();

  if (existingByLaloError) {
    throw Object.assign(new Error(existingByLaloError.message), { status: 500 });
  }

  profile = existingByLalo;

  if (!profile) {
    const { data: existingByEmail, error: existingByEmailError } = await admin
      .from('attendee_profiles')
      .select('id, email, user_id, lalo_user_id, auth_provider')
      .eq('email', syntheticEmail)
      .maybeSingle();

    if (existingByEmailError) {
      throw Object.assign(new Error(existingByEmailError.message), { status: 500 });
    }

    profile = existingByEmail;
  }

  let userId = profile?.user_id || null;
  const nextAuthProvider =
    profile?.auth_provider?.trim() && profile.auth_provider !== LALO_PROVIDER ? profile.auth_provider : LALO_PROVIDER;
  const metadata = {
    auth_provider: nextAuthProvider,
    lalo_user_id: laloUserId,
  };
  const profileEmail = profile?.email?.trim() || syntheticEmail;
  const shouldUseSyntheticCredentials = normalizeEmail(profileEmail) === normalizeEmail(syntheticEmail);
  let signInEmail = shouldUseSyntheticCredentials ? syntheticEmail : profileEmail;

  if (userId) {
    const { data: existingUserData, error: getUserError } = await admin.auth.admin.getUserById(userId);
    if (getUserError) {
      throw Object.assign(new Error(getUserError.message), { status: 500 });
    }

    const existingUser = existingUserData.user;
    const providers = Array.from(
      new Set(
        [existingUser?.app_metadata?.provider, ...(Array.isArray(existingUser?.app_metadata?.providers) ? existingUser.app_metadata.providers : []), LALO_PROVIDER]
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      ),
    );

    const nextUserPayload: Parameters<typeof admin.auth.admin.updateUserById>[1] = {
      password: temporaryPassword,
      user_metadata: {
        ...(existingUser?.user_metadata || {}),
        ...metadata,
        whatsapp_verified_at: verifiedAt,
      },
      app_metadata: {
        ...(existingUser?.app_metadata || {}),
        provider: String(existingUser?.app_metadata?.provider || '').trim() || nextAuthProvider,
        providers,
      },
    };

    if (shouldUseSyntheticCredentials) {
      nextUserPayload.email = syntheticEmail;
      nextUserPayload.email_confirm = true;
      nextUserPayload.app_metadata = {
        ...(nextUserPayload.app_metadata || {}),
        provider: LALO_PROVIDER,
        providers,
      };
      signInEmail = syntheticEmail;
    }

    const { error: updateUserError } = await admin.auth.admin.updateUserById(userId, {
      ...nextUserPayload,
    });

    if (updateUserError) {
      throw Object.assign(new Error(updateUserError.message), { status: 500 });
    }
  } else {
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: metadata,
      app_metadata: {
        provider: LALO_PROVIDER,
        providers: [LALO_PROVIDER],
      },
    });

    if (createUserError || !createdUser.user?.id) {
      throw Object.assign(new Error(createUserError?.message || 'Could not create the local auth user.'), { status: 500 });
    }

    userId = createdUser.user.id;
  }

  if (profile?.id) {
    const { error: updateProfileError } = await admin
      .from('attendee_profiles')
      .update({
        auth_provider: nextAuthProvider,
        lalo_user_id: laloUserId,
        whatsapp_verified_at: verifiedAt,
        user_id: userId,
        email: profileEmail,
      })
      .eq('id', profile.id);

    if (updateProfileError) {
      throw Object.assign(new Error(updateProfileError.message), { status: 500 });
    }
  } else {
    const { error: insertProfileError } = await admin
      .from('attendee_profiles')
      .insert({
        auth_provider: nextAuthProvider,
        lalo_user_id: laloUserId,
        whatsapp_verified_at: verifiedAt,
        user_id: userId,
        email: profileEmail,
        first_name: '',
        last_name: '',
      });

    if (insertProfileError) {
      throw Object.assign(new Error(insertProfileError.message), { status: 500 });
    }
  }

  return {
    authProvider: nextAuthProvider,
    isNewProfile: !profile,
    signInEmail,
    signInPassword: temporaryPassword,
    userId,
  };
}

export async function linkExistingUserToLaloIdentity(
  admin: SupabaseClient,
  user: SupabaseUser,
  laloUserId: string,
  whatsappNumber?: string | null,
) {
  const normalizedEmail = normalizeEmail(user.email);
  const normalizedWhatsappNumber = normalizeWhatsappNumber(whatsappNumber);
  const verifiedAt = new Date().toISOString();

  const { data: existingByLalo, error: existingByLaloError } = await admin
    .from('attendee_profiles')
    .select('id, email, user_id, lalo_user_id, auth_provider, first_name, last_name, whatsapp_number, whatsapp_verified_at')
    .eq('lalo_user_id', laloUserId)
    .maybeSingle();

  if (existingByLaloError) {
    throw Object.assign(new Error(existingByLaloError.message), { status: 500 });
  }

  let profile: AttendeeProfileRow | null = null;

  const { data: byUserRows, error: byUserError } = await admin
    .from('attendee_profiles')
    .select('id, email, user_id, lalo_user_id, auth_provider, whatsapp_number, whatsapp_verified_at, first_name, last_name')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (byUserError) {
    throw Object.assign(new Error(byUserError.message), { status: 500 });
  }

  profile = (byUserRows?.[0] as AttendeeProfileRow | null) || null;

  if (!profile && normalizedEmail) {
    const { data: byEmailRows, error: byEmailError } = await admin
      .from('attendee_profiles')
      .select('id, email, user_id, lalo_user_id, auth_provider, whatsapp_number, whatsapp_verified_at, first_name, last_name')
      .eq('email', normalizedEmail)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (byEmailError) {
      throw Object.assign(new Error(byEmailError.message), { status: 500 });
    }

    profile = (byEmailRows?.[0] as AttendeeProfileRow | null) || null;
  }

  if (existingByLalo?.user_id && existingByLalo.user_id !== user.id) {
    const mergeResult = await mergeLaloAccountIntoUser(
      admin,
      user,
      existingByLalo as AttendeeProfileRow,
      profile,
      laloUserId,
      normalizedWhatsappNumber,
      verifiedAt,
    );

    return {
      linked: true as const,
      merged: mergeResult.merged,
      laloUserId,
      whatsappNumber: normalizedWhatsappNumber,
    };
  }

  const nextAuthProvider = deriveLinkedAuthProvider(user, profile);
  const updatePayload = {
    user_id: user.id,
    email: profile?.email?.trim() || normalizedEmail || null,
    auth_provider: nextAuthProvider,
    lalo_user_id: laloUserId,
    whatsapp_number: normalizedWhatsappNumber,
    whatsapp_verified_at: verifiedAt,
  };

  if (profile?.id) {
    const { error: updateProfileError } = await admin
      .from('attendee_profiles')
      .update(updatePayload)
      .eq('id', profile.id);

    if (updateProfileError) {
      throw Object.assign(new Error(updateProfileError.message), { status: 500 });
    }
  } else {
    const { error: insertProfileError } = await admin
      .from('attendee_profiles')
      .insert({
        ...updatePayload,
        first_name: '',
        last_name: '',
      });

    if (insertProfileError) {
      throw Object.assign(new Error(insertProfileError.message), { status: 500 });
    }
  }

  const providers = Array.from(
    new Set(
      [user.app_metadata?.provider, ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []), LALO_PROVIDER]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

  const { error: updateUserError } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.user_metadata || {}),
      lalo_user_id: laloUserId,
      whatsapp_number: normalizedWhatsappNumber,
      whatsapp_verified_at: verifiedAt,
    },
    app_metadata: {
      ...(user.app_metadata || {}),
      providers,
    },
  });

  if (updateUserError) {
    throw Object.assign(new Error(updateUserError.message), { status: 500 });
  }

  return {
    linked: true as const,
    merged: false,
    laloUserId,
    whatsappNumber: normalizedWhatsappNumber,
  };
}
