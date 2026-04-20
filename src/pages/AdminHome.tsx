import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, FlaskConical, Image, MessageSquare, Shield, SlidersHorizontal, Upload } from 'lucide-react';
import { canAccessAnyAdminFrontend, canAccessFeedbackAdminFrontend, canAccessModerationAdminFrontend } from '../lib/admin';
import { supabase } from '../supabase';

type SourceHealthRow = {
  id: string;
  name: string;
  last_fetch_status: string | null;
  last_fetch_error: string | null;
  last_imported_at: string | null;
};

export default function AdminHome({ user }: { user: User | null }) {
  const [sourceHealthRows, setSourceHealthRows] = useState<SourceHealthRow[]>([]);
  const [sourceHealthError, setSourceHealthError] = useState<string | null>(null);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const canModerate = canAccessModerationAdminFrontend(user.email);
  const canReviewFeedback = canAccessFeedbackAdminFrontend(user.email);

  if (!canAccessAnyAdminFrontend(user.email)) {
    return <Navigate to="/" replace />;
  }

  useEffect(() => {
    if (!canModerate) return;
    const loadSourceHealth = async () => {
      const { data, error } = await supabase
        .from('event_sources')
        .select('id,name,last_fetch_status,last_fetch_error,last_imported_at')
        .order('updated_at', { ascending: false })
        .limit(120);
      if (error) {
        setSourceHealthError(error.message || 'Could not load imported listing health.');
        return;
      }
      setSourceHealthRows((data || []) as SourceHealthRow[]);
    };
    void loadSourceHealth();
  }, [canModerate]);

  const sourceHealthSummary = useMemo(() => {
    const summary = {
      total: sourceHealthRows.length,
      active: 0,
      failed: 0,
      queued: 0,
      stale: 0,
      topFailures: [] as SourceHealthRow[],
    };
    const now = Date.now();
    const staleThresholdMs = 1000 * 60 * 60 * 24 * 7;
    for (const row of sourceHealthRows) {
      const status = (row.last_fetch_status || 'idle').toLowerCase();
      if (status === 'queued' || status === 'fetching' || status === 'extracting' || status === 'submitting') {
        summary.queued += 1;
      }
      if (status === 'failed' || status === 'retryable') {
        summary.failed += 1;
        if (summary.topFailures.length < 3) {
          summary.topFailures.push(row);
        }
      }
      if (status === 'succeeded') {
        summary.active += 1;
      }
      if (row.last_imported_at) {
        const importedAtMs = new Date(row.last_imported_at).getTime();
        if (Number.isFinite(importedAtMs) && now - importedAtMs > staleThresholdMs) {
          summary.stale += 1;
        }
      }
    }
    return summary;
  }, [sourceHealthRows]);

  const tools = [
    canModerate
      ? {
          to: '/admin/moderation',
          icon: Shield,
          title: 'Moderation',
          description: 'Review public-facing activity moderation, overrides, and queue state.',
        }
      : null,
    canModerate
      ? {
          to: '/admin/moderation/settings',
          icon: SlidersHorizontal,
          title: 'Moderation settings',
          description: 'Adjust strictness, trust thresholds, and moderation rules at runtime.',
        }
      : null,
    canModerate
      ? {
          to: '/admin/gallery',
          icon: Image,
          title: 'Gallery review',
          description: 'Review public-preview gallery images, reports, and image moderation state.',
        }
      : null,
    canReviewFeedback
      ? {
          to: '/admin/feedback',
          icon: MessageSquare,
          title: 'Feedback',
          description: 'Review internal feedback submissions, blocked items, failed Trello syncs, and retries.',
        }
      : null,
    canModerate
      ? {
          to: '/admin/imported-listings',
          icon: Upload,
          title: 'Imported listings',
          description: 'Create community sources, parse snapshots into drafts, review, and publish imported events.',
        }
      : null,
    canModerate
      ? {
          to: '/admin/beta-features',
          icon: FlaskConical,
          title: 'Beta features',
          description: 'Enable feature rollouts per user and manage testing overrides like WhatsApp numbers.',
        }
      : null,
  ].filter(Boolean) as Array<{
    to: string;
    icon: typeof Shield;
    title: string;
    description: string;
  }>;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Admin</h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Hidden admin tooling</span>
          </div>
          <div className="w-9" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-6 space-y-5">
        <section className="bg-white rounded-2xl p-5">
          <p className="text-sm font-bold text-slate-900">Admin hub</p>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            Use this page as the single entry point for hidden admin tools. Any new `/admin/*` feature should be linked from here.
          </p>
        </section>

        {canModerate ? (
          <section className="bg-white rounded-2xl p-5 border border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">Imported listing source health</p>
              <Link
                to="/admin/imported-listings"
                className="text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                Open imported listings
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Total</p>
                <p className="text-lg font-bold text-slate-900">{sourceHealthSummary.total}</p>
              </div>
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-blue-700">Queued</p>
                <p className="text-lg font-bold text-blue-900">{sourceHealthSummary.queued}</p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-rose-700">Failing</p>
                <p className="text-lg font-bold text-rose-900">{sourceHealthSummary.failed}</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-amber-700">Stale 7d</p>
                <p className="text-lg font-bold text-amber-900">{sourceHealthSummary.stale}</p>
              </div>
            </div>
            {sourceHealthError ? <p className="mt-3 text-xs text-rose-600">{sourceHealthError}</p> : null}
            {sourceHealthSummary.topFailures.length > 0 ? (
              <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 p-3">
                <p className="text-xs font-semibold text-rose-800">Top failing sources</p>
                <div className="mt-2 space-y-1">
                  {sourceHealthSummary.topFailures.map((row) => (
                    <p key={row.id} className="text-xs text-rose-700">
                      {row.name}: {row.last_fetch_error || row.last_fetch_status || 'Unknown error'}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.to}
                to={tool.to}
                className="bg-white rounded-2xl p-5 hover:bg-slate-50 transition-colors border border-slate-100"
              >
                <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-slate-600" />
                </div>
                <p className="text-base font-bold text-slate-900 mt-4">{tool.title}</p>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">{tool.description}</p>
              </Link>
            );
          })}
        </section>
      </main>
    </div>
  );
}
