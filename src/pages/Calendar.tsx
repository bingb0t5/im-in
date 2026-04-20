import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Calendar as CalendarIcon, MapPin, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { formatDay, formatTime, isEventActiveOrUpcoming } from '../utils';
import { Event } from '../types';
import { buildEventPath } from '../lib/events';
import { User } from '@supabase/supabase-js';
import { BookingRow, groupBookingsByEvent } from '../lib/bookings';
import { filterEventsForQuery } from '../lib/activityRelations';
import { hydrateMissingEventCounts } from '../lib/activityCounts';
import { Card } from '../components/ui/Card';

type CalendarGroup = {
  key: string;
  label: string;
  events: Event[];
};

function getStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDayDifference(from: Date, to: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((getStartOfDay(to).getTime() - getStartOfDay(from).getTime()) / millisecondsPerDay);
}

function getWeekdayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
}

function upcomingOnly(events: Event[]) {
  return events.filter((event) => isEventActiveOrUpcoming(event));
}

function groupCalendarEvents(events: Event[]) {
  const now = new Date();
  const groups: CalendarGroup[] = [];
  const weekdayGroups = new Map<string, CalendarGroup>();
  let laterGroup: CalendarGroup | null = null;

  events.forEach((event) => {
    const eventDate = new Date(event.starts_at);
    const dayDifference = getDayDifference(now, eventDate);

    if (dayDifference <= 0) {
      let todayGroup = groups.find((group) => group.key === 'today');
      if (!todayGroup) {
        todayGroup = { key: 'today', label: 'Today', events: [] };
        groups.push(todayGroup);
      }
      todayGroup.events.push(event);
      return;
    }

    if (dayDifference === 1) {
      let tomorrowGroup = groups.find((group) => group.key === 'tomorrow');
      if (!tomorrowGroup) {
        tomorrowGroup = { key: 'tomorrow', label: 'Tomorrow', events: [] };
        groups.push(tomorrowGroup);
      }
      tomorrowGroup.events.push(event);
      return;
    }

    if (dayDifference < 7) {
      const key = getStartOfDay(eventDate).toISOString();
      const existingGroup = weekdayGroups.get(key);
      if (existingGroup) {
        existingGroup.events.push(event);
      } else {
        const newGroup = {
          key,
          label: getWeekdayLabel(eventDate),
          events: [event],
        };
        weekdayGroups.set(key, newGroup);
        groups.push(newGroup);
      }
      return;
    }

    if (!laterGroup) {
      laterGroup = { key: 'later', label: 'Later', events: [] };
      groups.push(laterGroup);
    }
    laterGroup.events.push(event);
  });

  return groups;
}

type JoinedRow = BookingRow & {
  status: string;
  events: Event;
};

function getVisibilityMeta(event: Event) {
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');

  if (visibility === 'semi_public') {
    return {
      label: 'Semi public',
      className: 'bg-indigo-50 text-indigo-500',
    };
  }

  if (visibility === 'private') {
    return {
      label: 'Private',
      className: 'bg-slate-100 text-slate-500',
    };
  }

  return {
    label: 'Public',
    className: 'bg-brand-50 text-brand-700',
  };
}

function getPreviewLocation(event: Event) {
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
  return visibility === 'semi_public'
    ? event.public_location_text || 'Location shared by host'
    : event.location_text || event.public_location_text || '';
}

