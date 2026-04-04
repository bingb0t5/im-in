import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Link, useSearchParams } from 'react-router-dom';
import { Calendar as CalendarIcon, MapPin, Search, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { formatDay, formatTime } from '../utils';
import { Event } from '../types';
import { buildEventPath } from '../lib/events';
import { User } from '@supabase/supabase-js';
import { BookingRow, groupBookingsByEvent } from '../lib/bookings';
import { filterEventsForQuery } from '../lib/activityRelations';
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

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3 px-1">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <Card className="overflow-hidden p-0">
        {events.map((event, index) => {
          const visibility = event.visibility || (event.is_public ? 'public' : 'private');
          const isSemiPublic = visibility === 'semi_public';
          const dayOnly = formatDay(event.starts_at, event.timezone);
          const timeOnly = formatTime(event.starts_at, event.timezone);
          const previewLocation = isSemiPublic
            ? event.public_location_text || 'Location shared by host'
            : event.location_text || event.public_location_text || '';

          return (
            <Link
              key={event.id}
              to={pathForEvent(event)}
              className={`block px-5 py-4 transition-colors hover:bg-slate-50 ${index < events.length - 1 ? 'border-b border-slate-100' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 leading-tight">{event.title}</h3>
                  <div className="mt-1 flex items-center gap-3">
                    {previewLocation ? (
                      <span className="flex items-center gap-1 truncate text-xs text-slate-400">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {previewLocation}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
                      <Users className="h-3 w-3" />
                      {event.confirmed_count || 0}/{event.capacity}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-slate-700">{dayOnly}</p>
                  {!isSemiPublic ? (
                    <p className="text-xs text-slate-400">{timeOnly}</p>
                  ) : (
                    <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-indigo-400">Semi public</p>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(queryParam);
  useEffect(() => {
    fetchPublicEvents();
  }, []);

  useEffect(() => {
    void fetchRelatedActivitySearchPools();
  }, [user?.id, user?.email]);

  useEffect(() => {
    setSearchQuery(queryParam);
  }, [queryParam]);

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

    setHostingEvents((hostedResult.data || []) as Event[]);
    setAttendingEvents(groupedAttending);
    setSharedEvents((sharedResult.data || []) as Event[]);
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredEvents = normalizedSearch
    ? events.filter(event => 
        event.title.toLowerCase().includes(normalizedSearch) ||
        (event.location_text && event.location_text.toLowerCase().includes(normalizedSearch)) ||
        (event.public_location_text && event.public_location_text.toLowerCase().includes(normalizedSearch))
      )
    : events;
  const groupedEvents = groupCalendarEvents(filteredEvents);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    const nextParams = new URLSearchParams(searchParams);
    if (value.trim()) {
      nextParams.set('q', value);
    } else {
      nextParams.delete('q');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const hiddenUpcomingLabel = hiddenUpcomingCount === 1
    ? 'There is 1 other activity happening this week.'
    : `There are ${hiddenUpcomingCount} other activities happening this week.`;

  const searchedHosting = filterEventsForQuery(hostingEvents, normalizedSearch);
  const searchedAttending = filterEventsForQuery(attendingEvents, normalizedSearch);
  const searchedShared = filterEventsForQuery(sharedEvents, normalizedSearch);
  const ownEventIds = new Set([...searchedHosting, ...searchedAttending, ...searchedShared].map((event) => event.id));
  const searchedPublic = filteredEvents.filter((event) => !ownEventIds.has(event.id));

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <main className="max-w-2xl mx-auto px-6 pt-2 space-y-6">
        {/* Search Bar */}
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-brand-600 transition-colors" />
          <input 
            type="text"
            autoFocus={!!queryParam}
            placeholder="Search public activities"
            className="w-full pl-12 pr-4 py-4 bg-white rounded-2xl border border-slate-100 shadow-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

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
              pathForEvent={(event) => buildEventPath(event)}
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
                to="/moderation"
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
                <div className="bg-white rounded-2xl overflow-hidden">
                  {group.events.map((event, idx) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      {(() => {
                        const visibility = event.visibility || (event.is_public ? 'public' : 'private');
                        const isSemiPublic = visibility === 'semi_public';
                        const dayOnly = formatDay(event.starts_at, event.timezone);
                        const timeOnly = formatTime(event.starts_at, event.timezone);
                        const previewLocation = isSemiPublic
                          ? event.public_location_text || 'Location shared by host'
                          : event.location_text || event.public_location_text || '';
                        const eventPath = buildEventPath(event);

                        return (
                          <Link 
                            to={eventPath}
                            className={`block px-5 py-4 hover:bg-slate-50 transition-all active:scale-[0.99] ${idx < group.events.length - 1 ? 'border-b border-slate-50' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-bold text-slate-900 leading-tight">{event.title}</h3>
                                <div className="flex items-center gap-3 mt-1">
                                  {previewLocation && (
                                    <span className="text-xs text-slate-400 flex items-center gap-1 truncate">
                                      <MapPin className="w-3 h-3 shrink-0" />{previewLocation}
                                    </span>
                                  )}
                                  <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
                                    <Users className="w-3 h-3" />{event.confirmed_count}/{event.capacity}
                                  </span>
                                  <span className="text-xs text-slate-400 shrink-0">
                                    {event.thinking_count || 0} thinking about it
                                  </span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-bold text-slate-700">{dayOnly}</p>
                                {!isSemiPublic ? (
                                  <p className="text-xs text-slate-400">{timeOnly}</p>
                                ) : (
                                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest mt-0.5">Semi public</p>
                                )}
                              </div>
                            </div>
                          </Link>
                        );
                      })()}
                    </motion.div>
                  ))}
                </div>
              </section>
            ))}
            {!normalizedSearch && hiddenUpcomingCount > 0 ? (
              <p className="px-1 text-center text-xs text-slate-300">{hiddenUpcomingLabel}</p>
            ) : null}
            <div className="px-1 text-center">
              <Link
                to="/moderation"
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
