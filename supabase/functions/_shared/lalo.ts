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

type AttendeeProfileRow = {
  id: string;
  email: string | null;
  user_id: string | null;
  lalo_user_id: string | null;
  auth_provider: string | null;
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

function normalizeEmail(value: string | null | undefined) {
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
  const metadata = {
    auth_provider: LALO_PROVIDER,
    lalo_user_id: laloUserId,
  };

  if (userId) {
    const { error: updateUserError } = await admin.auth.admin.updateUserById(userId, {
      email: syntheticEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: metadata,
      app_metadata: {
        provider: LALO_PROVIDER,
        providers: [LALO_PROVIDER],
      },
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

  const profileEmail = profile?.email?.trim() || syntheticEmail;

  if (profile?.id) {
    const { error: updateProfileError } = await admin
      .from('attendee_profiles')
      .update({
        auth_provider: LALO_PROVIDER,
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
        auth_provider: LALO_PROVIDER,
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
    authProvider: LALO_PROVIDER,
    isNewProfile: !profile,
    signInEmail: syntheticEmail,
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
    .select('id, email, user_id, lalo_user_id, auth_provider, whatsapp_number, whatsapp_verified_at')
    .eq('lalo_user_id', laloUserId)
    .maybeSingle();

  if (existingByLaloError) {
    throw Object.assign(new Error(existingByLaloError.message), { status: 500 });
  }

  if (existingByLalo?.user_id && existingByLalo.user_id !== user.id) {
    throw Object.assign(new Error('That WhatsApp account is already linked to another profile.'), { status: 409 });
  }

  let profile: AttendeeProfileRow | null = existingByLalo || null;

  if (!profile) {
    const { data: byUserRows, error: byUserError } = await admin
      .from('attendee_profiles')
      .select('id, email, user_id, lalo_user_id, auth_provider, whatsapp_number, whatsapp_verified_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (byUserError) {
      throw Object.assign(new Error(byUserError.message), { status: 500 });
    }

    profile = byUserRows?.[0] || null;
  }

  if (!profile && normalizedEmail) {
    const { data: byEmailRows, error: byEmailError } = await admin
      .from('attendee_profiles')
      .select('id, email, user_id, lalo_user_id, auth_provider, whatsapp_number, whatsapp_verified_at')
      .eq('email', normalizedEmail)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (byEmailError) {
      throw Object.assign(new Error(byEmailError.message), { status: 500 });
    }

    profile = byEmailRows?.[0] || null;
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
    laloUserId,
    whatsappNumber: normalizedWhatsappNumber,
  };
}
