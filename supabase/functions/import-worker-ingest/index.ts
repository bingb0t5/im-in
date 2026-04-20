import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

const DAY_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays|daily)\b/i;
const TIME_PATTERN = /\b([01]?\d|2[0-3])[:.][0-5]\d\b/;

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

function splitSourceIntoBlocks(rawText: string) {
  return rawText
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

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

function unauthorized() {
  return json({ error: 'Unauthorized worker callback.' }, { status: 401 });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const workerToken = normalizeText(Deno.env.get('IM_IN_IMPORT_INGEST_KEY') || Deno.env.get('LALO_IM_IN_IMPORT_INGEST_KEY'));
    const providedAuth = normalizeText(req.headers.get('Authorization'));
    if (!workerToken || !providedAuth || providedAuth !== `Bearer ${workerToken}`) {
      return unauthorized();
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase service role configuration is missing for import-worker-ingest.');
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const action = normalizeText(typeof body?.action === 'string' ? body.action : 'ingestSuccess');
    const sourceId = normalizeText(typeof body?.sourceId === 'string' ? body.sourceId : '');
    const sourceUrl = normalizeText(typeof body?.sourceUrl === 'string' ? body.sourceUrl : '');
    const sourceTypeHint = normalizeText(typeof body?.sourceTypeHint === 'string' ? body.sourceTypeHint : '');
    const jobId = normalizeText(typeof body?.jobId === 'string' ? body.jobId : '');
    if (!sourceId) return json({ error: 'sourceId is required.' }, { status: 400 });
    if (!jobId) return json({ error: 'jobId is required.' }, { status: 400 });

    if (action === 'ingestFailure') {
      const status = normalizeText(typeof body?.status === 'string' ? body.status : 'failed');
      const errorCode = normalizeText(typeof body?.errorCode === 'string' ? body.errorCode : '');
      const errorMessage = normalizeText(typeof body?.errorMessage === 'string' ? body.errorMessage : 'Import fetch failed.');
      const { error } = await adminClient
        .from('event_sources')
        .update({
          last_fetch_status: status === 'retryable' ? 'retryable' : 'failed',
          last_fetch_error: `${errorCode ? `${errorCode}: ` : ''}${errorMessage}`,
          last_fetch_job_id: jobId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceId);
      if (error) throw new Error(error.message || 'Could not update source failure state.');
      return json({ ok: true });
    }

    const rawContentText = normalizeText(typeof body?.rawContentText === 'string' ? body.rawContentText : '');
    if (!rawContentText) {
      return json({ error: 'rawContentText is required for ingestSuccess.' }, { status: 400 });
    }

    const parsedDrafts = parseSourceTextToDrafts(rawContentText);
    const snapshotPayload = {
      event_source_id: sourceId,
      raw_content_text: rawContentText,
      raw_content_hash: normalizeText(typeof body?.contentHash === 'string' ? body.contentHash : `snapshot_${Date.now()}`),
      raw_metadata_json: {
        sourceUrl,
        sourceTypeHint: sourceTypeHint || null,
        responseUrl: normalizeText(typeof body?.responseUrl === 'string' ? body.responseUrl : ''),
        contentType: normalizeText(typeof body?.contentType === 'string' ? body.contentType : ''),
        httpStatus: typeof body?.httpStatus === 'number' ? body.httpStatus : null,
        fetchedAt: normalizeText(typeof body?.fetchedAt === 'string' ? body.fetchedAt : ''),
        workerLabel: normalizeText(typeof body?.workerLabel === 'string' ? body.workerLabel : ''),
        jobId,
        fetchDetails: typeof body?.rawMetadataJson === 'object' && body.rawMetadataJson ? body.rawMetadataJson : {},
      },
      capture_method: 'fetched',
      ingestion_job_id: jobId,
      ingestion_status_message:
        parsedDrafts.length > 0 ? `Fetched and parsed ${parsedDrafts.length} draft block(s).` : 'Fetched but no event blocks found.',
      created_by: null,
    };

    const { data: snapshot, error: snapshotError } = await adminClient
      .from('source_snapshots')
      .insert(snapshotPayload)
      .select('id')
      .single();
    if (snapshotError || !snapshot) {
      throw new Error(snapshotError?.message || 'Could not store fetched snapshot.');
    }

    if (parsedDrafts.length > 0) {
      const draftRows = parsedDrafts.map((draft) => ({
        ...draft,
        event_source_id: sourceId,
        source_snapshot_id: snapshot.id,
      }));
      const { error: draftsError } = await adminClient.from('external_event_drafts').insert(draftRows);
      if (draftsError) {
        throw new Error(draftsError.message || 'Could not create drafts from fetched snapshot.');
      }
    }

    const sourceUpdate = {
      last_imported_at: new Date().toISOString(),
      last_fetched_at: new Date().toISOString(),
      last_fetch_status: 'succeeded',
      last_fetch_error: null,
      last_fetch_job_id: jobId,
      last_snapshot_id: snapshot.id,
      updated_at: new Date().toISOString(),
    };
    const { error: sourceError } = await adminClient.from('event_sources').update(sourceUpdate).eq('id', sourceId);
    if (sourceError) {
      throw new Error(sourceError.message || 'Could not update source import timestamps.');
    }

    return json({
      ok: true,
      snapshotId: snapshot.id,
      draftCount: parsedDrafts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected import-worker-ingest failure.';
    console.error('[import-worker-ingest] error', message);
    return json({ error: message }, { status: 500 });
  }
});
