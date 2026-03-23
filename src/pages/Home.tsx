import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Calendar as CalendarIcon, ChevronRight, LogOut, MessageSquare, Users, MapPin, X, Heart, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate } from '../utils';
import { Event } from '../types';
import { guestService } from '../services/guestService';

export default function Home({ user }: { user: User | null }) {
  const [hostedEvents, setHostedEvents] = useState<Event[]>([]);
  const [joinedEvents, setJoinedEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hosting' | 'attending'>('hosting');
  const [showWhyModal, setShowWhyModal] = useState(false);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [hasGuestSession, setHasGuestSession] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setHasGuestSession(!!guestService.getStoredSession());
  }, []);

  useEffect(() => {
    if (user) {
      fetchAllData();
    } else {
      setLoading(false);
    }
  }, [user]);

  const fetchAllData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 1. Fetch Hosted Events
      const { data: hosted, error: hostedError } = await supabase
        .from('events')
        .select(`
          *,
          event_attendees(status)
        `)
        .eq('host_user_id', user.id)
        .order('starts_at', { ascending: true });

      if (hostedError) throw hostedError;

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

      const hostedWithCounts = (hosted || []).map((event: any) => ({
        ...event,
        confirmed_count: event.event_attendees?.filter((a: any) => a.status === 'confirmed').length || 0
      }));

      setHostedEvents(hostedWithCounts);
      setJoinedEvents(joined || []);

      // 3. Smart Default Logic (Only if not already set)
      if (hostedWithCounts.length === 0 && (joined || []).length > 0) {
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

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <div className="inline-flex items-center justify-center w-20 h-20 bg-brand-600 rounded-3xl mb-8 shadow-xl shadow-brand-600/10">
            <CalendarIcon className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 mb-2">I'm In</h1>
          <p className="text-lg text-slate-500 mb-10 font-medium">
            See what's on. Say I'm in.
          </p>
          
          <div className="space-y-6">
            <div className="space-y-4">
              <Link 
                to="/login" 
                className="block w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                Get Started
                <ChevronRight className="w-5 h-5" />
              </Link>

              <Link 
                to="/calendar" 
                className="block w-full bg-white hover:bg-slate-50 text-slate-900 font-black py-4 rounded-2xl border border-slate-100 shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                Browse Events
                <CalendarIcon className="w-5 h-5 text-brand-600" />
              </Link>

              <Link 
                to={hasGuestSession ? "/bookings" : "/login?recovery=true"} 
                className="block w-full bg-brand-50 hover:bg-brand-100 text-brand-600 font-black py-4 rounded-2xl border border-brand-100 shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                My Bookings
                <ChevronRight className="w-5 h-5" />
              </Link>
              
              <div className="flex items-center justify-center gap-6">
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
              </div>
            </div>

            <div className="pt-4">
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                Open, community-first,<br />and volunteer-supported.
              </p>
            </div>
          </div>
        </motion.div>
        
        <footer className="mt-20 text-slate-300 text-[9px] font-bold tracking-[0.2em] flex items-center gap-2 uppercase">
          Powered by Lalo
        </footer>

        {/* Why this exists Modal */}
        <AnimatePresence>
          {showWhyModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
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
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[80vh]"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Why I'm In exists</h2>
                  <button onClick={() => setShowWhyModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>
                
                <div className="space-y-4 text-slate-600 text-sm font-medium leading-relaxed">
                  <p>I’m In is a simple community tool for organising real-life plans, activities, and events.</p>
                  <p>It was created to make things easier than messy chat threads and scattered sign-ups.</p>
                  <p>The goal is to keep it open, lightweight, and useful for the community — not owned or controlled by any one organiser.</p>
                  <p>We want events, pages, and local coordination to feel shared, simple, and accessible.</p>
                  <p>I’m In is being built as a community-first project, with an open and transparent approach over time.</p>
                  
                  <div className="pt-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">What it's for</h3>
                    <ul className="space-y-2">
                      {['classes and activities', 'sports and games', 'casual meetups', 'recurring community events'].map((item, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-brand-600 rounded-full" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <button
                  onClick={() => setShowWhyModal(false)}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-500 font-bold py-4 rounded-2xl mt-8 transition-all active:scale-95"
                >
                  Got it
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Help build it Modal */}
        <AnimatePresence>
          {showBuildModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
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
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Help build I'm In</h2>
                  <button onClick={() => setShowBuildModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>
                
                <div className="space-y-4 text-slate-600 text-sm font-medium leading-relaxed">
                  <p>I’m In is still early, and we’d love help from people in the community.</p>
                  <p>We’re looking for volunteers, testers, organisers, and thoughtful contributors who want to help shape something useful for everyone.</p>
                  
                  <div className="pt-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Ways you can help</h3>
                    <ul className="space-y-2">
                      {[
                        'test the app and give feedback',
                        'help organise or moderate pages/events',
                        'contribute design, copy, or code',
                        'help shape how the project grows over time'
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-brand-600 rounded-full" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <button
                  onClick={() => {
                    // Scaffolded contact flow
                    window.location.href = `mailto:hello@rcnz.net?subject=Helping build I'm In`;
                  }}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 mt-8 transition-all active:scale-95"
                >
                  Get in touch
                </button>
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
              <CalendarIcon className="w-4 h-4" /> Browse Events
            </Link>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-8">
        {/* View Toggle */}
        <div className="flex p-1 bg-slate-200/50 rounded-2xl mb-8">
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

        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            {view === 'hosting' ? 'My Events' : "Events I'm In"}
          </h2>
          {view === 'hosting' && (
            <Link to="/create-event" className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl text-sm font-black flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]">
              <Plus className="w-4 h-4" /> New
            </Link>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
          </div>
        ) : view === 'hosting' ? (
          /* Hosting View */
          hostedEvents.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-sm">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-50 rounded-2xl mb-4">
                <MessageSquare className="w-8 h-8 text-slate-200" />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">Nothing scheduled</h3>
              <p className="text-slate-500 mb-8 text-sm font-medium">Create an event and share the link with your community.</p>
              <Link to="/create-event" className="text-brand-600 font-black text-sm hover:text-brand-500 transition-colors inline-flex items-center gap-2">
                Create your first event <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {hostedEvents.map((event) => (
                <Link 
                  key={event.id} 
                  to={`/host/events/${event.id}`}
                  className="block bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:border-brand-100 hover:shadow-md transition-all active:scale-[0.98]"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="space-y-1">
                      <h3 className="text-lg font-black text-slate-900 leading-tight tracking-tight">{event.title}</h3>
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold">
                        <MapPin className="w-3.5 h-3.5" />
                        {event.location_text || 'No location set'}
                      </div>
                    </div>
                    <span className={`text-[9px] uppercase tracking-widest font-black px-2 py-1 rounded-lg ${
                      event.status === 'scheduled' ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {event.status}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-slate-600 font-bold">
                        <CalendarIcon className="w-4 h-4 text-brand-600" />
                        <span className="text-xs">{formatDate(event.starts_at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-600 font-bold">
                        <Users className="w-4 h-4 text-brand-600" />
                        <span className="text-xs">{(event as any).confirmed_count || 0} Going</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-300" />
                  </div>
                </Link>
              ))}
            </div>
          )
        ) : (
          /* Attending View */
          joinedEvents.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-sm">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-50 rounded-2xl mb-4">
                <CalendarIcon className="w-8 h-8 text-slate-200" />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">No bookings yet</h3>
              <p className="text-slate-500 mb-8 text-sm font-medium">Browse the calendar to find something to join.</p>
              <Link to="/calendar" className="text-brand-600 font-black text-sm hover:text-brand-500 transition-colors inline-flex items-center gap-2">
                Browse Events <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.values(joinedEvents.reduce((acc: any, booking) => {
                const eventId = booking.events.id;
                if (!acc[eventId]) {
                  acc[eventId] = {
                    ...booking,
                    attendees: [booking.guest_name]
                  };
                } else {
                  acc[eventId].attendees.push(booking.guest_name);
                  // If any booking is confirmed, show confirmed status
                  if (booking.status === 'confirmed') acc[eventId].status = 'confirmed';
                }
                return acc;
              }, {})).map((groupedBooking: any) => (
                <Link 
                  key={groupedBooking.events.id} 
                  to={`/events/${groupedBooking.events.slug}`}
                  className="block bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:border-brand-100 hover:shadow-md transition-all active:scale-[0.98]"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="space-y-1">
                      <h3 className="text-lg font-black text-slate-900 leading-tight tracking-tight">{groupedBooking.events.title}</h3>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {groupedBooking.attendees.map((name: string, i: number) => (
                          <span key={i} className="text-[10px] font-bold text-brand-600 uppercase tracking-widest bg-brand-50 px-2 py-0.5 rounded-md">
                            {name}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold mt-2">
                        <MapPin className="w-3.5 h-3.5" />
                        {groupedBooking.events.location_text || 'No location set'}
                      </div>
                    </div>
                    <span className={`text-[9px] uppercase tracking-widest font-black px-2 py-1 rounded-lg ${
                      groupedBooking.status === 'confirmed' ? 'bg-brand-50 text-brand-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {groupedBooking.status}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-slate-600 font-bold">
                        <CalendarIcon className="w-4 h-4 text-brand-600" />
                        <span className="text-xs">{formatDate(groupedBooking.events.starts_at)}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-300" />
                  </div>
                </Link>
              ))}
            </div>
          )
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
