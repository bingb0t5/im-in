import { FormEvent, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../supabase';
import { Card } from '../components/ui/Card';
import { HomeCommunitySection } from '../components/HomeCommunitySection';
import { mapJoinedBookingsToEvents, pickUpcomingActivities } from '../lib/activityRelations';
import { buildEventPath } from '../lib/events';
import { Event } from '../types';
import { formatDate } from '../utils';

type JoinedRow = {
  status: string;
  events: Event;
  guest_name: string;
};

type UpcomingActivity = {
  event: Event;
  state: string | null;
};

function formatActivityStateLabel(state: string | null) {
  if (!state) return '';
  if (state === 'SHARED_WITH_USER') return 'Shared with me';
  return state.replaceAll('_', ' ');
}

function pathForHomeUpcomingRow(event: Event, state: string | null) {
  if (state === 'HOSTING') {
    return `/host/events/${event.id}`;
  }
  return buildEventPath(event, {
    preferPrivateAccess: state === 'SHARED_WITH_USER' || state === 'ATTENDING',
  });
}

export default function Home({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const topSpacingClass = user ? 'pt-2.5' : 'pt-16';
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [upcomingActivities, setUpcomingActivities] = useState<UpcomingActivity[]>([]);
  const [loadingNext, setLoadingNext] = useState(!!user);

  useEffect(() => {
    if (!user) {
      setUpcomingActivities([]);
      setLoadingNext(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoadingNext(true);
      try {
        const [hostedResult, joinedResult, sharedResult] = await Promise.all([
          supabase.rpc('list_my_hosted_events'),
          supabase.rpc('list_my_joined_activities'),
          supabase.rpc('list_my_shared_activities'),
        ]);

        if (cancelled) return;

        const hosted = (hostedResult.data || []) as Event[];
        const joined = mapJoinedBookingsToEvents(
          ((joinedResult.data || []) as JoinedRow[]).filter((row) => row.status !== 'pending_approval'),
        );
        const shared = (sharedResult.data || []) as Event[];

        const groups = [
          { state: 'HOSTING' as const, events: hosted },
          { state: 'ATTENDING' as const, events: joined },
          { state: 'SHARED_WITH_USER' as const, events: shared },
        ];
        const upcoming = pickUpcomingActivities(groups, 3);
        setUpcomingActivities(
          upcoming.map((event) => ({
            event,
            state: groups.find((group) => group.events.some((item) => item.id === event.id))?.state || null,
          })),
        );
      } catch (error) {
        console.error('Could not load home activity summary:', error);
        setUpcomingActivities([]);
      } finally {
        if (!cancelled) {
          setLoadingNext(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleJoinByCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = joinCode.trim();

    if (!normalizedCode) {
      setJoinError('Enter a code to continue.');
      return;
    }

    setJoinLoading(true);
    setJoinError(null);

    try {
      if (user) {
        const { data, error } = await supabase.rpc('share_event_by_join_code', {
          p_join_code: normalizedCode,
        });

        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('No activity was found for that code.');
        }

        const sharedEvent = data[0] as Event;
        setJoinCode('');
        navigate(buildEventPath(sharedEvent, { preferPrivateAccess: true }));
        return;
      }

      const { data, error } = await supabase.rpc('get_event_for_view', {
        p_slug: normalizedCode,
        p_access_code: null,
      });

      if (error) throw error;
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('No activity was found for that code.');
      }

      const openedEvent = data[0] as Event;
      setJoinCode('');
      navigate(buildEventPath(openedEvent, { preferPrivateAccess: true }));
    } catch (joinCodeError) {
      setJoinError(joinCodeError instanceof Error ? joinCodeError.message : 'Could not open that activity.');
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <div className="bg-slate-50">
      <main className={`mx-auto max-w-2xl px-6 pb-2 ${topSpacingClass}`}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {user ? (
            <Card className="space-y-2 pt-3">
              <h2 className="ui-section-title">Upcoming activities</h2>

              {loadingNext ? (
                <div className="ui-muted-panel text-sm text-slate-500">Loading your upcoming activities...</div>
              ) : upcomingActivities.length > 0 ? (
                <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-slate-50 px-3">
                  {upcomingActivities.map(({ event, state }, index) => (
                    <Link
                      key={event.id}
                      to={pathForHomeUpcomingRow(event, state)}
                      className={`block rounded-xl py-1.5 transition-colors hover:bg-white ${index === 0 ? 'pt-1.5' : ''}`}
                    >
                      <h3 className="truncate text-base font-black text-slate-900">{event.title}</h3>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm text-slate-500">{formatDate(event.starts_at, event.timezone)}</p>
                        <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                      </div>
                      {state ? (
                        <p className="mt-0 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
                          {formatActivityStateLabel(state)}
                        </p>
                      ) : null}
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="ui-muted-panel space-y-3">
                  <p className="text-sm text-slate-600">Nothing is coming up yet. Explore activities or create one of your own.</p>
                  <button
                    type="button"
                    onClick={() => navigate('/explore')}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-all hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                  >
                    Explore activities
                  </button>
                </div>
              )}
            </Card>
          ) : null}

          <Card className="space-y-3 pt-4">
            <div className="space-y-0.5">
              <h2 className="ui-section-title">Received a join code?</h2>
              <p className="text-xs text-slate-500">Enter your code below to view the activity.</p>
            </div>

            <form onSubmit={handleJoinByCode} className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="Enter join code"
                  className="ui-input rounded-2xl border-slate-200 bg-white py-2 tracking-[0.12em]"
                />
                <button
                  type="submit"
                  disabled={joinLoading}
                  aria-label="Open activity"
                  className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-brand-600 bg-gradient-to-br from-teal-300 via-brand-500 to-teal-700 text-white shadow-[0_8px_18px_rgba(13,148,136,0.32)] ring-1 ring-white/70 transition-all hover:brightness-105 disabled:opacity-60"
                >
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-white/10 to-transparent" />
                  {joinLoading ? <Loader2 className="relative h-4 w-4 animate-spin" /> : <ArrowRight className="relative h-4 w-4" />}
                </button>
              </div>
              {joinError ? <p className="ui-feedback ui-feedback-error">{joinError}</p> : null}
            </form>
          </Card>

          <HomeCommunitySection user={user} />
        </motion.div>
      </main>

    </div>
  );
}
