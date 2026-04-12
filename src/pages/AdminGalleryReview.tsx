import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { GalleryAdminItem } from '../types';
import { canAccessModerationAdminFrontend } from '../lib/admin';
import { invokeAuthedFunction } from '../lib/functions';

type QueueFilter = 'needs_review' | 'reported' | 'all';

export default function AdminGalleryReview({ user }: { user: User | null }) {
  const [items, setItems] = useState<GalleryAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionImageId, setActionImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('needs_review');

  const isAdmin = canAccessModerationAdminFrontend(user?.email);

  const loadQueue = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await invokeAuthedFunction<{ items: GalleryAdminItem[] }>('gallery-admin', { list: true });
      setItems(response.items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load gallery moderation queue.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    void loadQueue();
  }, [user?.id, isAdmin]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'reported') {
      return items.filter((item) => item.public_visibility_status === 'report_hidden' || (item.report_count || 0) > 0);
    }
    return items.filter((item) => item.public_visibility_status !== 'report_hidden');
  }, [filter, items]);

  const applyAction = async (imageId: string, action: 'approve' | 'block' | 'mark_private' | 'delete') => {
    setActionImageId(imageId);
    setError(null);
    try {
      await invokeAuthedFunction('gallery-admin', {
        imageId,
        action,
      });
      await loadQueue();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Gallery action failed.');
    } finally {
      setActionImageId(null);
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/admin" className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Gallery Review</h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Moderate image previews</span>
          </div>
          <button
            type="button"
            onClick={() => { void loadQueue(); }}
            className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95"
            disabled={loading}
          >
            <RefreshCw className={`w-5 h-5 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-4">
        <section className="bg-white rounded-2xl p-4 flex flex-wrap gap-2">
          {([
            { key: 'needs_review', label: 'Needs review' },
            { key: 'reported', label: 'Reported' },
            { key: 'all', label: 'All' },
          ] as Array<{ key: QueueFilter; label: string }>).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                filter === option.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </section>

        {error ? (
          <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : null}

        {loading ? (
          <section className="bg-white rounded-2xl p-6 text-sm text-slate-500">Loading gallery queue...</section>
        ) : filteredItems.length === 0 ? (
          <section className="bg-white rounded-2xl p-6 text-sm text-slate-500">No gallery images need review.</section>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <article key={item.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                {item.signed_url ? (
                  <img src={item.signed_url} alt={item.original_file_name || 'Gallery image'} className="w-full h-48 object-cover" />
                ) : (
                  <div className="w-full h-48 bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                    Preview unavailable
                  </div>
                )}
                <div className="p-4 space-y-2">
                  <p className="text-sm font-bold text-slate-800">
                    {item.event?.title || 'Untitled activity'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Status: <span className="font-semibold">{item.public_visibility_status}</span>
                    {item.report_count ? ` • reports: ${item.report_count}` : ''}
                  </p>
                  <p className="text-xs text-slate-400 break-all">/{item.event?.slug || 'unknown'}</p>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { void applyAction(item.id, 'approve'); }}
                      disabled={actionImageId === item.id}
                      className="rounded-lg bg-brand-600 text-white text-xs font-semibold px-2 py-2 hover:bg-brand-500 disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => { void applyAction(item.id, 'block'); }}
                      disabled={actionImageId === item.id}
                      className="rounded-lg bg-slate-800 text-white text-xs font-semibold px-2 py-2 hover:bg-slate-700 disabled:opacity-60"
                    >
                      Block
                    </button>
                    <button
                      type="button"
                      onClick={() => { void applyAction(item.id, 'mark_private'); }}
                      disabled={actionImageId === item.id}
                      className="rounded-lg border border-slate-200 text-xs font-semibold px-2 py-2 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Private only
                    </button>
                    <button
                      type="button"
                      onClick={() => { void applyAction(item.id, 'delete'); }}
                      disabled={actionImageId === item.id}
                      className="rounded-lg border border-red-100 bg-red-50 text-red-700 text-xs font-semibold px-2 py-2 hover:bg-red-100 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
