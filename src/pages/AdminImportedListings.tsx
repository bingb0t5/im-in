import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, Check, Loader2, RefreshCcw, Upload, X } from 'lucide-react';

import { canAccessModerationAdminFrontend } from '../lib/admin';
import { supabase } from '../supabase';
import { EventSource, ExternalEventDraft, ImportWorkerJob, SourceSnapshot } from '../types';

type DraftWithSource = ExternalEventDraft & {
  event_sources?: Pick<EventSource, 'id' | 'name' | 'trust_level' | 'source_url'> | null;
};

type SnapshotSummary = Pick<SourceSnapshot, 'id' | 'event_source_id' | 'captured_at' | 'capture_method' | 'ingestion_status_message'>;

const DEFAULT_SOURCE_FORM = {
  id: '',
  name: '',
  source_type: 'web_page',
  source_url: '',
  community_name: '',
  trust_level: 'community_source',
  default_location_area: 'hoi_an',
  sync_mode: 'manual',
  notes: '',
};

function formatTime(value: string | null | undefined) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString();
}

function statusBadgeClass(status: string | null | undefined) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'succeeded' || normalized === 'published' || normalized === 'approved') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (normalized === 'failed' || normalized === 'rejected') {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  if (normalized === 'retryable' || normalized === 'needs_review') {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  if (normalized === 'queued' || normalized === 'fetching' || normalized === 'extracting' || normalized === 'submitting') {
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

export default function AdminImportedListings({ user }: { user: User | null }) {
  const [sources, setSources] = useState<EventSource[]>([]);
  const [drafts, setDrafts] = useState<DraftWithSource[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [jobsBySource, setJobsBySource] = useState<Record<string, ImportWorkerJob[]>>({});
  const [sourceForm, setSourceForm] = useState(DEFAULT_SOURCE_FORM);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [rawText, setRawText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSource, setSavingSource] = useState(false);
  const [working, setWorking] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | ExternalEventDraft['review_status']>('all');
  const [draftNoteDrafts, setDraftNoteDrafts] = useState<Record<string, string>>({});

  const canModerate = canAccessModerationAdminFrontend(user?.email);

  const load = async () => {
    setLoading(true);
    const [sourceResult, draftResult, snapshotResult] = await Promise.all([
      supabase.from('event_sources').select('*').order('created_at', { ascending: false }),
      supabase
        .from('external_event_drafts')
        .select('*, event_sources(id,name,trust_level,source_url)')
        .order('updated_at', { ascending: false })
        .limit(400),
      supabase
        .from('source_snapshots')
        .select('id,event_source_id,captured_at,capture_method,ingestion_status_message')
        .order('captured_at', { ascending: false })
        .limit(400),
    ]);
    if (sourceResult.error || draftResult.error || snapshotResult.error) {
      setMessage(sourceResult.error?.message || draftResult.error?.message || snapshotResult.error?.message || 'Failed to load imported listings.');
      setLoading(false);
      return;
    }
    const nextSources = (sourceResult.data || []) as EventSource[];
    setSources(nextSources);
    setDrafts((draftResult.data || []) as DraftWithSource[]);
    setSnapshots((snapshotResult.data || []) as SnapshotSummary[]);
    if (!selectedSourceId && nextSources.length > 0) {
      const initial = nextSources[0];
      setSelectedSourceId(initial.id);
      setSourceForm({
        id: initial.id,
        name: initial.name || '',
        source_type: initial.source_type || 'web_page',
        source_url: initial.source_url || '',
        community_name: initial.community_name || '',
        trust_level: initial.trust_level || 'community_source',
        default_location_area: initial.default_location_area || 'hoi_an',
        sync_mode: initial.sync_mode || 'manual',
        notes: initial.notes || '',
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user || !canModerate) return;
    void load();
  }, [user?.id, canModerate]);

  const invokeAdmin = async (action: string, payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('import-worker-admin', {
      body: {
        action,
        ...payload,
      },
    });
    if (error) {
      throw new Error(error.message || 'Admin import request failed.');
    }
    if (data?.error) {
      throw new Error(String(data.error));
    }
    return data;
  };

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId],
  );

  const selectedSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.event_source_id === selectedSourceId),
    [snapshots, selectedSourceId],
  );

  const selectedDrafts = useMemo(
    () => drafts.filter((draft) => draft.event_source_id === selectedSourceId),
    [drafts, selectedSourceId],
  );

  const visibleDrafts = useMemo(() => {
    if (statusFilter === 'all') return selectedDrafts;
    return selectedDrafts.filter((draft) => draft.review_status === statusFilter);
  }, [selectedDrafts, statusFilter]);

  const sourceSnapshotSummary = useMemo(() => {
    const summary: Record<string, { newCount: number; needsReviewCount: number; publishedCount: number; rejectedCount: number }> = {};
    for (const draft of selectedDrafts) {
      const key = draft.source_snapshot_id;
      if (!summary[key]) {
        summary[key] = { newCount: 0, needsReviewCount: 0, publishedCount: 0, rejectedCount: 0 };
      }
      if (draft.review_status === 'new') summary[key].newCount += 1;
      if (draft.review_status === 'needs_review') summary[key].needsReviewCount += 1;
      if (draft.review_status === 'published') summary[key].publishedCount += 1;
      if (draft.review_status === 'rejected') summary[key].rejectedCount += 1;
    }
    return summary;
  }, [selectedDrafts]);

  const selectedJobs = jobsBySource[selectedSourceId] || [];
  const latestJob = selectedJobs[0] || null;

  const refreshSourceJobs = async (sourceId: string) => {
    if (!sourceId) return;
    try {
      const result = await invokeAdmin('listImportJobsForSource', { sourceId, limit: 8 });
      setJobsBySource((prev) => ({
        ...prev,
        [sourceId]: ((result?.jobs || []) as ImportWorkerJob[]),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh import jobs.';
      setMessage(message);
    }
  };

  useEffect(() => {
    if (!selectedSourceId || !user || !canModerate) return;
    void refreshSourceJobs(selectedSourceId);
    const timer = setInterval(() => {
      void refreshSourceJobs(selectedSourceId);
      void load();
    }, 8000);
    return () => clearInterval(timer);
  }, [selectedSourceId, user?.id, canModerate]);

  const hydrateSourceForm = (source: EventSource) => {
    setSourceForm({
      id: source.id,
      name: source.name || '',
      source_type: source.source_type || 'web_page',
      source_url: source.source_url || '',
      community_name: source.community_name || '',
      trust_level: source.trust_level || 'community_source',
      default_location_area: source.default_location_area || 'hoi_an',
      sync_mode: source.sync_mode || 'manual',
      notes: source.notes || '',
    });
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!canModerate) return <Navigate to="/" replace />;

  const handleSaveSource = async (e: FormEvent) => {
    e.preventDefault();
    if (!sourceForm.name.trim()) {
      setMessage('Source name is required.');
      return;
    }
    setSavingSource(true);
    setMessage(null);
    try {
      const action = sourceForm.id ? 'updateSource' : 'createSource';
      const result = await invokeAdmin(action, {
        sourceId: sourceForm.id || undefined,
        name: sourceForm.name,
        source_type: sourceForm.source_type,
        source_url: sourceForm.source_url,
        community_name: sourceForm.community_name,
        trust_level: sourceForm.trust_level,
        default_location_area: sourceForm.default_location_area,
        sync_mode: sourceForm.sync_mode,
        notes: sourceForm.notes,
      });
      const source = result?.source as EventSource | undefined;
      if (source) {
        setSelectedSourceId(source.id);
      }
      await load();
      setMessage(sourceForm.id ? 'Source updated.' : 'Source created.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save source.');
    } finally {
      setSavingSource(false);
    }
  };

  const handleImportNow = async () => {
    if (!selectedSource) {
      setMessage('Select a source first.');
      return;
    }
    if (!selectedSource.source_url) {
      setMessage('This source has no URL. Add a source URL before queueing import.');
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      await invokeAdmin('enqueueImport', {
        sourceId: selectedSource.id,
        sourceUrl: selectedSource.source_url,
        sourceTypeHint: selectedSource.source_type,
      });
      await refreshSourceJobs(selectedSource.id);
      await load();
      setMessage('Import job queued.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not queue import job.');
    } finally {
      setWorking(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    if (!selectedSource) return;
    setWorking(true);
    setMessage(null);
    try {
      await invokeAdmin('retryImport', { jobId, sourceId: selectedSource.id });
      await refreshSourceJobs(selectedSource.id);
      await load();
      setMessage('Retry job queued.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not retry import.');
    } finally {
      setWorking(false);
    }
  };

  const handleManualFallback = async () => {
    if (!selectedSource) {
      setMessage('Select a source first.');
      return;
    }
    if (!rawText.trim()) {
      setMessage('Paste content first.');
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const result = await invokeAdmin('manualParseSnapshot', {
        sourceId: selectedSource.id,
        rawText,
      });
      setRawText('');
      await load();
      setMessage(`Manual fallback parsed ${result?.draftCount || 0} draft entries.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Manual parse failed.');
    } finally {
      setWorking(false);
    }
  };

  const updateDraftStatus = async (draft: DraftWithSource, reviewStatus: DraftWithSource['review_status']) => {
    const statusReason = reviewStatus === 'needs_review' || reviewStatus === 'rejected'
      ? window.prompt('Reason for this status change (optional):', '') || ''
      : '';
    setWorking(true);
    setMessage(null);
    try {
      const result = await invokeAdmin('updateDraftReview', {
        draftId: draft.id,
        reviewStatus,
        reviewNotes: draftNoteDrafts[draft.id] ?? draft.review_notes ?? '',
        statusReason,
      });
      const nextDraft = result?.draft as DraftWithSource | undefined;
      if (nextDraft) {
        setDrafts((prev) => prev.map((item) => (item.id === draft.id ? nextDraft : item)));
      }
      setMessage('Draft status updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update draft.');
    } finally {
      setWorking(false);
    }
  };

  const publishDraft = async (draft: DraftWithSource) => {
    setWorking(true);
    setMessage(null);
    try {
      const result = await invokeAdmin('publishDraft', {
        draftId: draft.id,
      });
      const nextDraft = result?.draft as DraftWithSource | undefined;
      if (nextDraft) {
        setDrafts((prev) => prev.map((item) => (item.id === draft.id ? nextDraft : item)));
      }
      setMessage('Draft published into events.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not publish draft.');
    } finally {
      setWorking(false);
    }
  };

  const handleSelectSource = (source: EventSource) => {
    setSelectedSourceId(source.id);
    hydrateSourceForm(source);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/admin" className="rounded-xl p-2 transition-all hover:bg-slate-100">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </Link>
          <div className="text-center">
            <p className="text-base font-bold text-slate-900">Imported listings</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Worker queue, snapshots, review, publish</p>
          </div>
          <div className="w-9" />
        </div>
      </header>

      <main className="mx-auto mt-6 grid max-w-6xl gap-4 px-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-slate-100 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black text-brand-600">Source setup</p>
            <button
              type="button"
              onClick={() => setSourceForm(DEFAULT_SOURCE_FORM)}
              className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
            >
              New source
            </button>
          </div>
          <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/70 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">How this works</p>
            <p className="mt-1">
              A source is the place you import from, usually a webpage, public Google Doc, or public Google Sheet. Create the source once,
              then select it from the list below and use <span className="font-semibold">Import now</span> to fetch the latest content.
            </p>
          </div>
          <form onSubmit={handleSaveSource} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              required
              value={sourceForm.name}
              onChange={(e) => setSourceForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Source name"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium sm:col-span-2"
            />
            <input
              value={sourceForm.source_url}
              onChange={(e) => setSourceForm((prev) => ({ ...prev, source_url: e.target.value }))}
              placeholder="Source URL"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium sm:col-span-2"
            />
            <select
              value={sourceForm.source_type}
              onChange={(e) => setSourceForm((prev) => ({ ...prev, source_type: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium"
            >
              <option value="web_page">Web page</option>
              <option value="google_doc">Google Doc</option>
              <option value="google_sheet">Google Sheet</option>
              <option value="pdf">PDF</option>
              <option value="manual_text">Manual text</option>
            </select>
            <select
              value={sourceForm.sync_mode}
              onChange={(e) => setSourceForm((prev) => ({ ...prev, sync_mode: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium"
            >
              <option value="manual">Manual</option>
              <option value="semi_manual">Semi-manual</option>
              <option value="automatic">Automatic</option>
            </select>
            <select
              value={sourceForm.trust_level}
              onChange={(e) => setSourceForm((prev) => ({ ...prev, trust_level: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium"
            >
              <option value="community_source">Community source</option>
              <option value="known_organiser">Known organiser</option>
              <option value="verified_partner">Verified partner</option>
              <option value="internal_curated">Internal curated</option>
            </select>
            <input
              value={sourceForm.default_location_area}
              onChange={(e) => setSourceForm((prev) => ({ ...prev, default_location_area: e.target.value }))}
              placeholder="Default location area"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium"
            />
            <input
              value={sourceForm.community_name}
              onChange={(e) => setSourceForm((prev) => ({ ...prev, community_name: e.target.value }))}
              placeholder="Community name"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium sm:col-span-2"
            />
            <textarea
              rows={3}
              value={sourceForm.notes}
              onChange={(e) => setSourceForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Source notes"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
            />
            <button
              type="submit"
              disabled={savingSource}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60 sm:col-span-2"
            >
              {savingSource ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {sourceForm.id ? 'Save source changes' : 'Create source'}
            </button>
          </form>

          <div className="mt-5 space-y-2">
            {sources.length > 0 ? (
              <p className="text-xs text-slate-500">
                Saved sources appear here. Click one to load its URL, import status, snapshots, and review queue.
              </p>
            ) : null}
            {sources.map((source) => (
              <button
                type="button"
                key={source.id}
                onClick={() => handleSelectSource(source)}
                className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition-all ${
                  selectedSourceId === source.id ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-slate-800">{source.name}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${statusBadgeClass(source.last_fetch_status)}`}>
                    {source.last_fetch_status || 'idle'}
                  </span>
                </div>
                <p className="text-slate-500">
                  {source.source_type} · {source.sync_mode} · {source.trust_level}
                </p>
              </button>
            ))}
            {!loading && sources.length === 0 ? (
              <p className="text-xs text-slate-500">No sources yet. Create one to begin URL ingestion.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-5">
          <p className="text-sm font-black text-brand-600">Import control</p>
          <p className="mt-1 text-xs text-slate-500">
            This panel runs the worker import for the selected source and shows the latest fetch status. A normal flow is:
            save source, select source, click <span className="font-semibold">Import now</span>, then review the generated drafts below.
          </p>
          {!selectedSource ? (
            <p className="mt-3 text-sm text-slate-500">Select a source to queue imports.</p>
          ) : (
            <>
              <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <p className="font-bold text-slate-800">{selectedSource.name}</p>
                <p className="text-slate-500">{selectedSource.source_url || 'No source URL set yet'}</p>
                <p className="text-slate-500">
                  Last fetched: {formatTime(selectedSource.last_fetched_at)} · Last imported: {formatTime(selectedSource.last_imported_at)}
                </p>
                <p className="text-slate-500">
                  Status meanings: queued = waiting for worker, fetching/extracting/submitting = in progress, succeeded = snapshot and drafts created,
                  failed/retryable = check the error and retry.
                </p>
                {selectedSource.last_fetch_error ? (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">{selectedSource.last_fetch_error}</p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleImportNow}
                  disabled={working || !selectedSource.source_url}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                >
                  {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Import now
                </button>
                <button
                  type="button"
                  onClick={() => void refreshSourceJobs(selectedSource.id)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh status
                </button>
                {latestJob ? (
                  <button
                    type="button"
                    onClick={() => void handleRetryJob(latestJob.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700"
                  >
                    Retry import
                  </button>
                ) : null}
              </div>
            </>
          )}

          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Latest jobs</p>
            <p className="mt-1 text-xs text-slate-500">
              Each job is one fetch attempt for this source. If a job fails, use retry import to queue a fresh run.
            </p>
            <div className="mt-2 space-y-2">
              {selectedJobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-slate-200 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">{job.id.slice(0, 8)}</span>
                    <span className={`rounded-full border px-2 py-0.5 font-bold uppercase tracking-wider ${statusBadgeClass(job.status)}`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-500">
                    attempts {job.attempt_count}/{job.max_attempts} · fetched {formatTime(job.fetched_at)}
                  </p>
                  {job.last_error_message ? <p className="mt-1 text-rose-600">{job.last_error_message}</p> : null}
                </div>
              ))}
              {!loading && selectedJobs.length === 0 ? (
                <p className="text-xs text-slate-500">No worker jobs yet for this source.</p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Manual fallback (edge cases)</p>
            <p className="mt-1 text-xs text-slate-500">
              Use this only when the source cannot be fetched automatically, for example a messy page or copied schedule text from elsewhere.
              It still creates a snapshot and draft rows, but it skips the worker fetch step.
            </p>
            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Paste source content..."
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={handleManualFallback}
              disabled={working || !selectedSourceId}
              className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-60"
            >
              Parse manual snapshot
            </button>
          </div>
        </section>
      </main>

      <section className="mx-auto mt-4 max-w-6xl px-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black text-brand-600">Snapshot feedback loop</p>
            <span className="text-xs text-slate-500">Fetched snapshot to draft statuses</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            A snapshot is the raw content captured from one import run. Each snapshot can create zero or more drafts. If you see
            &quot;fetched but no event blocks found&quot;, the worker got content but the parser could not split it into usable activities.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {selectedSnapshots.map((snapshot) => {
              const summary = sourceSnapshotSummary[snapshot.id] || { newCount: 0, needsReviewCount: 0, publishedCount: 0, rejectedCount: 0 };
              return (
                <div key={snapshot.id} className="rounded-xl border border-slate-200 p-3 text-xs">
                  <p className="font-semibold text-slate-800">
                    Snapshot {snapshot.id.slice(0, 8)} · {snapshot.capture_method}
                  </p>
                  <p className="text-slate-500">{formatTime(snapshot.captured_at)}</p>
                  <p className="mt-1 text-slate-500">{snapshot.ingestion_status_message || 'No ingest message.'}</p>
                  <p className="mt-2 text-slate-600">
                    new {summary.newCount} · needs review {summary.needsReviewCount} · published {summary.publishedCount} · rejected {summary.rejectedCount}
                  </p>
                </div>
              );
            })}
            {!loading && selectedSnapshots.length === 0 ? (
              <p className="text-sm text-slate-500">No snapshots yet for this source.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-4 max-w-6xl px-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black text-brand-600">Review queue</p>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
            >
              <option value="all">All statuses</option>
              <option value="new">New</option>
              <option value="needs_review">Needs review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="published">Published</option>
            </select>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Review generated drafts here before they become live events. Typical flow: check the summary and warnings, add internal review notes,
            mark needs review or reject if parsing looks wrong, and publish when the draft is good enough to appear as an imported listing.
          </p>
          {loading ? <p className="mt-3 text-sm text-slate-500">Loading drafts...</p> : null}
          <div className="mt-4 space-y-3">
            {visibleDrafts.map((draft) => (
              <div key={draft.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{draft.parsed_title || draft.raw_title || 'Untitled draft'}</p>
                    <p className="text-xs text-slate-500">
                      {(draft.event_sources?.name || 'Unknown source')} · snapshot {draft.source_snapshot_id.slice(0, 8)} · conf {draft.parsed_confidence_score ?? 'n/a'}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${statusBadgeClass(draft.review_status)}`}>
                    {draft.review_status}
                  </span>
                </div>
                {draft.parsed_summary ? <p className="mt-2 text-xs text-slate-500">{draft.parsed_summary}</p> : null}
                {draft.normalization_warnings?.length ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                    Warnings: {draft.normalization_warnings.join(' | ')}
                  </p>
                ) : null}
                <textarea
                  rows={2}
                  value={draftNoteDrafts[draft.id] ?? draft.review_notes ?? ''}
                  onChange={(e) => setDraftNoteDrafts((prev) => ({ ...prev, [draft.id]: e.target.value }))}
                  placeholder="Review notes (internal only)"
                  className="mt-3 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void updateDraftStatus(draft, 'approved')}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateDraftStatus(draft, 'needs_review')}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700"
                  >
                    Needs review
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateDraftStatus(draft, 'rejected')}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void publishDraft(draft)}
                    disabled={draft.review_status === 'rejected'}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Publish
                  </button>
                </div>
              </div>
            ))}
            {!loading && visibleDrafts.length === 0 ? (
              <p className="text-sm text-slate-500">No drafts found for this source/filter.</p>
            ) : null}
          </div>
        </div>
      </section>

      {message ? (
        <div className="fixed bottom-4 left-1/2 z-30 w-[min(92vw,42rem)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-lg">
          {message}
        </div>
      ) : null}
    </div>
  );
}
