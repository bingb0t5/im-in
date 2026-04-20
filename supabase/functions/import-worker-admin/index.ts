import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SourceTrustLevel = 'community_source' | 'known_organiser' | 'verified_partner' | 'internal_curated';

type ParsedDraft = {
  raw_title: string;
  raw_text_block: string;
  parsed_title: string;
  parsed_summary: string;
  parsed_description: string;
  parsed_activity_type: string;
  parsed_location_area: string;
  parsed_is_recurring: boolean;
  parsed_recurrence_text: string | null;
  parsed_start_datetime: string | null;
  parsed_end_datetime: string | null;
  parsed_confidence_score: number;
  review_status: 'new' | 'needs_review';
  normalization_warnings: string[];
};

type DraftWithSource = {
  id: string;
  event_source_id: string;
  linked_published_event_id: string | null;
  parsed_title: string | null;
  parsed_description: string | null;
  parsed_summary: string | null;
  parsed_location_name: string | null;
  parsed_location_area: string | null;
  parsed_start_datetime: string | null;
  parsed_end_datetime: string | null;
  parsed_timezone: string | null;
  parsed_visibility: 'public' | 'semi_public' | 'private' | null;
  event_sources?: {
    id: string;
    name: string;
    trust_level: SourceTrustLevel;
    source_url: string | null;
  } | null;
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

function normalizeSourceType(value: string | null | undefined) {
  const normalized = normalizeText(value).toLowerCase();
  if (['manual_text', 'google_doc', 'google_sheet', 'pdf', 'web_page'].includes(normalized)) {
    return normalized;
  }
  return 'manual_text';
}

const DAY_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays|daily)\b/i;
const TIME_PATTERN = /\b([01]?\d|2[0-3])[:.][0-5]\d\b/;

function classifyActivityType(text: string) {
  const t = text.toLowerCase();
  if (/(football|basketball|tennis|swim|sport|gym|yoga)/.test(t)) return 'sports';
  if (/(paint|art|music|craft|dance|creative)/.test(t)) return 'creative';
  if (/(learn|class|lesson|study|school|educat)/.test(t)) return 'educational';
  if (/(hike|beach|park|camp|outdoor)/.test(t)) return 'outdoor';
  if (/(meditation|wellbeing|wellness)/.test(t)) return 'wellbeing';
  if (/(meetup|social|community|playgroup)/.test(t)) return 'social';
  return 'other';
}

function inferLocationArea(text: string) {
  const t = text.toLowerCase();
  if (t.includes('an bang')) return 'an_bang';
  if (t.includes('cam an')) return 'cam_an';
  if (t.includes('cam ha')) return 'cam_ha';
  if (t.includes('cam chau')) return 'cam_chau';
  if (t.includes('da nang')) return 'da_nang';
  if (t.includes('hoi an')) return 'hoi_an';
  return 'other';
}

function parseDateTimeFromBlock(text: string): { start: string | null; end: string | null } {
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const timeMatch = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!dateMatch || !timeMatch) return { start: null, end: null };
  const hh = timeMatch[1].padStart(2, '0');
  const mm = timeMatch[2];
  const start = new Date(`${dateMatch[1]}T${hh}:${mm}:00`).toISOString();
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  return { start, end };
}

function summarizeBlock(block: string) {
  const clean = block.replace(/\s+/g, ' ').trim();
  return clean.length <= 160 ? clean : `${clean.slice(0, 157)}...`;
}

