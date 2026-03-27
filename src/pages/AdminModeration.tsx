import { useEffect, useMemo, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { Shield, ArrowLeft, RefreshCw, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Event } from '../types';
import { isModerationAdminEmail } from '../lib/admin';
import { invokeAuthedFunction } from '../lib/functions';
import { getModerationStatusBadge } from '../lib/moderation';
import { formatDate } from '../utils';

type OverrideOption = 'force_visible' | 'force_limited' | 'hide' | 'mark_safe' | 'mark_spam';
type FilterOption = 'review' | 'archived' | 'spam' | 'all';
type ModerationActionPayload = {
  override?: OverrideOption;
  clearOverride?: boolean;
  rerun?: boolean;
  archive?: boolean;
  unarchive?: boolean;
  publicExplanation?: string;
};

type PendingModerationAction = {
  eventId: string;
  label: string;
  payload: ModerationActionPayload;
};

function getAiStatusSummary(event: Event) {
  if (event.moderation_status === 'error') {
    return {
      label: 'Error',
      detail: 'The last moderation run failed. Re-run AI moderation after checking the function setup.',
    };
  }

  if (event.moderation_status === 'pending') {
    return {
      label: 'Not checked yet',
      detail: 'The current version is waiting for AI moderation before broader discovery can be decided.',
    };
  }

  if (!event.moderated_at) {
    return {
      label: 'Not checked yet',
      detail: 'No completed AI moderation run is stored for the current version.',
    };
  }

  return {
    label: 'Checked',
    detail: 'AI moderation has completed for the current saved version.',
  };
}

function getModerationBucket(event: Event): Exclude<FilterOption, 'all'> | 'other' {
  if (event.moderation_override === 'mark_spam') return 'spam';
  if (event.moderation_archived_at) return 'archived';

  if (
    !event.moderated_at ||
    event.moderation_status === 'pending' ||
    event.moderation_status === 'limited' ||
    event.moderation_status === 'review' ||
    event.moderation_status === 'blocked' ||
    event.moderation_status === 'error'
  ) {
    return 'review';
  }

  return 'other';
}

function getOverrideLabel(event: Event) {
  switch (event.moderation_override) {
    case 'hide':
      return 'hide / review';
    case 'mark_spam':
      return 'spam';
    case 'force_visible':
      return 'force visible';
    case 'force_limited':
      return 'force limited';
    case 'mark_safe':
      return 'mark safe';
    default:
      return null;
  }
}

export default function AdminModeration({ user }: { user: User | null }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterOption>('review');
  const [actionEventId, setActionEventId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingModerationAction | null>(null);
  const [moderatorExplanation, setModeratorExplanation] = useState('');

  const isAdmin = isModerationAdminEmail(user?.email);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await invokeAuthedFunction<{ items: Event[] }>('moderate-activity', {
        listQueue: true,
      });
      setEvents(response.items || []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load moderation queue.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    void fetchEvents();
  }, [user?.id, isAdmin]);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return events.filter((event) => {
      const bucket = getModerationBucket(event);
      if (filter !== 'all' && bucket !== filter) return false;

      if (!normalizedQuery) return true;

      return (
        event.title.toLowerCase().includes(normalizedQuery) ||
        (event.host_name || '').toLowerCase().includes(normalizedQuery) ||
        event.slug.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [events, filter, query]);

  const counts = useMemo(
    () => ({
      review: events.filter((event) => getModerationBucket(event) === 'review').length,
      archived: events.filter((event) => getModerationBucket(event) === 'archived').length,
      spam: events.filter((event) => getModerationBucket(event) === 'spam').length,
      all: events.length,
    }),
    [events],
  );

  const applyModerationAction = async (
    eventId: string,
    payload: ModerationActionPayload,
  ) => {
    setActionEventId(eventId);
    setError(null);

    try {
      await invokeAuthedFunction('moderate-activity', {
        eventId,
        ...payload,
      });
      await fetchEvents();
      return true;
    } catch (invokeError) {
      setError(invokeError instanceof Error ? invokeError.message : 'Moderation action failed.');
      return false;
    }
    finally {
      setActionEventId(null);
    }
  };

  const openDecisionModal = (eventId: string, label: string, payload: ModerationActionPayload) => {
    setPendingAction({ eventId, label, payload });
    setModeratorExplanation('');
    setError(null);
  };

  const closeDecisionModal = () => {
    if (actionEventId) return;
    setPendingAction(null);
    setModeratorExplanation('');
  };

  const submitDecision = async () => {
    if (!pendingAction) return;

    const explanation = moderatorExplanation.trim();
    if (!explanation) {
      setError('Please add a short explanation for this moderation decision.');
      return;
    }

    const wasSuccessful = await applyModerationAction(pendingAction.eventId, {
      ...pendingAction.payload,
      publicExplanation: explanation,
    });

    if (wasSuccessful) {
      setPendingAction(null);
      setModeratorExplanation('');
    }
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Moderation</h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Hidden admin tooling</span>
          </div>
          <button
            type="button"
            onClick={() => { void fetchEvents(); }}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all active:scale-95"
            aria-label="Refresh moderation queue"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-6 space-y-5">
        <section className="bg-white rounded-2xl p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Manual discovery controls</p>
              <p className="text-sm text-slate-500 leading-relaxed mt-1">
                Use this page to review public-facing activity moderation only. Private activities and private-link-only semi-public content stay outside platform moderation tooling.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, host, or slug"
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
            />
            <div className="flex items-center justify-end gap-4 text-sm">
              {([
                ['review', 'Review'],
                ['archived', 'Archived'],
                ['spam', 'Spam'],
                ['all', 'All'],
              ] as Array<[FilterOption, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`transition-colors ${
                    filter === value ? 'text-slate-900 font-bold' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {label} ({counts[value]})
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          ) : null}
        </section>

        {loading ? (
          <section className="bg-white rounded-2xl overflow-hidden">
            {[1, 2, 3].map((item) => (
              <div key={item} className="px-5 py-4 border-b border-slate-50 last:border-0 space-y-2 animate-pulse">
                <div className="h-4 bg-slate-100 rounded-full w-1/2" />
                <div className="h-3 bg-slate-100 rounded-full w-1/3" />
              </div>
            ))}
          </section>
        ) : filteredEvents.length === 0 ? (
          <section className="bg-white rounded-2xl p-10 text-center">
            <p className="text-sm text-slate-400">No matching activities in the moderation view.</p>
          </section>
        ) : (
          <div className="space-y-4">
            {filteredEvents.map((event) => {
              const isBusy = actionEventId === event.id;
              const aiStatus = getAiStatusSummary(event);
              const isExpanded = expandedEventId === event.id;
              const bucket = getModerationBucket(event);
              const statusBadge =
                bucket === 'spam'
                  ? { label: 'Spam', className: 'bg-red-50 text-red-700 border border-red-100' }
                  : getModerationStatusBadge(event);
              const archiveBadge = event.moderation_archived_at
                ? { label: 'Inbox archived', className: 'bg-slate-100 text-slate-700 border border-slate-200' }
                : null;
              const overrideLabel = getOverrideLabel(event);

              return (
                <section key={event.id} className="bg-white rounded-2xl p-5 space-y-4">
                  <button
                    type="button"
                    onClick={() => setExpandedEventId((current) => (current === event.id ? null : event.id))}
                    className="w-full text-left flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-bold text-slate-900 truncate">{event.title}</p>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {event.visibility === 'semi_public' ? 'Semi-public preview' : 'Public'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        Host: {event.show_host_publicly && event.host_name ? event.host_name : 'Not shown publicly'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {bucket === 'review'
                          ? aiStatus.detail
                          : bucket === 'archived'
                            ? 'Archived from the moderator inbox. Discovery status stays the same.'
                            : bucket === 'spam'
                              ? 'Marked as spam.'
                              : 'Not currently in the review queue.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {archiveBadge ? (
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${archiveBadge.className}`}>
                          {archiveBadge.label}
                        </span>
                      ) : null}
                      {statusBadge ? (
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${statusBadge.className}`}>
                          {statusBadge.label}
                        </span>
                      ) : null}
                      <span className="text-slate-300">{isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
                    </div>
                  </button>

                  {isExpanded ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-slate-400">
                          `/events/{event.slug}`{overrideLabel ? ` · override: ${overrideLabel}` : ''}{event.moderation_archived_at ? ` · inbox archived ${formatDate(event.moderation_archived_at)}` : ''}
                        </p>
                        <Link
                          to={`/host/events/${event.id}`}
                          className="text-xs font-bold text-slate-400 hover:text-brand-600 transition-colors"
                        >
                          Open host view
                        </Link>
                      </div>

                      {event.moderation_reasons && event.moderation_reasons.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {event.moderation_reasons.map((reason) => (
                            <span key={reason} className="px-2.5 py-1 rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
                              {reason}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">AI moderation</p>
                          <span className="text-xs font-bold text-slate-600">{aiStatus.label}</span>
                        </div>
                        <p className="text-sm text-slate-500 leading-relaxed">{aiStatus.detail}</p>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Risk</p>
                            <p className="text-sm font-bold text-slate-800">{event.moderation_risk_level || 'Not set'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Suggested action</p>
                            <p className="text-sm font-bold text-slate-800">{event.moderation_action || 'Not set'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Confidence</p>
                            <p className="text-sm font-bold text-slate-800">
                              {typeof event.moderation_confidence === 'number'
                                ? event.moderation_confidence.toFixed(2)
                                : 'Not set'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Checked at</p>
                            <p className="text-sm font-bold text-slate-800">
                              {event.moderated_at ? formatDate(event.moderated_at) : 'Not checked'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => { openDecisionModal(event.id, 'Force visible', { override: 'force_visible' }); }}
                          className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 transition-all disabled:opacity-50"
                        >
                          Force visible
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => { openDecisionModal(event.id, 'Force limited', { override: 'force_limited' }); }}
                          className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-sm font-bold hover:bg-amber-100 transition-all disabled:opacity-50"
                        >
                          Force limited
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => { openDecisionModal(event.id, 'Hide / review', { override: 'hide' }); }}
                          className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
                        >
                          Hide / review
                        </button>
                        {bucket !== 'spam' ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              void applyModerationAction(
                                event.id,
                                bucket === 'archived' ? { unarchive: true } : { archive: true },
                              );
                            }}
                            className="px-3 py-2 rounded-xl bg-slate-50 text-slate-700 text-sm font-bold hover:bg-slate-100 transition-all disabled:opacity-50"
                          >
                            {bucket === 'archived' ? 'Return to inbox' : 'Archive from inbox'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => { openDecisionModal(event.id, 'Mark safe', { override: 'mark_safe' }); }}
                          className="px-3 py-2 rounded-xl bg-brand-50 text-brand-700 text-sm font-bold hover:bg-brand-100 transition-all disabled:opacity-50"
                        >
                          Mark safe
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => { openDecisionModal(event.id, 'Mark spam', { override: 'mark_spam' }); }}
                          className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-bold hover:bg-red-100 transition-all disabled:opacity-50"
                        >
                          Mark spam
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => { void applyModerationAction(event.id, { clearOverride: true }); }}
                          className="px-3 py-2 rounded-xl bg-slate-50 text-slate-600 text-sm font-bold hover:bg-slate-100 transition-all disabled:opacity-50"
                        >
                          Clear override
                        </button>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => { openDecisionModal(event.id, 'Re-run AI moderation', { clearOverride: true, rerun: true }); }}
                          className="text-sm font-bold text-slate-500 hover:text-brand-600 transition-colors disabled:opacity-50"
                        >
                          Re-run AI moderation
                        </button>
                      </div>
                    </>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </main>

      {pendingAction ? (
        <div className="fixed inset-0 z-50 bg-slate-900/30 px-4 py-6 overflow-y-auto overscroll-contain">
          <div className="min-h-full flex items-center justify-center">
            <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-xl space-y-4 my-auto">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">{pendingAction.label}</p>
                  <p className="text-sm text-slate-500 mt-1">
                    Add a short public explanation for this moderation decision. It will appear in the moderation transparency log.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDecisionModal}
                  disabled={!!actionEventId}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  aria-label="Close moderation explanation modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <textarea
                value={moderatorExplanation}
                onChange={(e) => setModeratorExplanation(e.target.value)}
                rows={5}
                placeholder="Explain the decision in calm, factual language."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all resize-none"
              />

              {error ? (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDecisionModal}
                  disabled={!!actionEventId}
                  className="px-4 py-2 rounded-full bg-slate-100 text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void submitDecision(); }}
                  disabled={!!actionEventId}
                  className="px-4 py-2 rounded-full bg-slate-900 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {actionEventId ? 'Saving...' : 'Save decision'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
