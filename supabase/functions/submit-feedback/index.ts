import { createClient } from 'npm:@supabase/supabase-js@2';

type SubmissionType = 'bug' | 'feature' | 'feedback';
type AbuseRiskLevel = 'low' | 'medium' | 'high';

type FeedbackPayload = {
  submissionType?: string;
  title?: string;
  details?: string;
  reporterName?: string;
  reporterEmail?: string;
  pageUrl?: string;
  screenshotDataUrl?: string;
  source?: string;
};

type AbuseCheckResult = {
  risk_level: AbuseRiskLevel;
  block_submission: boolean;
  reasons: string[];
  confidence: number;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ABUSE_SCHEMA = {
  name: 'feedback_abuse_check',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
      block_submission: { type: 'boolean' },
      reasons: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' },
    },
    required: ['risk_level', 'block_submission', 'reasons', 'confidence'],
  },
} as const;

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

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function trimText(value: string | null | undefined) {
  return (value || '').trim();
}

function normalizeType(value: string | undefined): SubmissionType {
  if (value === 'bug' || value === 'feature' || value === 'feedback') return value;
  return 'feedback';
}

function sanitizeForPublicBoard(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSanitizedSummary(title: string, details: string) {
  const merged = sanitizeForPublicBoard(`${title}. ${details}`);
  return merged.slice(0, 220);
}

function parseDataUrlImage(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) {
    throw new Error('Invalid screenshot format. Please upload PNG, JPG, or WEBP.');
  }

  const mimeType = match[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  if (bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error('Screenshot is too large. Max size is 5MB.');
  }

  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return { bytes, mimeType, extension };
}

async function getOptionalUser(supabaseUrl: string, supabaseAnonKey: string, authorizationHeader: string | null) {
  if (!authorizationHeader?.trim()) return null;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
  });
  const { data } = await userClient.auth.getUser();
  return data.user ?? null;
}

async function runAbuseCheck({
  apiKey,
  model,
  title,
  details,
}: {
  apiKey: string | null;
  model: string;
  title: string;
  details: string;
}): Promise<AbuseCheckResult> {
  if (!apiKey) {
    return {
      risk_level: 'low',
      block_submission: false,
      reasons: ['ai_not_configured'],
      confidence: 0.5,
    };
  }

  const prompt = `
You are a lightweight abuse filter for product feedback submissions.

Only block submissions when there is clear verbal abuse, harassment, hate, violent threats, or explicit spam.
Do not block normal criticism, frustration, or blunt bug reports.
Return strict JSON only.
`.trim();

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
        json_schema: ABUSE_SCHEMA,
      },
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: JSON.stringify({ title, details }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Abuse check failed: ${response.status} ${errorText}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content || '{}') as Partial<AbuseCheckResult>;

  return {
    risk_level: parsed.risk_level === 'high' ? 'high' : parsed.risk_level === 'medium' ? 'medium' : 'low',
    block_submission: Boolean(parsed.block_submission),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((reason) => String(reason)) : [],
    confidence: clampConfidence(Number(parsed.confidence ?? 0.5)),
  };
}

