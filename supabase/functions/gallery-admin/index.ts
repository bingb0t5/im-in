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

function parseEmailAllowlist(raw?: string | null) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const ADMIN_REVIEW_IMAGE_TRANSFORM = {
  width: 1400,
  quality: 72,
};

async function getRequiredUser(supabaseUrl: string, supabaseAnonKey: string, authorizationHeader: string | null) {
  if (!authorizationHeader?.trim()) {
    throw new Error('Missing authorization header.');
  }
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new Error(error?.message || 'Could not verify current user.');
  }
  return data.user;
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
      throw new Error('Supabase credentials are not configured for gallery-admin.');
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    const allowlist = parseEmailAllowlist(Deno.env.get('MODERATION_ADMIN_EMAILS'));
    const userEmail = normalizeText(user.email).toLowerCase();
    if (allowlist.length === 0) {
      return json({ error: 'Gallery admin allowlist is not configured.' }, { status: 403 });
    }
    if (!userEmail || !allowlist.includes(userEmail)) {
      return json({ error: 'Not authorized to use gallery admin.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const bucket = Deno.env.get('EVENT_GALLERY_BUCKET') || 'event-gallery';

    if (body?.list === true) {
      const { data, error } = await admin
        .from('event_gallery_images')
        .select(`
          *,
          event:events (
            id,
            slug,
            title,
            host_name,
            visibility,
            is_public,
            gallery_visibility
          )
        `)
        .or('public_visibility_status.eq.pending,public_visibility_status.eq.blocked,public_visibility_status.eq.error,public_visibility_status.eq.report_hidden')
        .order('review_requested_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false })
        .limit(300);

      if (error) {
        throw new Error(error.message || 'Could not load gallery admin queue.');
      }

      const rows = (data || []) as Array<Record<string, unknown>>;
      const items = await Promise.all(
        rows.map(async (row) => {
          const storagePath = normalizeText(String(row.storage_path || ''));
          let signedUrl: string | null = null;
          if (storagePath) {
            const { data: signedData } = await admin.storage.from(bucket).createSignedUrl(storagePath, 60 * 60, {
              transform: ADMIN_REVIEW_IMAGE_TRANSFORM,
            });
            signedUrl = signedData?.signedUrl || null;
          }
          return {
            ...row,
            signed_url: signedUrl,
          };
        }),
      );

      return json({ items });
    }

    const imageId = normalizeText(typeof body?.imageId === 'string' ? body.imageId : '');
    const action = normalizeText(typeof body?.action === 'string' ? body.action : '');
    if (!imageId || !action) {
      return json({ error: 'imageId and action are required.' }, { status: 400 });
    }

    if (action === 'approve') {
      const { error } = await admin
        .from('event_gallery_images')
        .update({
          public_visibility_status: 'approved',
          public_hidden_at: null,
          public_hidden_reason: null,
          review_requested_at: null,
          public_moderated_at: new Date().toISOString(),
        })
        .eq('id', imageId);
      if (error) throw new Error(error.message || 'Could not approve image.');
      return json({ ok: true });
    }

    if (action === 'block') {
      const reason = normalizeText(typeof body?.reason === 'string' ? body.reason : '') || 'admin_blocked';
      const { error } = await admin
        .from('event_gallery_images')
        .update({
          public_visibility_status: 'blocked',
          public_hidden_at: new Date().toISOString(),
          public_hidden_reason: reason,
          review_requested_at: new Date().toISOString(),
          public_moderated_at: new Date().toISOString(),
        })
        .eq('id', imageId);
      if (error) throw new Error(error.message || 'Could not block image.');
      return json({ ok: true });
    }

    if (action === 'mark_private') {
      const { error } = await admin
        .from('event_gallery_images')
        .update({
          public_visibility_status: 'private_only',
          public_hidden_at: null,
          public_hidden_reason: null,
          review_requested_at: null,
          public_moderated_at: new Date().toISOString(),
        })
        .eq('id', imageId);
      if (error) throw new Error(error.message || 'Could not mark image as private-only.');
      return json({ ok: true });
    }

    if (action === 'delete') {
      const { data: row, error: rowError } = await admin
        .from('event_gallery_images')
        .select('storage_bucket, storage_path')
        .eq('id', imageId)
        .single();
      if (rowError || !row) {
        throw new Error(rowError?.message || 'Image not found.');
      }

      const objectBucket = normalizeText((row as { storage_bucket?: string | null }).storage_bucket) || bucket;
      const objectPath = normalizeText((row as { storage_path?: string | null }).storage_path);
      if (objectPath) {
        await admin.storage.from(objectBucket).remove([objectPath]);
      }

      const { error } = await admin
        .from('event_gallery_images')
        .delete()
        .eq('id', imageId);
      if (error) throw new Error(error.message || 'Could not delete gallery image.');
      return json({ ok: true });
    }

    return json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected gallery-admin error.';
    return json({ error: message }, { status: 500 });
  }
});