function splitSourceIntoBlocks(rawText: string) {
  return rawText
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function parseSourceTextToDrafts(rawText: string): ParsedDraft[] {
  const blocks = splitSourceIntoBlocks(rawText);
  return blocks.map((block) => {
    const firstLine = block.split('\n').map((line) => line.trim()).find(Boolean) || 'Community activity';
    const recurrenceMatch = block.match(DAY_PATTERN);
    const hasTime = TIME_PATTERN.test(block);
    const { start, end } = parseDateTimeFromBlock(block);
    const warnings: string[] = [];
    let confidence = 0.45;
    if (firstLine.length >= 4) confidence += 0.2;
    if (recurrenceMatch) confidence += 0.15;
    if (hasTime || start) confidence += 0.15;
    if (!recurrenceMatch && !start) warnings.push('Timing is unclear');
    if (firstLine.toLowerCase().includes('contact')) warnings.push('Title may be noisy');
    return {
      raw_title: firstLine,
      raw_text_block: block,
      parsed_title: firstLine,
      parsed_summary: summarizeBlock(block),
      parsed_description: block,
      parsed_activity_type: classifyActivityType(block),
      parsed_location_area: inferLocationArea(block),
      parsed_is_recurring: !!recurrenceMatch && !start,
      parsed_recurrence_text: recurrenceMatch ? recurrenceMatch[0] : null,
      parsed_start_datetime: start,
      parsed_end_datetime: end,
      parsed_confidence_score: Math.max(0.05, Math.min(0.98, Number(confidence.toFixed(2)))),
      review_status: confidence >= 0.7 ? 'new' : 'needs_review',
      normalization_warnings: warnings,
    };
  });
}

async function sha256Text(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSyncMode(value: string | null | undefined) {
  const normalized = normalizeText(value).toLowerCase();
  if (['manual', 'semi_manual', 'automatic'].includes(normalized)) {
    return normalized;
  }
  return 'manual';
}

function normalizeTrustLevel(value: string | null | undefined): SourceTrustLevel {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === 'community_source'
    || normalized === 'known_organiser'
    || normalized === 'verified_partner'
    || normalized === 'internal_curated'
  ) {
    return normalized;
  }
  return 'community_source';
}

function makeSlug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${normalized || 'activity'}-${suffix}`;
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

function assertAdminUser(email: string | null | undefined) {
  const allowlist = parseEmailAllowlist(Deno.env.get('MODERATION_ADMIN_EMAILS'));
  if (allowlist.length === 0) return;
  const normalized = normalizeText(email).toLowerCase();
  if (!normalized || !allowlist.includes(normalized)) {
    throw Object.assign(new Error('Not authorized to use imported listings admin.'), { status: 403 });
  }
}

async function callWorkerApi(params: {
  workerBaseUrl: string;
  workerApiKey: string;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}) {
  const target = `${params.workerBaseUrl.replace(/\/$/, '')}${params.path}`;
  const response = await fetch(target, {
    method: params.method,
    headers: {
      Authorization: `Bearer ${params.workerApiKey}`,
      'Content-Type': 'application/json',
    },
    body: params.method === 'POST' ? JSON.stringify(params.body || {}) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof parsed?.error === 'string' ? parsed.error : `Worker API request failed (${response.status})`;
    return { ok: false as const, status: response.status, error: message, payload: parsed };
  }
  return { ok: true as const, payload: parsed };
}

function mapOriginType(trustLevel: SourceTrustLevel | undefined) {
  if (trustLevel === 'verified_partner') return 'imported_verified_partner';
  if (trustLevel === 'internal_curated') return 'curated_manual';
  return 'imported_community_source';
}

function mapTrustBadge(trustLevel: SourceTrustLevel | undefined) {
  if (trustLevel === 'verified_partner') return 'verified_partner';
  if (trustLevel === 'internal_curated') return 'curated';
  return 'community_listing';
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
      throw new Error('Supabase credentials are not configured for import-worker-admin.');
    }

    const workerBaseUrl = normalizeText(
      Deno.env.get('WORKER_IMPORTS_API_BASE_URL')
      || Deno.env.get('LALO_WORKER_IMPORTS_API_BASE_URL')
      || Deno.env.get('WORKER_SOCIAL_API_BASE_URL')
      || Deno.env.get('LALO_WORKER_SOCIAL_API_BASE_URL'),
    );
    const workerApiKey = normalizeText(
      Deno.env.get('WORKER_IMPORTS_API_KEY')
      || Deno.env.get('LALO_WORKER_IMPORTS_API_KEY')
      || Deno.env.get('WORKER_SOCIAL_API_KEY')
      || Deno.env.get('LALO_WORKER_SOCIAL_API_KEY'),
    );
    if (!workerBaseUrl || !workerApiKey) {
      throw new Error('Worker imports API credentials are not configured for import-worker-admin.');
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    assertAdminUser(user.email);

    const body = await req.json().catch(() => ({}));
    const action = normalizeText(typeof body?.action === 'string' ? body.action : '');
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    if (action === 'createSource') {
      const payload = {
        name: normalizeText(body?.name),
        source_type: normalizeSourceType(body?.source_type),
        source_url: normalizeText(body?.source_url) || null,
        community_name: normalizeText(body?.community_name) || null,
        default_location_area: normalizeText(body?.default_location_area) || null,
        sync_mode: normalizeSyncMode(body?.sync_mode),
        trust_level: normalizeTrustLevel(body?.trust_level),
        notes: normalizeText(body?.notes) || null,
        created_by: user.id,
        updated_by: user.id,
      };
      if (!payload.name) {
        return json({ error: 'Source name is required.' }, { status: 400 });
      }
      const { data, error } = await adminClient.from('event_sources').insert(payload).select('*').single();
      if (error || !data) throw new Error(error?.message || 'Could not create event source.');
      return json({ ok: true, source: data });
    }

    if (action === 'updateSource') {
      const sourceId = normalizeText(body?.sourceId);
      if (!sourceId) return json({ error: 'sourceId is required.' }, { status: 400 });
      const patch = {
        name: normalizeText(body?.name),
        source_type: normalizeSourceType(body?.source_type),
        source_url: normalizeText(body?.source_url) || null,
        community_name: normalizeText(body?.community_name) || null,
        default_location_area: normalizeText(body?.default_location_area) || null,
        sync_mode: normalizeSyncMode(body?.sync_mode),
        trust_level: normalizeTrustLevel(body?.trust_level),
        notes: normalizeText(body?.notes) || null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };
      if (!patch.name) return json({ error: 'Source name is required.' }, { status: 400 });
      const { data, error } = await adminClient.from('event_sources').update(patch).eq('id', sourceId).select('*').single();
      if (error || !data) throw new Error(error?.message || 'Could not update source.');
      return json({ ok: true, source: data });
    }

    if (action === 'enqueueImport') {
      const sourceId = normalizeText(body?.sourceId);
      const sourceUrl = normalizeText(body?.sourceUrl);
      const sourceTypeHint = normalizeSourceType(body?.sourceTypeHint);
      if (!sourceId || !sourceUrl) {
        return json({ error: 'sourceId and sourceUrl are required.' }, { status: 400 });
      }
      const worker = await callWorkerApi({
        workerBaseUrl,
        workerApiKey,
        method: 'POST',
        path: '/api/workers/imports/jobs',
        body: {
          sourceId,
          sourceUrl,
          sourceTypeHint,
          requestedBy: user.email || user.id,
        },
      });
      if (!worker.ok) {
        return json({ error: worker.error, workerStatus: worker.status }, { status: 502 });
      }
      const jobId = normalizeText(worker.payload?.jobId);
      const { error: sourceError } = await adminClient
        .from('event_sources')
        .update({
          last_fetch_status: 'queued',
          last_fetch_error: null,
          last_fetch_job_id: jobId || null,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceId);
      if (sourceError) throw new Error(sourceError.message || 'Could not update source queue status.');
      return json({
        ok: true,
        jobId,
        statusPath: worker.payload?.statusPath || null,
        job: worker.payload?.job || null,
      });
    }

    if (action === 'retryImport') {
      const jobId = normalizeText(body?.jobId);
      const sourceId = normalizeText(body?.sourceId);
      if (!jobId) return json({ error: 'jobId is required.' }, { status: 400 });
      const worker = await callWorkerApi({
        workerBaseUrl,
        workerApiKey,
        method: 'POST',
        path: `/api/workers/imports/jobs/${encodeURIComponent(jobId)}/retry`,
        body: {
          requestedBy: user.email || user.id,
        },
      });
      if (!worker.ok) return json({ error: worker.error, workerStatus: worker.status }, { status: 502 });

      if (sourceId) {
        await adminClient
          .from('event_sources')
          .update({
            last_fetch_status: 'queued',
            last_fetch_error: null,
            last_fetch_job_id: normalizeText(worker.payload?.jobId) || null,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sourceId);
      }
      return json({ ok: true, ...worker.payload });
    }

    if (action === 'manualParseSnapshot') {
      const sourceId = normalizeText(body?.sourceId);
      const rawText = normalizeText(body?.rawText);
      if (!sourceId || !rawText) {
        return json({ error: 'sourceId and rawText are required.' }, { status: 400 });
      }
      const hash = await sha256Text(rawText);
      const parsedDrafts = parseSourceTextToDrafts(rawText);
      const { data: snapshot, error: snapshotError } = await adminClient
        .from('source_snapshots')
        .insert({
          event_source_id: sourceId,
          raw_content_text: rawText,
          raw_content_hash: hash,
          raw_metadata_json: {
            sourceLength: rawText.length,
            mode: 'manual_admin_fallback',
          },
          capture_method: 'manual_paste',
          ingestion_status_message:
            parsedDrafts.length > 0 ? `Manually parsed ${parsedDrafts.length} draft block(s).` : 'No event blocks found.',
          created_by: user.id,
        })
        .select('id')
        .single();
      if (snapshotError || !snapshot) {
        throw new Error(snapshotError?.message || 'Could not store manual snapshot.');
      }
      if (parsedDrafts.length > 0) {
        const draftRows = parsedDrafts.map((draft) => ({
          ...draft,
          event_source_id: sourceId,
          source_snapshot_id: snapshot.id,
        }));
        const { error: draftsError } = await adminClient.from('external_event_drafts').insert(draftRows);
        if (draftsError) throw new Error(draftsError.message || 'Could not create manual draft rows.');
      }
      await adminClient
        .from('event_sources')
        .update({
          last_imported_at: new Date().toISOString(),
          last_fetch_status: 'succeeded',
          last_fetch_error: null,
          last_snapshot_id: snapshot.id,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceId);
      return json({
        ok: true,
        snapshotId: snapshot.id,
        draftCount: parsedDrafts.length,
      });
    }

    if (action === 'getImportJobStatus') {
      const jobId = normalizeText(body?.jobId);
      if (!jobId) return json({ error: 'jobId is required.' }, { status: 400 });
      const worker = await callWorkerApi({
        workerBaseUrl,
        workerApiKey,
        method: 'GET',
        path: `/api/workers/imports/jobs/${encodeURIComponent(jobId)}`,
      });
      if (!worker.ok) return json({ error: worker.error, workerStatus: worker.status }, { status: 502 });
      return json({ ok: true, job: worker.payload?.job || null });
    }

    if (action === 'listImportJobsForSource') {
      const sourceId = normalizeText(body?.sourceId);
      const limit = typeof body?.limit === 'number' ? body.limit : 8;
      if (!sourceId) return json({ error: 'sourceId is required.' }, { status: 400 });
      const worker = await callWorkerApi({
        workerBaseUrl,
        workerApiKey,
        method: 'GET',
        path: `/api/workers/imports/jobs?sourceId=${encodeURIComponent(sourceId)}&limit=${encodeURIComponent(String(limit))}`,
      });
      if (!worker.ok) return json({ error: worker.error, workerStatus: worker.status }, { status: 502 });
      return json({ ok: true, jobs: worker.payload?.jobs || [] });
    }

    if (action === 'updateDraftReview') {
      const draftId = normalizeText(body?.draftId);
      const reviewStatus = normalizeText(body?.reviewStatus);
      if (!draftId || !reviewStatus) return json({ error: 'draftId and reviewStatus are required.' }, { status: 400 });
      const reviewNotes = normalizeText(body?.reviewNotes);
      const statusReason = normalizeText(body?.statusReason);
      const { data, error } = await adminClient
        .from('external_event_drafts')
        .update({
          review_status: reviewStatus,
          review_notes: reviewNotes || null,
          status_reason: statusReason || null,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', draftId)
        .select('*, event_sources(id,name,trust_level,source_url)')
        .single();
      if (error || !data) throw new Error(error?.message || 'Could not update draft status.');
      return json({ ok: true, draft: data });
    }

    if (action === 'publishDraft') {
      const draftId = normalizeText(body?.draftId);
      if (!draftId) return json({ error: 'draftId is required.' }, { status: 400 });
      const { data: draft, error: draftError } = await adminClient
        .from('external_event_drafts')
        .select('*, event_sources(id,name,trust_level,source_url)')
        .eq('id', draftId)
        .single();
      if (draftError || !draft) throw new Error(draftError?.message || 'Could not load draft for publish.');
      const draftRow = draft as DraftWithSource;
      if (!draftRow.parsed_title) return json({ error: 'Draft needs a title before publish.' }, { status: 400 });

      const startsAt = draftRow.parsed_start_datetime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const endsAt = draftRow.parsed_end_datetime || new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString();
      const visibility = draftRow.parsed_visibility || 'public';
      const trustLevel = draftRow.event_sources?.trust_level;

      const publishPayload = {
        title: draftRow.parsed_title,
        slug: makeSlug(draftRow.parsed_title),
        description: draftRow.parsed_description || null,
        public_summary: draftRow.parsed_summary || null,
        location_text: draftRow.parsed_location_name || null,
        public_location_text: draftRow.parsed_location_area || null,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: draftRow.parsed_timezone || 'Asia/Ho_Chi_Minh',
        duration_minutes: 60,
        capacity: 999,
        host_user_id: user.id,
        host_name: draftRow.event_sources?.name || 'Community listing',
        status: 'scheduled',
        visibility,
        is_public: visibility !== 'private',
        participation_mode: 'interest_only',
        interest_visibility: 'count_only',
        origin_type: mapOriginType(trustLevel),
        trust_badge: mapTrustBadge(trustLevel),
        source_attribution_label: draftRow.event_sources?.name || 'Community listing',
        source_url: draftRow.event_sources?.source_url || null,
        source_last_checked_at: new Date().toISOString(),
        event_source_id: draftRow.event_source_id,
        external_event_draft_id: draftRow.id,
      };

      let publishedEventId = draftRow.linked_published_event_id || null;
      if (publishedEventId) {
        const { error } = await adminClient
          .from('events')
          .update({
            ...publishPayload,
            slug: undefined,
          })
          .eq('id', publishedEventId);
        if (error) throw new Error(error.message || 'Could not update published event.');
      } else {
        const { data: created, error } = await adminClient.from('events').insert(publishPayload).select('id').single();
        if (error || !created) throw new Error(error?.message || 'Could not create event from draft.');
        publishedEventId = created.id as string;
      }

      const { data: nextDraft, error: nextDraftError } = await adminClient
        .from('external_event_drafts')
        .update({
          review_status: 'published',
          linked_published_event_id: publishedEventId,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          status_reason: null,
        })
        .eq('id', draftId)
        .select('*, event_sources(id,name,trust_level,source_url)')
        .single();
      if (nextDraftError || !nextDraft) {
        throw new Error(nextDraftError?.message || 'Published event but failed to update draft row.');
      }

      await adminClient
        .from('event_sources')
        .update({
          last_published_at: new Date().toISOString(),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', draftRow.event_source_id);

      return json({ ok: true, draft: nextDraft, publishedEventId });
    }

    return json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected import-worker-admin error.';
    console.error('[import-worker-admin] error', message);
    return json({ error: message }, { status });
  }
});
