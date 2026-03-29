import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, RefreshCw, Send, Smartphone } from 'lucide-react';

import { canAccessWhatsAppAdminFrontend } from '../lib/admin';
import {
  clearWhatsAppHelperReauthRequired,
  enqueueWhatsAppJoin,
  enqueueWhatsAppSend,
  getWhatsAppHelperAdminStatus,
  markWhatsAppHelperReauthRequired,
} from '../lib/whatsappHelper';
import type {
  EventWhatsAppGroup,
  WhatsAppHelperAccount,
  WhatsAppJoinJob,
  WhatsAppSendJob,
} from '../types';
import { formatDate } from '../utils';

type StatusPayload = {
  helperAccount: WhatsAppHelperAccount;
  groups: EventWhatsAppGroup[];
  joinJobs: WhatsAppJoinJob[];
  sendJobs: WhatsAppSendJob[];
};

function stateBadgeClass(state: string) {
  if (state === 'online') return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
  if (state === 'connecting') return 'bg-brand-50 text-brand-700 border border-brand-100';
  if (state === 'degraded') return 'bg-amber-50 text-amber-700 border border-amber-100';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}

export default function AdminWhatsApp({ user }: { user: User | null }) {
  const [statusData, setStatusData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [joinEventId, setJoinEventId] = useState('');
  const [joinInviteUrl, setJoinInviteUrl] = useState('');
  const [sendEventId, setSendEventId] = useState('');
  const [sendLabel, setSendLabel] = useState('');

  const isAdmin = canAccessWhatsAppAdminFrontend(user?.email);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getWhatsAppHelperAdminStatus();
      setStatusData({
        helperAccount: response.helperAccount,
        groups: response.groups || [],
        joinJobs: response.joinJobs || [],
        sendJobs: response.sendJobs || [],
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load WhatsApp helper status.');
      setStatusData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    void fetchStatus();
  }, [user?.id, isAdmin]);

  const recentJoinJobs = useMemo(() => (statusData?.joinJobs || []).slice(0, 8), [statusData?.joinJobs]);
  const recentSendJobs = useMemo(() => (statusData?.sendJobs || []).slice(0, 8), [statusData?.sendJobs]);

  const handleMarkReauth = async (clear: boolean) => {
    setActionBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (clear) {
        await clearWhatsAppHelperReauthRequired();
        setMessage('Cleared re-auth required flag.');
      } else {
        await markWhatsAppHelperReauthRequired();
        setMessage('Marked helper as re-auth required.');
      }
      await fetchStatus();
    } catch (invokeError) {
      setError(invokeError instanceof Error ? invokeError.message : 'Could not update helper re-auth state.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleEnqueueJoin = async () => {
    if (!joinEventId.trim() || !joinInviteUrl.trim()) {
      setError('eventId and inviteUrl are required for join enqueue.');
      return;
    }

    setActionBusy(true);
    setError(null);
    setMessage(null);

    try {
      const result = await enqueueWhatsAppJoin({
        eventId: joinEventId.trim(),
        inviteUrl: joinInviteUrl.trim(),
      });
      setMessage(`Queued join job ${result.joinJobId}.`);
      setJoinInviteUrl('');
      await fetchStatus();
    } catch (invokeError) {
      setError(invokeError instanceof Error ? invokeError.message : 'Failed to enqueue WhatsApp join.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleEnqueueTestSend = async () => {
    if (!sendEventId.trim()) {
      setError('eventId is required for send enqueue.');
      return;
    }

    setActionBusy(true);
    setError(null);
    setMessage(null);

    try {
      const result = await enqueueWhatsAppSend({
        eventId: sendEventId.trim(),
        jobType: 'send_test',
        payload: sendLabel.trim() ? { label: sendLabel.trim() } : {},
      });
      setMessage(`Queued send job ${result.sendJobId}.`);
      await fetchStatus();
    } catch (invokeError) {
      setError(invokeError instanceof Error ? invokeError.message : 'Failed to enqueue WhatsApp send.');
    } finally {
      setActionBusy(false);
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
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/admin" className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">WhatsApp Helper</h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Hidden admin tooling</span>
          </div>
          <button
            type="button"
            onClick={() => {
              void fetchStatus();
            }}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all active:scale-95"
            aria-label="Refresh helper status"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-5">
        <section className="bg-white rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Worker health and queue controls</p>
              <p className="text-sm text-slate-500 leading-relaxed mt-1">
                Use this page to inspect helper health, enqueue invite joins, enqueue outbound test sends, and trigger manual re-auth state.
              </p>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>
          ) : null}
          {message ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">{message}</p>
          ) : null}
        </section>

        <section className="bg-white rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Primary helper</p>
              <p className="text-sm font-bold text-slate-900 mt-1">
                {statusData?.helperAccount.label || 'primary-helper'}
              </p>
            </div>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${stateBadgeClass(statusData?.helperAccount.status || 'offline')}`}>
              {statusData?.helperAccount.status || 'offline'}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Last health reason</p>
              <p className="text-sm font-bold text-slate-800">{statusData?.helperAccount.last_health_reason || 'None'}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Last checked</p>
              <p className="text-sm font-bold text-slate-800">
                {statusData?.helperAccount.last_health_checked_at
                  ? formatDate(statusData.helperAccount.last_health_checked_at)
                  : 'Not checked yet'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => {
                void handleMarkReauth(false);
              }}
              className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-sm font-bold hover:bg-amber-100 transition-all disabled:opacity-50"
            >
              Mark re-auth required
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => {
                void handleMarkReauth(true);
              }}
              className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
            >
              Clear re-auth required
            </button>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="bg-white rounded-2xl p-5 space-y-3">
            <p className="text-sm font-bold text-slate-900">Enqueue invite join</p>
            <input
              type="text"
              value={joinEventId}
              onChange={(e) => setJoinEventId(e.target.value)}
              placeholder="Event ID"
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
            />
            <input
              type="text"
              value={joinInviteUrl}
              onChange={(e) => setJoinInviteUrl(e.target.value)}
              placeholder="WhatsApp invite URL"
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
            />
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => {
                void handleEnqueueJoin();
              }}
              className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 transition-all disabled:opacity-50"
            >
              Queue join job
            </button>
          </div>

          <div className="bg-white rounded-2xl p-5 space-y-3">
            <p className="text-sm font-bold text-slate-900">Enqueue test send</p>
            <input
              type="text"
              value={sendEventId}
              onChange={(e) => setSendEventId(e.target.value)}
              placeholder="Event ID"
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
            />
            <input
              type="text"
              value={sendLabel}
              onChange={(e) => setSendLabel(e.target.value)}
              placeholder="Optional test label"
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
            />
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => {
                void handleEnqueueTestSend();
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Queue send_test job
            </button>
          </div>
        </section>

        <section className="bg-white rounded-2xl p-5 space-y-3">
          <p className="text-sm font-bold text-slate-900">Event group mappings</p>
          {(statusData?.groups || []).length === 0 ? (
            <p className="text-sm text-slate-400">No WhatsApp group mappings found yet.</p>
          ) : (
            <div className="space-y-3">
              {statusData?.groups.slice(0, 12).map((group) => (
                <div key={group.id} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <p className="text-xs text-slate-400">Event ID: {group.event_id}</p>
                  <p className="text-sm font-bold text-slate-900 mt-1">{group.group_name_exact || 'Pending join title'}</p>
                  <p className="text-xs text-slate-500 mt-1">Status: {group.join_status}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="bg-white rounded-2xl p-5 space-y-3">
            <p className="text-sm font-bold text-slate-900">Recent join jobs</p>
            {recentJoinJobs.length === 0 ? (
              <p className="text-sm text-slate-400">No join jobs yet.</p>
            ) : (
              recentJoinJobs.map((job) => (
                <div key={job.id} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <p className="text-sm font-bold text-slate-900">{job.status}</p>
                  <p className="text-xs text-slate-400 mt-1">{job.id}</p>
                  {job.last_error_code ? (
                    <p className="text-xs text-red-600 mt-1">Error: {job.last_error_code}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="bg-white rounded-2xl p-5 space-y-3">
            <p className="text-sm font-bold text-slate-900">Recent send jobs</p>
            {recentSendJobs.length === 0 ? (
              <p className="text-sm text-slate-400">No send jobs yet.</p>
            ) : (
              recentSendJobs.map((job) => (
                <div key={job.id} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <p className="text-sm font-bold text-slate-900">{job.job_type} · {job.status}</p>
                  <p className="text-xs text-slate-400 mt-1">{job.id}</p>
                  {job.last_error_code ? (
                    <p className="text-xs text-red-600 mt-1">Error: {job.last_error_code}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
