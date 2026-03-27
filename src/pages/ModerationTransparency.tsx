import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calendar, ExternalLink, MapPin, X } from 'lucide-react';
import { supabase } from '../supabase';
import { Event, PublicModerationLogEntry } from '../types';
import { formatDate } from '../utils';

type ActionFilter = 'all' | PublicModerationLogEntry['action'];

const PAGE_SIZE = 20;

const FILTER_LABELS: Record<ActionFilter, string> = {
  all: 'All',
  approved: 'Approved',
  denied: 'Denied',
  flagged: 'Flagged',
  marked_spam: 'Marked spam',
  restored: 'Restored',
  removed: 'Removed',
};

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatAction(action: PublicModerationLogEntry['action']) {
  return FILTER_LABELS[action];
}

export default function ModerationTransparency() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState<PublicModerationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<PublicModerationLogEntry | null>(null);
  const [previewEvent, setPreviewEvent] = useState<(Event & { can_view_full_details?: boolean }) | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const actionFilter = (searchParams.get('action') as ActionFilter | null) || 'all';
  const activityFilter = searchParams.get('activity') || null;

  const loadEntries = async (offset = 0, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('list_public_moderation_log', {
      p_action: actionFilter === 'all' ? null : actionFilter,
      p_target_id: activityFilter || null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });

    if (rpcError) {
      setError(rpcError.message || 'Could not load the moderation log.');
      if (!append) {
        setEntries([]);
      }
      setHasMore(false);
    } else {
      const nextEntries = (data || []) as PublicModerationLogEntry[];
      setEntries((current) => (append ? [...current, ...nextEntries] : nextEntries));
      setHasMore(nextEntries.length === PAGE_SIZE);
    }

    setLoading(false);
    setLoadingMore(false);
  };

  useEffect(() => {
    void loadEntries(0, false);
  }, [actionFilter, activityFilter]);

  const filterButtons = useMemo(
    () => (Object.keys(FILTER_LABELS) as ActionFilter[]).map((value) => ({
      value,
      label: FILTER_LABELS[value],
    })),
    [],
  );

  const updateFilter = (value: ActionFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value === 'all') {
      nextParams.delete('action');
    } else {
      nextParams.set('action', value);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const openPreviewModal = async (entry: PublicModerationLogEntry) => {
    setSelectedEntry(entry);
    setPreviewEvent(null);
    setPreviewError(null);

    if (!entry.public_slug_snapshot) {
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);

    const { data, error: previewRpcError } = await supabase.rpc('get_event_for_view', {
      p_slug: entry.public_slug_snapshot,
      p_access_code: null,
    });

    if (previewRpcError || !Array.isArray(data) || data.length === 0) {
      setPreviewError('The current public page is not available right now.');
      setPreviewLoading(false);
      return;
    }

    setPreviewEvent(data[0] as Event & { can_view_full_details?: boolean });
    setPreviewLoading(false);
  };

  const closePreviewModal = () => {
    setSelectedEntry(null);
    setPreviewEvent(null);
    setPreviewError(null);
    setPreviewLoading(false);
  };

  const previewPath = selectedEntry?.public_slug_snapshot ? `/events/${selectedEntry.public_slug_snapshot}` : null;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-black text-slate-900 tracking-tight">Moderation Transparency</h1>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Public-facing moderation log</span>
          </div>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-8 space-y-6">
        <section className="bg-white rounded-2xl p-5 space-y-3">
          <p className="text-sm font-bold text-slate-900">Why this log exists</p>
          <p className="text-sm text-slate-500 leading-relaxed">
            This log exists so moderation of public content remains open and accountable.
          </p>
          <p className="text-sm text-slate-500 leading-relaxed">
            Only public-facing moderation is shown here. For semi-public activities, that means the public preview only. Private content and private-link-only semi-public content never appear in this log, nor do moderators have access to view that private content unless the host has shared the private URL with a moderator.
          </p>
          {activityFilter ? (
            <p className="text-xs text-slate-400">
              Showing moderation history for one public-facing activity listing.
            </p>
          ) : null}
        </section>

        <section className="bg-white rounded-2xl p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {filterButtons.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => updateFilter(value)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  actionFilter === value
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3].map((item) => (
                <div key={item} className="rounded-2xl border border-slate-100 p-4 space-y-2">
                  <div className="h-4 bg-slate-100 rounded-full w-1/3" />
                  <div className="h-3 bg-slate-100 rounded-full w-2/3" />
                  <div className="h-3 bg-slate-100 rounded-full w-1/4" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-400">No public moderation entries match this view yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => { void openPreviewModal(entry); }}
                  className="w-full text-left rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-2 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold bg-slate-900 text-white">
                        {formatAction(entry.action)}
                      </span>
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                        {entry.target_visibility_snapshot === 'semi_public' ? 'Semi-public preview' : 'Public'}
                      </span>
                      {entry.reason_code ? (
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                          {entry.reason_code.replace(/_/g, ' ')}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-slate-400">{formatTimestamp(entry.created_at)}</span>
                  </div>

                  <p className="text-sm font-bold text-slate-900">
                    {entry.public_title_snapshot || 'Public activity'}
                  </p>

                  {entry.public_explanation ? (
                    <p className="text-sm text-slate-500 leading-relaxed">{entry.public_explanation}</p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span>{entry.moderator_public_handle}</span>
                    <span>Tap to view current public page</span>
                  </div>
                </button>
              ))}

              {hasMore ? (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => { void loadEntries(entries.length, true); }}
                    disabled={loadingMore}
                    className="px-4 py-2 rounded-full bg-white border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </main>

      {selectedEntry ? (
        <div className="fixed inset-0 z-50 bg-slate-900/30 px-4 py-6 overflow-y-auto overscroll-contain">
          <div className="min-h-full flex items-center justify-center">
            <div className="w-full max-w-2xl bg-white rounded-3xl p-6 shadow-xl space-y-5 my-auto">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">
                    {previewEvent?.title || selectedEntry.public_title_snapshot || 'Public activity'}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">
                    Current public-facing page preview for this moderation log entry.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePreviewModal}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  aria-label="Close activity preview modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold bg-slate-900 text-white">
                    {formatAction(selectedEntry.action)}
                  </span>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                    {selectedEntry.target_visibility_snapshot === 'semi_public' ? 'Semi-public preview' : 'Public'}
                  </span>
                </div>
                {selectedEntry.public_explanation ? (
                  <p className="text-sm text-slate-500 leading-relaxed">{selectedEntry.public_explanation}</p>
                ) : null}
              </div>

              {previewLoading ? (
                <div className="rounded-2xl border border-slate-100 p-5 space-y-3 animate-pulse">
                  <div className="h-5 w-1/2 rounded-full bg-slate-100" />
                  <div className="h-4 w-1/3 rounded-full bg-slate-100" />
                  <div className="h-4 w-2/3 rounded-full bg-slate-100" />
                </div>
              ) : previewError ? (
                <div className="rounded-2xl border border-slate-100 p-5 space-y-3">
                  <p className="text-sm font-bold text-slate-900">
                    {selectedEntry.public_title_snapshot || 'Public activity'}
                  </p>
                  <p className="text-sm text-slate-500 leading-relaxed">{previewError}</p>
                </div>
              ) : previewEvent ? (
                <div className="rounded-2xl border border-slate-100 p-5 space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                      <p className="text-sm font-bold text-slate-800">{formatDate(previewEvent.starts_at, previewEvent.timezone)}</p>
                    </div>
                    {(previewEvent.location_text || previewEvent.public_location_text) ? (
                      <div className="flex items-center gap-3">
                        <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                        <p className="text-sm text-slate-600">
                          {previewEvent.location_text || previewEvent.public_location_text}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {previewEvent.public_summary ? (
                    <p className="text-sm text-slate-500 leading-relaxed">{previewEvent.public_summary}</p>
                  ) : null}

                  {previewEvent.description ? (
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Description</p>
                      <p className="text-sm text-slate-500 leading-relaxed whitespace-pre-wrap">{previewEvent.description}</p>
                    </div>
                  ) : null}

                  {previewPath ? (
                    <div className="pt-1">
                      <Link
                        to={previewPath}
                        className="inline-flex items-center gap-2 text-sm font-bold text-brand-600 hover:text-brand-500 transition-colors"
                      >
                        Open public page
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
