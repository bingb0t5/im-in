import { createClient } from 'npm:@supabase/supabase-js@2';

type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  url: string;
  idList: string;
  dateLastActivity?: string;
};

type PromptResult = {
  summary: string;
  codex_prompt: string;
  confidenceLevel: 'High' | 'Medium' | 'Low';
  triageLabel: 'bug_fix' | 'design_opportunity' | 'ops_followup' | 'needs_clarification' | 'not_actionable';
  contractVersion: string;
  workItemId?: string;
  verificationChecklist?: string[];
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-trello-webhook',
};

type LaloFeedbackPromptResponse = {
  workItem?: {
    id?: string;
  };
  reviewPacket?: {
    promptPacket?: {
      issueSummary?: string;
      cursorPrompt?: string;
      verificationChecklist?: string[];
      confidenceLevel?: 'High' | 'Medium' | 'Low';
      triageLabel?: 'bug_fix' | 'design_opportunity' | 'ops_followup' | 'needs_clarification' | 'not_actionable';
    };
    analysis?: {
      quickTake?: string;
    };
  };
  error?: string;
  details?: string;
};

class LaloPromptGenerationError extends Error {
  code: 'upstream' | 'unauthorized' | 'invalid_response';
  status: number | null;

  constructor(code: 'upstream' | 'unauthorized' | 'invalid_response', message: string, status: number | null = null) {
    super(message);
    this.name = 'LaloPromptGenerationError';
    this.code = code;
    this.status = status;
  }
}

const ALLOWED_TRIAGE_LABELS = new Set([
  'bug_fix',
  'design_opportunity',
  'ops_followup',
  'needs_clarification',
  'not_actionable',
]);
const ALLOWED_CONFIDENCE_LEVELS = new Set(['High', 'Medium', 'Low']);

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

