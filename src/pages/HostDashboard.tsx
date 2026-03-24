import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { Users, Share2, Copy, MessageCircle, ArrowLeft, Trash2, CheckCircle2, Clock, Edit2, Plus, X, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate, generateSlug } from '../utils';
import { Event, Attendee, EventAccessRequest } from '../types';
import { decideRsvpStatus, getConfirmedCount, isRsvpBlocked } from '../lib/rsvp';
import { goBackOr } from '../lib/navigation';

export default function HostDashboard({ user }: { user: User | null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAttendee, setNewAttendee] = useState({ name: '', email: '' });
  const [actionLoading, setActionLoading] = useState(false);
  const [adderNamesByProfileId, setAdderNamesByProfileId] = useState<Record<string, string>>({});
  const [accessRequests, setAccessRequests] = useState<EventAccessRequest[]>([]);
  const [requestActionLoadingId, setRequestActionLoadingId] = useState<string | null>(null);
  const [showDeclinedRequests, setShowDeclinedRequests] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState<{
    show: boolean;
    type: 'event' | 'attendee';
    id: string;
    name?: string;
  }>({ show: false, type: 'event', id: '' });
  const [confirmText, setConfirmText] = useState('');

  const getDisplayName = (name?: string | null, email?: string | null) => {
    const explicitName = (name || '').trim();
    if (explicitName) return explicitName;
    const localPart = (email || '').split('@')[0] || '';
    const fallback = localPart.replace(/[._-]+/g, ' ').trim();
    return fallback || 'Guest';
  };

  const normalizeWhatsapp = (value: string) => value.replace(/[^\d]/g, '');

  const getPublicPreviewUrl = () => {
    if (!event) return '';
    return `${window.location.origin}/events/${event.slug}`;
  };

  const generateAccessCode = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const ensurePrivateAccessUrl = async () => {
    if (!event) return '';
    const base = getPublicPreviewUrl();
    const visibility = event.visibility || (event.is_public ? 'public' : 'private');

    if (visibility !== 'semi_public') return base;

    if (event.access_code && event.access_code.trim()) {
      return `${base}?access=${event.access_code}`;
    }

    const nextAccessCode = generateAccessCode();
    const { error } = await supabase
      .from('events')
      .update({ access_code: nextAccessCode })
      .eq('id', event.id);

    if (error) throw error;
    setEvent((prev) => (prev ? { ...prev, access_code: nextAccessCode } : prev));
    return `${base}?access=${nextAccessCode}`;
  };

  const getAddedByLabel = (attendee: Attendee) => {
    if (!attendee.added_by_type || attendee.added_by_type === 'self') return null;
    if (attendee.added_by_type === 'host') return 'added by host';
    if (attendee.added_by_type === 'proxy') {
      const adderId = attendee.added_by_attendee_profile_id || '';
      const adderName = adderNamesByProfileId[adderId];
      return adderName ? `added by ${adderName}` : 'added by attendee';
    }
    return null;
  };

  const hydrateAdderNames = async (attendeeRows: Attendee[]) => {
    const ids = Array.from(
      new Set(
        attendeeRows
          .map((a) => a.added_by_attendee_profile_id || '')
          .filter(Boolean)
      )
    );

    if (ids.length === 0) {
      setAdderNamesByProfileId({});
      return;
    }

    const { data } = await supabase
      .from('attendee_profiles')
      .select('id, full_name, email')
      .in('id', ids);

    const map: Record<string, string> = {};
    (data || []).forEach((profile: any) => {
      const fullName = (profile.full_name || '').trim();
      const fallback = ((profile.email || '').split('@')[0] || '').replace(/[._-]+/g, ' ').trim();
      map[profile.id] = fullName || fallback || 'attendee';
    });
    setAdderNamesByProfileId(map);
  };

  useEffect(() => {
    if (!user) return;
    fetchEvent();

    // Subscribe to changes
    const channel = supabase
      .channel('host_event_changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'event_attendees',
        filter: `event_id=eq.${id}`
      }, () => {
        fetchAttendees(id!);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'event_access_requests',
        filter: `event_id=eq.${id}`
      }, () => {
        fetchAccessRequests(id!);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, user]);

  const fetchEvent = async () => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (error || data.host_user_id !== user?.id) {
      console.error(error);
      navigate('/');
    } else {
      setEvent(data);
      fetchAttendees(data.id);
      fetchAccessRequests(data.id);
    }
  };

  const fetchAttendees = async (eventId: string) => {
    const { data } = await supabase
      .from('event_attendees')
      .select('*')
      .eq('event_id', eventId)
      .neq('status', 'cancelled')
      .order('joined_at', { ascending: true });

    if (data) {
      setAttendees(data);
      await hydrateAdderNames(data as Attendee[]);
    }
    setLoading(false);
  };

  const fetchAccessRequests = async (eventId: string) => {
    const { data } = await supabase
      .from('event_access_requests')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (data) setAccessRequests(data as EventAccessRequest[]);
  };

  const removeAttendee = async (attendeeId: string) => {
    setActionLoading(true);
    try {
      // Use server-side cancel path to avoid fragile direct DELETE/UPDATE policy paths.
      const { data, error } = await supabase.rpc('cancel_attendee_with_promotion', {
        p_attendee_id: attendeeId,
        p_session_token: null,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      fetchAttendees(event!.id);
      setShowDeleteModal({ show: false, type: 'attendee', id: '' });
    } catch (error: any) {
      console.error('Remove Attendee Error:', error);
      alert(error.message || 'Failed to remove attendee');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddAttendee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;
    setActionLoading(true);

    const email = newAttendee.email || `guest_${Math.random().toString(36).substring(2, 7)}@example.com`;

    try {
      // 1. Check for existing RSVP
      const { data: existing } = await supabase
        .from('event_attendees')
        .select('id, status')
        .eq('event_id', event.id)
        .eq('guest_email', email)
        .maybeSingle();

      if (existing && existing.status !== 'cancelled') {
        alert('This email is already registered for this activity');
        setActionLoading(false);
        return;
      }

      // 2. Determine status from shared RSVP strategy
      const decision = decideRsvpStatus(getConfirmedCount(attendees), event.capacity, event.allow_waitlist);
      if (isRsvpBlocked(decision)) {
        alert(decision.reason);
        setActionLoading(false);
        return;
      }
      const status = decision.status;

      // 3. Insert or Update RSVP
      if (existing) {
        const { error } = await supabase
          .from('event_attendees')
          .update({
            status,
            guest_name: newAttendee.name,
            added_by_type: 'host',
            added_by_attendee_profile_id: null,
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
            guest_name: newAttendee.name,
            guest_email: email,
            status,
            added_by_type: 'host',
            added_by_attendee_profile_id: null
          }]);
        
        if (error) throw error;
      }

      setShowAddModal(false);
      setNewAttendee({ name: '', email: '' });
      fetchAttendees(event.id);
    } catch (error: any) {
      console.error('Add Attendee Error:', error);
      alert(error.message || 'Failed to add attendee');
    } finally {
      setActionLoading(false);
    }
  };

  const deleteEvent = async () => {
    if (confirmText.toLowerCase() !== 'delete') return;
    
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', id);

      if (error) throw error;
      navigate('/');
    } catch (error: any) {
      console.error('Delete Activity Error:', error);
      alert(error.message || 'Failed to delete activity');
    } finally {
      setActionLoading(false);
    }
  };

  const copyEvent = async () => {
    if (!event) return;
    setActionLoading(true);
    try {
      const newStartsAt = new Date(event.starts_at);
      newStartsAt.setDate(newStartsAt.getDate() + 7);
      
      let newEndsAt = null;
      const durationMinutes = event.duration_minutes || 60;
      newEndsAt = new Date(newStartsAt.getTime() + durationMinutes * 60 * 1000).toISOString();

      const newSlug = `${generateSlug(event.title)}-${Math.random().toString(36).substring(2, 7)}`;

      const { data: newEvent, error } = await supabase
        .from('events')
        .insert([{
          title: event.title,
          description: event.description,
          public_summary: event.public_summary,
          location_text: event.location_text,
          public_location_text: event.public_location_text,
          google_maps_url: event.google_maps_url,
          starts_at: newStartsAt.toISOString(),
          ends_at: newEndsAt,
          timezone: event.timezone || 'Asia/Ho_Chi_Minh',
          duration_minutes: durationMinutes,
          capacity: event.capacity,
          host_name: event.host_name,
          host_contact_text: event.host_contact_text,
          show_host_publicly: event.show_host_publicly,
          visibility: event.visibility || (event.is_public ? 'public' : 'private'),
          allow_waitlist: event.allow_waitlist,
          is_public: event.is_public,
          host_user_id: user?.id,
          status: 'scheduled',
          slug: newSlug
        }])
        .select()
        .single();

      if (error) throw error;
      navigate(`/host/events/${newEvent.id}/edit`);
    } catch (error: any) {
      console.error('Copy Activity Error:', error);
      alert(error.message || 'Failed to copy activity');
    } finally {
      setActionLoading(false);
    }
  };

  const copyLink = async () => {
    try {
      const url = await ensurePrivateAccessUrl();
      if (!url) return;
      navigator.clipboard.writeText(url);
      alert('Private link copied!');
    } catch (error: any) {
      alert(error.message || 'Could not prepare private link');
    }
  };

  const copyPublicPreviewLink = () => {
    const url = getPublicPreviewUrl();
    navigator.clipboard.writeText(url);
    alert('Public preview link copied!');
  };

  const shareWhatsApp = async () => {
    try {
      const url = await ensurePrivateAccessUrl();
      if (!url || !event) return;
      const confirmedCount = attendees.filter(a => a.status === 'confirmed').length;
      const spotsLeft = Math.max(0, event.capacity - confirmedCount);
      const text = `${event.title}\n${formatDate(event.starts_at, event.timezone)}\n${spotsLeft} spots left.\n\nPrivate activity link:\n${url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    } catch (error: any) {
      alert(error.message || 'Could not prepare WhatsApp share');
    }
  };

  const openRequestWhatsapp = async (
    request: EventAccessRequest,
    mode: 'approve' | 'decline' | 'more_info',
  ) => {
    if (!event) return;
    const number = normalizeWhatsapp(request.requester_whatsapp || '');
    if (!number) {
      alert('No valid WhatsApp number on this request.');
      return;
    }

    const eventLink = await ensurePrivateAccessUrl();
    let status: EventAccessRequest['status'] | null = null;
    let text = '';
    if (mode === 'approve') {
      status = 'approved';
      text = `Hi ${request.requester_name}, thanks for requesting access to ${event.title}. Here is the private activity link:\n${eventLink}`;
    } else if (mode === 'decline') {
      status = 'declined';
      text = `Hi ${request.requester_name}, thanks for your request for ${event.title}. Sorry, we can't share this activity right now.`;
    } else {
      text = `Hi ${request.requester_name}, thanks for requesting access to ${event.title}. Can you please tell me a little more before I share the link?`;
    }

    try {
      setRequestActionLoadingId(request.id);
      if (status) {
        const { error } = await supabase
          .from('event_access_requests')
          .update({ status })
          .eq('id', request.id);
        if (error) throw error;
      }

      window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, '_blank');
      fetchAccessRequests(event.id);
    } catch (error: any) {
      alert(error.message || 'Could not update request');
    } finally {
      setRequestActionLoadingId(null);
    }
  };

  if (loading || !event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  const confirmed = attendees.filter(a => a.status === 'confirmed');
  const waitlist = attendees.filter(a => a.status === 'waitlist');
  const pendingRequests = accessRequests.filter((r) => r.status === 'pending');
  const activeRequests = accessRequests.filter((r) => r.status !== 'declined');
  const declinedRequests = accessRequests.filter((r) => r.status === 'declined');
  const visibleRequests = showDeclinedRequests ? declinedRequests : activeRequests;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => goBackOr(navigate, '/')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Manage Activity</h1>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[150px]">{event.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={copyEvent}
              disabled={actionLoading}
              className="p-2 text-slate-400 hover:text-brand-600 hover:bg-slate-50 rounded-xl transition-all"
              title="Duplicate for Next Week"
            >
              <Copy className="w-5 h-5" />
            </button>
            <button 
              onClick={() => navigate(`/host/events/${event.id}/edit`)}
              className="p-2 text-slate-400 hover:text-brand-600 hover:bg-slate-50 rounded-xl transition-all"
              title="Edit Activity"
            >
              <Edit2 className="w-5 h-5" />
            </button>
            <button onClick={() => navigate(`/events/${event.slug}`)} className="text-brand-600 font-bold text-sm px-3 py-2 hover:bg-brand-50 rounded-lg transition-all">
              View
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Quick Stats */}
        <section className="grid grid-cols-2 gap-4">
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Going</p>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">{confirmed.length} <span className="text-slate-200 text-xl font-medium">/</span> {event.capacity}</p>
          </div>
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Waitlist</p>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">{waitlist.length}</p>
          </div>
        </section>

        {/* Share Tools */}
        <section className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Share2 className="w-4 h-4" /> Share Activity
          </h2>
          {(event.visibility || (event.is_public ? 'public' : 'private')) === 'semi_public' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={copyPublicPreviewLink} className="bg-slate-50 hover:bg-slate-100 p-4 rounded-2xl flex flex-col items-center gap-2 transition-all active:scale-95 group">
                  <Copy className="w-5 h-5 text-slate-400 group-hover:text-brand-600" />
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Public Link</span>
                </button>
                <button onClick={() => { void copyLink(); }} className="bg-brand-50 hover:bg-brand-100 p-4 rounded-2xl flex flex-col items-center gap-2 transition-all active:scale-95 group">
                  <Copy className="w-5 h-5 text-brand-600" />
                  <span className="text-[9px] font-bold text-brand-700 uppercase tracking-wider">Private Link</span>
                </button>
              </div>
              <button onClick={() => { void shareWhatsApp(); }} className="w-full bg-brand-600 hover:bg-brand-700 p-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md shadow-brand-600/10">
                <MessageCircle className="w-5 h-5 text-white" />
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Share Private Link on WhatsApp</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { void copyLink(); }} className="bg-slate-50 hover:bg-slate-100 p-4 rounded-2xl flex flex-col items-center gap-2 transition-all active:scale-95 group">
                <Copy className="w-5 h-5 text-slate-400 group-hover:text-brand-600" />
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Link</span>
              </button>
              <button onClick={() => { void shareWhatsApp(); }} className="bg-brand-600 hover:bg-brand-700 p-4 rounded-2xl flex flex-col items-center gap-2 transition-all active:scale-95 shadow-md shadow-brand-600/10">
                <MessageCircle className="w-5 h-5 text-white" />
                <span className="text-[9px] font-bold text-white uppercase tracking-wider">WhatsApp</span>
              </button>
            </div>
          )}
        </section>

        {(event.visibility || (event.is_public ? 'public' : 'private')) === 'semi_public' && (
          <section className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Access Requests</h2>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {pendingRequests.length} pending
              </span>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowDeclinedRequests((prev) => !prev)}
                className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all"
              >
                {showDeclinedRequests ? 'View Active' : `View Declined (${declinedRequests.length})`}
              </button>
            </div>

            {visibleRequests.length === 0 ? (
              <p className="text-sm text-slate-400 italic">
                {showDeclinedRequests ? 'No declined requests.' : 'No active requests yet.'}
              </p>
            ) : (
              <div className="space-y-3">
                {visibleRequests.slice(0, 8).map((request) => (
                  <div key={request.id} className="rounded-2xl border border-slate-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-800 text-sm">{request.requester_name}</p>
                        <p className="text-xs text-slate-500 font-medium">{request.requester_whatsapp}</p>
                        {request.requester_note && (
                          <p className="text-xs text-slate-500 mt-2">{request.requester_note}</p>
                        )}
                      </div>
                      <span className="text-[9px] font-black uppercase tracking-widest bg-slate-50 text-slate-500 px-2 py-1 rounded-lg">
                        {request.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                      <button
                        onClick={() => openRequestWhatsapp(request, 'approve')}
                        disabled={requestActionLoadingId === request.id || request.status === 'declined'}
                        className="px-3 py-2 rounded-xl bg-brand-600 text-white text-xs font-black hover:bg-brand-500 transition-all disabled:opacity-50"
                      >
                        Share Private Link
                      </button>
                      <button
                        onClick={() => openRequestWhatsapp(request, 'more_info')}
                        disabled={requestActionLoadingId === request.id || request.status === 'declined'}
                        className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 transition-all disabled:opacity-50"
                      >
                        Request Info
                      </button>
                      <button
                        onClick={() => openRequestWhatsapp(request, 'decline')}
                        disabled={requestActionLoadingId === request.id || request.status === 'declined'}
                        className="px-3 py-2 rounded-xl bg-red-50 text-red-500 text-xs font-black hover:bg-red-100 transition-all disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Attendee List */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Going</h2>
            <button 
              onClick={() => setShowAddModal(true)}
              className="text-brand-600 font-bold text-xs flex items-center gap-1.5 hover:bg-brand-50 px-3 py-1.5 rounded-lg transition-all"
            >
              <Plus className="w-4 h-4" /> Add Person
            </button>
          </div>
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            {confirmed.length === 0 ? (
              <p className="p-10 text-center text-slate-400 text-sm italic">No one has said they're in yet.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {confirmed.map((a) => (
                  <div key={a.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
                        <CheckCircle2 className="w-5 h-5 text-brand-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-800 text-sm">{getDisplayName(a.guest_name, a.guest_email)}</p>
                          {getAddedByLabel(a) && (
                            <span className="text-[11px] text-slate-400 font-medium">{getAddedByLabel(a)}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 font-medium">{a.guest_email}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowDeleteModal({ show: true, type: 'attendee', id: a.id, name: getDisplayName(a.guest_name, a.guest_email) })} 
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Waitlist */}
        {event.allow_waitlist && (
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Waitlist</h2>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{waitlist.length} People</span>
            </div>
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              {waitlist.length === 0 ? (
                <p className="p-10 text-center text-slate-400 text-sm italic">Waitlist is empty.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {waitlist.map((a, i) => (
                    <div key={a.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-all group">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                          <Clock className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-800 text-sm">{getDisplayName(a.guest_name, a.guest_email)}</p>
                            {getAddedByLabel(a) && (
                              <span className="text-[11px] text-slate-400 font-medium">{getAddedByLabel(a)}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 font-medium">#{i + 1} on waitlist</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowDeleteModal({ show: true, type: 'attendee', id: a.id, name: getDisplayName(a.guest_name, a.guest_email) })} 
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Danger Zone */}
        <section className="pt-8 pb-12">
          <button 
            onClick={() => {
              setConfirmText('');
              setShowDeleteModal({ show: true, type: 'event', id: event.id });
            }}
            className="w-full p-4 rounded-2xl border border-red-100 text-red-500 text-sm font-bold hover:bg-red-50 transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            <Trash2 className="w-4 h-4" /> Delete Activity
          </button>
        </section>
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteModal({ ...showDeleteModal, show: false })}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex items-center justify-center w-16 h-16 bg-red-50 rounded-2xl mb-6 mx-auto">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              
              <h2 className="text-xl font-bold text-center text-slate-900 tracking-tight mb-2">
                {showDeleteModal.type === 'event' ? 'Delete Activity?' : 'Remove Attendee?'}
              </h2>
              <p className="text-slate-500 text-center mb-8 text-sm font-medium leading-relaxed px-2">
                {showDeleteModal.type === 'event' 
                  ? 'This will permanently delete the activity and all attendee records. This action cannot be undone.'
                  : `Are you sure you want to remove ${showDeleteModal.name} from the list?`}
              </p>

              {showDeleteModal.type === 'event' && (
                <div className="mb-8">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 text-center">
                    Type <span className="text-red-500">delete</span> to confirm
                  </label>
                  <input
                    type="text"
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 text-center font-bold text-lg"
                    placeholder="delete"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal({ ...showDeleteModal, show: false })}
                  className="flex-1 p-3.5 rounded-xl bg-slate-50 text-slate-500 font-bold hover:bg-slate-100 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={() => showDeleteModal.type === 'event' ? deleteEvent() : removeAttendee(showDeleteModal.id)}
                  disabled={actionLoading || (showDeleteModal.type === 'event' && confirmText.toLowerCase() !== 'delete')}
                  className="flex-1 p-3.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-500/10 disabled:opacity-50 active:scale-95"
                >
                  {actionLoading ? 'Deleting...' : showDeleteModal.type === 'event' ? 'Delete' : 'Remove'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Attendee Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Add Attendee</h2>
                <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              
              <form onSubmit={handleAddAttendee} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Guest Name</label>
                  <input
                    required
                    type="text"
                    className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                    placeholder="e.g. Alex Smith"
                    value={newAttendee.name}
                    onChange={e => setNewAttendee({ ...newAttendee, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Email (Optional)</label>
                  <input
                    type="email"
                    className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                    placeholder="guest@example.com"
                    value={newAttendee.email}
                    onChange={e => setNewAttendee({ ...newAttendee, email: e.target.value })}
                  />
                </div>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-brand-600/10 mt-2 disabled:opacity-50 active:scale-95"
                >
                  {actionLoading ? 'Adding...' : 'Add to Activity'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="max-w-2xl mx-auto px-6 mt-12 pb-10 text-center">
        <p className="text-slate-300 text-[9px] font-bold uppercase tracking-[0.2em]">
          Powered by Lalo
        </p>
      </footer>
    </div>
  );
}
