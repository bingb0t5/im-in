import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { Calendar, MapPin, Users, CheckCircle2, AlertCircle, ArrowLeft, Share2, MessageCircle, X, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate } from '../utils';
import { Event, Attendee } from '../types';
import { guestService, AttendeeProfile } from '../services/guestService';
import { findMyRsvps, getAttendanceSummary } from '../lib/attendees';
import { decideRsvpStatus, getConfirmedCount, isRsvpBlocked } from '../lib/rsvp';

export default function EventDetail({ user }: { user: User | null }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [showRsvpModal, setShowRsvpModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showProxyModal, setShowProxyModal] = useState(false);
  const [proxyName, setProxyName] = useState('');
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [guestInfo, setGuestInfo] = useState({ name: '', email: '' });
  const [guestProfile, setGuestProfile] = useState<AttendeeProfile | null>(null);
  const [myRsvps, setMyRsvps] = useState<Attendee[]>([]);
  const [rsvpToCancel, setRsvpToCancel] = useState<Attendee | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === 'object') {
      const maybeError = error as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [maybeError.message, maybeError.details, maybeError.hint].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(' - ');
      }
      if (maybeError.code) {
        return `Error code: ${maybeError.code}`;
      }
    }
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  };

  useEffect(() => {
    const checkGuestSession = async () => {
      const token = guestService.getStoredSession();
      if (token) {
        const profile = await guestService.validateSession(token);
        if (profile) {
          setGuestProfile(profile);
          setGuestInfo({ name: profile.full_name, email: profile.email });
        } else {
          guestService.clearStoredSession();
        }
      }
    };
    checkGuestSession();
  }, []);

  useEffect(() => {
    fetchEvent();
    // Subscribe to changes
    const channel = supabase
      .channel('event_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_attendees' }, () => {
        fetchAttendees();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [slug]);

  useEffect(() => {
    if (attendees.length > 0) {
      setMyRsvps(
        findMyRsvps(attendees, {
          userId: user?.id,
          userEmail: user?.email,
          guestProfileId: guestProfile?.id,
        }),
      );
    } else {
      setMyRsvps([]);
    }
  }, [user, guestProfile, attendees]);

  const fetchEvent = async () => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error) {
      console.error(error);
      setLoading(false);
    } else {
      setEvent(data);
      fetchAttendees(data.id);
    }
  };

  const fetchAttendees = async (eventId?: string) => {
    const id = eventId || event?.id;
    if (!id) return;

    const { data } = await supabase
      .from('event_attendees')
      .select('*')
      .eq('event_id', id)
      .neq('status', 'cancelled')
      .order('joined_at', { ascending: true });

    if (data) setAttendees(data);
    setLoading(false);
  };

  const handleRsvp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!event) return;
    setRsvpLoading(true);

    const email = user?.email || guestInfo.email;
    const name = user?.user_metadata?.full_name || guestInfo.name;

    if (!email || !name) {
      if (user?.email && !guestInfo.email) {
        setGuestInfo(prev => ({ ...prev, email: user.email! }));
      }
      setShowRsvpModal(true);
      setRsvpLoading(false);
      return;
    }

    try {
      let currentProfileId = guestProfile?.id;

      // 1. If logged in, get or create profile
      if (user) {
        const profile = await guestService.getOrCreateProfileForUser(user, name);
        currentProfileId = profile.id;
      } 
      // 2. If not logged in and no profile, create one
      else if (!currentProfileId) {
        const names = name.split(' ');
        const firstName = names[0];
        const lastName = names.slice(1).join(' ') || '';
        const { profile } = await guestService.createGuestSession(email, firstName, lastName);
        currentProfileId = profile.id;
        setGuestProfile(profile);
      }

      // 3. Check for existing RSVP
      const { data: existing } = await supabase
        .from('event_attendees')
        .select('id, status')
        .eq('event_id', event.id)
        .or(`guest_email.eq.${email}${currentProfileId ? `,attendee_profile_id.eq.${currentProfileId}` : ''}`)
        .maybeSingle();

      if (existing && existing.status !== 'cancelled') {
        alert('You have already said you\'re in!');
        setRsvpLoading(false);
        return;
      }

      // 4. Determine status from shared RSVP strategy
      const decision = decideRsvpStatus(getConfirmedCount(attendees), event.capacity, event.allow_waitlist);
      if (isRsvpBlocked(decision)) {
        alert(decision.reason);
        setRsvpLoading(false);
        return;
      }
      const status = decision.status;

      // 5. Insert or Update RSVP
      if (existing) {
        const { error } = await supabase
          .from('event_attendees')
          .update({
            status,
            guest_name: name,
            user_id: user?.id || null,
            attendee_profile_id: currentProfileId || null,
            joined_at: new Date().toISOString(),
            cancelled_at: null
          })
          .eq('id', existing.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('event_attendees')
          .insert([{
            event_id: event.id,
            user_id: user?.id || null,
            attendee_profile_id: currentProfileId || null,
            guest_name: name,
            guest_email: email,
            status
          }]);
        
        if (error) throw error;
      }

      setShowRsvpModal(false);
      setShowSuccessModal(true);
      fetchAttendees();
    } catch (error: any) {
      console.error('RSVP Error:', error);
      alert(error.message || 'Failed to join event. Please try again.');
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleProxyRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !proxyName.trim()) return;
    setRsvpLoading(true);
    setProxyError(null);

    const email = user?.email || guestInfo.email;
    let currentProfileId = guestProfile?.id;

    if (!email) {
      setProxyError('Email is required to add someone else.');
      setRsvpLoading(false);
      return;
    }

    try {
      // 1. Ensure we have a profile ID
      if (user && !currentProfileId) {
        const profile = await guestService.getOrCreateProfileForUser(user);
        currentProfileId = profile.id;
        // Optionally update guestProfile state if we want to keep it in sync
        setGuestProfile(profile);
      }

      if (!currentProfileId) {
        setProxyError('You must be signed in or have a guest session to add someone else.');
        setRsvpLoading(false);
        return;
      }

      // 2. Determine status from shared RSVP strategy
      const decision = decideRsvpStatus(getConfirmedCount(attendees), event.capacity, event.allow_waitlist);
      if (isRsvpBlocked(decision)) {
        setProxyError(decision.reason);
        setRsvpLoading(false);
        return;
      }

      // 3. Use server-side upsert path for proxy RSVP (handles legacy constraints + auth).
      const sessionToken = guestService.getStoredSession();
      const { data, error } = await supabase.rpc('add_proxy_attendee', {
        p_event_id: event.id,
        p_proxy_name: proxyName.trim(),
        p_attendee_profile_id: currentProfileId,
        p_user_id: user?.id || null,
        p_owner_email: email,
        p_session_token: sessionToken,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setShowProxyModal(false);
      setProxyName('');
      setShowSuccessModal(true);
      fetchAttendees();
    } catch (error: any) {
      console.error('Proxy RSVP Error:', error);
      setProxyError(error.message || 'Failed to add person. Please try again.');
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!rsvpToCancel) return;

    try {
      setRsvpLoading(true);
      setCancelError(null);
      const sessionToken = guestService.getStoredSession();
      const { data, error } = await supabase.rpc('cancel_attendee_with_promotion', {
        p_attendee_id: rsvpToCancel.id,
        p_session_token: sessionToken,
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      setRsvpToCancel(null);
      setShowCancelModal(false);
      fetchAttendees();
    } catch (error: unknown) {
      console.error('Cancel Error:', error);
      setCancelError(getErrorMessage(error, 'Failed to cancel RSVP'));
    } finally {
      setRsvpLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-slate-50">
        <AlertCircle className="w-16 h-16 text-slate-200 mb-6" />
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Event not found</h1>
        <p className="text-slate-500 mt-2 max-w-xs mx-auto">The link might be broken or the event was deleted.</p>
        <button onClick={() => navigate('/')} className="mt-10 text-brand-600 font-bold hover:text-brand-500 transition-colors">Go Home</button>
      </div>
    );
  }

  const { confirmedCount, waitlistCount, isFull, spotsRemaining } = getAttendanceSummary(attendees, event.capacity);

  return (
    <div className="min-h-screen bg-slate-50 pb-40">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Event Details</span>
          <button 
            onClick={() => {
              const text = `${event.title} – ${formatDate(event.starts_at)}\n${spotsRemaining} spots left. Join here:\n${window.location.href}`;
              if (navigator.share) {
                navigator.share({ title: event.title, text, url: window.location.href });
              } else {
                navigator.clipboard.writeText(text);
                alert('Invite copied to clipboard!');
              }
            }}
            className="p-2 hover:bg-slate-50 rounded-xl transition-all"
          >
            <Share2 className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </div>

      <main className="max-w-xl mx-auto px-6 pt-8 space-y-8">
        {/* Hero Info */}
        <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100">
          <h1 className="text-3xl font-black tracking-tight leading-tight text-slate-900 mb-6">
            {event.title}
          </h1>
          
          <div className="mb-6 flex">
            {event.is_public ? (
              <span className="inline-flex items-center gap-1.5 bg-brand-50 text-brand-600 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border border-brand-100">
                <Users className="w-3 h-3" /> Public Event
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border border-slate-200">
                <Users className="w-3 h-3" /> Private Link
              </span>
            )}
          </div>
          
          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
                <Calendar className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-base">{formatDate(event.starts_at)}</p>
                {event.ends_at && <p className="text-xs text-slate-400 font-medium">Until {formatDate(event.ends_at)}</p>}
              </div>
            </div>

            {event.location_text && (
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-bold text-slate-900 text-base">{event.location_text}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-base">
                  {confirmedCount} / {event.capacity} Going
                </p>
                {isFull ? (
                  <p className="text-xs text-amber-600 font-bold">
                    {event.allow_waitlist ? `${waitlistCount} on waitlist` : 'Event is full'}
                  </p>
                ) : (
                  <p className="text-xs text-brand-600 font-bold">{spotsRemaining} spots left</p>
                )}
              </div>
            </div>
          </div>

          {event.description && (
            <div className="mt-8 pt-8 border-t border-slate-50">
              <p className="text-slate-600 leading-relaxed whitespace-pre-wrap font-medium text-sm">{event.description}</p>
            </div>
          )}
        </section>

        {/* Attendee Preview */}
        <section className="space-y-4">
          <h2 className="text-xl font-black text-slate-900 tracking-tight px-1">Going</h2>
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
            {attendees.length === 0 ? (
              <p className="text-slate-400 text-center py-4 font-medium italic text-sm">Be the first to join!</p>
            ) : (
              <div className="space-y-4">
                {attendees.map((attendee, i) => (
                  <div key={attendee.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-[10px] font-black text-slate-400">
                        {i + 1}
                      </div>
                      <span className="font-bold text-slate-700 text-sm">{attendee.guest_name}</span>
                    </div>
                    {attendee.status === 'waitlist' && (
                      <span className="text-[9px] uppercase tracking-widest font-black bg-amber-50 text-amber-600 px-2 py-1 rounded-lg">
                        Waitlist
                      </span>
                    )}
                    {attendee.status === 'confirmed' && (
                      <CheckCircle2 className="w-5 h-5 text-brand-600" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Host Info */}
        <section className="bg-slate-100 rounded-3xl p-6 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Hosted By</p>
            <p className="text-lg font-black text-slate-800">{event.host_name || 'Anonymous'}</p>
          </div>
          {event.host_contact_text && (
            <div className="flex items-center gap-3">
              <p className="text-xs text-slate-500 hidden sm:block font-medium">{event.host_contact_text}</p>
              {event.host_contact_text.replace(/\D/g, '') && (
                <a 
                  href={`https://wa.me/${event.host_contact_text.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${event.host_name}, I'm interested in your event: ${event.title}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-12 h-12 bg-brand-600 hover:bg-brand-500 text-white rounded-xl flex items-center justify-center shadow-md shadow-brand-600/10 transition-all active:scale-95"
                  title="Message on WhatsApp"
                >
                  <MessageCircle className="w-6 h-6" />
                </a>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-lg border-t border-slate-100 z-20">
        <div className="max-w-xl mx-auto">
          {myRsvps.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {myRsvps.map(rsvp => (
                  <div key={rsvp.id} className="flex gap-2">
                    <div className="flex-1 bg-brand-50 text-brand-600 font-bold py-3 rounded-xl flex items-center justify-between px-4 text-xs">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{rsvp.guest_name}</span>
                      </div>
                      {rsvp.status === 'confirmed' ? (
                        <span>In</span>
                      ) : (
                        <span className="text-[9px] uppercase tracking-widest font-black bg-amber-50 text-amber-600 px-2 py-1 rounded-lg">
                          Waitlist
                        </span>
                      )}
                    </div>
                    <button 
                      onClick={() => {
                        setCancelError(null);
                        setRsvpToCancel(rsvp);
                        setShowCancelModal(true);
                      }}
                      disabled={rsvpLoading}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold px-4 rounded-xl transition-all active:scale-95 text-[10px] uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
              <button 
                onClick={() => {
                  setProxyError(null);
                  setShowProxyModal(true);
                }}
                className="w-full bg-white border border-brand-100 text-brand-600 font-black py-4 rounded-2xl shadow-sm hover:bg-brand-50 transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                <Plus className="w-5 h-5" />
                Add someone else
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleRsvp()}
              disabled={rsvpLoading || (isFull && !event.allow_waitlist)}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
            >
              {rsvpLoading ? 'Just a sec...' : isFull ? "Join Waitlist" : "I'm in"}
            </button>
          )}
        </div>
      </div>

      {/* RSVP Modal */}
      <AnimatePresence>
        {showRsvpModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRsvpModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">
                    {guestProfile ? `Joining as ${guestProfile.first_name}` : 'Almost there!'}
                  </h2>
                  <p className="text-slate-500 font-medium text-sm">
                    {guestProfile ? "We've remembered you on this device." : "Enter your details once and we'll remember you on this device."}
                  </p>
                </div>
                <button onClick={() => setShowRsvpModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              
              <form onSubmit={handleRsvp} className="space-y-5">
                {!guestProfile && (!user || !user.user_metadata?.full_name) ? (
                  <>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Your Name</label>
                      <input
                        required
                        type="text"
                        className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                        placeholder="e.g. Alex Smith"
                        value={guestInfo.name}
                        onChange={e => setGuestInfo({ ...guestInfo, name: e.target.value })}
                      />
                    </div>
                    {!user && (
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Email Address</label>
                        <input
                          required
                          type="email"
                          className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                          placeholder="you@example.com"
                          value={guestInfo.email}
                          onChange={e => setGuestInfo({ ...guestInfo, email: e.target.value })}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Confirmed Details</p>
                      <p className="font-black text-slate-900">{user?.user_metadata?.full_name || guestProfile?.full_name}</p>
                      <p className="text-xs text-slate-500">{user?.email || guestProfile?.email}</p>
                    </div>
                    {!user && (
                      <button 
                        type="button"
                        onClick={() => {
                          guestService.clearStoredSession();
                          setGuestProfile(null);
                          setGuestInfo({ name: '', email: '' });
                        }}
                        className="text-[10px] font-black text-brand-600 uppercase tracking-widest hover:bg-brand-50 px-3 py-2 rounded-lg transition-all"
                      >
                        Not you?
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={rsvpLoading}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-brand-600/10 mt-2 transition-all active:scale-95"
                >
                  {rsvpLoading ? "Joining..." : "I'm in"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {showSuccessModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSuccessModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-[2.5rem] p-10 shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-brand-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10 text-brand-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">You're in!</h2>
              <p className="text-slate-500 font-medium mb-8 text-sm leading-relaxed">
                We've added you to the list. You can manage all your bookings in one place.
              </p>
              
              <div className="space-y-3">
                <button
                  onClick={() => navigate('/bookings')}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                >
                  Manage My Bookings
                </button>
                <button
                  onClick={() => setShowSuccessModal(false)}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-500 font-bold py-4 rounded-2xl transition-all active:scale-95 text-sm"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cancel Confirmation Modal */}
      <AnimatePresence>
        {showCancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCancelModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight mb-2">Are you sure?</h2>
              <p className="text-slate-500 font-medium mb-8 text-sm">You'll lose your spot and might not be able to get it back.</p>
              {cancelError && (
                <p className="text-red-500 text-xs font-bold bg-red-50 p-3 rounded-xl border border-red-100 mb-4">
                  {cancelError}
                </p>
              )}
              
              <div className="space-y-3">
                <button
                  onClick={handleCancel}
                  disabled={rsvpLoading}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-black py-4 rounded-2xl shadow-md shadow-red-500/10 transition-all active:scale-95"
                >
                  {rsvpLoading ? "Updating..." : "Yes, can't make it"}
                </button>
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-500 font-bold py-4 rounded-2xl transition-all active:scale-95 text-sm"
                >
                  Actually, I'm still in
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Proxy RSVP Modal */}
      <AnimatePresence>
        {showProxyModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProxyModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">
                    Add someone else
                  </h2>
                  <p className="text-slate-500 font-medium text-sm">
                    Bringing a friend or family member? Add them to the list.
                  </p>
                </div>
                <button onClick={() => setShowProxyModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              {proxyError && (
                <p className="text-red-500 text-xs font-bold bg-red-50 p-3 rounded-xl border border-red-100 mb-4">
                  {proxyError}
                </p>
              )}
              
              <form onSubmit={handleProxyRsvp} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Their Name</label>
                  <input
                    required
                    autoFocus
                    type="text"
                    className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                    placeholder="e.g. Charlie Smith"
                    value={proxyName}
                    onChange={e => setProxyName(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={rsvpLoading || !proxyName.trim()}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-brand-600/10 mt-2 transition-all active:scale-95 disabled:opacity-50"
                >
                  {rsvpLoading ? "Adding..." : "Add to list"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="max-w-xl mx-auto px-6 mt-12 pb-10 text-center">
        <p className="text-slate-300 text-[9px] font-bold uppercase tracking-[0.2em]">
          Powered by Lalo
        </p>
      </footer>
    </div>
  );
}
