import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  buildGoogleCalendarShortcutTarget,
  buildIcsDownload,
  buildPrivateActivityUrl,
  type EventShortcutKind,
} from '../lib/eventShare';
import { fetchEventForView } from '../lib/eventLookup';

type ShortcutState = {
  title: string;
  message: string;
  activityUrl?: string;
  downloadUrl?: string;
  downloadFilename?: string;
};

const copyByKind: Record<EventShortcutKind, { loading: string; missing: string; success: string }> = {
  loc: {
    loading: 'Opening location...',
    missing: 'Map link unavailable',
    success: 'Opening location...',
  },
  gcal: {
    loading: 'Opening Google Calendar...',
    missing: 'Activity unavailable',
    success: 'Opening Google Calendar...',
  },
  ical: {
    loading: 'Preparing calendar file...',
    missing: 'Activity unavailable',
    success: 'Apple Calendar download started',
  },
};

export default function EventShortLinkPage({ kind }: { kind: EventShortcutKind }) {
  const { code } = useParams();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ShortcutState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextDownloadUrl: string | null = null;

    const run = async () => {
      if (!code) {
        setState({
          title: 'Activity link is incomplete',
          message: 'This shortcut is missing its activity code.',
        });
        setLoading(false);
        return;
      }

      setLoading(true);
      setState(null);

      try {
        const event = await fetchEventForView(code);
        if (!event) {
          setState({
            title: copyByKind[kind].missing,
            message: 'No activity was found for that shortcut.',
          });
          setLoading(false);
          return;
        }

        const activityUrl = buildPrivateActivityUrl(window.location.origin, event);

        if (kind === 'loc') {
          const mapsUrl = event.google_maps_url?.trim();
          if (mapsUrl) {
            window.location.replace(mapsUrl);
            return;
          }

          setState({
            title: 'Map link unavailable',
            message: event.location_text?.trim()
              ? `Exact location: ${event.location_text.trim()}`
              : 'This activity does not have a Google Maps link or exact location saved.',
            activityUrl,
          });
          setLoading(false);
          return;
        }

        if (kind === 'gcal') {
          window.location.replace(buildGoogleCalendarShortcutTarget(window.location.origin, event));
          return;
        }

        const { content, filename } = buildIcsDownload(window.location.origin, event);
        nextDownloadUrl = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));

        const link = document.createElement('a');
        link.href = nextDownloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (cancelled) {
          return;
        }

        setState({
          title: copyByKind[kind].success,
          message: 'If the download did not begin automatically, use the button below to try again.',
          activityUrl,
          downloadUrl: nextDownloadUrl,
          downloadFilename: filename,
        });
        setLoading(false);
      } catch (error) {
        console.error(error);
        if (cancelled) {
          return;
        }
        setState({
          title: copyByKind[kind].missing,
          message: 'This shortcut could not be opened right now.',
        });
        setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (nextDownloadUrl) {
        URL.revokeObjectURL(nextDownloadUrl);
      }
    };
  }, [code, kind]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-100 bg-white p-8 shadow-xl shadow-slate-200/60">
        {loading ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
            <div className="space-y-2">
              <h1 className="text-xl font-black tracking-tight text-slate-900">{copyByKind[kind].loading}</h1>
              <p className="text-sm font-medium text-slate-500">Please wait a moment.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5 text-center">
            <div className="space-y-2">
              <h1 className="text-xl font-black tracking-tight text-slate-900">{state?.title}</h1>
              <p className="text-sm font-medium leading-6 text-slate-500">{state?.message}</p>
            </div>

            {state?.downloadUrl ? (
              <a
                href={state.downloadUrl}
                download={state.downloadFilename}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-brand-600 px-5 py-4 text-sm font-black text-white transition-all active:scale-95 hover:bg-brand-500"
              >
                Download .ics Again
              </a>
            ) : null}

            {state?.activityUrl ? (
              <a
                href={state.activityUrl}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-50 px-5 py-4 text-sm font-black text-slate-700 transition-all active:scale-95 hover:bg-slate-100"
              >
                Open Activity
              </a>
            ) : null}

            <Link
              to="/"
              className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 px-5 py-4 text-sm font-black text-slate-600 transition-all active:scale-95 hover:bg-slate-50"
            >
              Go Home
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
