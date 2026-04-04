import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, LogOut, Share2 } from 'lucide-react';
import { supabase } from '../supabase';
import { formatDate } from '../utils';
import { Event } from '../types';
import { buildEventPath, withConfirmedCounts } from '../lib/events';
import { BookingRow, groupBookingsByEvent } from '../lib/bookings';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

type JoinedRow = BookingRow & {
  status: string;
  events: Event;
};

function ActivitySection({
  cta,
  description,
  emptyLabel,
  events,
  title,
}: {
  cta?: { label: string; to: string };
  description: string;
  emptyLabel: string;
  events: Event[];
  title: string;
}) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="ui-eyebrow">{title}</p>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        {cta ? (
          <Link to={cta.to} className="text-sm font-bold text-brand-700">
            {cta.label}
          </Link>
        ) : null}
      </div>

      {events.length === 0 ? (
        <div className="ui-muted-panel text-sm text-slate-500">{emptyLabel}</div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <Link
              key={event.id}
              to={buildEventPath(event, { preferPrivateAccess: true })}
              className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 transition-colors hover:bg-white"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-slate-900">{event.title}</h3>
                  <p className="text-sm text-slate-500">{formatDate(event.starts_at, event.timezone)}</p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 text-slate-300" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function MyActivities({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const [hosting, setHosting] = useState<Event[]>([]);
  const [attending, setAttending] = useState<Event[]>([]);
  const [requested, setRequested] = useState<Event[]>([]);
  const [shared, setShared] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [hostedResult, joinedResult, sharedResult] = await Promise.all([
          supabase.rpc('list_my_hosted_events'),
          supabase.rpc('list_my_joined_activities'),
          supabase.rpc('list_my_shared_activities'),
        ]);

        if (cancelled) return;

        const hosted = (hostedResult.data || []) as Event[];
        const joinedRows = (joinedResult.data || []) as JoinedRow[];
        const sharedRows = (sharedResult.data || []) as Event[];

        const hostedIds = hosted.map((event) => event.id);
        const { data: attendeeRows } = hostedIds.length
          ? await supabase
              .from('event_attendees')
              .select('event_id, status')
              .in('event_id', hostedIds)
              .neq('status', 'cancelled')
          : { data: [] };

        const hostedWithCounts = withConfirmedCounts(
          hosted.map((event) => ({
            ...event,
            event_attendees: ((attendeeRows || []) as Array<{ event_id: string; status: string }>)
              .filter((row) => row.event_id === event.id)
              .map((row) => ({ status: row.status })),
          })),
        );

        const requestedRows = joinedRows.filter((row) => row.status === 'pending_approval');
        const attendingRows = joinedRows.filter((row) => row.status !== 'pending_approval');

        setHosting(hostedWithCounts);
        setRequested(
          groupBookingsByEvent(requestedRows as BookingRow[]).map((row) => row.events as Event),
        );
        setAttending(
          groupBookingsByEvent(attendingRows as BookingRow[]).map((row) => row.events as Event),
        );
        setShared(sharedRows);
      } catch (error) {
        console.error('Could not load activity state:', error);
        setHosting([]);
        setRequested([]);
        setAttending([]);
        setShared([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-2xl px-6 pb-10 pt-6">
        <div className="space-y-6">
          <header className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="ui-eyebrow">My Activities</p>
              <h1 className="text-3xl font-black tracking-tight text-slate-900">Activity states</h1>
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/login', { replace: true });
              }}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-700"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </header>

          {loading ? (
            <Card className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </Card>
          ) : (
            <>
              <ActivitySection
                title="Hosting"
                description="Activities you are running."
                emptyLabel="You are not hosting anything yet."
                events={hosting}
                cta={{ label: 'Create', to: '/create-event' }}
              />
              <ActivitySection
                title="Attending"
                description="Activities you have already joined."
                emptyLabel="You are not attending anything yet."
                events={attending}
                cta={{ label: 'Explore', to: '/explore' }}
              />
              <ActivitySection
                title="Requested"
                description="Requests waiting on host approval."
                emptyLabel="No pending requests right now."
                events={requested}
              />
              <ActivitySection
                title="Shared with you"
                description="Activities opened by link or join code."
                emptyLabel="Nothing has been shared with you yet."
                events={shared}
              />

              <Card className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-brand-700">
                  <Share2 className="h-4 w-4" />
                  <span>Access does not join you automatically.</span>
                </div>
                <p className="text-sm text-slate-500">
                  Shared activities stay separate until you explicitly request or join them.
                </p>
                <Button variant="secondary" onClick={() => navigate('/explore')}>
                  Explore more
                </Button>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
