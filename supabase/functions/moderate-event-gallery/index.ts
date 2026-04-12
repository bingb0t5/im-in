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

type GalleryRow = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  public_visibility_status: string;
  public_hidden_at: string | null;
};

type ModerationResult = {
  allow: boolean;
  reasons: string[];
  confidence: number;
  status: 'approved' | 'blocked' | 'error';
};

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, Number(value)));
}

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

async function moderateImageWithOpenAI({
  apiKey,
  model,
  signedUrl,
}: {
  apiKey: string | null;
  model: string;
  signedUrl: string;
}): Promise<ModerationResult> {
  if (!apiKey) {
    return {
      allow: true,
      reasons: ['ai_not_configured'],
      confidence: 0.5,
      status: 'approved',
    };
  }

  const schema = {
    name: 'gallery_image_moderation',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        allow: { type: 'boolean' },
        reasons: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
      },
      required: ['allow', 'reasons', 'confidence'],
    },
  } as const;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: schema,
      },
      messages: [
        {
          role: 'system',
          content:
            'You moderate activity gallery photos for public preview. Block hateful, violent, explicit sexual, graphic, or scam-like content. Allow normal people/events/scenes.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Should this image be allowed in a public activity preview gallery?' },
            {
              type: 'image_url',
              image_url: { url: signedUrl },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI moderation request failed: ${response.status} ${details}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content || '{}') as { allow?: boolean; reasons?: string[]; confidence?: number };

  const allow = Boolean(parsed.allow);
  return {
    allow,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((reason) => String(reason)) : [],
    confidence: clampConfidence(Number(parsed.confidence ?? 0.5)),
    status: allow ? 'approved' : 'blocked',
  };
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
      throw new Error('Supabase credentials are not configured for moderate-event-gallery.');
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const eventId = normalizeText(typeof body?.eventId === 'string' ? body.eventId : '');
    if (!eventId) {
      return json({ error: 'eventId is required.' }, { status: 400 });
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: eventRow, error: eventError } = await admin
      .from('events')
      .select('id, host_user_id, visibility, is_public, gallery_visibility')
      .eq('id', eventId)
      .single();
    if (eventError || !eventRow) {
      return json({ error: eventError?.message || 'Event not found.' }, { status: 404 });
    }

    let isHost = eventRow.host_user_id === user.id;
    if (!isHost) {
      const { data: hostMembership } = await admin
        .from('event_hosts')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', user.id)
        .maybeSingle();
      isHost = !!hostMembership?.id;
    }
    if (!isHost) {
      return json({ error: 'Only hosts can run gallery moderation.' }, { status: 403 });
    }

    const visibility = normalizeText(eventRow.visibility) || (eventRow.is_public ? 'public' : 'private');
    const galleryVisibility = normalizeText(eventRow.gallery_visibility) || 'private_only';
    const isPublicPreview = visibility !== 'private' && galleryVisibility === 'public_preview';

    const { data: rows, error: rowsError } = await admin
      .from('event_gallery_images')
      .select('id, storage_bucket, storage_path, public_visibility_status, public_hidden_at')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (rowsError) {
      throw new Error(rowsError.message || 'Could not load gallery images.');
    }

    const images = (rows || []) as GalleryRow[];
    if (!isPublicPreview) {
      if (images.length > 0) {
        const ids = images.map((image) => image.id);
        await admin
          .from('event_gallery_images')
          .update({
            public_visibility_status: 'private_only',
            public_moderation_reasons: [],
            public_moderation_confidence: null,
            public_moderated_at: new Date().toISOString(),
            public_hidden_reason: null,
          })
          .in('id', ids);
      }
      return json({
        ok: true,
        moderatedCount: images.length,
        approvedCount: 0,
        blockedCount: 0,
        skippedBecauseNotPublicPreview: true,
      });
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    const model = Deno.env.get('GALLERY_MODERATION_MODEL') || 'gpt-4.1-mini';
    let approvedCount = 0;
    let blockedCount = 0;
    const errors: Array<{ imageId: string; message: string }> = [];

    for (const image of images) {
      if (!image.storage_path) continue;
      if (image.public_visibility_status === 'report_hidden' && image.public_hidden_at) {
        continue;
      }

      const bucket = normalizeText(image.storage_bucket) || 'event-gallery';
      const { data: signedData, error: signError } = await admin.storage
        .from(bucket)
        .createSignedUrl(image.storage_path, 60 * 15);

      if (signError || !signedData?.signedUrl) {
        errors.push({ imageId: image.id, message: signError?.message || 'Could not generate signed URL.' });
        await admin
          .from('event_gallery_images')
          .update({
            public_visibility_status: 'error',
            public_moderation_reasons: ['signed_url_generation_failed'],
            public_moderation_confidence: null,
            public_moderated_at: new Date().toISOString(),
            review_requested_at: new Date().toISOString(),
          })
          .eq('id', image.id);
        continue;
      }

      try {
        const moderation = await moderateImageWithOpenAI({
          apiKey,
          model,
          signedUrl: signedData.signedUrl,
        });
        if (moderation.status === 'approved') {
          approvedCount += 1;
        } else if (moderation.status === 'blocked') {
          blockedCount += 1;
        }

        await admin
          .from('event_gallery_images')
          .update({
            public_visibility_status: moderation.status,
            public_moderation_reasons: moderation.reasons,
            public_moderation_confidence: moderation.confidence,
            public_moderated_at: new Date().toISOString(),
            public_hidden_at: moderation.allow ? null : new Date().toISOString(),
            public_hidden_reason: moderation.allow ? null : 'ai_blocked',
            review_requested_at: moderation.allow ? null : new Date().toISOString(),
          })
          .eq('id', image.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Gallery moderation failed.';
        errors.push({ imageId: image.id, message });
        await admin
          .from('event_gallery_images')
          .update({
            public_visibility_status: 'error',
            public_moderation_reasons: ['moderation_call_failed'],
            public_moderation_confidence: null,
            public_moderated_at: new Date().toISOString(),
            review_requested_at: new Date().toISOString(),
          })
          .eq('id', image.id);
      }
    }

    return json({
      ok: true,
      moderatedCount: images.length,
      approvedCount,
      blockedCount,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected moderate-event-gallery error.';
    return json({ error: message }, { status: 500 });
  }
});
