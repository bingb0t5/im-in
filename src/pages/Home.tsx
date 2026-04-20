import { FormEvent, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../supabase';
import { Card } from '../components/ui/Card';
import { HomeCommunitySection } from '../components/HomeCommunitySection';
import { isLaloWhatsAppAuthEnabled } from '../integrations/lalo/laloAuth';
import { mapJoinedBookingsToEvents, pickUpcomingActivities } from '../lib/activityRelations';
import { groupBookingsByEvent, type GroupedBooking } from '../lib/bookings';
import { fetchEventForView } from '../lib/eventLookup';
import { buildEventPath } from '../lib/events';
import { getProfileDisplayName, guestService, isSystemGuestEmail } from '../services/guestService';
import { Event } from '../types';
import { formatDate, isOnOrAfterTodayInTimeZone } from '../utils';

type JoinedRow = {
  status: string;
  events: Event;
  guest_name: string;
};

type UpcomingActivity = {
  event: Event;
  state: string | null;
};

function formatGuestUpcomingLabel(status: string) {
  if (status === 'thinking') return 'Thinking about it';
  if (status === 'pending_approval') return 'Pending approval';
  if (status === 'waitlist') return 'Waitlist';
  return 'Saved on this device';
}

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
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [upcomingActivities, setUpcomingActivities] = useState<UpcomingActivity[]>([]);
  const [loadingNext, setLoadingNext] = useState(!!user);
  const [rememberedGuestName, setRememberedGuestName] = useState('');
  const [rememberedGuestHasRecoveryEmail, setRememberedGuestHasRecoveryEmail] = useState(false);
  const [rememberedGuestUpcoming, setRememberedGuestUpcoming] = useState<GroupedBooking[]>([]);
  const [loadingRememberedGuest, setLoadingRememberedGuest] = useState(!user);
  const hasRememberedGuestState = !user && (loadingRememberedGuest || !!rememberedGuestName);
  const topSpacingClass = user ? 'pt-2' : hasRememberedGuestState ? 'pt-4' : 'pt-8';
  const guestPrimaryCtaLabel = isLaloWhatsAppAuthEnabled() ? 'Continue with WhatsApp' : 'Sign in to keep this';

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

  useEffect(() => {
    if (user) {
      setRememberedGuestName('');
      setRememberedGuestHasRecoveryEmail(false);
      setRememberedGuestUpcoming([]);
      setLoadingRememberedGuest(false);
      return;
    }

    let cancelled = false;

    const loadRememberedGuest = async () => {
      setLoadingRememberedGuest(true);
      try {
        const session = await guestService.getStoredGuestSession();
        if (cancelled) return;

        if (!session) {
          setRememberedGuestName('');
          setRememberedGuestHasRecoveryEmail(false);
          setRememberedGuestUpcoming([]);
          return;
        }

        setRememberedGuestName(getProfileDisplayName(session.profile).trim() || 'Guest account on this device');
        setRememberedGuestHasRecoveryEmail(!!session.profile.email && !isSystemGuestEmail(session.profile.email));

        const [bookingRows, interestRows] = await Promise.all([
          guestService.getMyBookings(session.token),
          guestService.getMyInterests(session.token),
        ]);
        if (cancelled) return;

        const upcoming = groupBookingsByEvent([...(bookingRows || []), ...(interestRows || [])])
          .filter((booking) => isOnOrAfterTodayInTimeZone(booking.events.starts_at, booking.events.timezone))
          .sort((a, b) => new Date(a.events.starts_at).getTime() - new Date(b.events.starts_at).getTime())
          .slice(0, 3);

        setRememberedGuestUpcoming(upcoming);
      } catch (error) {
        console.error('Could not load remembered guest summary:', error);
        if (!cancelled) {
          setRememberedGuestName('');
          setRememberedGuestHasRecoveryEmail(false);
          setRememberedGuestUpcoming([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingRememberedGuest(false);
        }
      }
    };

    void loadRememberedGuest();

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
      const eventForView = await fetchEventForView(normalizedCode, null);
      if (!eventForView) {
        throw new Error('No activity was found for that code.');
      }

      setJoinCode('');
      navigate(buildEventPath(eventForView, { preferPrivateAccess: true }));
    } catch (joinCodeError) {
      setJoinError(joinCodeError instanceof Error ? joinCodeError.message : 'Could not open that activity.');
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <div className="bg-slate-50">
      <main className={`mx-auto max-w-2xl px-6 pb-2 ${topSpacingClass}`}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
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
          ) : rememberedGuestName || loadingRememberedGuest ? (
            <>
              <Card className="space-y-2 pt-3">
                <h2 className="ui-section-title">Upcoming activities</h2>

                {loadingRememberedGuest ? (
                  <div className="ui-muted-panel text-sm text-slate-500">Loading activities saved on this device...</div>
                ) : rememberedGuestUpcoming.length > 0 ? (
                  <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-slate-50 px-3">
                    {rememberedGuestUpcoming.map((booking, index) => (
                      <Link
                        key={booking.events.id}
                        to={buildEventPath(booking.events as Event, { preferPrivateAccess: true })}
                        className={`block rounded-xl py-1.5 transition-colors hover:bg-white ${index === 0 ? 'pt-1.5' : ''}`}
                      >
                        <h3 className="truncate text-base font-black text-slate-900">{booking.events.title}</h3>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <p className="truncate text-sm text-slate-500">{formatDate(booking.events.starts_at, booking.events.timezone)}</p>
                          <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                        </div>
                        <p className="mt-0 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
                          {formatGuestUpcomingLabel(booking.status)}
                        </p>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="ui-muted-panel space-y-2">
                    <p className="text-sm text-slate-600">No upcoming guest activities are saved on this device right now.</p>
                    <button
                      type="button"
                      onClick={() => navigate('/bookings')}
                      className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-all hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                    >
                      Open guest activities
                    </button>
                  </div>
                )}
              </Card>

              <Card className="space-y-3 pt-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="ui-eyebrow">Guest account on this device</p>
                    <h2 className="truncate text-lg font-black tracking-tight text-slate-900">
                      {loadingRememberedGuest ? 'Checking this device...' : rememberedGuestName}
                    </h2>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Remembered on this device. Sign in to keep it across devices.
                    </p>
                  </div>
                  {!loadingRememberedGuest ? (
                    <span className="shrink-0 rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">
                      {rememberedGuestHasRecoveryEmail ? 'Email backup' : 'Local only'}
                    </span>
                  ) : null}
                </div>

                {!loadingRememberedGuest ? (
                  <p className="text-xs text-slate-500">
                    WhatsApp is the main sign-in path. Email stays available as a backup for recovery.
                  </p>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/bookings')}
                    className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition-all hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 active:scale-[0.99]"
                  >
                    View guest activities
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/login?from=%2F')}
                    className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-brand-600 px-3 text-xs font-black text-white transition-all hover:bg-brand-500 active:scale-[0.99]"
                  >
                    {guestPrimaryCtaLabel}
                  </button>
                </div>
              </Card>
            </>
          ) : null}

          <Card className="space-y-2.5 pt-3.5">
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

          {!user ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => navigate('/create-event')}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-brand-600 px-3 text-sm font-black text-white transition-all hover:bg-brand-500 active:scale-[0.99]"
              >
                Create activity
              </button>
              <button
                type="button"
                onClick={() => navigate('/explore')}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition-all hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 active:scale-[0.99]"
              >
                Explore activities
              </button>
            </div>
          ) : null}

          <HomeCommunitySection user={user} />
        </motion.div>
      </main>

    </div>
  );
}
