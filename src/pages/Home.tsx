import { FormEvent, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Search, UserCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../supabase';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { mapJoinedBookingsToEvents, pickNextUpcomingActivity } from '../lib/activityRelations';
import { buildEventPath } from '../lib/events';
import { Event } from '../types';
import { formatDate } from '../utils';

type JoinedRow = {
  status: string;
  events: Event;
  guest_name: string;
};

export default function Home({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [nextActivity, setNextActivity] = useState<Event | null>(null);
  const [nextActivityState, setNextActivityState] = useState<string | null>(null);
  const [loadingNext, setLoadingNext] = useState(!!user);

  useEffect(() => {
    if (!user) {
      setNextActivity(null);
      setNextActivityState(null);
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
        const next = pickNextUpcomingActivity(groups);
        setNextActivity(next);
        setNextActivityState(
          next
            ? groups.find((group) => group.events.some((event) => event.id === next.id))?.state || null
            : null,
        );
      } catch (error) {
        console.error('Could not load home activity summary:', error);
        setNextActivity(null);
        setNextActivityState(null);
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

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    navigate(query ? `/explore?q=${encodeURIComponent(query)}` : '/explore');
  };

  const handleJoinByCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = joinCode.trim().toUpperCase();

    if (!normalizedCode) {
      setJoinError('Enter a code to continue.');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    setJoinLoading(true);
    setJoinError(null);

    try {
      const { data, error } = await supabase.rpc('share_event_by_join_code', {
        p_join_code: normalizedCode,
      });

      if (error) throw error;
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('No activity was found for that code.');
      }

      const sharedEvent = data[0] as Event;
      setJoinCode('');
      navigate(buildEventPath(sharedEvent));
    } catch (joinCodeError) {
      setJoinError(joinCodeError instanceof Error ? joinCodeError.message : 'Could not open that activity.');
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-2xl px-6 pb-10 pt-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <header className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="ui-eyebrow">I&apos;m In</p>
              <h1 className="text-3xl font-black tracking-tight text-slate-900">Home</h1>
            </div>
            <Link
              to={user ? '/profile' : '/login'}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-brand-700"
            >
              <UserCircle2 className="h-5 w-5" />
            </Link>
          </header>

          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search activities"
              className="ui-input rounded-2xl border-slate-200 bg-white py-4 pl-12 pr-4 shadow-sm"
            />
          </form>

          <Card className="space-y-4">
            <div className="space-y-1">
              <p className="ui-eyebrow">My Activities</p>
              <h2 className="ui-section-title">Your next activity</h2>
            </div>

            {loadingNext ? (
              <div className="ui-muted-panel text-sm text-slate-500">Loading your activity state...</div>
            ) : !user ? (
              <div className="ui-muted-panel space-y-3">
                <p className="text-sm text-slate-600">Sign in to track what you&apos;re hosting, attending, or what has been shared with you.</p>
                <Button onClick={() => navigate('/login')}>Sign in</Button>
              </div>
            ) : nextActivity ? (
              <div className="ui-muted-panel space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-black text-slate-900">{nextActivity.title}</h3>
                    <p className="text-sm text-slate-500">{formatDate(nextActivity.starts_at, nextActivity.timezone)}</p>
                  </div>
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-brand-700">
                    {nextActivityState?.replaceAll('_', ' ') || 'Activity'}
                  </span>
                </div>
                <Button variant="secondary" onClick={() => navigate(buildEventPath(nextActivity))}>
                  Open activity
                </Button>
              </div>
            ) : (
              <div className="ui-muted-panel space-y-3">
                <p className="text-sm text-slate-600">Nothing is coming up yet. Explore activities or create one of your own.</p>
                <Button variant="secondary" onClick={() => navigate('/explore')}>
                  Explore activities
                </Button>
              </div>
            )}
          </Card>

          <Card className="space-y-4">
            <div className="space-y-1">
              <p className="ui-eyebrow">Join By Code</p>
              <h2 className="ui-section-title">Open a shared activity</h2>
              <p className="text-sm text-slate-500">Enter a code to add an activity to your shared list without joining it.</p>
            </div>

            <form onSubmit={handleJoinByCode} className="space-y-3">
              <input
                type="text"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="Enter join code"
                className="ui-input rounded-2xl border-slate-200 bg-white py-4 uppercase tracking-[0.18em]"
              />
              {joinError ? <p className="ui-feedback ui-feedback-error">{joinError}</p> : null}
              <Button type="submit" loading={joinLoading}>
                Open activity
              </Button>
            </form>
          </Card>

          <Card className="space-y-4">
            <div className="space-y-1">
              <p className="ui-eyebrow">Updates</p>
              <h2 className="ui-section-title">What&apos;s new</h2>
            </div>
            <div className="ui-muted-panel space-y-3">
              <p className="text-sm text-slate-600">App-style navigation and clearer activity states are now being added across the experience.</p>
              <div className="flex items-center gap-2 text-sm font-bold text-brand-700">
                <CalendarDays className="h-4 w-4" />
                <span>Explore, share, request, and attend with clearer separation.</span>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => navigate('/explore')}>
              Explore
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(user ? '/my-activities' : '/login')}
              trailingIcon={<ArrowRight className="h-4 w-4" />}
            >
              My Activities
            </Button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
