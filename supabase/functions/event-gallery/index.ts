import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

function normalizeText(value: string | null | undefined) {
  return (value || '').trim();
}

async function getOptionalUser(supabaseUrl: string, supabaseAnonKey: string, authorizationHeader: string | null) {
  if (!authorizationHeader?.trim()) return null;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

type GalleryRow = {
  id: string;
  event_id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  original_file_name: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  public_visibility_status: string;
  public_moderation_reasons: string[] | null;
  public_moderation_confidence: number | null;
  public_moderated_at: string | null;
  public_hidden_at: string | null;
  public_hidden_reason: string | null;
  review_requested_at: string | null;
  report_count: number | null;
  is_public_preview_visible?: boolean;
  can_report?: boolean;
  created_at: string;
  updated_at: string;
};

type SignedUrlTransform = {
  width: number;
  quality: number;
};

const MANAGE_IMAGE_TRANSFORM: SignedUrlTransform = {
  width: 1200,
  quality: 70,
};

const VIEW_IMAGE_TRANSFORM: SignedUrlTransform = {
  width: 1600,
  quality: 75,
};

async function createSignedUrlMap(
  adminClient: ReturnType<typeof createClient>,
  rows: GalleryRow[],
  expiresInSeconds = 60 * 60,
  transform?: SignedUrlTransform,
) {
  const output = new Map<string, string>();
  for (const row of rows) {
    const bucket = normalizeText(row.storage_bucket) || 'event-gallery';
    const path = normalizeText(row.storage_path);
    if (!path) continue;
    const { data } = await adminClient.storage.from(bucket).createSignedUrl(path, expiresInSeconds, transform
      ? {
          transform,
        }
      : undefined);
    if (data?.signedUrl) {
      output.set(row.id, data.signedUrl);
    }
  }
  return output;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error('Supabase credentials are not configured for event-gallery.');
    }

    const authorizationHeader = req.headers.get('Authorization');
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const mode = normalizeText(typeof body?.mode === 'string' ? body.mode : '');
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (mode === 'manage') {
      const eventId = normalizeText(typeof body?.eventId === 'string' ? body.eventId : '');
      if (!eventId) {
        return json({ error: 'eventId is required in manage mode.' }, { status: 400 });
      }
      const user = await getOptionalUser(supabaseUrl, supabaseAnonKey, authorizationHeader);
      if (!user?.id) {
        return json({ error: 'Sign-in required for gallery management.' }, { status: 401 });
      }

      const { data: eventRow, error: eventError } = await adminClient
        .from('events')
        .select('id, host_user_id, gallery_visibility')
        .eq('id', eventId)
        .single();
      if (eventError || !eventRow) {
        return json({ error: eventError?.message || 'Event not found.' }, { status: 404 });
      }

      let isHost = eventRow.host_user_id === user.id;
      if (!isHost) {
        const { data: hostMembership } = await adminClient
          .from('event_hosts')
          .select('id')
          .eq('event_id', eventRow.id)
          .eq('user_id', user.id)
          .maybeSingle();
        isHost = !!hostMembership?.id;
      }
      if (!isHost) {
        return json({ error: 'Only hosts can manage gallery images.' }, { status: 403 });
      }

      const { data: rows, error: rowsError } = await adminClient
        .from('event_gallery_images')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (rowsError) {
        throw new Error(rowsError.message || 'Could not load gallery images.');
      }

      const galleryRows = (rows || []) as GalleryRow[];
      const signedUrls = await createSignedUrlMap(adminClient, galleryRows, 60 * 60, MANAGE_IMAGE_TRANSFORM);
      const images = galleryRows.map((row) => ({
        ...row,
        signed_url: signedUrls.get(row.id) || null,
      }));

      return json({
        galleryVisibility: normalizeText(eventRow.gallery_visibility) || 'private_only',
        images,
      });
    }

    const eventSlug = normalizeText(typeof body?.eventSlug === 'string' ? body.eventSlug : '');
    if (!eventSlug) {
      return json({ error: 'eventSlug is required.' }, { status: 400 });
    }

    const accessCode = normalizeText(typeof body?.accessCode === 'string' ? body.accessCode : '') || null;
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: authorizationHeader ? { headers: { Authorization: authorizationHeader } } : undefined,
    });
    const { data: rows, error: rpcError } = await userClient.rpc('list_event_gallery_for_view', {
      p_slug: eventSlug,
      p_access_code: accessCode,
    });
    if (rpcError) {
      throw new Error(rpcError.message || 'Could not load gallery.');
    }

    const galleryRows = ((rows || []) as GalleryRow[]).filter((row) => normalizeText(row.storage_path));
    const signedUrls = await createSignedUrlMap(adminClient, galleryRows, 60 * 60, VIEW_IMAGE_TRANSFORM);
    const images = galleryRows.map((row) => ({
      ...row,
      signed_url: signedUrls.get(row.id) || null,
      can_report: Boolean(row.can_report),
      is_public_preview_visible: Boolean(row.is_public_preview_visible),
    }));

    return json({ images });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected event-gallery error.';
    return json({ error: message }, { status: 500 });
  }
});
