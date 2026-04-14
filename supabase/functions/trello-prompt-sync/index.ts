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
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-trello-webhook',
};

type LaloFeedbackPromptResponse = {
  summary?: string;
  rootCauseHypothesisOrOpportunity?: string;
  implementationPrompt?: string;
  verificationChecklist?: string[];
  docsToUpdate?: string[];
  confidenceLevel?: 'High' | 'Medium' | 'Low';
  triageLabel?: 'bug_fix' | 'design_opportunity' | 'ops_followup' | 'needs_clarification' | 'not_actionable';
  requestId?: string;
  model?: string;
  error?: string;
  details?: string;
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
}: {
  laloBaseUrl: string;
  laloApiKey: string;
  laloApp: 'im_in' | 'lalo';
  card: TrelloCard;
}): Promise<PromptResult> {
  const feedbackType = inferFeedbackType(card.name, card.desc || '');
  const payload = {
    app: laloApp,
    feedbackType,
    title: card.name,
    description: card.desc || '(No card description provided)',
    extraContext: {
      source: 'trello_prompt_sync',
      trelloCard: {
        id: card.id,
        url: card.url,
        idList: card.idList,
        dateLastActivity: card.dateLastActivity || null,
      },
    },
  };

  const response = await fetch(`${laloBaseUrl.replace(/\/+$/, '')}/v1/feedback/prompts/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${laloApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let parsed: LaloFeedbackPromptResponse = {};
  try {
    parsed = JSON.parse(bodyText) as LaloFeedbackPromptResponse;
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const errorDetail = normalizeText(parsed.error || parsed.details || bodyText || 'Unknown Lalo error');
    throw new Error(`Lalo feedback prompt generation failed (${response.status}): ${errorDetail}`);
  }

  const summary = normalizeText(parsed.summary);
  const implementationPrompt = normalizeText(parsed.implementationPrompt);
  const confidenceLevel = parsed.confidenceLevel;
  const triageLabel = parsed.triageLabel;

  if (!summary || !implementationPrompt || !confidenceLevel || !triageLabel) {
    throw new Error('Lalo feedback prompt response was missing required fields.');
  }

  return {
    summary,
    codex_prompt: implementationPrompt,
    confidenceLevel,
    triageLabel,
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
    const promptResult = await generateCodexPrompt({
      laloBaseUrl,
      laloApiKey,
      laloApp,
      card,
    });

    const stampedPrompt = [
      `Generated: ${new Date().toISOString()}`,
      `Triage: ${promptResult.triageLabel}`,
      `Confidence: ${promptResult.confidenceLevel}`,
      '',
      promptResult.summary,
      '',
      promptResult.codex_prompt,
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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const trelloKey = Deno.env.get('TRELLO_API_KEY');
    const trelloToken = Deno.env.get('TRELLO_API_TOKEN');
    const triggerListId = Deno.env.get('TRELLO_PROMPT_TRIGGER_LIST_ID');
    const laloBaseUrl = normalizeText(Deno.env.get('LALO_ENGINEERING_API_BASE_URL')) || 'http://localhost:3000';
    const laloApiKey = normalizeText(Deno.env.get('LALO_ENGINEERING_INTERNAL_API_KEY'));
    const laloApp = (normalizeText(Deno.env.get('LALO_ENGINEERING_APP')) || 'im_in') as 'im_in' | 'lalo';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error('Supabase credentials are not configured for trello-prompt-sync.');
    }
    if (!trelloKey || !trelloToken || !triggerListId) {
      throw new Error('Trello credentials are not configured for trello-prompt-sync.');
    }
    if (!laloApiKey) {
      throw new Error('LALO_ENGINEERING_INTERNAL_API_KEY is required for trello-prompt-sync.');
    }
    if (laloApp !== 'im_in' && laloApp !== 'lalo') {
      throw new Error('LALO_ENGINEERING_APP must be either "im_in" or "lalo".');
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const body = await req.json().catch(() => ({}));

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
