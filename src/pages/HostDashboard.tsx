import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { Users, Share2, Copy, MessageCircle, ArrowLeft, Trash2, CheckCircle2, Clock, Edit2, Plus, X, AlertCircle, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate, formatDurationMinutes, generateSlug } from '../utils';
import { Event, Attendee, EventAccessRequest, EventInterest } from '../types';
import { decideRsvpStatus, getConfirmedCount, isRsvpBlocked } from '../lib/rsvp';
import { goBackOr } from '../lib/navigation';
import { guestService, getAccountNameFromUser } from '../services/guestService';

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
  const [accessRequestView, setAccessRequestView] = useState<'pending' | 'approved' | 'declined'>('pending');
  const [interests, setInterests] = useState<EventInterest[]>([]);
  const [hosts, setHosts] = useState<Array<{ user_id: string; display_name: string; email: string }>>([]);
  const [hostEmailToAdd, setHostEmailToAdd] = useState('');
  const [hostActionLoading, setHostActionLoading] = useState(false);
  const [showHostsPanel, setShowHostsPanel] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState<{
    show: boolean;
    type: 'event' | 'attendee';
    id: string;
    name?: string;
  }>({ show: false, type: 'event', id: '' });
  const [confirmText, setConfirmText] = useState('');

  const pickFirstNonEmpty = (...values: Array<string | null | undefined>) =>
    values.map((value) => (value || '').trim()).find(Boolean) || '';

  const getProfileName = (profile?: { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null) =>
    pickFirstNonEmpty(
      profile?.full_name,
      `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim(),
    );

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
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'event_interests',
        filter: `event_id=eq.${id}`
      }, () => {
        fetchInterests(id!);
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

    if (error || !user) {
      console.error(error);
      navigate('/');
    } else {
      const { data: hostMembership } = await supabase
        .from('event_hosts')
        .select('id')
        .eq('event_id', data.id)
        .eq('user_id', user.id)
        .maybeSingle();

      const canManage = data.host_user_id === user.id || !!hostMembership?.id;
      if (!canManage) {
        navigate('/');
        return;
      }

      let normalizedEvent = data;

      if (data.host_user_id === user.id) {
        const profile = await guestService.getOrCreateProfileForUser(user);
        const preferredHostName = pickFirstNonEmpty(
          getAccountNameFromUser(user),
          getProfileName(profile),
          data.host_name,
          getDisplayName('', user.email || ''),
        );

        if (preferredHostName && preferredHostName !== (data.host_name || '').trim()) {
          const { error: updateHostNameError } = await supabase
            .from('events')
            .update({ host_name: preferredHostName })
            .eq('id', data.id);

          if (!updateHostNameError) {
            normalizedEvent = { ...data, host_name: preferredHostName };
          }
        }
      }

      setEvent(normalizedEvent);
      fetchAttendees(normalizedEvent.id);
      fetchAccessRequests(normalizedEvent.id);
      fetchInterests(normalizedEvent.id);
      fetchHosts(normalizedEvent.id, normalizedEvent.host_user_id || null, normalizedEvent.host_name || null);
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

  const fetchInterests = async (eventId: string) => {
    const { data } = await supabase
      .from('event_interests')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (data) setInterests(data as EventInterest[]);
  };

  const fetchHosts = async (eventId: string, fallbackHostUserId?: string | null, primaryHostName?: string | null) => {
    const { data: hostRows } = await supabase
      .from('event_hosts')
      .select('user_id')
      .eq('event_id', eventId);

    const hostUserIds = Array.from(new Set((hostRows || []).map((row: any) => row.user_id).filter(Boolean)));

    if (hostUserIds.length === 0 && fallbackHostUserId) {
      hostUserIds.push(fallbackHostUserId);
    }

    if (hostUserIds.length === 0) {
      setHosts([]);
      return;
    }

    const { data: profiles } = await supabase
      .from('attendee_profiles')
      .select('user_id, full_name, first_name, last_name, email')
      .in('user_id', hostUserIds);

    const { data: latestHostedNames } = await supabase
      .from('events')
      .select('host_user_id, host_name, created_at')
      .in('host_user_id', hostUserIds)
      .not('host_name', 'is', null)
      .order('created_at', { ascending: false });

    const profileMap = (profiles || []).reduce((acc: Record<string, any>, row: any) => {
      if (row.user_id) acc[row.user_id] = row;
      return acc;
    }, {});

    const hostedNameByUserId = (latestHostedNames || []).reduce((acc: Record<string, string>, row: any) => {
      const hostUserId = row.host_user_id;
      const hostName = (row.host_name || '').trim();
      if (!hostUserId || !hostName || acc[hostUserId]) return acc;
      acc[hostUserId] = hostName;
      return acc;
    }, {});

    const normalizedHosts = hostUserIds.map((userId) => {
      const profile = profileMap[userId];
      const email = (profile?.email || '').trim().toLowerCase();
      const displayName = pickFirstNonEmpty(
        userId === user?.id ? getAccountNameFromUser(user) : '',
        getProfileName(profile),
        hostedNameByUserId[userId],
        userId === fallbackHostUserId ? primaryHostName : '',
        getDisplayName('', email),
      );
      return {
        user_id: userId,
        display_name: displayName,
        email,
      };
    });

    setHosts(normalizedHosts);
  };

  const addHost = async () => {
    if (!event || !user) return;
    const normalizedEmail = hostEmailToAdd.trim().toLowerCase();
    if (!normalizedEmail) return;

    if (hosts.length >= 10) {
      alert('Host limit reached (10).');
      return;
    }

    setHostActionLoading(true);
    try {
      const { data: profile } = await supabase
        .from('attendee_profiles')
        .select('user_id, full_name, email')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (!profile?.user_id) {
        throw new Error('This email is not linked to an active account yet.');
      }

      if (hosts.some((host) => host.user_id === profile.user_id)) {
        throw new Error('That person is already a host.');
      }

      const { error } = await supabase
        .from('event_hosts')
        .insert([
          {
            event_id: event.id,
            user_id: profile.user_id,
            added_by_user_id: user.id,
          },
        ]);

      if (error) throw error;
      setHostEmailToAdd('');
      await fetchHosts(event.id);
    } catch (error: any) {
      alert(error.message || 'Could not add host.');
    } finally {
      setHostActionLoading(false);
    }
  };

  const leaveAsHost = async () => {
    if (!event || !user) return;
    if (hosts.length <= 1) {
      alert('You are the last host. Delete the activity instead.');
      return;
    }

    setHostActionLoading(true);
    try {
      if (event.host_user_id === user.id) {
        const nextPrimaryHost = hosts.find((host) => host.user_id !== user.id);
        if (!nextPrimaryHost?.user_id) {
          throw new Error('Could not reassign primary host.');
        }
        const { error: reassignError } = await supabase
          .from('events')
          .update({ host_user_id: nextPrimaryHost.user_id })
          .eq('id', event.id);
        if (reassignError) throw reassignError;
      }

      const { error } = await supabase
        .from('event_hosts')
        .delete()
        .eq('event_id', event.id)
        .eq('user_id', user.id);

      if (error) throw error;
      navigate('/');
    } catch (error: any) {
      alert(error.message || 'Could not leave as host.');
    } finally {
      setHostActionLoading(false);
    }
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

      const hostUserIds = hosts.length > 0
        ? hosts.map((host) => host.user_id)
        : user?.id
          ? [user.id]
          : [];

      if (hostUserIds.length > 0) {
        const hostRows = hostUserIds.map((hostUserId) => ({
          event_id: newEvent.id,
          user_id: hostUserId,
          added_by_user_id: user?.id || hostUserId,
        }));
        const { error: hostCopyError } = await supabase
          .from('event_hosts')
          .insert(hostRows);
        if (hostCopyError) throw hostCopyError;
      }

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
      <div className="min-h-screen bg-slate-50 pb-24">
        <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
          <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="w-9 h-9 bg-slate-100 rounded-xl animate-pulse" />
            <div className="w-32 h-4 bg-slate-100 rounded-full animate-pulse" />
            <div className="w-9 h-9 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        </div>
        <main className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />)}
          </div>
          <div className="h-32 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />)}
          </div>
        </main>
      </div>
    );
  }

  const confirmed = attendees.filter(a => a.status === 'confirmed');
  const waitlist = attendees.filter(a => a.status === 'waitlist');
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
  const namedInterests = interests.filter((interest) => interest.visibility_mode === 'named');
  const pendingRequests = accessRequests.filter((r) => r.status === 'pending');
  const approvedRequests = accessRequests.filter((r) => r.status === 'approved');
  const declinedRequests = accessRequests.filter((r) => r.status === 'declined');
  const visibleRequests =
    accessRequestView === 'approved'
      ? approvedRequests
      : accessRequestView === 'declined'
        ? declinedRequests
        : pendingRequests;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => goBackOr(navigate, '/')} className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Manage Activity</h1>
            <span className="text-[10px] font-medium text-slate-400 truncate max-w-[160px]">{event.title}</span>
          </div>
          <button 
            onClick={() => navigate(`/host/events/${event.id}/edit`)}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all active:scale-95"
            title="Edit Activity"
          >
            <Edit2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* At-a-glance row: When · Going · Waitlist */}
        <section className="grid grid-cols-3 gap-3">
          <div className="col-span-1 bg-white p-3 rounded-2xl flex flex-col justify-between">
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-1">When</p>
            <p className="text-xs font-bold text-slate-900 leading-snug">{formatDate(event.starts_at, event.timezone)}</p>
            <p className="text-[10px] text-slate-400 mt-1">{formatDurationMinutes(event.duration_minutes)}</p>
          </div>
          <div className="bg-white p-3 rounded-2xl">
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-1">Going</p>
            <p className="text-lg font-bold text-slate-900 tracking-tight">{confirmed.length} <span className="text-slate-300 text-base font-light">/</span> {event.capacity}</p>
          </div>
          <div className="bg-white p-3 rounded-2xl">
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-1">Waitlist</p>
            <p className="text-lg font-bold text-slate-900 tracking-tight">{waitlist.length}</p>
          </div>
        </section>

        <section className="bg-white rounded-2xl p-4">
          <button
            type="button"
            onClick={() => setShowHostsPanel((value) => !value)}
            className="w-full flex items-center justify-between gap-3 text-left"
            aria-expanded={showHostsPanel}
          >
            <p className="text-sm font-bold text-slate-800">Hosts ({hosts.length})</p>
            <div className="flex items-center gap-2 text-slate-400">
              {showHostsPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {showHostsPanel ? (
            <div className="mt-4 space-y-4">
              <div className="divide-y divide-slate-50">
                {hosts.map((host) => (
                  <div key={host.user_id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="text-sm font-bold text-slate-800">
                      {host.display_name}
                      {host.user_id === user?.id ? <span className="text-xs text-slate-400 font-medium"> (you)</span> : null}
                    </p>
                    <p className="text-[11px] text-slate-400">{host.email || 'No email'}</p>
                  </div>
                ))}
                {hosts.length === 0 && (
                  <p className="text-xs text-slate-400 py-2">No hosts found.</p>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="email"
                  value={hostEmailToAdd}
                  onChange={(e) => setHostEmailToAdd(e.target.value)}
                  placeholder="Add host by email"
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
                />
                <button
                  type="button"
                  onClick={addHost}
                  disabled={hostActionLoading || !hostEmailToAdd.trim()}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  Add
                </button>
              </div>

              {hosts.length > 1 ? (
                <button
                  type="button"
                  onClick={leaveAsHost}
                  disabled={hostActionLoading}
                  className="text-xs text-slate-400 hover:text-slate-600 underline transition-all disabled:opacity-50"
                >
                  Leave as host
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Share Tools */}
        <section className="bg-white rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest">Share Activity</p>
            <button
              type="button"
              onClick={() => navigate(`/events/${event.slug}`)}
              className="text-xs font-bold text-slate-400 hover:text-brand-600 transition-all active:scale-95"
            >
              View Activity
            </button>
          </div>
          {(event.visibility || (event.is_public ? 'public' : 'private')) === 'semi_public' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={copyPublicPreviewLink} className="bg-slate-50 hover:bg-slate-100 p-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95">
                  <Copy className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold text-slate-600">Public Link</span>
                </button>
                <button onClick={() => { void copyLink(); }} className="bg-slate-50 hover:bg-slate-100 p-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95">
                  <Copy className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-bold text-slate-600">Private Link</span>
                </button>
              </div>
              <button onClick={() => { void shareWhatsApp(); }} className="w-full bg-brand-600 hover:bg-brand-700 p-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95">
                <MessageCircle className="w-5 h-5 text-white" />
                <span className="text-sm font-bold text-white">Share Private Link via WhatsApp</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { void copyLink(); }} className="bg-slate-50 hover:bg-slate-100 p-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95">
                <Copy className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-600">Copy Link</span>
              </button>
              <button onClick={() => { void shareWhatsApp(); }} className="bg-brand-600 hover:bg-brand-700 p-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95">
                <MessageCircle className="w-4 h-4 text-white" />
                <span className="text-xs font-bold text-white">WhatsApp</span>
              </button>
            </div>
          )}
        </section>

        {(event.visibility || (event.is_public ? 'public' : 'private')) === 'semi_public' && (
          <section className="bg-white rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest">Access Requests</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAccessRequestView('pending')}
                  className={`text-xs transition-all ${
                    accessRequestView === 'pending'
                      ? 'font-bold text-slate-500'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {pendingRequests.length} pending
                </button>
                <button
                  type="button"
                  onClick={() => setAccessRequestView('approved')}
                  className={`text-xs underline transition-all ${
                    accessRequestView === 'approved'
                      ? 'font-bold text-slate-500'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Approved ({approvedRequests.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAccessRequestView('declined')}
                  className={`text-xs underline transition-all ${
                    accessRequestView === 'declined'
                      ? 'font-bold text-slate-500'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Declined ({declinedRequests.length})
                </button>
              </div>
            </div>

            {visibleRequests.length === 0 ? (
              <p className="text-sm text-slate-400">
                {accessRequestView === 'approved'
                  ? 'No approved requests.'
                  : accessRequestView === 'declined'
                    ? 'No declined requests.'
                    : 'No pending requests.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-50">
                {visibleRequests.slice(0, 8).map((request) => (
                  <div key={request.id} className="py-4 first:pt-0">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-bold text-slate-800 text-sm">{request.requester_name}</p>
                        <p className="text-xs text-slate-400">{request.requester_whatsapp}</p>
                        {request.requester_note && (
                          <p className="text-xs text-slate-500 mt-1">{request.requester_note}</p>
                        )}
                      </div>
                      <span className="text-[9px] font-medium uppercase tracking-widest text-slate-400">
                        {request.status}
                      </span>
                    </div>
                    {request.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openRequestWhatsapp(request, 'approve')}
                          disabled={requestActionLoadingId === request.id}
                          className="flex-1 px-3 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-500 transition-all active:scale-95 disabled:opacity-50"
                        >
                          Share Link
                        </button>
                        <button
                          onClick={() => openRequestWhatsapp(request, 'more_info')}
                          disabled={requestActionLoadingId === request.id}
                          className="flex-1 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50"
                        >
                          More Info
                        </button>
                        <button
                          onClick={() => openRequestWhatsapp(request, 'decline')}
                          disabled={requestActionLoadingId === request.id}
                          className="px-3 py-2 rounded-xl text-red-400 text-xs font-bold hover:bg-red-50 transition-all active:scale-95 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        {request.status === 'approved'
                          ? 'Approved and archived.'
                          : 'Declined and archived.'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Attendee List */}
        <section className="bg-white rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest">Going</p>
            <button 
              onClick={() => setShowAddModal(true)}
              className="text-brand-600 font-bold text-xs flex items-center gap-1 hover:text-brand-500 transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" /> Add Person
            </button>
          </div>
          {confirmed.length === 0 ? (
            <div className="px-5 pb-6 pt-2">
              <p className="text-sm text-slate-400 mb-3">No one's joined yet.</p>
              <button
                onClick={() => { void shareWhatsApp(); }}
                className="text-sm font-bold text-brand-600 hover:text-brand-500 transition-all"
              >
                Share on WhatsApp to get people signing up →
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {confirmed.map((a) => (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-all group">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-800 text-sm">{getDisplayName(a.guest_name, a.guest_email)}</p>
                      {getAddedByLabel(a) && (
                        <span className="text-[11px] text-slate-400">{getAddedByLabel(a)}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{a.guest_email}</p>
                  </div>
                  <button 
                    onClick={() => setShowDeleteModal({ show: true, type: 'attendee', id: a.id, name: getDisplayName(a.guest_name, a.guest_email) })} 
                    className="p-2 text-slate-300 hover:text-red-400 rounded-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 active:scale-95"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Waitlist */}
        {event.allow_waitlist && waitlist.length > 0 && (
          <section className="bg-white rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest">Waitlist</p>
              <span className="text-xs text-slate-400">{waitlist.length}</span>
            </div>
            <div className="divide-y divide-slate-50">
              {waitlist.map((a, i) => (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-all group">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-800 text-sm">{getDisplayName(a.guest_name, a.guest_email)}</p>
                      {getAddedByLabel(a) && (
                        <span className="text-[11px] text-slate-400">{getAddedByLabel(a)}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">#{i + 1} on waitlist</p>
                  </div>
                  <button 
                    onClick={() => setShowDeleteModal({ show: true, type: 'attendee', id: a.id, name: getDisplayName(a.guest_name, a.guest_email) })} 
                    className="p-2 text-slate-300 hover:text-red-400 rounded-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 active:scale-95"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="bg-white rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest">Thinking About It</p>
            <span className="text-sm font-bold text-slate-800">{interests.length}</span>
          </div>
          {visibility === 'public' ? (
            <p className="text-xs text-slate-400 mt-2">Public activities show count only.</p>
          ) : namedInterests.length > 0 ? (
            <div className="mt-3 divide-y divide-slate-50">
              {namedInterests.slice(0, 6).map((interest) => (
                <div key={interest.id} className="py-2.5">
                  <p className="text-sm font-bold text-slate-800">{getDisplayName(interest.guest_name, interest.guest_email)}</p>
                  <p className="text-[11px] text-slate-400">{interest.guest_email}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 mt-2">No named interest yet.</p>
          )}
        </section>

        {/* Secondary actions */}
        <section className="pt-2 pb-12 flex flex-col items-center gap-4">
          <button
            onClick={copyEvent}
            disabled={actionLoading}
            className="text-sm text-slate-400 hover:text-slate-600 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
          >
            <Copy className="w-4 h-4" /> Duplicate for next week
          </button>
          <button 
            onClick={() => {
              setConfirmText('');
              setShowDeleteModal({ show: true, type: 'event', id: event.id });
            }}
            className="text-sm text-red-400 hover:text-red-500 transition-all"
          >
            Delete activity
          </button>
        </section>
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 overflow-y-auto overscroll-contain">
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
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 overflow-y-auto overscroll-contain">
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
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
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

    </div>
  );
}