async function createTrelloCard({
  trelloKey,
  trelloToken,
  listId,
  submissionType,
  title,
  details,
  pageUrl,
  submissionId,
}: {
  trelloKey: string | null;
  trelloToken: string | null;
  listId: string | null;
  submissionType: SubmissionType;
  title: string;
  details: string;
  pageUrl: string;
  submissionId: string;
}) {
  if (!trelloKey || !trelloToken || !listId) {
    return { queued: false, skipped: true, cardId: null, cardUrl: null };
  }

  const label =
    submissionType === 'bug' ? 'Bug report' : submissionType === 'feature' ? 'Feature request' : 'General feedback';
  const cardName = `${label}: ${title.slice(0, 72)}`;
  const desc = [
    'Submitted from the public feedback form.',
    '',
    `Type: ${label}`,
    `Title: ${title || '(No title provided)'}`,
    '',
    'Details:',
    details || '(No details provided)',
    '',
    `Source page: ${sanitizeForPublicBoard(pageUrl || 'unknown')}`,
    `Submission ID: ${submissionId}`,
  ].join('\n');

  const params = new URLSearchParams({
    key: trelloKey,
    token: trelloToken,
    idList: listId,
    name: cardName,
    desc,
    pos: 'top',
  });

  const response = await fetch(`https://api.trello.com/1/cards?${params.toString()}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Trello card create failed: ${response.status} ${text}`);
  }

  const card = await response.json();
  return {
    queued: true,
    skipped: false,
    cardId: typeof card?.id === 'string' ? card.id : null,
    cardUrl: typeof card?.url === 'string' ? card.url : null,
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
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error('Supabase credentials are not configured for submit-feedback.');
    }

    const payload = (await req.json()) as FeedbackPayload;
    const submissionType = normalizeType(payload.submissionType);
    const title = trimText(payload.title);
    const details = trimText(payload.details);
    const reporterName = normalizeText(payload.reporterName);
    const reporterEmail = normalizeText(payload.reporterEmail).toLowerCase();
    const pageUrl = normalizeText(payload.pageUrl);
    const source = normalizeText(payload.source) || 'home_modal';

    if (!title || title.length < 3) {
      return json({ error: 'Please add a short title (at least 3 characters).' }, { status: 400 });
    }
    if (!details || details.length < 8) {
      return json({ error: 'Please add more details (at least 8 characters).' }, { status: 400 });
    }

    const authorizationHeader = req.headers.get('Authorization');
    const user = await getOptionalUser(supabaseUrl, supabaseAnonKey, authorizationHeader);
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const abuseCheck = await runAbuseCheck({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
      model: Deno.env.get('OPENAI_FEEDBACK_MODEL') || Deno.env.get('OPENAI_MODERATION_MODEL') || 'gpt-5.4-nano',
      title,
      details,
    });

    const sanitizedSummary = buildSanitizedSummary(title, details);
    const blockedByAbuse = abuseCheck.block_submission;
    const nextStatus = blockedByAbuse ? 'blocked_abuse' : 'pending_review';

    const { data: inserted, error: insertError } = await adminClient
      .from('feedback_submissions')
      .insert({
        submission_type: submissionType,
        title,
        details,
        reporter_name: reporterName || null,
        reporter_email: reporterEmail || null,
        auth_user_id: user?.id || null,
        page_url: pageUrl || null,
        status: nextStatus,
        abuse_risk_level: abuseCheck.risk_level,
        abuse_confidence: abuseCheck.confidence,
        abuse_reasons: abuseCheck.reasons,
        abuse_blocked: blockedByAbuse,
        trello_sync_status: blockedByAbuse ? 'skipped' : 'not_sent',
        public_sanitized_summary: sanitizedSummary || null,
        raw_source: source,
      })
      .select('id')
      .single();

    if (insertError || !inserted?.id) {
      throw new Error(insertError?.message || 'Could not store feedback submission.');
    }

    let screenshotPath: string | null = null;
    const screenshotDataUrl = typeof payload.screenshotDataUrl === 'string' ? payload.screenshotDataUrl.trim() : '';
    if (screenshotDataUrl) {
      const parsed = parseDataUrlImage(screenshotDataUrl);
      const bucket = Deno.env.get('FEEDBACK_SCREENSHOT_BUCKET') || 'feedback-screenshots';
      screenshotPath = `${inserted.id}/${Date.now()}.${parsed.extension}`;
      const { error: uploadError } = await adminClient.storage
        .from(bucket)
        .upload(screenshotPath, parsed.bytes, {
          contentType: parsed.mimeType,
          upsert: false,
        });
      if (uploadError) {
        throw new Error(`Screenshot upload failed: ${uploadError.message}`);
      }
      await adminClient
        .from('feedback_submissions')
        .update({ screenshot_storage_path: screenshotPath })
        .eq('id', inserted.id);
    }

    let trelloCardId: string | null = null;
    let trelloCardUrl: string | null = null;
    let queuedToTrello = false;

    if (!blockedByAbuse) {
      try {
        const trelloResult = await createTrelloCard({
          trelloKey: Deno.env.get('TRELLO_API_KEY'),
          trelloToken: Deno.env.get('TRELLO_API_TOKEN'),
          listId: Deno.env.get('TRELLO_INTAKE_LIST_ID'),
          submissionType,
          title,
          details,
          pageUrl,
          submissionId: inserted.id,
        });

        queuedToTrello = trelloResult.queued;
        trelloCardId = trelloResult.cardId;
        trelloCardUrl = trelloResult.cardUrl;

        await adminClient
          .from('feedback_submissions')
          .update({
            status: queuedToTrello ? 'queued_to_trello' : 'pending_review',
            trello_sync_status: trelloResult.skipped ? 'skipped' : 'synced',
            trello_card_id: trelloCardId,
            trello_card_url: trelloCardUrl,
            trello_list_id: Deno.env.get('TRELLO_INTAKE_LIST_ID') || null,
          })
          .eq('id', inserted.id);
      } catch (trelloError) {
        await adminClient
          .from('feedback_submissions')
          .update({
            status: 'pending_review',
            trello_sync_status: 'failed',
          })
          .eq('id', inserted.id);

        console.error('submit-feedback trello sync error', trelloError);
      }
    }

    return json({
      ok: true,
      submissionId: inserted.id,
      blockedByAbuse,
      queuedToTrello,
      screenshotStored: Boolean(screenshotPath),
      trelloCardId,
      trelloCardUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected submit-feedback failure.';
    return json({ error: message }, { status: 500 });
  }
});
