import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Calendar as CalendarIcon, ChevronRight, MapPin, Users, ArrowLeft, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { formatDay, formatTime } from '../utils';
import { Event } from '../types';
import { buildEventPath } from '../lib/events';
import { goBackOr } from '../lib/navigation';
import { User } from '@supabase/supabase-js';

export default function Calendar({ user }: { user: User | null }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [privateAccessByEventId, setPrivateAccessByEventId] = useState<Record<string, string>>({});
  const [hiddenUpcomingCount, setHiddenUpcomingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(queryParam);
  const navigate = useNavigate();

  useEffect(() => {
    fetchPublicEvents();
  }, []);

  useEffect(() => {
    fetchMyPrivateAccessMap();
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

  const fetchMyPrivateAccessMap = async () => {
    if (!user?.email) {
      setPrivateAccessByEventId({});
      return;
    }

    const { data, error } = await supabase
      .from('event_attendees')
      .select(`
        event_id,
        events (
          id,
          slug,
          visibility,
          is_public,
          access_code
        )
      `)
      .or(`user_id.eq.${user.id},guest_email.eq.${user.email}`)
      .neq('status', 'cancelled');

    if (error || !data) {
      setPrivateAccessByEventId({});
      return;
    }

    const map: Record<string, string> = {};
    (data as any[]).forEach((row) => {
      const eventRow = row.events;
      if (!eventRow?.id) return;
      const path = buildEventPath(eventRow, { preferPrivateAccess: true });
      if (path.includes('?access=')) {
        map[eventRow.id] = path;
      }
    });
    setPrivateAccessByEventId(map);
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredEvents = normalizedSearch
    ? events.filter(event => 
        event.title.toLowerCase().includes(normalizedSearch) ||
        (event.location_text && event.location_text.toLowerCase().includes(normalizedSearch)) ||
        (event.public_location_text && event.public_location_text.toLowerCase().includes(normalizedSearch))
      )
    : events;

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

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => goBackOr(navigate, '/')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-black text-slate-900 tracking-tight">Public Activities</h1>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">See what's on</span>
          </div>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-8 space-y-8">
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
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl overflow-hidden">
              {filteredEvents.map((event, idx) => (
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
                    const eventPath = privateAccessByEventId[event.id] || buildEventPath(event);

                    return (
                      <Link 
                        to={eventPath}
                        className={`block px-5 py-4 hover:bg-slate-50 transition-all active:scale-[0.99] ${idx < filteredEvents.length - 1 ? 'border-b border-slate-50' : ''}`}
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
            {!normalizedSearch && hiddenUpcomingCount > 0 ? (
              <p className="px-1 text-center text-xs text-slate-300">{hiddenUpcomingLabel}</p>
            ) : null}
          </div>
        )}
      </main>

    </div>
  );
}
