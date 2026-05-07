import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, FlaskConical, RefreshCw, Save, Search } from 'lucide-react';
import { canAccessModerationAdminFrontend } from '../lib/admin';
import { invokeAuthedFunction } from '../lib/functions';

type BetaRow = {
  id: string;
  user_id: string;
  feature_key: string;
  enabled: boolean;
  whatsapp_test_number: string | null;
  notes: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  whatsapp_number: string | null;
  whatsapp_verified_at: string | null;
  auth_provider: string | null;
};

type SearchResultRow = {
  profile: ProfileRow;
  authIdentity?: {
    email: string | null;
    whatsapp_number: string | null;
    whatsapp_verified_at: string | null;
    lalo_user_id: string | null;
  } | null;
  beta: BetaRow | null;
};

const FEATURE_KEY = 'host_whatsapp_messaging';

export default function AdminBetaFeatures({ user }: { user: User | null }) {
  const isAdmin = canAccessModerationAdminFrontend(user?.email);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<SearchResultRow[]>([]);
  const [draftByUserId, setDraftByUserId] = useState<Record<string, { enabled: boolean; whatsappTestNumber: string; notes: string }>>(
    {},
  );

  const getBestWhatsappNumber = (row: SearchResultRow) => row.profile.whatsapp_number || row.authIdentity?.whatsapp_number || '';
  const getBestWhatsappVerifiedAt = (row: SearchResultRow) => row.profile.whatsapp_verified_at || row.authIdentity?.whatsapp_verified_at || null;

  const rowsWithUserId = useMemo(
    () => rows.filter((row) => typeof row.profile.user_id === 'string' && row.profile.user_id.trim().length > 0),
    [rows],
  );

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const hydrateDraft = (incoming: SearchResultRow[]) => {
    const nextDraft: Record<string, { enabled: boolean; whatsappTestNumber: string; notes: string }> = {};
    for (const row of incoming) {
      const userId = (row.profile.user_id || '').trim();
      if (!userId) continue;
      nextDraft[userId] = {
        enabled: row.beta?.enabled === true,
        whatsappTestNumber: row.beta?.whatsapp_test_number || getBestWhatsappNumber(row),
        notes: row.beta?.notes || '',
      };
    }
    setDraftByUserId(nextDraft);
  };

  const runSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError('Enter an email, WhatsApp number, user id, or host name to search.');
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await invokeAuthedFunction<{ items: SearchResultRow[] }>('beta-feature-admin', {
        action: 'lookup',
        feature_key: FEATURE_KEY,
        query: trimmed,
      });
      setRows(response.items || []);
      hydrateDraft(response.items || []);
      if ((response.items || []).length === 0) {
        setMessage('No matching profiles found.');
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Failed to search beta users.');
      setRows([]);
      setDraftByUserId({});
    } finally {
      setLoading(false);
    }
  };

  const updateDraft = (userId: string, patch: Partial<{ enabled: boolean; whatsappTestNumber: string; notes: string }>) => {
    setDraftByUserId((previous) => ({
      ...previous,
      [userId]: {
        enabled: previous[userId]?.enabled === true,
        whatsappTestNumber: previous[userId]?.whatsappTestNumber || '',
        notes: previous[userId]?.notes || '',
        ...patch,
      },
    }));
  };

  const saveRow = async (row: SearchResultRow) => {
    const userId = (row.profile.user_id || '').trim();
    if (!userId) {
      setError('This profile has no user_id and cannot be enabled for beta.');
      return;
    }
    const draft = draftByUserId[userId] || {
      enabled: false,
      whatsappTestNumber: '',
      notes: '',
    };

    setSavingUserId(userId);
    setError(null);
    setMessage(null);
    try {
      await invokeAuthedFunction<{ row: BetaRow }>('beta-feature-admin', {
        action: 'upsert',
        feature_key: FEATURE_KEY,
        user_id: userId,
        enabled: draft.enabled,
        whatsapp_test_number: draft.whatsappTestNumber || null,
        notes: draft.notes || null,
      });
      setMessage(`Saved beta settings for ${row.profile.email || userId}.`);
      await runSearch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save beta settings.');
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/admin" className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Beta Features</h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Host rollout controls</span>
          </div>
          <div className="w-9" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-5">
        <section className="bg-white rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Host WhatsApp messaging beta</p>
              <p className="text-sm text-slate-500">Enable or disable the platform-backed Host Dashboard messaging flow per host.</p>
            </div>
          </div>

          <form onSubmit={runSearch} className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by email, WhatsApp number, user id, or host name"
                className="w-full rounded-2xl border border-slate-200 bg-white px-10 py-3 text-sm font-medium text-slate-800 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </form>
        </section>

        {error ? <section className="bg-red-50 text-red-700 rounded-2xl p-4 text-sm font-medium">{error}</section> : null}
        {message ? <section className="bg-brand-50 text-brand-700 rounded-2xl p-4 text-sm font-medium">{message}</section> : null}

        <section className="space-y-3">
          {rowsWithUserId.map((row) => {
            const userId = row.profile.user_id as string;
            const draft = draftByUserId[userId] || { enabled: false, whatsappTestNumber: '', notes: '' };
            const saving = savingUserId === userId;
            const bestWhatsappNumber = getBestWhatsappNumber(row);
            const bestWhatsappVerifiedAt = getBestWhatsappVerifiedAt(row);
            return (
              <article key={`${row.profile.id}-${userId}`} className="bg-white rounded-2xl p-5 border border-slate-100 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-900">{row.profile.full_name || row.profile.email || userId}</p>
                    <p className="text-xs text-slate-500 break-all">user_id: {userId}</p>
                    <p className="text-xs text-slate-500 break-all">email: {row.profile.email || 'No email on profile'}</p>
                    <p className="text-xs text-slate-500 break-all">
                      WhatsApp: {bestWhatsappNumber || 'No WhatsApp number found'}
                      {bestWhatsappVerifiedAt ? ' · verified' : ''}
                      {!row.profile.whatsapp_number && row.authIdentity?.whatsapp_number ? ' · from login identity' : ''}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                      draft.enabled ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {draft.enabled ? 'Beta enabled' : 'Beta disabled'}
                  </span>
                </div>

                <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-800">Enable host WhatsApp messaging beta</span>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => updateDraft(userId, { enabled: event.target.checked })}
                    className="h-4 w-4 accent-brand-600"
                  />
                </label>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-500">WhatsApp test number (E.164)</label>
                  <input
                    value={draft.whatsappTestNumber}
                    onChange={(event) => updateDraft(userId, { whatsappTestNumber: event.target.value })}
                    placeholder="+64270000000"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Notes</label>
                  <textarea
                    value={draft.notes}
                    onChange={(event) => updateDraft(userId, { notes: event.target.value })}
                    rows={2}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                    placeholder="Optional rollout notes"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      void saveRow(row);
                    }}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save beta settings
                  </button>
                </div>
              </article>
            );
          })}

          {!loading && rows.length > 0 && rowsWithUserId.length === 0 ? (
            <div className="bg-amber-50 text-amber-700 rounded-2xl p-4 text-sm font-medium">
              Matching profiles were found, but none are attached to an auth user yet.
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
