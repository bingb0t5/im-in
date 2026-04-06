import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calendar, ExternalLink, MapPin, Shield, X } from 'lucide-react';
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

export function ModerationTransparencyModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState<PublicModerationLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<PublicModerationLogEntry | null>(null);
  const [previewEvent, setPreviewEvent] = useState<(Event & { can_view_full_details?: boolean }) | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const isOpen = searchParams.get('action') === 'moderation';
  const actionFilter = (searchParams.get('moderationAction') as ActionFilter | null) || 'all';
  const activityFilter = searchParams.get('activity') || null;

  const filterButtons = useMemo(
    () =>
      (Object.keys(FILTER_LABELS) as ActionFilter[]).map((value) => ({
        value,
        label: FILTER_LABELS[value],
      })),
    [],
  );

  const closePreviewModal = () => {
    setSelectedEntry(null);
    setPreviewEvent(null);
    setPreviewError(null);
    setPreviewLoading(false);
  };

  const closeModal = () => {
    closePreviewModal();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('action');
    nextParams.delete('activity');
    nextParams.delete('moderationAction');
    setSearchParams(nextParams, { replace: true });
  };

  const loadEntries = async (offset = 0, append = false) => {
    if (!isOpen) return;

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
    if (!isOpen) {
      setEntries([]);
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      setError(null);
      closePreviewModal();
      return;
    }

    void loadEntries(0, false);
  }, [isOpen, actionFilter, activityFilter]);

  const updateFilter = (value: ActionFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value === 'all') {
      nextParams.delete('moderationAction');
    } else {
      nextParams.set('moderationAction', value);
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

  if (!isOpen) {
    return null;
  }

  const previewPath = selectedEntry?.public_slug_snapshot ? `/events/${selectedEntry.public_slug_snapshot}` : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        onClick={closeModal}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Close moderation transparency modal"
      />
      <div className="relative flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] bg-white text-left shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 sm:px-8 sm:py-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 shrink-0 text-brand-600" />
              <h2 className="truncate text-lg font-black tracking-tight text-slate-900 sm:text-xl">
                Moderation Transparency
              </h2>
            </div>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Public-facing moderation log
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="rounded-xl p-2 transition-all hover:bg-slate-50"
            aria-label="Close moderation transparency modal"
          >
            <X className="h-6 w-6 text-slate-300" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-6 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6">
          <div className="space-y-6">
            <section className="rounded-3xl bg-slate-50/80 p-5">
              <div className="space-y-3 text-sm font-medium leading-relaxed text-slate-600">
                <p className="font-bold text-slate-900">Why this log exists</p>
                <p>This log exists so moderation of public content remains open and accountable.</p>
                <p>
                  Only public-facing moderation is shown here. For semi-public activities, that means the public
                  preview only. Private content and private-link-only semi-public content never appear in this log, nor
                  do moderators have access to view that private content unless the host has shared the private URL
                  with a moderator.
                </p>
                {activityFilter ? (
                  <p className="text-xs text-slate-400">
                    Showing moderation history for one public-facing activity listing.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {filterButtons.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateFilter(value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
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
                <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
              ) : null}

              {loading ? (
                <div className="animate-pulse space-y-3">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="space-y-2 rounded-2xl border border-slate-100 p-4">
                      <div className="h-4 w-1/3 rounded-full bg-slate-100" />
                      <div className="h-3 w-2/3 rounded-full bg-slate-100" />
                      <div className="h-3 w-1/4 rounded-full bg-slate-100" />
                    </div>
                  ))}
                </div>
              ) : entries.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-slate-400">No public moderation entries match this view yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {entries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        void openPreviewModal(entry);
                      }}
                      className="w-full space-y-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 text-left transition-colors hover:bg-slate-50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white">
                            {formatAction(entry.action)}
                          </span>
                          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                            {entry.target_visibility_snapshot === 'semi_public' ? 'Semi-public preview' : 'Public'}
                          </span>
                          {entry.reason_code ? (
                            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                              {entry.reason_code.replace(/_/g, ' ')}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs text-slate-400">{formatTimestamp(entry.created_at)}</span>
                      </div>

                      <p className="text-sm font-bold text-slate-900">{entry.public_title_snapshot || 'Public activity'}</p>

                      {entry.public_explanation ? (
                        <p className="text-sm leading-relaxed text-slate-500">{entry.public_explanation}</p>
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
                        onClick={() => {
                          void loadEntries(entries.length, true);
                        }}
                        disabled={loadingMore}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-50"
                      >
                        {loadingMore ? 'Loading...' : 'Load more'}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {selectedEntry ? (
        <div className="fixed inset-0 z-[80] bg-slate-900/30 px-4 py-6 overflow-y-auto overscroll-contain">
          <div className="flex min-h-full items-center justify-center">
            <div className="my-auto w-full max-w-2xl space-y-5 rounded-3xl bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">
                    {previewEvent?.title || selectedEntry.public_title_snapshot || 'Public activity'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Current public-facing page preview for this moderation log entry.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePreviewModal}
                  className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Close activity preview modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white">
                    {formatAction(selectedEntry.action)}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    {selectedEntry.target_visibility_snapshot === 'semi_public' ? 'Semi-public preview' : 'Public'}
                  </span>
                </div>
                {selectedEntry.public_explanation ? (
                  <p className="text-sm leading-relaxed text-slate-500">{selectedEntry.public_explanation}</p>
                ) : null}
              </div>

              {previewLoading ? (
                <div className="space-y-3 rounded-2xl border border-slate-100 p-5 animate-pulse">
                  <div className="h-5 w-1/2 rounded-full bg-slate-100" />
                  <div className="h-4 w-1/3 rounded-full bg-slate-100" />
                  <div className="h-4 w-2/3 rounded-full bg-slate-100" />
                </div>
              ) : previewError ? (
                <div className="space-y-3 rounded-2xl border border-slate-100 p-5">
                  <p className="text-sm font-bold text-slate-900">
                    {selectedEntry.public_title_snapshot || 'Public activity'}
                  </p>
                  <p className="text-sm leading-relaxed text-slate-500">{previewError}</p>
                </div>
              ) : previewEvent ? (
                <div className="space-y-4 rounded-2xl border border-slate-100 p-5">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
                      <p className="text-sm font-bold text-slate-800">
                        {formatDate(previewEvent.starts_at, previewEvent.timezone)}
                      </p>
                    </div>
                    {previewEvent.location_text || previewEvent.public_location_text ? (
                      <div className="flex items-center gap-3">
                        <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                        <p className="text-sm text-slate-600">
                          {previewEvent.location_text || previewEvent.public_location_text}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {previewEvent.public_summary ? (
                    <p className="text-sm leading-relaxed text-slate-500">{previewEvent.public_summary}</p>
                  ) : null}

                  {previewEvent.description ? (
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Description</p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-500">
                        {previewEvent.description}
                      </p>
                    </div>
                  ) : null}

                  {previewPath ? (
                    <div className="pt-1">
                      <Link
                        to={previewPath}
                        onClick={closeModal}
                        className="inline-flex items-center gap-2 text-sm font-bold text-brand-600 transition-colors hover:text-brand-500"
                      >
                        Open public page
                        <ExternalLink className="h-4 w-4" />
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