function normalizeText(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function inferFeedbackType(cardName: string, cardDescription: string): 'bug' | 'feature' | 'feedback' {
  const source = `${cardName} ${cardDescription}`.toLowerCase();
  if (source.includes('bug')) return 'bug';
  if (source.includes('feature')) return 'feature';
  return 'feedback';
}

function parseEmailAllowlist(raw?: string | null) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function timingSafeStringEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function toBase64(input: Uint8Array) {
  let binary = '';
  for (const byte of input) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function computeTrelloWebhookSignature(rawBody: string, callbackUrl: string, appSecret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    {
      name: 'HMAC',
      hash: 'SHA-1',
    },
    false,
    ['sign'],
  );
  const payload = `${rawBody}${callbackUrl}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64(new Uint8Array(signature));
}

function buildFallbackPrompt(card: TrelloCard) {
  return [
    'Do not implement immediately. First inspect the codebase and propose a safe plan before editing.',
    'Wait for explicit approval before implementation.',
    '',
    `Task: ${card.name}`,
    '',
    'Context:',
    card.desc || '(No card description provided)',
    '',
    'Verification:',
    '- Verify the primary user flow end-to-end.',
    '- Verify no auth/permission regressions.',
    '- Verify any docs/config updates needed for deployment.',
  ].join('\n');
}

function upsertPromptSection(existingDescription: string, promptBody: string) {
  const markerStart = '## Codex Prompt Draft (AI)';
  const markerEnd = '## End Codex Prompt Draft';
  const section = `${markerStart}\n${promptBody}\n${markerEnd}`;
  const pattern = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, 'm');
  if (pattern.test(existingDescription)) {
    return existingDescription.replace(pattern, section);
  }
  return `${existingDescription.trim()}\n\n${section}`.trim();
}

async function trelloRequest<T>({
  method = 'GET',
  path,
  key,
  token,
  body,
}: {
  method?: 'GET' | 'PUT' | 'POST';
  path: string;
  key: string;
  token: string;
  body?: URLSearchParams;
}): Promise<T> {
  const url = `https://api.trello.com/1${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(
    key,
  )}&token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    body: body?.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Trello request failed (${method} ${path}): ${response.status} ${text}`);
  }
  return (await response.json()) as T;
}

async function getOptionalUser(supabaseUrl: string, supabaseAnonKey: string, authorizationHeader: string | null) {
  if (!authorizationHeader?.trim()) return null;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
  });
  const { data } = await userClient.auth.getUser();
  return data.user ?? null;
}

async function generateCodexPrompt({
  laloBaseUrl,
  laloApiKey,
  laloApp,
  card,
  feedbackContext,
}: {
  laloBaseUrl: string;
  laloApiKey: string;
  laloApp: 'im_in' | 'lalo';
  card: TrelloCard;
  feedbackContext?: {
    feedbackSubmissionId?: string | null;
    pageUrl?: string | null;
    screenshotPath?: string | null;
  };
}): Promise<PromptResult> {
  const feedbackType = inferFeedbackType(card.name, card.desc || '');
  const payload = {
    app: laloApp,
    feedbackType,
    source: 'feedback',
    runRepro: feedbackType === 'bug',
    requiresVerification: feedbackType === 'bug',
    title: card.name,
    description: card.desc || '(No card description provided)',
    extraContext: {
      source: 'trello_prompt_sync',
      feedbackSubmissionId: feedbackContext?.feedbackSubmissionId || null,
      routeOrArea: feedbackContext?.pageUrl || null,
      screenshotRefs: feedbackContext?.screenshotPath ? [feedbackContext.screenshotPath] : [],
      trelloCard: {
        id: card.id,
        url: card.url,
        idList: card.idList,
        dateLastActivity: card.dateLastActivity || null,
      },
    },
  };

  let response: Response;
  try {
    response = await fetch(`${laloBaseUrl.replace(/\/+$/, '')}/api/platform/internal/engineering-worker/work-items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${laloApiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lalo endpoint was unreachable.';
    throw new LaloPromptGenerationError('upstream', `Lalo feedback prompt request failed: ${message}`, null);
  }

  const bodyText = await response.text();
  let parsed: LaloFeedbackPromptResponse = {};
  try {
    parsed = JSON.parse(bodyText) as LaloFeedbackPromptResponse;
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const errorDetail = normalizeText(parsed.error || parsed.details || bodyText || 'Unknown Lalo error');
    if (response.status === 401 || response.status === 403) {
      throw new LaloPromptGenerationError(
        'unauthorized',
        `Lalo feedback prompt request unauthorized (${response.status}): ${errorDetail}`,
        response.status,
      );
    }
    throw new LaloPromptGenerationError(
      'upstream',
      `Lalo feedback prompt generation failed (${response.status}): ${errorDetail}`,
      response.status,
    );
  }

  const summary = normalizeText(parsed.reviewPacket?.analysis?.quickTake) || `Prompt generated for "${card.name}"`;
  const implementationPrompt = normalizeText(parsed.reviewPacket?.promptPacket?.cursorPrompt) || buildFallbackPrompt(card);
  const confidenceLevel = ALLOWED_CONFIDENCE_LEVELS.has(parsed.reviewPacket?.promptPacket?.confidenceLevel || '')
    ? (parsed.reviewPacket?.promptPacket?.confidenceLevel as PromptResult['confidenceLevel'])
    : 'Medium';
  const triageLabel = ALLOWED_TRIAGE_LABELS.has(parsed.reviewPacket?.promptPacket?.triageLabel || '')
    ? (parsed.reviewPacket?.promptPacket?.triageLabel as PromptResult['triageLabel'])
    : 'needs_clarification';
  const contractVersion = 'engineering_work_item_v1';

  if (!implementationPrompt) {
    throw new LaloPromptGenerationError('invalid_response', 'Lalo feedback prompt response could not be normalized.', 502);
  }

  return {
    summary,
    codex_prompt: implementationPrompt,
    confidenceLevel,
    triageLabel,
    contractVersion,
    workItemId: normalizeText(parsed.workItem?.id) || undefined,
    verificationChecklist: Array.isArray(parsed.reviewPacket?.promptPacket?.verificationChecklist)
      ? parsed.reviewPacket?.promptPacket?.verificationChecklist
      : [],
  };
}