function ExploreEventRow({
  event,
  index,
  path,
  total,
}: {
  event: Event;
  index: number;
  path: string;
  total: number;
}) {
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
  const dayOnly = formatDay(event.starts_at, event.timezone);
  const timeOnly = visibility === 'semi_public' ? null : formatTime(event.starts_at, event.timezone);
  const previewLocation = getPreviewLocation(event);
  const visibilityMeta = getVisibilityMeta(event);
  const confirmedCount = event.confirmed_count || 0;
  const thinkingCount = event.thinking_count || 0;
  const isInterestOnly = (event.participation_mode || 'rsvp') === 'interest_only';
  const interestedLabel = `${thinkingCount} ${thinkingCount === 1 ? 'person interested' : 'people interested'}`;

  return (
    <Link
      to={path}
      className={`block px-5 py-4 transition-colors hover:bg-slate-50 ${index < total - 1 ? 'border-b border-slate-100' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <h3 className="text-[15px] font-black leading-tight text-slate-900">{event.title}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] ${visibilityMeta.className}`}>
                {visibilityMeta.label}
              </span>
              {isInterestOnly ? (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-amber-700">
                  No sign-up
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {previewLocation ? (
              <span className="flex min-w-0 items-center gap-1 truncate">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                <span className="truncate">{previewLocation}</span>
              </span>
            ) : null}
            {isInterestOnly ? (
              <span className="flex shrink-0 items-center gap-1">
                <Users className="h-3.5 w-3.5 text-brand-600" />
                {interestedLabel}
              </span>
            ) : (
              <>
                <span className="flex shrink-0 items-center gap-1">
                  <Users className="h-3.5 w-3.5 text-brand-600" />
                  {confirmedCount}/{event.capacity} going
                </span>
                <span className="shrink-0">{thinkingCount} thinking about it</span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-slate-700">{dayOnly}</p>
          {timeOnly ? <p className="mt-0.5 text-xs text-slate-400">{timeOnly}</p> : null}
        </div>
      </div>
    </Link>
  );
}

function ExploreResultSection({
  events,
  label,
  pathForEvent,
}: {
  events: Event[];
  label: string;
  pathForEvent: (event: Event) => string;
}) {
  if (events.length === 0) return null;

  const sectionDescription =
    label === 'Hosting'
      ? 'Activities you are running.'
      : label === 'Attending'
        ? 'Activities you have already joined.'
        : label === 'Shared with you'
          ? 'Activities opened by link or join code.'
          : 'Public activities matching your search.';

  return (
    <section>
      <Card padded={false} className="overflow-hidden">
        <div className="space-y-1 px-4 py-4">
          <p className="ui-eyebrow">{label}</p>
          <p className="text-sm text-slate-500">{sectionDescription}</p>
        </div>
        <div className="border-t border-slate-100">
        {events.map((event, index) => {
          return (
            <Fragment key={event.id}>
              <ExploreEventRow
                event={event}
                index={index}
                total={events.length}
                path={pathForEvent(event)}
              />
            </Fragment>
          );
        })}
        </div>
      </Card>
    </section>
  );
}

export default function Calendar({ user }: { user: User | null }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [hostingEvents, setHostingEvents] = useState<Event[]>([]);
  const [attendingEvents, setAttendingEvents] = useState<Event[]>([]);
  const [sharedEvents, setSharedEvents] = useState<Event[]>([]);
  const [hiddenUpcomingCount, setHiddenUpcomingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';
  const moderationTransparencyHref = (() => {
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('action', 'moderation');
    return {
      pathname: location.pathname,
      search: `?${nextParams.toString()}`,
    };
  })();
  useEffect(() => {
    fetchPublicEvents();
  }, []);

  useEffect(() => {
    void fetchRelatedActivitySearchPools();
  }, [user?.id, user?.email]);

  const fetchPublicEvents = async () => {
    const nowIso = new Date().toISOString();
    const weekAhead = new Date();
    weekAhead.setDate(weekAhead.getDate() + 7);
    const weekAheadIso = weekAhead.toISOString();

    const [publicResult, hiddenResult] = await Promise.all([
      supabase.rpc('list_public_calendar_events', {
        p_now: nowIso,
      }),
      supabase.rpc('count_hidden_upcoming_activities', {
        p_now: nowIso,
        p_week_ahead: weekAheadIso,
      }),
    ]);

    const { data, error } = publicResult;

    if (hiddenResult.error) {
      console.error('Error fetching hidden upcoming activity count:', hiddenResult.error);
      setHiddenUpcomingCount(0);
    } else {
      setHiddenUpcomingCount(Number(hiddenResult.data || 0));
    }

    if (error) {
      console.error('Error fetching public activities:', error);
      setEvents([]);
    } else if (data) {
      setEvents(data as Event[]);
    }
    setLoading(false);
  };

  const fetchRelatedActivitySearchPools = async () => {
    if (!user) {
      setHostingEvents([]);
      setAttendingEvents([]);
      setSharedEvents([]);
      return;
    }

    const [hostedResult, joinedResult, sharedResult] = await Promise.all([
      supabase.rpc('list_my_hosted_events'),
      supabase.rpc('list_my_joined_activities'),
      supabase.rpc('list_my_shared_activities'),
    ]);

    if (hostedResult.error || joinedResult.error || sharedResult.error) {
      console.warn('Could not load related activity search pools.', hostedResult.error || joinedResult.error || sharedResult.error);
      return;
    }

    const groupedAttending = groupBookingsByEvent(
      ((joinedResult.data || []) as JoinedRow[]).filter((row) => row.status !== 'pending_approval') as BookingRow[],
    ).map((row) => row.events as Event);

    const [hostingWithCounts, attendingWithCounts, sharedWithCounts] = await Promise.all([
      hydrateMissingEventCounts((hostedResult.data || []) as Event[]),
      hydrateMissingEventCounts(groupedAttending),
      hydrateMissingEventCounts((sharedResult.data || []) as Event[]),
    ]);

    setHostingEvents(hostingWithCounts);
    setAttendingEvents(attendingWithCounts);
    setSharedEvents(sharedWithCounts);
  };

  const normalizedSearch = queryParam.trim().toLowerCase();
  const filteredEvents = normalizedSearch
    ? events.filter(event => 
        event.title.toLowerCase().includes(normalizedSearch) ||
        (event.location_text && event.location_text.toLowerCase().includes(normalizedSearch)) ||
        (event.public_location_text && event.public_location_text.toLowerCase().includes(normalizedSearch))
      )
    : events;
  const groupedEvents = groupCalendarEvents(filteredEvents);

  const hiddenUpcomingLabel = hiddenUpcomingCount === 1
    ? 'There is 1 other activity happening this week.'
    : `There are ${hiddenUpcomingCount} other activities happening this week.`;

  const searchedHosting = filterEventsForQuery(upcomingOnly(hostingEvents), normalizedSearch);
  const searchedAttending = filterEventsForQuery(upcomingOnly(attendingEvents), normalizedSearch);
  const searchedShared = filterEventsForQuery(upcomingOnly(sharedEvents), normalizedSearch);
  const ownEventIds = new Set([...searchedHosting, ...searchedAttending, ...searchedShared].map((event) => event.id));
  const searchedPublic = upcomingOnly(filteredEvents).filter((event) => !ownEventIds.has(event.id));

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <main className="max-w-2xl mx-auto px-6 pt-2 space-y-6">
        {loading ? (
          <div className="bg-white rounded-2xl overflow-hidden">
            {[1,2,3,4].map(i => (
              <div key={i} className="px-5 py-4 border-b border-slate-50 last:border-0 space-y-2 animate-pulse">
                <div className="flex justify-between">
                  <div className="h-4 bg-slate-100 rounded-full w-2/5" />
                  <div className="h-4 bg-slate-100 rounded-full w-1/4" />
                </div>
                <div className="h-3 bg-slate-100 rounded-full w-1/3" />
              </div>
            ))}
          </div>
        ) : normalizedSearch && (searchedHosting.length > 0 || searchedAttending.length > 0 || searchedShared.length > 0 || searchedPublic.length > 0) ? (
          <div className="space-y-4">
            <ExploreResultSection
              label="Hosting"
              events={searchedHosting}
              pathForEvent={(event) => buildEventPath(event, { preferPrivateAccess: true })}
            />
            <ExploreResultSection
              label="Attending"
              events={searchedAttending}
              pathForEvent={(event) => buildEventPath(event, { preferPrivateAccess: true })}
            />
            <ExploreResultSection
              label="Shared with you"
              events={searchedShared}
              pathForEvent={(event) => buildEventPath(event, { preferPrivateAccess: true })}
            />
            <ExploreResultSection
              label="Public activities"
              events={searchedPublic}
              pathForEvent={(event) => buildEventPath(event)}
            />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-20">
            <CalendarIcon className="w-8 h-8 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400 text-sm">
              {normalizedSearch ? `No results for "${normalizedSearch}"` : 'Nothing on yet. Check back soon.'}
            </p>
            {!normalizedSearch ? (
              <Link
                to="/create-event"
                className="inline-flex items-center justify-center mt-4 px-4 py-2 rounded-full bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 transition-all active:scale-[0.98]"
              >
                Create your own activity
              </Link>
            ) : null}
            {!normalizedSearch && hiddenUpcomingCount > 0 ? (
              <p className="mt-3 text-xs text-slate-300">{hiddenUpcomingLabel}</p>
            ) : null}
            <div className="mt-4">
              <Link
                to={moderationTransparencyHref}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
              >
                Moderation transparency
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedEvents.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="flex items-center gap-3 px-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                    {group.label}
                  </p>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <Card padded={false} className="overflow-hidden">
                  {group.events.map((event, idx) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <ExploreEventRow
                        event={event}
                        index={idx}
                        total={group.events.length}
                        path={buildEventPath(event)}
                      />
                    </motion.div>
                  ))}
                </Card>
              </section>
            ))}
            {!normalizedSearch && hiddenUpcomingCount > 0 ? (
              <p className="px-1 text-center text-xs text-slate-300">{hiddenUpcomingLabel}</p>
            ) : null}
            <div className="px-1 text-center">
              <Link
                to={moderationTransparencyHref}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
              >
                Moderation transparency
              </Link>
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
