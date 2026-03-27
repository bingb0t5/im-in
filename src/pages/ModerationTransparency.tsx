import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../supabase';
import { PublicModerationLogEntry } from '../types';

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
                <article key={entry.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-2">
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
                  </div>
                </article>
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
    </div>
  );
}