async function processCard({
  adminClient,
  card,
  triggerListId,
  snapshot,
  actionId,
  trelloKey,
  trelloToken,
  laloBaseUrl,
  laloApiKey,
  laloApp,
}: {
  adminClient: ReturnType<typeof createClient>;
  card: TrelloCard;
  triggerListId: string;
  snapshot: string;
  actionId: string | null;
  trelloKey: string;
  trelloToken: string;
  laloBaseUrl: string;
  laloApiKey: string;
  laloApp: 'im_in' | 'lalo';
}) {
  if (card.idList !== triggerListId) {
    return { processed: false, reason: 'not_in_trigger_list' };
  }

  const { data: insertedJob, error: insertJobError } = await adminClient
    .from('trello_prompt_jobs')
    .insert({
      trello_card_id: card.id,
      trello_action_id: actionId,
      trigger_list_id: triggerListId,
      trigger_snapshot: snapshot,
      status: 'pending',
      card_name_snapshot: card.name,
    })
    .select('id')
    .single();

  if (insertJobError) {
    if (insertJobError.code === '23505') {
      return { processed: false, reason: 'already_processed' };
    }
    throw new Error(insertJobError.message || 'Could not create trello prompt job.');
  }

  const jobId = insertedJob?.id;
  if (!jobId) {
    throw new Error('Could not allocate trello prompt job.');
  }

  try {
    const { data: feedbackSubmission } = await adminClient
      .from('feedback_submissions')
      .select('id, page_url, screenshot_storage_path')
      .eq('trello_card_id', card.id)
      .maybeSingle();

    const promptResult = await generateCodexPrompt({
      laloBaseUrl,
      laloApiKey,
      laloApp,
      card,
      feedbackContext: {
        feedbackSubmissionId: feedbackSubmission?.id || null,
        pageUrl: feedbackSubmission?.page_url || null,
        screenshotPath: feedbackSubmission?.screenshot_storage_path || null,
      },
    });

    const stampedPrompt = [
      `Generated: ${new Date().toISOString()}`,
      `Contract: ${promptResult.contractVersion}`,
      `Triage: ${promptResult.triageLabel}`,
      `Confidence: ${promptResult.confidenceLevel}`,
      promptResult.workItemId ? `Work item: ${promptResult.workItemId}` : null,
      '',
      promptResult.summary,
      '',
      promptResult.codex_prompt,
      promptResult.verificationChecklist && promptResult.verificationChecklist.length > 0
        ? ['', 'Verification checklist:', ...promptResult.verificationChecklist.map((item) => `- ${item}`)].join('\n')
        : null,
    ].join('\n');

    const nextDescription = upsertPromptSection(card.desc || '', stampedPrompt);
    const updateBody = new URLSearchParams({ desc: nextDescription });
    await trelloRequest({
      method: 'PUT',
      path: `/cards/${encodeURIComponent(card.id)}`,
      key: trelloKey,
      token: trelloToken,
      body: updateBody,
    });

    await adminClient
      .from('trello_prompt_jobs')
      .update({
        status: 'processed',
        generated_prompt: promptResult.codex_prompt,
        processed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await adminClient
      .from('feedback_submissions')
      .update({
        codex_prompt_draft: promptResult.codex_prompt,
        codex_prompt_generated_at: new Date().toISOString(),
      })
      .eq('trello_card_id', card.id);

    return { processed: true, reason: 'prompt_written' };
  } catch (error) {
    await adminClient
      .from('trello_prompt_jobs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Prompt generation failure.',
      })
      .eq('id', jobId);

    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const contentLength = Number(req.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > 250_000) {
    return json({ error: 'Payload too large' }, { status: 413 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const trelloKey = Deno.env.get('TRELLO_API_KEY');
    const trelloToken = Deno.env.get('TRELLO_API_TOKEN');
    const triggerListId = Deno.env.get('TRELLO_PROMPT_TRIGGER_LIST_ID');
    const configuredEngineeringBaseUrl =
      normalizeText(Deno.env.get('ENGINEERING_SERVICE_BASE_URL'))
      || normalizeText(Deno.env.get('LALO_ENGINEERING_API_BASE_URL'));
    const reqHost = new URL(req.url).hostname;
    const isLocalDevRequest = reqHost === 'localhost' || reqHost === '127.0.0.1';
    const laloBaseUrl = configuredEngineeringBaseUrl || (isLocalDevRequest ? 'http://localhost:3000' : '');
    const laloApiKey = normalizeText(Deno.env.get('LALO_ENGINEERING_INTERNAL_API_KEY'));
    const laloApp = (normalizeText(Deno.env.get('LALO_ENGINEERING_APP')) || 'im_in') as 'im_in' | 'lalo';
    const trelloApiSecret = normalizeText(Deno.env.get('TRELLO_API_SECRET'));
    const trelloWebhookCallbackUrl =
      normalizeText(Deno.env.get('TRELLO_WEBHOOK_CALLBACK_URL')) || `${new URL(req.url).origin}${new URL(req.url).pathname}`;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error('Supabase credentials are not configured for trello-prompt-sync.');
    }
    if (!trelloKey || !trelloToken || !triggerListId) {
      throw new Error('Trello credentials are not configured for trello-prompt-sync.');
    }
    if (!laloApiKey) {
      throw new Error('LALO_ENGINEERING_INTERNAL_API_KEY is required for trello-prompt-sync.');
    }
    if (!laloBaseUrl) {
      throw new Error('ENGINEERING_SERVICE_BASE_URL or LALO_ENGINEERING_API_BASE_URL is required outside local development.');
    }
    if (laloApp !== 'im_in' && laloApp !== 'lalo') {
      throw new Error('LALO_ENGINEERING_APP must be either "im_in" or "lalo".');
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const rawBody = await req.text();
    const body = (() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return {};
      }
    })();

    // Manual sync mode: for trusted admins, process all cards currently in trigger list.
    if (body?.syncFromTriggerList === true) {
      const user = await getOptionalUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
      const allowlist = parseEmailAllowlist(
        Deno.env.get('FEEDBACK_ADMIN_EMAILS') || Deno.env.get('MODERATION_ADMIN_EMAILS'),
      );
      const email = normalizeText(user?.email).toLowerCase();
      if (!email || !allowlist.includes(email)) {
        return json({ error: 'Not authorized to run manual Trello sync.' }, { status: 403 });
      }

      const cards = await trelloRequest<TrelloCard[]>({
        method: 'GET',
        path: `/lists/${encodeURIComponent(triggerListId)}/cards?fields=name,desc,idList,url,dateLastActivity`,
        key: trelloKey,
        token: trelloToken,
      });

      let processedCount = 0;
      let skippedCount = 0;
      for (const card of cards) {
        const snapshot = `manual-${card.dateLastActivity || 'unknown'}`;
        const result = await processCard({
          adminClient,
          card,
          triggerListId,
          snapshot,
          actionId: null,
          trelloKey,
          trelloToken,
          laloBaseUrl,
          laloApiKey,
          laloApp,
        });
        if (result.processed) processedCount += 1;
        else skippedCount += 1;
      }

      return json({
        ok: true,
        mode: 'manual_sync',
        processedCount,
        skippedCount,
      });
    }

    // Trello webhook mode: process only list move events into the configured trigger list.
    const action = body?.action;
    const actionType = action?.type;
    const listAfterId = action?.data?.listAfter?.id;
    const cardId = action?.data?.card?.id;
    const actionId = normalizeText(action?.id) || null;

    if (actionType !== 'updateCard' || !cardId || listAfterId !== triggerListId) {
      return json({ ok: true, ignored: true, reason: 'not_prompt_trigger_event' });
    }

    if (!trelloApiSecret) {
      return json({ error: 'TRELLO_API_SECRET is required for webhook mode.' }, { status: 503 });
    }
    const incomingWebhookSignature = normalizeText(req.headers.get('x-trello-webhook'));
    if (!incomingWebhookSignature) {
      return json({ error: 'Missing x-trello-webhook signature.' }, { status: 401 });
    }
    const expectedWebhookSignature = await computeTrelloWebhookSignature(
      rawBody,
      trelloWebhookCallbackUrl,
      trelloApiSecret,
    );
    if (!timingSafeStringEqual(incomingWebhookSignature, expectedWebhookSignature)) {
      return json({ error: 'Unauthorized webhook request.' }, { status: 401 });
    }

    const card = await trelloRequest<TrelloCard>({
      method: 'GET',
      path: `/cards/${encodeURIComponent(cardId)}?fields=name,desc,idList,url,dateLastActivity`,
      key: trelloKey,
      token: trelloToken,
    });

    const snapshot = actionId || `webhook-${card.dateLastActivity || Date.now().toString()}`;
    const result = await processCard({
      adminClient,
      card,
      triggerListId,
      snapshot,
      actionId,
      trelloKey,
      trelloToken,
      laloBaseUrl,
      laloApiKey,
      laloApp,
    });

    return json({
      ok: true,
      mode: 'webhook',
      processed: result.processed,
      reason: result.reason,
      cardId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected trello-prompt-sync failure.';
    return json({ error: message }, { status: 500 });
  }
});
