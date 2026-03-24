import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Calendar as CalendarIcon, ChevronRight, MapPin, Users, ArrowLeft, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { formatDay, formatTime } from '../utils';
import { Event } from '../types';
import { withConfirmedCounts, buildEventPath } from '../lib/events';
import { goBackOr } from '../lib/navigation';
import { User } from '@supabase/supabase-js';

export default function Calendar({ user }: { user: User | null }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [privateAccessByEventId, setPrivateAccessByEventId] = useState<Record<string, string>>({});
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
    // Show upcoming scheduled events in UTC.
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('events')
      .select(`
        *,
        event_attendees(status)
      `)
      .eq('status', 'scheduled')
      .eq('is_public', true)
      .gte('starts_at', nowIso)
      .order('starts_at', { ascending: true });

    if (error) {
      console.error('Error fetching public activities:', error);
    } else if (data) {
      const eventsWithCounts = withConfirmedCounts(data as any[]);
      setEvents(eventsWithCounts);
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
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-sm">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-50 rounded-2xl mb-4">
              <CalendarIcon className="w-8 h-8 text-slate-200" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">No activities found</h3>
            <p className="text-slate-500 text-sm font-medium mb-4">Try a different search or check back later.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEvents.map((event) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {(() => {
                  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
                  const isSemiPublic = visibility === 'semi_public';
                  const dayOnly = formatDay(event.starts_at, event.timezone);
                  const timeOnly = formatTime(event.starts_at, event.timezone);
                  const previewLocation = isSemiPublic
                    ? event.public_location_text || 'Town/city shared by host'
                    : event.location_text || event.public_location_text || 'No location set';
                  const cta = isSemiPublic ? 'Request to View' : "I'm in";
                  const eventPath = privateAccessByEventId[event.id] || buildEventPath(event);

                  return (
                <Link 
                  to={eventPath}
                  className="block bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:border-brand-100 hover:shadow-md transition-all active:scale-[0.98]"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="space-y-1">
                      <h3 className="text-lg font-black text-slate-900 leading-tight tracking-tight">{event.title}</h3>
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold">
                        <MapPin className="w-3.5 h-3.5" />
                        {previewLocation}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        {dayOnly}
                      </span>
                      {!isSemiPublic && (
                        <span className="text-[10px] font-black text-brand-600 uppercase tracking-widest">
                          {timeOnly}
                        </span>
                      )}
                      {isSemiPublic && (
                        <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-1 rounded-lg">
                          Semi Public
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-slate-600 font-bold">
                        <Users className="w-4 h-4 text-brand-600" />
                        <span className="text-xs">
                          {event.confirmed_count} / {event.capacity}
                        </span>
                      </div>
                      {event.confirmed_count! >= event.capacity && event.allow_waitlist && (
                        <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest bg-amber-50 px-2 py-1 rounded-lg">
                          Waitlist
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-brand-600 font-black text-xs">
                      {cta} <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </Link>
                  );
                })()}
              </motion.div>
            ))}
          </div>
        )}
      </main>

      <footer className="max-w-2xl mx-auto px-6 mt-16 pb-10 text-center">
        <p className="text-slate-300 text-[9px] font-bold uppercase tracking-[0.2em]">
          Powered by Lalo
        </p>
      </footer>
    </div>
  );
}
