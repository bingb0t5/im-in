import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Calendar as CalendarIcon, ChevronRight, LogOut, MessageSquare, Users, MapPin, X, Heart, Info, ThumbsUp, Search, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate } from '../utils';
import { Event } from '../types';
import { guestService } from '../services/guestService';
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

export default function Home({ user }: { user: User | null }) {
  const [hostedEvents, setHostedEvents] = useState<Event[]>([]);
  const [joinedEvents, setJoinedEvents] = useState<any[]>([]);
  const [pendingAccessRequests, setPendingAccessRequests] = useState<PendingAccessRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hosting' | 'attending'>('hosting');
  const [showWhyModal, setShowWhyModal] = useState(false);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);
  const [hasGuestSession, setHasGuestSession] = useState(false);
  const [publicSearchQuery, setPublicSearchQuery] = useState('');
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setHasGuestSession(!!guestService.getStoredSession());
  }, []);

  useEffect(() => {
    if (user) {
      fetchAllData();
    } else {
      setPendingAccessRequests([]);
      setLoading(false);
    }
  }, [user]);

  const fetchAllData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 1. Fetch Hosted Events (legacy owner + co-host memberships)
      const { data: hostedByOwner, error: hostedByOwnerError } = await supabase
        .from('events')
        .select(`
          *,
          event_attendees(status)
        `)
        .eq('host_user_id', user.id)
        .order('starts_at', { ascending: true });

      if (hostedByOwnerError) throw hostedByOwnerError;

      const { data: hostedByMembership, error: hostedByMembershipError } = await supabase
        .from('event_hosts')
        .select(`
          event_id,
          events (
            *,
            event_attendees(status)
          )
        `)
        .eq('user_id', user.id);

      if (hostedByMembershipError) throw hostedByMembershipError;

      // 2. Fetch Joined Events (More resilient)
      const { data: joined, error: joinedError } = await supabase
        .from('event_attendees')
        .select(`
          *,
          events (*)
        `)
        .or(`user_id.eq.${user.id},guest_email.eq.${user.email}`)
        .neq('status', 'cancelled')
        .order('joined_at', { ascending: false });

      if (joinedError) throw joinedError;

      // 3. Fetch Thinking-About-It events
      const thinkingIdentityFilters = [
        user.id ? `user_id.eq.${user.id}` : '',
        user.email ? `guest_email.eq.${user.email}` : '',
      ].filter(Boolean);
      const thinkingQuery = supabase
        .from('event_interests')
        .select(`
          *,
          events (*)
        `)
        .order('created_at', { ascending: false });
      const { data: thinking, error: thinkingError } =
        thinkingIdentityFilters.length > 0
          ? await thinkingQuery.or(thinkingIdentityFilters.join(','))
          : await thinkingQuery.limit(0);

      if (thinkingError) throw thinkingError;

      const hostedMerged = [
        ...((hostedByOwner || []) as any[]),
        ...((hostedByMembership || [])
          .map((row: any) => (Array.isArray(row.events) ? row.events[0] : row.events))
          .filter(Boolean) as any[]),
      ];
      const hostedById = hostedMerged.reduce((acc: Record<string, any>, event: any) => {
        if (!event?.id) return acc;
        acc[event.id] = event;
        return acc;
      }, {});
      const hostedWithCounts = withConfirmedCounts(Object.values(hostedById));
      const hostedEventIds = hostedWithCounts.map((event) => event.id);

      // 4. Fetch pending "request to view" rows for hosted activities
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

      if (pendingRequestsError) throw pendingRequestsError;

      const thinkingRows = (thinking || []).map((row: any) => ({
        ...row,
        status: 'thinking',
      }));
      const combinedJoined = [...(joined || []), ...thinkingRows];

      setHostedEvents(hostedWithCounts);
      setJoinedEvents(combinedJoined);
      const normalizedPendingRequests: PendingAccessRequestRow[] = (pendingRequests || []).map((row: any) => ({
        id: row.id,
        event_id: row.event_id,
        requester_name: row.requester_name,
        created_at: row.created_at,
        status: row.status,
        events: Array.isArray(row.events) ? row.events[0] || null : row.events || null,
      }));
      setPendingAccessRequests(normalizedPendingRequests);

      // 5. Smart Default Logic (Only if not already set)
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
    navigate('/login');
  };

  const handlePublicSearchChange = (value: string) => {
    setPublicSearchQuery(value);
    const nextPath = value.trim() ? `/calendar?q=${encodeURIComponent(value)}` : '/calendar';
    navigate(nextPath);
  };

  const groupedJoinedEvents = groupBookingsByEvent(joinedEvents);

  if (!user) {
    return (
      <div className="min-h-[100svh] flex flex-col items-center justify-between px-6 pt-5 pb-4 bg-slate-50 text-center md:min-h-screen md:justify-center md:py-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full flex-1 flex flex-col justify-center items-center"
        >
          <div className="inline-flex items-center justify-center w-20 h-20 bg-brand-600 rounded-3xl mb-5 shadow-xl shadow-brand-600/10">
            <CalendarIcon className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 mb-1.5">I'm In</h1>
          <p className="text-lg text-slate-500 mb-6 font-medium">
            See what's on. Say I'm in.
          </p>
          
          <div className="w-full space-y-5">
            <div className="space-y-3.5">
              <Link 
                to="/create-event" 
                className="block w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                Create an Activity
                <ChevronRight className="w-5 h-5" />
              </Link>

              <Link 
                to="/calendar" 
                className="block w-full bg-white hover:bg-slate-50 text-slate-900 font-black py-4 rounded-2xl border border-slate-100 shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                What's On
                <CalendarIcon className="w-5 h-5 text-brand-600" />
              </Link>

              <Link 
                to={hasGuestSession ? "/bookings" : "/login?recovery=true"} 
                className="block w-full bg-brand-50 hover:bg-brand-100 text-brand-600 font-black py-4 rounded-2xl border border-brand-100 shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                Activities I'm In
                <ThumbsUp className="w-5 h-5" />
              </Link>
              
              <div className="flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
                <button 
                  onClick={() => setShowWhyModal(true)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5"
                >
                  <Info className="w-3.5 h-3.5" />
                  Why this exists
                </button>
                <button 
                  onClick={() => setShowBuildModal(true)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5"
                >
                  <Heart className="w-3.5 h-3.5" />
                  Help build it
                </button>
                <button 
                  onClick={() => setShowHowItWorksModal(true)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5" />
                  How this works
                </button>
              </div>
            </div>

            <div className="pt-2">
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                Built for real communities.<br />Kept simple on purpose.
              </p>
            </div>
          </div>
        </motion.div>
        
        <footer className="mt-4 text-slate-300 text-[9px] font-bold tracking-[0.18em] flex items-center gap-2 uppercase">
          A community project, started by Lalo
        </footer>

        {/* Why this exists Modal */}
        <AnimatePresence>
          {showWhyModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left overflow-y-auto overscroll-contain">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowWhyModal(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Why I'm In exists</h2>
                  <button onClick={() => setShowWhyModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>
                
                <div className="space-y-4 text-slate-600 text-sm font-medium leading-relaxed">
                  <p>I’m In is a simple way to organise real-life plans, activities, and events without replacing the WhatsApp groups people already use.</p>
                  <p>You still share and chat in your groups. I’m In just makes it easier to see what&apos;s on, manage who&apos;s coming, and keep things organised.</p>
                  <p>It works alongside the groups and communities people already use, not inside a new one. In places like Hoi An, there are often overlapping groups with similar people and activities, but not always much visibility between them.</p>
                  <p>I’m In is meant to make things easier to share, discover, and join across those groups while still keeping things grounded in the communities people are already part of.</p>
                  <p className="text-slate-900 font-semibold">Build a longer table, not a higher fence.</p>
                  <p>Keep it useful. Keep it open. Keep it simple.</p>

                  <div className="pt-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">What it's for</h3>
                    <ul className="space-y-2">
                      {['classes and activities', 'sports and games', 'casual meetups', 'recurring community activities'].map((item, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-brand-600 rounded-full" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-4 space-y-3">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Built in the open</h3>
                    <p>You can see what&apos;s being worked on, what&apos;s coming next, and suggest ideas as it evolves.</p>
                    <p>The code is public. Contributions are welcome.</p>
                    <p>Ideas are welcome. We keep things simple on purpose.</p>
                  </div>
                </div>

                <div className="mt-8 space-y-3">
                  <a
                    href="mailto:hello@joinimin.com"
                    className="block w-full text-center bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                  >
                    Suggest an idea
                  </a>
                  <a
                    href="https://trello.com/b/kauEWnAe/im-in-dev-board"
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl transition-all active:scale-95"
                  >
                    See what&apos;s being worked on
                  </a>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Help build it Modal */}
        <AnimatePresence>
          {showBuildModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left overflow-y-auto overscroll-contain">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowBuildModal(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Help build I'm In</h2>
                  <button onClick={() => setShowBuildModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>
                
                <div className="space-y-4 text-slate-600 text-sm font-medium leading-relaxed">
                  <p>I’m In is still early, and evolving as people use it.</p>
                  <p>The aim is simple: make organising things easier for real-world communities.</p>
                  <p>It&apos;s being shaped by the people who organise and join activities, not just built in isolation.</p>
                  <p>Lalo helped start the project and contributes time to it, alongside others who want to help.</p>
                  <p>If you want to help, there are lots of ways to get involved:</p>
                  
                  <div className="pt-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Ways you can help</h3>
                    <ul className="space-y-2">
                      {[
                        'test the app and share feedback',
                        'help organise or run activities',
                        'contribute design, copy, or code',
                        'suggest ideas and vote on what would be most useful'
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-brand-600 rounded-full" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p>You don’t need to be technical — just interested in making it better.</p>
                </div>

                <div className="mt-8 space-y-3">
                  <button
                    onClick={() => {
                      window.location.href = `mailto:hello@joinimin.com?subject=Helping build I'm In`;
                    }}
                    className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                  >
                    Get involved
                  </button>
                  <a
                    href="https://trello.com/b/kauEWnAe/im-in-dev-board"
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl transition-all active:scale-95"
                  >
                    See what&apos;s being worked on
                  </a>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* How this works Modal */}
        <AnimatePresence>
          {showHowItWorksModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left overflow-y-auto overscroll-contain">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowHowItWorksModal(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">How this works</h2>
                  <button onClick={() => setShowHowItWorksModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>

                <div className="space-y-4 text-slate-600 text-sm font-medium leading-relaxed">
                  <p>I’m In is built to be simple, useful, and shaped by the people who use it.</p>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It&apos;s open</p>
                    <p>The code is public. People can see how it works and suggest improvements.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It&apos;s shaped by the community</p>
                    <p>Ideas, feedback, and real-world use help guide what gets built next.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It stays simple on purpose</p>
                    <p>Not every idea will be added. Keeping it easy to use matters more than adding everything.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">Hosts run their own activities</p>
                    <p>Activities should be created by the person actually organising or hosting them, so it&apos;s clear who&apos;s running things.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It&apos;s maintained by people giving their time</p>
                    <p>Lalo helps build and maintain it, alongside others who choose to get involved.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It should become more community-guided over time</p>
                    <p>As more people use it and contribute, the aim is for direction to be shaped more by the community itself.</p>
                  </div>
                </div>

                <div className="mt-8 space-y-3">
                  <a
                    href="https://trello.com/b/kauEWnAe/im-in-dev-board"
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                  >
                    See what&apos;s being worked on
                  </a>
                  <a
                    href="mailto:hello@joinimin.com"
                    className="block w-full text-center bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl transition-all active:scale-95"
                  >
                    Suggest an idea
                  </a>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-lg font-black tracking-tight text-brand-600 leading-none">I'm In</h1>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Host Dashboard</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/calendar" className="text-slate-600 hover:text-brand-600 text-xs font-black flex items-center gap-1.5 transition-colors">
              <CalendarIcon className="w-4 h-4" /> What's On
            </Link>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-5">
        {/* Public Search */}
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

        {/* View Toggle */}
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

        {view === 'hosting' && !loading && (
          <section className="bg-white rounded-2xl overflow-hidden mb-5">
            <button
              type="button"
              onClick={() => setShowRequestsPanel((prev) => !prev)}
              className="w-full px-5 py-3 border-b border-slate-50 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-slate-400" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Requests to View</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">{pendingAccessRequests.length} pending</span>
                <ChevronRight
                  className={`w-4 h-4 text-slate-300 transition-transform ${showRequestsPanel ? 'rotate-90' : ''}`}
                />
              </div>
            </button>
            {showRequestsPanel && (
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
            )}
          </section>
        )}

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            {view === 'hosting' ? 'My Activities' : "Activities I'm In"}
          </h2>
          {view === 'hosting' && (
            <Link to="/create-event" className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl text-sm font-black flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]">
              <Plus className="w-4 h-4" /> New
            </Link>
          )}
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl overflow-hidden">
            {[1,2,3].map(i => (
              <div key={i} className="px-5 py-4 border-b border-slate-50 last:border-0 space-y-2 animate-pulse">
                <div className="h-4 bg-slate-100 rounded-full w-1/2" />
                <div className="h-3 bg-slate-100 rounded-full w-1/3" />
              </div>
            ))}
          </div>
        ) : view === 'hosting' ? (
          /* Hosting View */
          hostedEvents.length === 0 ? (
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
              {hostedEvents.map((event, idx) => (
                <Link 
                  key={event.id} 
                  to={`/host/events/${event.id}`}
                  className={`block px-5 py-4 hover:bg-slate-50 transition-all active:scale-[0.99] ${idx < hostedEvents.length - 1 ? 'border-b border-slate-50' : ''}`}
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
          /* Attending View */
          joinedEvents.length === 0 ? (
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
              {groupedJoinedEvents.map((groupedBooking: any, idx: number) => (
                <Link 
                  key={groupedBooking.events.id} 
                  to={buildEventPath(groupedBooking.events, { preferPrivateAccess: true })}
                  className={`block px-5 py-4 hover:bg-slate-50 transition-all active:scale-[0.99] ${groupedBooking.status === 'thinking' ? 'bg-indigo-50/60' : ''} ${idx < groupedJoinedEvents.length - 1 ? 'border-b border-slate-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">{groupedBooking.events.title}</h3>
                      {groupedBooking.status === 'thinking' && (
                        <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5">I'm thinking about it</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {groupedBooking.attendees.map((name: string, i: number) => (
                          <span key={i} className="text-[10px] font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md">
                            {name}
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
      </main>

    </div>
  );
}
