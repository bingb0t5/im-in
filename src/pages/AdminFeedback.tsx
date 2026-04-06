import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { AlertCircle, Archive, ArrowLeft, ExternalLink, Image as ImageIcon, MessageSquare, RefreshCw, Trash2, X } from 'lucide-react';
import { canAccessFeedbackAdminFrontend } from '../lib/admin';
import { invokeAuthedFunction } from '../lib/functions';
import { FeedbackAdminItem } from '../types';
import { formatDate } from '../utils';

type FilterOption = 'review' | 'passed' | 'blocked' | 'failed' | 'archived' | 'all';

function getBucket(item: FeedbackAdminItem): FilterOption | 'other' {
  if (item.status === 'archived') return 'archived';
  if (item.status === 'blocked_abuse') return 'blocked';
  if (item.trello_sync_status === 'failed') return 'failed';
  if (item.trello_sync_status === 'synced' || item.status === 'queued_to_trello' || !!item.trello_card_id) return 'passed';
  if (item.status === 'pending_review' || item.trello_sync_status === 'not_sent' || item.trello_sync_status === 'skipped') return 'review';
  return 'other';
}

export default function AdminFeedback({ user }: { user: User | null }) {
  const [items, setItems] = useState<FeedbackAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterOption>('review');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const isAdmin = canAccessFeedbackAdminFrontend(user?.email);

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await invokeAuthedFunction<{ items: FeedbackAdminItem[] }>('feedback-admin', { list: true });
      setItems(response.items || []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load feedback admin.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    void fetchItems();
  }, [user?.id, isAdmin]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const bucket = getBucket(item);
      if (filter !== 'all' && bucket !== filter) return false;
      if (!normalizedQuery) return true;
      return (
        item.title.toLowerCase().includes(normalizedQuery)
        || item.details.toLowerCase().includes(normalizedQuery)
        || (item.reporter_email || '').toLowerCase().includes(normalizedQuery)
        || (item.reporter_name || '').toLowerCase().includes(normalizedQuery)
      );
    });
  }, [filter, items, query]);

  const counts = useMemo(
    () => ({
      review: items.filter((item) => getBucket(item) === 'review').length,
      passed: items.filter((item) => getBucket(item) === 'passed').length,
      blocked: items.filter((item) => getBucket(item) === 'blocked').length,
      failed: items.filter((item) => getBucket(item) === 'failed').length,
      archived: items.filter((item) => getBucket(item) === 'archived').length,
      all: items.length,
    }),
    [items],
  );

  const performAction = async (submissionId: string, payload: Record<string, unknown>) => {
    setActionId(submissionId);
    setError(null);
    try {
      await invokeAuthedFunction('feedback-admin', {
        submissionId,
        ...payload,
      });
      await fetchItems();
    } catch (invokeError) {
      setError(invokeError instanceof Error ? invokeError.message : 'Feedback action failed.');
    } finally {
      setActionId(null);
    }
  };

  const closeDeleteModal = () => {
    if (actionId) return;
    setDeleteTarget(null);
    setDeleteConfirmText('');
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
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/admin" className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Feedback</h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Hidden admin tooling</span>
          </div>
          <button
            type="button"
            onClick={() => {
              void fetchItems();
            }}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all active:scale-95"
            aria-label="Refresh feedback queue"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-5">
        <section className="bg-white rounded-2xl p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Internal feedback review</p>
              <p className="text-sm text-slate-500 leading-relaxed mt-1">
                Review feedback that stayed internal, retry Trello sync, and archive items once handled. This page includes blocked abuse items, failed syncs, and unsent submissions.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, text, or reporter"
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
            />
            <div className="flex items-center justify-end gap-4 text-sm flex-wrap">
              {([
                ['review', 'Review'],
                ['passed', 'Passed'],
                ['blocked', 'Blocked'],
                ['failed', 'Failed'],
                ['archived', 'Archived'],
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
        ) : filteredItems.length === 0 ? (
          <section className="bg-white rounded-2xl p-10 text-center">
            <p className="text-sm text-slate-400">No matching feedback items.</p>
          </section>
        ) : (
          <div className="space-y-4">
            {filteredItems.map((item) => {
              const isBusy = actionId === item.id;
              const bucket = getBucket(item);
              const isExpanded = expandedId === item.id;
              return (
                <section key={item.id} className="bg-white rounded-2xl p-5 space-y-4">
                  <button
                    type="button"
                    onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                    className="w-full text-left flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-bold text-slate-900 truncate">{item.title}</p>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.submission_type}</span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">{item.public_sanitized_summary || item.details}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {item.reporter_name || 'Unknown reporter'}{item.reporter_email ? ` · ${item.reporter_email}` : ''} · {formatDate(item.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${
                        bucket === 'blocked'
                          ? 'bg-red-50 text-red-700 border border-red-100'
                          : bucket === 'passed'
                            ? 'bg-brand-50 text-brand-700 border border-brand-100'
                          : bucket === 'failed'
                            ? 'bg-amber-50 text-amber-700 border border-amber-100'
                            : bucket === 'archived'
                              ? 'bg-slate-100 text-slate-700 border border-slate-200'
                              : 'bg-brand-50 text-brand-700 border border-brand-100'
                      }`}>
                        {bucket}
                      </span>
                    </div>
                  </button>

                  {isExpanded ? (
                    <>
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
                        <div className="space-y-4">
                          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Full details</p>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{item.details}</p>
                          </div>

                          {item.codex_prompt_draft ? (
                            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Generated prompt</p>
                              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{item.codex_prompt_draft}</p>
                            </div>
                          ) : null}
                        </div>

                        <div className="space-y-4">
                          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-3">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Status</p>
                              <p className="text-sm font-bold text-slate-800">{item.status}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Trello sync</p>
                              <p className="text-sm font-bold text-slate-800">{item.trello_sync_status}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Abuse check</p>
                              <p className="text-sm font-bold text-slate-800">
                                {item.abuse_blocked ? 'Blocked' : item.abuse_risk_level || 'Not set'}
                                {typeof item.abuse_confidence === 'number' ? ` · ${item.abuse_confidence.toFixed(2)}` : ''}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Reasons</p>
                              <div className="flex flex-wrap gap-2">
                                {(item.abuse_reasons || []).length > 0 ? (
                                  item.abuse_reasons.map((reason) => (
                                    <span key={reason} className="px-2.5 py-1 rounded-full bg-white text-[11px] font-bold text-slate-500 border border-slate-100">
                                      {reason}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-sm text-slate-400">No reasons stored.</span>
                                )}
                              </div>
                            </div>
                            {item.page_url ? (
                              <a
                                href={item.page_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-brand-600 transition-colors"
                              >
                                Open source page <ExternalLink className="w-4 h-4" />
                              </a>
                            ) : null}
                            {item.trello_card_url ? (
                              <a
                                href={item.trello_card_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-brand-600 transition-colors"
                              >
                                Open Trello card <ExternalLink className="w-4 h-4" />
                              </a>
                            ) : null}
                          </div>

                          {item.screenshot_signed_url ? (
                            <a
                              href={item.screenshot_signed_url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-2xl overflow-hidden border border-slate-100 bg-white"
                            >
                              <img src={item.screenshot_signed_url} alt="Feedback screenshot" className="w-full h-auto object-cover" />
                            </a>
                          ) : (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-400 flex items-center gap-2">
                              <ImageIcon className="w-4 h-4" /> No screenshot attached.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {!item.trello_card_id ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              void performAction(item.id, { retryTrello: true });
                            }}
                            className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 transition-all disabled:opacity-50"
                          >
                            Send to board
                          </button>
                        ) : null}
                        {item.trello_sync_status === 'failed' ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              void performAction(item.id, { retryTrello: true });
                            }}
                            className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-sm font-bold hover:bg-amber-100 transition-all disabled:opacity-50"
                          >
                            Retry Trello sync
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            void performAction(item.id, item.status === 'archived' ? { unarchive: true } : { archive: true });
                          }}
                          className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2"
                        >
                          <Archive className="w-4 h-4" />
                          {item.status === 'archived' ? 'Restore to review' : 'Archive'}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setDeleteTarget({ id: item.id, title: item.title });
                            setDeleteConfirmText('');
                          }}
                          className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-bold hover:bg-red-100 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}

        {!loading && items.length === 0 ? (
          <section className="bg-white rounded-2xl p-10 text-center">
            <AlertCircle className="w-8 h-8 text-slate-200 mx-auto mb-4" />
            <p className="text-sm text-slate-400">No feedback submissions stored yet.</p>
          </section>
        ) : null}
      </main>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 bg-slate-900/30 px-4 py-6 overflow-y-auto overscroll-contain">
          <div className="min-h-full flex items-center justify-center">
            <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-xl space-y-4 my-auto">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">Delete feedback item</p>
                  <p className="text-sm text-slate-500 mt-1">
                    This will permanently remove the feedback record, related prompt-job entries, and any stored screenshot.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={!!actionId}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  aria-label="Close delete confirmation modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Item</p>
                <p className="text-sm font-bold text-slate-900">{deleteTarget.title}</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-slate-600">
                  Type <span className="font-black text-slate-900">DELETE</span> to confirm.
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type DELETE"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-400 transition-all"
                />
              </div>

              {error ? (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={!!actionId}
                  className="px-4 py-2 rounded-full bg-slate-100 text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!deleteTarget || deleteConfirmText.trim() !== 'DELETE') return;
                    void performAction(deleteTarget.id, { deleteSubmission: true }).then(() => {
                      setDeleteTarget(null);
                      setDeleteConfirmText('');
                    });
                  }}
                  disabled={!!actionId || deleteConfirmText.trim() !== 'DELETE'}
                  className="px-4 py-2 rounded-full bg-red-600 text-sm font-bold text-white hover:bg-red-500 transition-colors disabled:opacity-50"
                >
                  {actionId ? 'Deleting...' : 'Delete permanently'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
