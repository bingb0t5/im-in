import { createClient } from 'npm:@supabase/supabase-js@2';

type SubmissionType = 'bug' | 'feature' | 'feedback';

type FeedbackRow = {
  id: string;
  submission_type: SubmissionType;
  title: string;
  details: string;
  reporter_name: string | null;
  reporter_email: string | null;
  auth_user_id: string | null;
  page_url: string | null;
  status: string;
  abuse_risk_level: 'low' | 'medium' | 'high' | null;
  abuse_confidence: number | null;
  abuse_reasons: string[] | null;
  abuse_blocked: boolean | null;
  codex_prompt_draft: string | null;
  codex_prompt_generated_at: string | null;
  trello_card_id: string | null;
  trello_card_url: string | null;
  trello_list_id: string | null;
  trello_sync_status: string | null;
  screenshot_storage_path: string | null;
  public_sanitized_summary: string | null;
  raw_source: string | null;
  created_at: string;
  updated_at: string;
};

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
  return (value || '').replace(/\s+/g, ' ').trim();
}

function parseEmailAllowlist(raw?: string | null) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
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

async function createTrelloCard({
  trelloKey,
  trelloToken,
  listId,
  row,
}: {
  trelloKey: string | null;
  trelloToken: string | null;
  listId: string | null;
  row: FeedbackRow;
}) {
  if (!trelloKey || !trelloToken || !listId) {
    return { queued: false, skipped: true, cardId: null, cardUrl: null };
  }

  const label =
    row.submission_type === 'bug' ? 'Bug report' : row.submission_type === 'feature' ? 'Feature request' : 'General feedback';
  const cardName = `${label}: ${sanitizeForPublicBoard(row.title).slice(0, 72)}`;
  const desc = [
    'Submitted from the public feedback form.',
    '',
    `Type: ${label}`,
    `Summary: ${row.public_sanitized_summary || buildSanitizedSummary(row.title, row.details) || '(No safe summary available)'}`,
    `Source page: ${sanitizeForPublicBoard(row.page_url || 'unknown')}`,
    `Submission ID: ${row.id}`,
    '',
    'This card intentionally contains sanitized content only.',
  ].join('\n');

  const params = new URLSearchParams({
    key: trelloKey,
    token: trelloToken,
    idList: listId,
    name: cardName,
    desc,
    pos: 'top',
  });

  const response = await fetch(`https://api.trello.com/1/cards?${params.toString()}`, { method: 'POST' });
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
      throw new Error('Supabase credentials are not configured for feedback-admin.');
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    const allowlist = parseEmailAllowlist(Deno.env.get('FEEDBACK_ADMIN_EMAILS') || Deno.env.get('MODERATION_ADMIN_EMAILS'));
    const email = normalizeText(user.email).toLowerCase();
    if (!email || !allowlist.includes(email)) {
      return json({ error: 'Not authorized to use feedback admin.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const bucket = Deno.env.get('FEEDBACK_SCREENSHOT_BUCKET') || 'feedback-screenshots';

    if (body?.list === true) {
      const { data, error } = await adminClient
        .from('feedback_submissions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        throw new Error(error.message || 'Could not load feedback submissions.');
      }

      const items = await Promise.all(
        ((data || []) as FeedbackRow[]).map(async (row) => {
          let screenshotSignedUrl: string | null = null;
          if (row.screenshot_storage_path) {
            const { data: signedData } = await adminClient.storage
              .from(bucket)
              .createSignedUrl(row.screenshot_storage_path, 60 * 60);
            screenshotSignedUrl = signedData?.signedUrl || null;
          }

          return {
            ...row,
            abuse_reasons: row.abuse_reasons || [],
            abuse_blocked: Boolean(row.abuse_blocked),
            trello_sync_status: row.trello_sync_status || 'not_sent',
            screenshot_signed_url: screenshotSignedUrl,
          };
        }),
      );

      return json({ items });
    }

    const submissionId = normalizeText(body?.submissionId);
    if (!submissionId) {
      return json({ error: 'submissionId is required.' }, { status: 400 });
    }

    if (body?.archive === true || body?.unarchive === true) {
      const nextStatus = body?.archive === true ? 'archived' : 'pending_review';
      const { error } = await adminClient
        .from('feedback_submissions')
        .update({ status: nextStatus })
        .eq('id', submissionId);
      if (error) {
        throw new Error(error.message || 'Could not update feedback status.');
      }
      return json({ ok: true, status: nextStatus });
    }

    if (body?.deleteSubmission === true) {
      const { data, error } = await adminClient
        .from('feedback_submissions')
        .select('id, screenshot_storage_path')
        .eq('id', submissionId)
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Could not load feedback submission for deletion.');
      }

      if (data.screenshot_storage_path) {
        const { error: storageError } = await adminClient.storage
          .from(bucket)
          .remove([data.screenshot_storage_path]);
        if (storageError) {
          throw new Error(storageError.message || 'Could not remove feedback screenshot.');
        }
      }

      const { error: promptJobDeleteError } = await adminClient
        .from('trello_prompt_jobs')
        .delete()
        .eq('feedback_submission_id', submissionId);

      if (promptJobDeleteError) {
        throw new Error(promptJobDeleteError.message || 'Could not remove prompt job records.');
      }

      const { error: submissionDeleteError } = await adminClient
        .from('feedback_submissions')
        .delete()
        .eq('id', submissionId);

      if (submissionDeleteError) {
        throw new Error(submissionDeleteError.message || 'Could not delete feedback submission.');
      }

      return json({ ok: true, deleted: true });
    }

    if (body?.retryTrello === true) {
      const { data, error } = await adminClient
        .from('feedback_submissions')
        .select('*')
        .eq('id', submissionId)
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Could not load feedback submission.');
      }

      const row = data as FeedbackRow;
      const trelloResult = await createTrelloCard({
        trelloKey: Deno.env.get('TRELLO_API_KEY'),
        trelloToken: Deno.env.get('TRELLO_API_TOKEN'),
        listId: Deno.env.get('TRELLO_INTAKE_LIST_ID'),
        row,
      });

      const { error: updateError } = await adminClient
        .from('feedback_submissions')
        .update({
          status: trelloResult.queued ? 'queued_to_trello' : row.status === 'archived' ? 'archived' : 'pending_review',
          trello_sync_status: trelloResult.skipped ? 'skipped' : 'synced',
          trello_card_id: trelloResult.cardId,
          trello_card_url: trelloResult.cardUrl,
          trello_list_id: Deno.env.get('TRELLO_INTAKE_LIST_ID') || null,
        })
        .eq('id', submissionId);

      if (updateError) {
        throw new Error(updateError.message || 'Could not update Trello sync state.');
      }

      return json({
        ok: true,
        queuedToTrello: trelloResult.queued,
        trelloCardId: trelloResult.cardId,
        trelloCardUrl: trelloResult.cardUrl,
      });
    }

    return json({ error: 'No supported action provided.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected feedback-admin failure.';
    return json({ error: message }, { status: 500 });
  }
});
