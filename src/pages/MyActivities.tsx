import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, ChevronRight, Eye, LogOut, MessageSquare, Plus, Search, Users } from 'lucide-react';
import { supabase } from '../supabase';
import { formatDate, isOnOrAfterTodayInTimeZone } from '../utils';
import { Event } from '../types';
import { groupBookingsByEvent } from '../lib/bookings';
import { withConfirmedCounts, buildEventPath } from '../lib/events';

interface PendingAccessRequestRow {
  id: string;
  event_id: string;
  requester_name: string;
  created_at: string;
  status: 'pending' | 'approved' | 'declined' | 'contacted';
  events?: {
    id: string;
    title: string;
    host_user_id?: string;
  } | null;
}

interface PendingJoinRequestRow {
  id: string;
  event_id: string;
  guest_name: string;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  events?: {
    id: string;
    title: string;
    host_user_id?: string;
  } | null;
}

export default function MyActivities({ user }: { user: User | null }) {
  const [hostedEvents, setHostedEvents] = useState<Event[]>([]);
  const [joinedEvents, setJoinedEvents] = useState<any[]>([]);
  const [pendingAccessRequests, setPendingAccessRequests] = useState<PendingAccessRequestRow[]>([]);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<PendingJoinRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hosting' | 'attending'>('hosting');
  const [publicSearchQuery, setPublicSearchQuery] = useState('');
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [showJoinRequestsPanel, setShowJoinRequestsPanel] = useState(false);
  const [showPastHosting, setShowPastHosting] = useState(false);
  const [showPastAttending, setShowPastAttending] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    void fetchAllData();
  }, [user?.id, user?.email]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const fetchAllData = async () => {
    setLoading(true);

    try {
      const {
        data: hostedByOwner,
        error: hostedByOwnerError,
      } = await supabase
        .rpc('list_my_hosted_events');

      if (hostedByOwnerError) throw hostedByOwnerError;

      const {
        data: joinedRows,
        error: joinedError,
      } = await supabase
        .rpc('list_my_joined_activities');

      if (joinedError) throw joinedError;

      const {
        data: thinkingRows,
        error: thinkingError,
      } = await supabase
        .rpc('list_my_interested_activities');

      if (thinkingError) throw thinkingError;

      const hostedById = ((hostedByOwner || []) as any[]).reduce((acc: Record<string, any>, event: any) => {
        if (!event?.id) return acc;
        acc[event.id] = event;
        return acc;
      }, {});

      const hostedIds = Object.keys(hostedById);
      const { data: hostedAttendeeRows, error: hostedAttendeeRowsError } = hostedIds.length > 0
        ? await supabase
            .from('event_attendees')
            .select('event_id, status')
            .in('event_id', hostedIds)
            .neq('status', 'cancelled')
        : { data: [], error: null };

      if (hostedAttendeeRowsError) {
        console.warn('Could not load hosted attendee counts for My Activities:', hostedAttendeeRowsError);
      }

      const hostedEventsWithAttendees = Object.values(hostedById).map((event: any) => ({
        ...event,
        event_attendees: ((hostedAttendeeRows || []) as Array<{ event_id: string; status: string }>)
          .filter((row) => row.event_id === event.id)
          .map((row) => ({ status: row.status })),
      }));

      const hostedWithCounts = withConfirmedCounts(hostedEventsWithAttendees);
      const hostedEventIds = hostedWithCounts.map((event) => event.id);

      const { data: pendingRequests, error: pendingRequestsError } = await supabase
        .from('event_access_requests')
        .select(`
          id,
          event_id,
          requester_name,
          created_at,
          status,
          events!inner(
            id,
            title,
            host_user_id
          )
        `)
        .eq('status', 'pending')
        .in('event_id', hostedEventIds.length > 0 ? hostedEventIds : ['00000000-0000-0000-0000-000000000000'])
        .order('created_at', { ascending: false });

      if (pendingRequestsError) {
        console.warn('Could not load pending access requests for My Activities:', pendingRequestsError);
      }

      const { data: pendingMembershipRequests, error: pendingMembershipRequestsError } = await supabase
        .from('event_join_requests')
        .select(`
          id,
          event_id,
          guest_name,
          created_at,
          status,
          events!inner(
            id,
            title,
            host_user_id
          )
        `)
        .eq('status', 'pending')
        .in('event_id', hostedEventIds.length > 0 ? hostedEventIds : ['00000000-0000-0000-0000-000000000000'])
        .order('created_at', { ascending: false });

      if (pendingMembershipRequestsError) {
        console.warn('Could not load pending join requests for My Activities:', pendingMembershipRequestsError);
      }

      const normalizedJoinedRows = (joinedRows || [])
        .filter((row: any) => row.events);

      const normalizedThinkingRows = (thinkingRows || [])
        .filter((row: any) => row.events);

      const thinkingRowsWithStatus = normalizedThinkingRows.map((row: any) => ({
        ...row,
        status: 'thinking',
      }));

      const combinedJoined = [...normalizedJoinedRows, ...thinkingRowsWithStatus];

      setHostedEvents(hostedWithCounts);
      setJoinedEvents(combinedJoined);
      setPendingAccessRequests(((pendingRequests || []) as any[]).map((row: any) => ({
        id: row.id,
        event_id: row.event_id,
        requester_name: row.requester_name,
        created_at: row.created_at,
        status: row.status,
        events: Array.isArray(row.events) ? row.events[0] || null : row.events || null,
      })));
      setPendingJoinRequests(((pendingMembershipRequests || []) as any[]).map((row: any) => ({
        id: row.id,
        event_id: row.event_id,
        guest_name: row.guest_name,
        created_at: row.created_at,
        status: row.status,
        events: Array.isArray(row.events) ? row.events[0] || null : row.events || null,
      })));

      if (hostedWithCounts.length === 0 && combinedJoined.length > 0) {
        setView('attending');
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  const handlePublicSearchChange = (value: string) => {
    setPublicSearchQuery(value);
    const nextPath = value.trim() ? `/calendar?q=${encodeURIComponent(value)}` : '/calendar';
    navigate(nextPath);
  };

  const groupedJoinedEvents = groupBookingsByEvent(joinedEvents);
  const upcomingHostedEvents = hostedEvents.filter((event) =>
    isOnOrAfterTodayInTimeZone(event.starts_at, event.timezone),
  );
  const pastHostedEvents = hostedEvents.filter((event) =>
    !isOnOrAfterTodayInTimeZone(event.starts_at, event.timezone),
  );
  const upcomingJoinedEvents = groupedJoinedEvents.filter((groupedBooking) =>
    isOnOrAfterTodayInTimeZone(groupedBooking.events.starts_at, groupedBooking.events.timezone),
  );
  const pastJoinedEvents = groupedJoinedEvents.filter((groupedBooking) =>
    !isOnOrAfterTodayInTimeZone(groupedBooking.events.starts_at, groupedBooking.events.timezone),
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-lg font-black tracking-tight text-brand-600 leading-none">I'm In</h1>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">My Activities</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-slate-600 hover:text-brand-600 text-xs font-black transition-colors">
              Home
            </Link>
            <Link to="/calendar" className="text-slate-600 hover:text-brand-600 text-xs font-black flex items-center gap-1.5 transition-colors">
              <CalendarIcon className="w-4 h-4" /> What's On
            </Link>
            <Link to="/profile" className="text-slate-600 hover:text-brand-600 text-xs font-black transition-colors">
              Profile
            </Link>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-5">
        <div className="relative group mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-brand-600 transition-colors" />
          <input
            type="text"
            placeholder="Search public activities"
            className="w-full pl-12 pr-4 py-3.5 bg-white rounded-2xl border border-slate-100 shadow-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium"
            value={publicSearchQuery}
            onChange={(e) => handlePublicSearchChange(e.target.value)}
          />
        </div>

        <div className="flex p-1 bg-slate-200/50 rounded-2xl mb-5">
          <button
            onClick={() => setView('hosting')}
            className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${
              view === 'hosting' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Hosting
          </button>
          <button
            onClick={() => setView('attending')}
            className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${
              view === 'attending' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Attending
          </button>
        </div>

        {view === 'hosting' && !loading ? (
          <div className="space-y-3 mb-5">
            <section className="bg-white rounded-2xl overflow-hidden">
              {(() => {
                const hasPendingAccess = pendingAccessRequests.length > 0;
                return (
              <button
                type="button"
                onClick={() => setShowRequestsPanel((prev) => !prev)}
                className="w-full px-5 py-3 border-b border-slate-50 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Eye className={`w-4 h-4 ${hasPendingAccess ? 'text-brand-600' : 'text-slate-400'}`} />
                  <p className={`text-[10px] font-black uppercase tracking-widest ${hasPendingAccess ? 'text-brand-600' : 'text-slate-400'}`}>Requests to View</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${hasPendingAccess ? 'text-brand-600' : 'text-slate-500'}`}>{pendingAccessRequests.length} pending</span>
                  <ChevronRight className={`w-4 h-4 ${hasPendingAccess ? 'text-brand-400' : 'text-slate-300'} transition-transform ${showRequestsPanel ? 'rotate-90' : ''}`} />
                </div>
              </button>
                );
              })()}
              {showRequestsPanel ? (
                pendingAccessRequests.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-400">No pending requests right now.</p>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {pendingAccessRequests.slice(0, 3).map((request) => (
                      <button
                        key={request.id}
                        onClick={() => navigate(`/host/events/${request.event_id}`)}
                        className="w-full text-left px-5 py-3 hover:bg-slate-50 transition-all active:scale-[0.99]"
                      >
                        <p className="text-sm font-bold text-slate-900 leading-tight truncate">
                          {request.requester_name} requested access to {request.events?.title || 'your activity'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">{formatDate(request.created_at)}</p>
                      </button>
                    ))}
                  </div>
                )
              ) : null}
            </section>

            <section className="bg-white rounded-2xl overflow-hidden">
              {(() => {
                const hasPendingJoin = pendingJoinRequests.length > 0;
                return (
              <button
                type="button"
                onClick={() => setShowJoinRequestsPanel((prev) => !prev)}
                className="w-full px-5 py-3 border-b border-slate-50 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Users className={`w-4 h-4 ${hasPendingJoin ? 'text-brand-600' : 'text-slate-400'}`} />
                  <p className={`text-[10px] font-black uppercase tracking-widest ${hasPendingJoin ? 'text-brand-600' : 'text-slate-400'}`}>Requests to Join</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${hasPendingJoin ? 'text-brand-600' : 'text-slate-500'}`}>{pendingJoinRequests.length} pending</span>
                  <ChevronRight className={`w-4 h-4 ${hasPendingJoin ? 'text-brand-400' : 'text-slate-300'} transition-transform ${showJoinRequestsPanel ? 'rotate-90' : ''}`} />
                </div>
              </button>
                );
              })()}
              {showJoinRequestsPanel ? (
                pendingJoinRequests.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-400">No pending join requests right now.</p>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {pendingJoinRequests.slice(0, 3).map((request) => (
                      <button
                        key={request.id}
                        onClick={() => navigate(`/host/events/${request.event_id}`)}
                        className="w-full text-left px-5 py-3 hover:bg-slate-50 transition-all active:scale-[0.99]"
                      >
                        <p className="text-sm font-bold text-slate-900 leading-tight truncate">
                          {request.guest_name} requested to join {request.events?.title || 'your activity'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">{formatDate(request.created_at)}</p>
                      </button>
                    ))}
                  </div>
                )
              ) : null}
            </section>
          </div>
        ) : null}

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            {view === 'hosting' ? 'My Activities' : "Activities I'm In"}
          </h2>
          {view === 'hosting' ? (
            <Link to="/create-event" className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl text-sm font-black flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]">
              <Plus className="w-4 h-4" /> New
            </Link>
          ) : null}
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl overflow-hidden">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-4 border-b border-slate-50 last:border-0 space-y-2 animate-pulse">
                <div className="h-4 bg-slate-100 rounded-full w-1/2" />
                <div className="h-3 bg-slate-100 rounded-full w-1/3" />
              </div>
            ))}
          </div>
        ) : view === 'hosting' ? (
          upcomingHostedEvents.length === 0 ? (
            <div className="text-center py-16">
              <MessageSquare className="w-8 h-8 text-slate-200 mx-auto mb-4" />
              <h3 className="text-base font-bold text-slate-900 mb-1">Nothing scheduled</h3>
              <p className="text-slate-400 mb-6 text-sm">Create an activity and share the link.</p>
              <Link to="/create-event" className="text-brand-600 font-bold text-sm hover:text-brand-500 transition-colors inline-flex items-center gap-1.5">
                Create your first activity <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="bg-white rounded-2xl overflow-hidden">
              {upcomingHostedEvents.map((event, idx) => (
                <Link
                  key={event.id}
                  to={`/host/events/${event.id}`}
                  className={`block px-5 py-4 hover:bg-slate-50 transition-all active:scale-[0.99] ${idx < upcomingHostedEvents.length - 1 ? 'border-b border-slate-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">{event.title}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">{formatDate(event.starts_at, event.timezone)}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{event.location_text || 'No location'} · {(event as any).confirmed_count || 0} going</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          )
        ) : (
          upcomingJoinedEvents.length === 0 ? (
            <div className="text-center py-16">
              <CalendarIcon className="w-8 h-8 text-slate-200 mx-auto mb-4" />
              <h3 className="text-base font-bold text-slate-900 mb-1">No activities yet</h3>
              <p className="text-slate-400 mb-6 text-sm">Browse to find something to join.</p>
              <Link to="/calendar" className="text-brand-600 font-bold text-sm hover:text-brand-500 transition-colors inline-flex items-center gap-1.5">
                What's On <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="bg-white rounded-2xl overflow-hidden">
              {upcomingJoinedEvents.map((groupedBooking: any, idx: number) => (
                <Link
                  key={groupedBooking.events.id}
                  to={buildEventPath(groupedBooking.events, { preferPrivateAccess: true })}
                  className={`block px-5 py-4 hover:bg-slate-50 transition-all active:scale-[0.99] ${groupedBooking.status === 'thinking' ? 'bg-indigo-50/60' : ''} ${idx < upcomingJoinedEvents.length - 1 ? 'border-b border-slate-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">{groupedBooking.events.title}</h3>
                      {groupedBooking.status === 'thinking' ? (
                        <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5">I'm thinking about it</p>
                      ) : null}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {groupedBooking.attendees.map((attendee: { name: string; status: string }, i: number) => (
                          <span
                            key={i}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              attendee.status === 'thinking'
                                ? 'text-indigo-600 bg-indigo-50'
                                : 'text-brand-600 bg-brand-50'
                            }`}
                          >
                            {attendee.name}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{formatDate(groupedBooking.events.starts_at, groupedBooking.events.timezone)}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          )
        )}

        {!loading && view === 'hosting' && pastHostedEvents.length > 0 ? (
          <section className="pt-1">
            <button
              type="button"
              onClick={() => setShowPastHosting((prev) => !prev)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
            >
              {showPastHosting ? 'Hide past activities' : `Past activities (${pastHostedEvents.length})`}
            </button>
            {showPastHosting ? (
              <div className="mt-3 bg-white rounded-2xl overflow-hidden">
                {pastHostedEvents.map((event, idx) => (
                  <Link
                    key={event.id}
                    to={`/host/events/${event.id}`}
                    className={`block px-5 py-4 hover:bg-slate-50 transition-all active:scale-[0.99] ${idx < pastHostedEvents.length - 1 ? 'border-b border-slate-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">{event.title}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">{formatDate(event.starts_at, event.timezone)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{event.location_text || 'No location'} · {(event as any).confirmed_count || 0} going</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {!loading && view === 'attending' && pastJoinedEvents.length > 0 ? (
          <section className="pt-1">
            <button
              type="button"
              onClick={() => setShowPastAttending((prev) => !prev)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
            >
              {showPastAttending ? 'Hide past activities' : `Past activities (${pastJoinedEvents.length})`}
            </button>
            {showPastAttending ? (
              <div className="mt-3 bg-white rounded-2xl overflow-hidden">
                {pastJoinedEvents.map((groupedBooking: any, idx: number) => (
                  <Link
                    key={groupedBooking.events.id}
                    to={buildEventPath(groupedBooking.events, { preferPrivateAccess: true })}
                    className={`block px-5 py-4 hover:bg-slate-50 transition-all active:scale-[0.99] ${groupedBooking.status === 'thinking' ? 'bg-indigo-50/60' : ''} ${idx < pastJoinedEvents.length - 1 ? 'border-b border-slate-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">{groupedBooking.events.title}</h3>
                        {groupedBooking.status === 'thinking' ? (
                          <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5">I'm thinking about it</p>
                        ) : null}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {groupedBooking.attendees.map((attendee: { name: string; status: string }, i: number) => (
                            <span
                              key={i}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                attendee.status === 'thinking'
                                  ? 'text-indigo-600 bg-indigo-50'
                                  : 'text-brand-600 bg-brand-50'
                              }`}
                            >
                              {attendee.name}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{formatDate(groupedBooking.events.starts_at, groupedBooking.events.timezone)}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
