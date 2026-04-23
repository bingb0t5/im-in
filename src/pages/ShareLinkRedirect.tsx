import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { captureProductEvent } from '../lib/productAnalytics';
import { openShareLink } from '../lib/shareLinks';

type RedirectState = {
  title: string;
  message: string;
};

export default function ShareLinkRedirect() {
  const { token } = useParams();
  const [state, setState] = useState<RedirectState>({
    title: 'Opening activity...',
    message: 'Please wait a moment.',
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!token) {
        setState({
          title: 'Link is incomplete',
          message: 'This share link is missing its token.',
        });
        return;
      }

      try {
        const link = await openShareLink(token);
        if (!link) {
          setState({
            title: 'Link unavailable',
            message: 'This share link could not be found.',
          });
          return;
        }

        captureProductEvent('link_opened', {
          activity_id: link.event_id,
          link_id: link.link_id,
          source: link.source || 'share_link',
          share_channel: link.share_channel || undefined,
          visibility_type: link.access_type,
          page: '/s/:token',
        });

        if (!cancelled) {
          window.location.replace(`/events/${link.target_slug}`);
        }
      } catch {
        if (cancelled) {
          return;
        }

        setState({
          title: 'Link unavailable',
          message: 'This share link could not be opened right now.',
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-100 bg-white p-8 shadow-xl shadow-slate-200/60">
        <div className="space-y-4 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
          <div className="space-y-2">
            <h1 className="text-xl font-black tracking-tight text-slate-900">{state.title}</h1>
            <p className="text-sm font-medium text-slate-500">{state.message}</p>
          </div>
          <Link
            to="/"
            className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 px-5 py-4 text-sm font-black text-slate-600 transition-all active:scale-95 hover:bg-slate-50"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
