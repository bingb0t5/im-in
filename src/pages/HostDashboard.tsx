import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { Users, Copy, MessageCircle, ArrowLeft, Trash2, CheckCircle2, Clock, Edit2, Plus, X, AlertCircle, Calendar, ChevronDown, ChevronUp, MessageSquare, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate, formatDurationMinutes } from '../utils';
import { Event, Attendee, EventAccessRequest, EventInterest, EventJoinRequest } from '../types';
import { decideRsvpStatus, getConfirmedCount, isRsvpBlocked } from '../lib/rsvp';
import { getModerationBannerCopy, getModerationStatusBadge } from '../lib/moderation';
import { LOCKED_PUBLIC_LOCATION } from '../lib/publicLocation';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { guestService, getAccountNameFromUser } from '../services/guestService';
import { buildPrivateActivityUrl, buildPrivateWhatsappShareText } from '../lib/eventShare';

type InAppShareCandidate = {
  user_id: string;
  display_name: string;
  whatsapp_number: string | null;
  attended_previous: boolean;
  viewed_previous: boolean;
  engagement_tag: 'attended' | 'viewed_private' | 'both' | string;
  already_shared: boolean;
  selected_by_default: boolean;
};

type EventAccessLogEntry = {
  user_id: string;
  display_name: string;
  whatsapp_number: string | null;
  first_seen_at: string;
  last_seen_at: string;
  view_count: number;
};

type NotificationRecipient = {
  user_id: string;
  display_name: string;
  whatsapp_number: string | null;
  source: string;
  attendee_status: string | null;
};

type PrivateAccessUser = {
  user_id: string;
  display_name: string;
  whatsapp_number: string | null;
  source: 'link' | 'code' | 'host_share' | string;
  granted_at: string;
};

type HostDashboardTab = 'requests' | 'people' | 'share' | 'settings';
type NotificationActionOption = 'none' | 'view_activity' | 'reply';
type HostAttendee = Attendee & {
  whatsapp_number?: string | null;
  resolved_user_id?: string | null;
  resolved_display_name?: string | null;
};
type HostJoinRequest = EventJoinRequest & { whatsapp_number?: string | null };
type HostInterest = EventInterest & { whatsapp_number?: string | null };

export default function HostDashboard({ user }: { user: User | null }) {
  const CREATE_EVENT_SUCCESS_KEY = 'im_in_recently_created_event_id';
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<HostAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAttendee, setNewAttendee] = useState({ name: '', email: '' });
  const [actionLoading, setActionLoading] = useState(false);
  const [adderNamesByProfileId, setAdderNamesByProfileId] = useState<Record<string, string>>({});
  const [accessRequests, setAccessRequests] = useState<EventAccessRequest[]>([]);
  const [requestActionLoadingId, setRequestActionLoadingId] = useState<string | null>(null);
  const [accessRequestView, setAccessRequestView] = useState<'pending' | 'approved' | 'declined'>('pending');
  const [joinRequests, setJoinRequests] = useState<HostJoinRequest[]>([]);
  const [joinRequestActionLoadingId, setJoinRequestActionLoadingId] = useState<string | null>(null);
  const [joinRequestView, setJoinRequestView] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [interests, setInterests] = useState<HostInterest[]>([]);
  const [hosts, setHosts] = useState<Array<{ user_id: string; display_name: string; whatsapp_number: string | null }>>([]);
  const [hostEmailToAdd, setHostEmailToAdd] = useState('');
  const [hostActionLoading, setHostActionLoading] = useState(false);
  const [showHostsPanel, setShowHostsPanel] = useState(false);
  const [showCreateSuccessModal, setShowCreateSuccessModal] = useState(false);
  const [showManualShareModal, setShowManualShareModal] = useState(false);
  const [manualShareUrl, setManualShareUrl] = useState('');
  const [inAppShareCandidates, setInAppShareCandidates] = useState<InAppShareCandidate[]>([]);
  const [selectedShareUserIds, setSelectedShareUserIds] = useState<string[]>([]);
  const [inAppShareLoading, setInAppShareLoading] = useState(false);
  const [inAppShareSaving, setInAppShareSaving] = useState(false);
  const [inAppShareMessage, setInAppShareMessage] = useState<string | null>(null);
  const [manualWhatsappLookup, setManualWhatsappLookup] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupCandidate, setLookupCandidate] = useState<InAppShareCandidate | null>(null);
  const [lookupNotFound, setLookupNotFound] = useState(false);
  const [showInAppSharePrompt, setShowInAppSharePrompt] = useState(false);
  const [showInAppShareModal, setShowInAppShareModal] = useState(false);
  const [eventAccessLog, setEventAccessLog] = useState<EventAccessLogEntry[]>([]);
  const [eventAccessLogLoading, setEventAccessLogLoading] = useState(false);
  const [eventAccessLogError, setEventAccessLogError] = useState<string | null>(null);
  const [notificationRecipients, setNotificationRecipients] = useState<NotificationRecipient[]>([]);
  const [notificationRecipientsLoading, setNotificationRecipientsLoading] = useState(false);
  const [privateAccessUsers, setPrivateAccessUsers] = useState<PrivateAccessUser[]>([]);
  const [privateAccessUsersLoading, setPrivateAccessUsersLoading] = useState(false);
  const [privateAccessUsersError, setPrivateAccessUsersError] = useState<string | null>(null);
  const [notificationTarget, setNotificationTarget] = useState<'all_access' | 'confirmed' | 'waitlist' | 'selected'>('all_access');
  const [selectedNotificationUserIds, setSelectedNotificationUserIds] = useState<string[]>([]);
  const [notificationTitle, setNotificationTitle] = useState('');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationAction, setNotificationAction] = useState<NotificationActionOption>('view_activity');
  const [notificationSending, setNotificationSending] = useState(false);
  const [notificationSendMessage, setNotificationSendMessage] = useState<string | null>(null);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [settingsSavingKey, setSettingsSavingKey] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HostDashboardTab>('requests');
  const [showShareInsights, setShowShareInsights] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState<{
    show: boolean;
    type: 'event' | 'attendee';
    id: string;
    name?: string;
  }>({ show: false, type: 'event', id: '' });
  const [confirmText, setConfirmText] = useState('');

  useBodyScrollLock(
    showAddModal
    || showCreateSuccessModal
    || showDeleteModal.show
    || showManualShareModal
    || showInAppShareModal
    || showNotificationModal,
  );

  const pickFirstNonEmpty = (...values: Array<string | null | undefined>) =>
    values.map((value) => (value || '').trim()).find(Boolean) || '';

  const getProfileName = (profile?: { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null) =>
    pickFirstNonEmpty(
      profile?.full_name,
      `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim(),
    );

  const getDisplayName = (name?: string | null) => {
    const explicitName = (name || '').trim();
    if (explicitName) return explicitName;
    return 'Guest';
  };

  const getDisplayWhatsapp = (whatsapp?: string | null) => (whatsapp || '').trim() || 'No WhatsApp available';

  const getEngagementTagLabel = (candidate: InAppShareCandidate) => {
    if (candidate.attended_previous || candidate.engagement_tag === 'attended' || candidate.engagement_tag === 'both') {
      return 'Has attended';
    }
    return 'Viewed link only';
  };

  const normalizeWhatsapp = (value: string) => value.replace(/[^\d]/g, '');
  const formatSharedSource = (source: PrivateAccessUser['source']) => {
    if (source === 'host_share') return 'Shared by host';
    if (source === 'code') return 'Unlocked via join code';
    return 'Opened private link';
  };

  const getPublicPreviewUrl = () => {
    if (!event) return '';
    const publicSlug = event.public_slug || event.slug;
    return `${window.location.origin}/events/${publicSlug}`;
  };

  const getPrivateShareUrl = () => {
    if (!event) return '';
    return buildPrivateActivityUrl(window.location.origin, event);
  };

  const buildInviteText = (fallbackUrl = '') => {
    if (!event) return fallbackUrl;
    return buildPrivateWhatsappShareText(window.location.origin, event);
  };

  const copyInviteFallback = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        alert('Invite copied to clipboard!');
        return;
      } catch {
        // Fall through to older copy strategies.
      }
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const copied = document.execCommand('copy');
      if (copied) {
        alert('Invite copied to clipboard!');
        return;
      }
    } catch {
      // Fall through to prompt.
    } finally {
      document.body.removeChild(textArea);
    }

    window.prompt('Copy this invite', text);
  };

  const openManualShareModal = (url: string) => {
    setManualShareUrl(url);
    setShowManualShareModal(true);
  };

  const ensurePrivateAccessUrl = async () => {
    if (!event) return '';
    return getPrivateShareUrl();
  };

  const openWhatsAppToNumber = async (rawNumber: string) => {
    if (!event) return;
    const number = normalizeWhatsapp(rawNumber);
    if (!number) {
      alert('Please enter a valid WhatsApp number.');
      return;
    }
    const url = await ensurePrivateAccessUrl();
    if (!url) return;
    const inviteText = buildInviteText(url);
    window.location.href = `https://wa.me/${number}?text=${encodeURIComponent(inviteText)}`;
  };

  const fetchInAppShareCandidates = async (eventId: string) => {
    setInAppShareLoading(true);
    try {
      const { data, error } = await supabase.rpc('host_list_share_suggestions_secure', {
        p_event_id: eventId,
      });
      if (error) throw error;
      const candidates = (data || []) as InAppShareCandidate[];
      setInAppShareCandidates(candidates);
      setSelectedShareUserIds(
        candidates
          .filter((candidate) => candidate.selected_by_default)
          .map((candidate) => candidate.user_id),
      );
    } catch (error) {
      console.warn('Could not load in-app share candidates:', error);
      setInAppShareCandidates([]);
      setSelectedShareUserIds([]);
    } finally {
      setInAppShareLoading(false);
    }
  };

  const fetchEventAccessLog = async (eventId: string) => {
    setEventAccessLogLoading(true);
    setEventAccessLogError(null);
    try {
      const { data, error } = await supabase.rpc('host_list_event_access_log_secure', {
        p_event_id: eventId,
      });
      if (error) throw error;
      setEventAccessLog((data || []) as EventAccessLogEntry[]);
    } catch (error: any) {
      setEventAccessLog([]);
      setEventAccessLogError(error?.message || 'Could not load access log right now.');
    } finally {
      setEventAccessLogLoading(false);
    }
  };

  const fetchNotificationRecipients = async (eventId: string) => {
    setNotificationRecipientsLoading(true);
    try {
      const { data, error } = await supabase.rpc('host_list_notification_recipients_secure', {
        p_event_id: eventId,
      });
      if (error) throw error;
      const recipients = (data || []) as NotificationRecipient[];
      setNotificationRecipients(recipients);
      setSelectedNotificationUserIds((prev) => prev.filter((id) => recipients.some((recipient) => recipient.user_id === id)));
    } catch (error) {
      console.warn('Could not load notification recipients:', error);
      setNotificationRecipients([]);
      setSelectedNotificationUserIds([]);
    } finally {
      setNotificationRecipientsLoading(false);
    }
  };

  const openNotificationModal = () => {
    if (!event) return;
    void fetchNotificationRecipients(event.id);
    setShowNotificationModal(true);
  };

  const openInAppShareModal = () => {
    if (!event) return;
    void fetchInAppShareCandidates(event.id);
    setShowInAppShareModal(true);
  };

  const updateEventSettings = async (updates: Partial<Event>, successMessage: string) => {
    if (!event) return;
    const updateKey = Object.keys(updates)[0] || 'settings';

    try {
      setSettingsSavingKey(updateKey);
      setSettingsMessage(null);
      const { data, error } = await supabase
        .from('events')
        .update(updates)
        .eq('id', event.id)
        .select()
        .single();

      if (error) throw error;

      setEvent((prev) => (prev ? { ...prev, ...(data as Partial<Event>) } : prev));
      setSettingsMessage(successMessage);
    } catch (error: any) {
      setSettingsMessage(error?.message || 'Could not save settings right now.');
    } finally {
      setSettingsSavingKey(null);
    }
  };

  const fetchPrivateAccessUsers = async (eventId: string) => {
    setPrivateAccessUsersLoading(true);
    setPrivateAccessUsersError(null);
    try {
      const { data, error } = await supabase.rpc('host_list_private_access_users_secure', {
        p_event_id: eventId,
      });
      if (error) throw error;
      setPrivateAccessUsers((data || []) as PrivateAccessUser[]);
    } catch (error: any) {
      setPrivateAccessUsers([]);
      setPrivateAccessUsersError(error?.message || 'Could not load shared private access list right now.');
    } finally {
      setPrivateAccessUsersLoading(false);
    }
  };

  const shareToSelectedUsers = async (userIds: string[]) => {
    if (!event || userIds.length === 0) return;
    try {
      setInAppShareSaving(true);
      setInAppShareMessage(null);
      const { data, error } = await supabase.rpc('host_share_event_with_users', {
        p_event_id: event.id,
        p_user_ids: userIds,
        p_source: 'link',
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);

      const sharedCount = Number(data?.shared_count || 0);
      const submittedCount = Number(data?.submitted_count || userIds.length);
      if (sharedCount > 0) {
        setInAppShareMessage(`Shared with ${sharedCount} account${sharedCount === 1 ? '' : 's'}.`);
      } else {
        setInAppShareMessage(
          submittedCount > 0
            ? 'Those people already had access.'
            : 'No recipients selected.',
        );
      }
      await fetchInAppShareCandidates(event.id);
      await fetchPrivateAccessUsers(event.id);
    } catch (error: any) {
      setInAppShareMessage(error.message || 'Could not share in app right now.');
    } finally {
      setInAppShareSaving(false);
    }
  };

  const lookupByWhatsapp = async () => {
    if (!event) return;
    const normalized = normalizeWhatsapp(manualWhatsappLookup);
    if (!normalized) {
      setLookupCandidate(null);
      setLookupNotFound(false);
      setInAppShareMessage('Enter a WhatsApp number first.');
      return;
    }

    try {
      setLookupLoading(true);
      setLookupCandidate(null);
      setLookupNotFound(false);
      setInAppShareMessage(null);
      const { data, error } = await supabase.rpc('host_lookup_user_by_whatsapp_secure', {
        p_event_id: event.id,
        p_whatsapp: manualWhatsappLookup,
      });
      if (error) throw error;

      const rows = (data || []) as InAppShareCandidate[];
      if (rows.length === 0) {
        setLookupNotFound(true);
        return;
      }
      setLookupCandidate(rows[0]);
    } catch (error: any) {
      setInAppShareMessage(error.message || 'Could not look up that WhatsApp number.');
    } finally {
      setLookupLoading(false);
    }
  };

  const getAddedByLabel = (attendee: HostAttendee) => {
    if (!attendee.added_by_type || attendee.added_by_type === 'self') return null;
    if (attendee.added_by_type === 'host') return 'added by host';
    if (attendee.added_by_type === 'proxy') {
      const adderId = attendee.added_by_attendee_profile_id || '';
      const adderName = adderNamesByProfileId[adderId];
      return adderName ? `added by ${adderName}` : 'added by attendee';
    }
    return null;
  };

  const isGuestAccountAttendee = (attendee: HostAttendee) => {
    if (attendee.user_id || attendee.resolved_user_id) return false;
    if (attendee.added_by_type && attendee.added_by_type !== 'self') return false;
    return true;
  };

  const getAttendeeDisplayName = (attendee: HostAttendee) => {
    const baseName = attendee.added_by_type === 'proxy'
      ? getDisplayName(attendee.guest_name || attendee.resolved_display_name)
      : getDisplayName(attendee.resolved_display_name || attendee.guest_name);
    return isGuestAccountAttendee(attendee) ? `${baseName} (guest account)` : baseName;
  };

  const hydrateAdderNames = async (attendeeRows: HostAttendee[]) => {
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
      .select('id, full_name')
      .in('id', ids);

    const map: Record<string, string> = {};
    (data || []).forEach((profile: any) => {
      const fullName = (profile.full_name || '').trim();
      map[profile.id] = fullName || 'attendee';
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
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'event_join_requests',
        filter: `event_id=eq.${id}`
      }, () => {
        fetchJoinRequests(id!);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, user]);

  useEffect(() => {
    const routeState = location.state as { justCreated?: boolean; openInAppShare?: boolean } | null;
    const justCreatedEventId = sessionStorage.getItem(CREATE_EVENT_SUCCESS_KEY);
    const shouldOpenSuccessModal = routeState?.justCreated || (!!id && justCreatedEventId === id);
    if (!shouldOpenSuccessModal) return;

    setShowCreateSuccessModal(true);
  }, [id, location.state]);

  useEffect(() => {
    const routeState = location.state as { openInAppShare?: boolean } | null;
    if (routeState?.openInAppShare) {
      setActiveTab('share');
      setShowInAppSharePrompt(true);
      setShowInAppShareModal(true);
    }
  }, [location.state]);

  const clearCreateSuccessState = () => {
    sessionStorage.removeItem(CREATE_EVENT_SUCCESS_KEY);

    const currentHistoryState = window.history.state as
      | { usr?: Record<string, unknown>; key?: string; idx?: number }
      | null;

    if (!currentHistoryState) return;

    const nextUserState = { ...(currentHistoryState.usr || {}) };
    delete nextUserState.justCreated;

    window.history.replaceState(
      {
        ...currentHistoryState,
        usr: nextUserState,
      },
      '',
      window.location.href,
    );
  };

  const dismissCreateSuccessModal = () => {
    clearCreateSuccessState();
    setShowCreateSuccessModal(false);
  };

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
      fetchJoinRequests(normalizedEvent.id);
      fetchInterests(normalizedEvent.id);
      fetchHosts(normalizedEvent.id, normalizedEvent.host_user_id || null, normalizedEvent.host_name || null);
      fetchInAppShareCandidates(normalizedEvent.id);
      fetchPrivateAccessUsers(normalizedEvent.id);
      fetchEventAccessLog(normalizedEvent.id);
      fetchNotificationRecipients(normalizedEvent.id);
    }
  };

  const sendHostNotification = async () => {
    if (!event) return;
    if (!notificationMessage.trim()) {
      setNotificationSendMessage('Write a message first.');
      return;
    }
    if (notificationTarget === 'selected' && selectedNotificationUserIds.length === 0) {
      setNotificationSendMessage('Select at least one recipient.');
      return;
    }

    try {
      setNotificationSending(true);
      setNotificationSendMessage(null);
      const actionConfig =
        notificationAction === 'view_activity'
          ? {
              actionUrl: `/events/${event.private_slug || event.join_code || event.slug}`,
              actionLabel: 'View activity',
            }
          : notificationAction === 'reply'
            ? {
                actionUrl: 'im-in://reply-to-host',
                actionLabel: 'Reply',
              }
            : {
                actionUrl: null,
                actionLabel: null,
              };
      const { data, error } = await supabase.rpc('host_send_activity_notification', {
        p_event_id: event.id,
        p_target: notificationTarget,
        p_user_ids: notificationTarget === 'selected' ? selectedNotificationUserIds : [],
        p_title: notificationTitle.trim() || null,
        p_message: notificationMessage.trim(),
        p_action_url: actionConfig.actionUrl,
        p_action_label: actionConfig.actionLabel,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);

      const sentCount = Number(data?.sent_count || 0);
      setNotificationSendMessage(`Notification sent to ${sentCount} account${sentCount === 1 ? '' : 's'}.`);
      setNotificationTitle('');
      setNotificationMessage('');
      setNotificationAction('view_activity');
      setShowNotificationModal(false);
      if (notificationTarget === 'selected') {
        setSelectedNotificationUserIds([]);
      }
    } catch (error: any) {
      setNotificationSendMessage(error?.message || 'Could not send notification right now.');
    } finally {
      setNotificationSending(false);
    }
  };

  const fetchAttendees = async (eventId: string) => {
    const { data, error } = await supabase.rpc('host_list_attendees_for_dashboard', {
      p_event_id: eventId,
    });

    if (error) {
      console.error('Host attendee fetch failed:', error);
      setAttendees([]);
      setLoading(false);
      return;
    }

    if (data) {
      const attendeeRows = data as HostAttendee[];
      setAttendees(attendeeRows);
      await hydrateAdderNames(attendeeRows);
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

  const fetchJoinRequests = async (eventId: string) => {
    const { data, error } = await supabase.rpc('host_list_join_requests_for_dashboard', {
      p_event_id: eventId,
      p_status: null,
    });

    if (error) {
      console.error('Could not load join requests:', error);
      setJoinRequests([]);
      return;
    }

    if (data) setJoinRequests(data as HostJoinRequest[]);
  };

  const fetchInterests = async (eventId: string) => {
    const { data, error } = await supabase.rpc('host_list_interests_for_dashboard', {
      p_event_id: eventId,
    });

    if (error) {
      console.error('Host interest fetch failed:', error);
      setInterests([]);
      return;
    }

    if (data) setInterests(data as HostInterest[]);
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
      .select('user_id, full_name, first_name, last_name, whatsapp_number')
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
      const displayName = pickFirstNonEmpty(
        userId === user?.id ? getAccountNameFromUser(user) : '',
        getProfileName(profile),
        hostedNameByUserId[userId],
        userId === fallbackHostUserId ? primaryHostName : '',
        'Host',
      );
      return {
        user_id: userId,
        display_name: displayName,
        whatsapp_number: (profile?.whatsapp_number || '').trim() || null,
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

      const { data: newEvent, error } = await supabase
        .from('events')
        .insert([{
          title: event.title,
          description: event.description,
          public_summary: event.public_summary,
          location_text: event.location_text,
          public_location_text: LOCKED_PUBLIC_LOCATION,
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
          require_host_approval_for_join: event.require_host_approval_for_join,
          is_public: event.is_public,
          public_discovery_enabled: event.public_discovery_enabled,
          require_guest_email_for_join: event.require_guest_email_for_join,
          copied_from_event_id: event.id,
          host_user_id: user?.id,
          status: 'scheduled',
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

      navigate(`/host/events/${newEvent.id}`, {
        state: { openInAppShare: true },
      });
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
      await copyInviteFallback(url);
    } catch (error: any) {
      alert(error.message || 'Could not prepare private link');
    }
  };

  const copyPublicPreviewLink = async () => {
    const url = getPublicPreviewUrl();
    await copyInviteFallback(url);
  };

  const shareWhatsApp = async () => {
    try {
      const url = await ensurePrivateAccessUrl();
      if (!url || !event) {
        return;
      }
      const inviteText = buildInviteText(url);
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;
      // Use same-tab navigation so returning from WhatsApp lands back on this activity page.
      window.location.href = whatsappUrl;
    } catch (error: any) {
      openManualShareModal(getPrivateShareUrl());
      alert(error.message || 'Could not prepare share');
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
      text = `Hi ${request.requester_name}, thanks for requesting access to ${event.title}. Here are the activity details:\n\n${buildInviteText(eventLink)}`;
    } else if (mode === 'decline') {
      status = 'declined';
      text = `Hi ${request.requester_name}, thanks for your request for ${event.title}. Sorry, we can't share this activity right now.`;
    } else {
      text = `Hi ${request.requester_name}, thanks for requesting access to ${event.title}. Can you please tell me a little more before I share the link?`;
    }

    try {
      setRequestActionLoadingId(request.id);
      if (status) {
        const { data, error } = await supabase.rpc('host_review_access_request', {
          p_request_id: request.id,
          p_action: status,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error as string);
        if (status === 'approved') {
          await fetchPrivateAccessUsers(event.id);
        }
      }

      const whatsappUrl = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
      // In-app browsers (like WhatsApp webview) may block async popups;
      // prefer same-tab navigation for reliability.
      window.location.href = whatsappUrl;
      fetchAccessRequests(event.id);
    } catch (error: any) {
      alert(error.message || 'Could not update request');
    } finally {
      setRequestActionLoadingId(null);
    }
  };

  const handleApproveJoinRequest = async (requestId: string) => {
    if (!event) return;
    try {
      setJoinRequestActionLoadingId(requestId);
      const { data, error } = await supabase.rpc('approve_event_join_request', {
        p_request_id: requestId,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await Promise.all([
        fetchJoinRequests(event.id),
        fetchAttendees(event.id),
      ]);
    } catch (error: any) {
      alert(error.message || 'Could not approve join request');
    } finally {
      setJoinRequestActionLoadingId(null);
    }
  };

  const handleRejectJoinRequest = async (requestId: string) => {
    if (!event) return;
    try {
      setJoinRequestActionLoadingId(requestId);
      const { data, error } = await supabase.rpc('reject_event_join_request', {
        p_request_id: requestId,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await fetchJoinRequests(event.id);
    } catch (error: any) {
      alert(error.message || 'Could not reject join request');
    } finally {
      setJoinRequestActionLoadingId(null);
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
  const pendingApprovalAttendees = attendees.filter(a => a.status === 'pending_approval');
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
  const namedInterests = interests.filter((interest) => interest.visibility_mode === 'named');
  const pendingRequests = accessRequests.filter((r) => r.status === 'pending');
  const approvedRequests = accessRequests.filter((r) => r.status === 'approved');
  const declinedRequests = accessRequests.filter((r) => r.status === 'declined');
  const pendingJoinRequests = joinRequests.filter((r) => r.status === 'pending');
  const approvedJoinRequests = joinRequests.filter((r) => r.status === 'approved');
  const rejectedJoinRequests = joinRequests.filter((r) => r.status === 'rejected');
  const moderationBanner = getModerationBannerCopy(event);
  const moderationStatusBadge = getModerationStatusBadge(event);
  const visibleRequests =
    accessRequestView === 'approved'
      ? approvedRequests
      : accessRequestView === 'declined'
        ? declinedRequests
        : pendingRequests;
  const visibleJoinRequests =
    joinRequestView === 'approved'
      ? approvedJoinRequests
      : joinRequestView === 'rejected'
        ? rejectedJoinRequests
        : pendingJoinRequests;
  const pendingReviewCount = pendingJoinRequests.length + pendingRequests.length;
  const canReviewJoinRequests = event.require_host_approval_for_join;
  const canReviewAccessRequests = visibility === 'semi_public';
  const renderPrimaryShareActions = ({
    iconClassName = 'w-5 h-5',
    labelClassName = 'text-sm font-bold',
    buttonClassName = 'p-4',
  }: {
    iconClassName?: string;
    labelClassName?: string;
    buttonClassName?: string;
  } = {}) => (
    <>
      <button
        type="button"
        onClick={() => {
          void shareWhatsApp();
        }}
        className={`rounded-xl bg-brand-600 ${buttonClassName} flex items-center justify-center gap-2 transition-all hover:bg-brand-700 active:scale-95`}
      >
        <MessageCircle className={`${iconClassName} text-white`} />
        <span className={`${labelClassName} text-white`}>WhatsApp</span>
      </button>
      <button
        type="button"
        onClick={openInAppShareModal}
        className={`rounded-xl bg-slate-50 ${buttonClassName} flex items-center justify-center gap-2 transition-all hover:bg-slate-100 active:scale-95`}
      >
        <Users className={`${iconClassName} text-slate-500`} />
        <span className={`${labelClassName} text-slate-700`}>Share In App</span>
      </button>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <button onClick={() => navigate('/my-activities')} className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div className="flex flex-col items-center min-w-0">
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
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* At-a-glance row: When · Going · Waitlist */}
        <section className="grid grid-cols-3 gap-3">
          <div className="col-span-1 rounded-2xl bg-white px-3 py-2.5">
            <p className="mb-1 text-[9px] font-medium uppercase tracking-widest text-slate-400">When</p>
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
              <p className="text-xs font-bold leading-snug text-slate-900">{formatDate(event.starts_at, event.timezone)}</p>
              <span className="text-[10px] text-slate-400">{formatDurationMinutes(event.duration_minutes)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('people')}
            className="rounded-2xl bg-white px-3 py-2.5 text-left transition-all hover:bg-slate-50 active:scale-[0.99]"
            aria-label="View people going to this activity"
          >
            <p className="mb-1 text-[9px] font-medium uppercase tracking-widest text-slate-400">Going</p>
            <p className="text-lg font-bold tracking-tight text-slate-900">{confirmed.length} <span className="text-base font-light text-slate-300">/</span> {event.capacity}</p>
            {pendingApprovalAttendees.length > 0 ? (
              <p className="mt-0.5 text-[10px] text-slate-400">{pendingApprovalAttendees.length} pending approval</p>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('people')}
            className="rounded-2xl bg-white px-3 py-2.5 text-left transition-all hover:bg-slate-50 active:scale-[0.99]"
            aria-label="View activity waitlist"
          >
            <p className="mb-1 text-[9px] font-medium uppercase tracking-widest text-slate-400">Waitlist</p>
            <p className="text-lg font-bold tracking-tight text-slate-900">{waitlist.length}</p>
          </button>
        </section>

        <section className="rounded-2xl bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-black tracking-tight text-brand-600">Quick Actions</p>
            <button
              type="button"
              onClick={() => navigate(`/events/${event.public_slug || event.slug}`)}
              className="text-xs font-bold text-slate-400 transition-all hover:text-brand-600 active:scale-95"
            >
              View Activity
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {renderPrimaryShareActions()}
            <button
              type="button"
              onClick={openNotificationModal}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center transition-all hover:border-brand-200 hover:bg-brand-50/40 active:scale-[0.99]"
            >
              <MessageSquare className="h-5 w-5 text-brand-600" />
              <span className="text-sm font-bold text-slate-700">Send Msg</span>
            </button>
            <button
              type="button"
              onClick={copyEvent}
              disabled={actionLoading}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center transition-all hover:border-brand-200 hover:bg-brand-50/40 active:scale-[0.99] disabled:opacity-50"
            >
              <Copy className="h-5 w-5 text-slate-500" />
              <span className="text-sm font-bold text-slate-700">Copy Activity</span>
            </button>
          </div>
          {notificationSendMessage ? (
            <p className="mt-3 px-1 text-xs font-bold text-slate-500">{notificationSendMessage}</p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-1">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`rounded-xl px-3 py-2 text-sm font-bold transition-all ${
                activeTab === 'requests' ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Requests {pendingReviewCount > 0 ? `(${pendingReviewCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('people')}
              className={`rounded-xl px-3 py-2 text-sm font-bold transition-all ${
                activeTab === 'people' ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              People
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('share')}
              className={`rounded-xl px-3 py-2 text-sm font-bold transition-all ${
                activeTab === 'share' ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Share
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`rounded-xl px-3 py-2 text-sm font-bold transition-all ${
                activeTab === 'settings' ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Settings
            </button>
          </div>
        </section>

        {activeTab === 'settings' && moderationStatusBadge ? (
          <div className="flex justify-start">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${moderationStatusBadge.className}`}>
              {moderationStatusBadge.label}
            </span>
          </div>
        ) : null}

        {activeTab === 'settings' && moderationBanner ? (
          <section className="bg-slate-100 border border-slate-200 rounded-2xl p-4">
            <p className="text-sm font-bold text-slate-800">{moderationBanner.title}</p>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">{moderationBanner.body}</p>
          </section>
        ) : null}

        {activeTab === 'people' ? (
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
                    <p className="text-[11px] text-slate-400">{getDisplayWhatsapp(host.whatsapp_number)}</p>
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
        ) : null}

        {activeTab === 'share' ? (
        <>
        {activeTab === 'share' ? (
        <>
        <section className="bg-white rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-black text-brand-600 tracking-tight">Share Activity</p>
          </div>
          {event.join_code ? (
            <div className="mb-4 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-700">Join code (case sensitive)</p>
              <p className="mt-1 text-lg font-black tracking-[0.2em] text-slate-900">{event.join_code}</p>
              <p className="mt-1 text-xs text-slate-500">People can enter this on Home to save the activity under Shared with you.</p>
            </div>
          ) : null}
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
              <div className="grid grid-cols-2 gap-3">
                {renderPrimaryShareActions()}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => { void copyLink(); }} className="bg-slate-50 hover:bg-slate-100 p-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95">
                <Copy className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-600">Copy Link</span>
              </button>
              {renderPrimaryShareActions({
                iconClassName: 'w-4 h-4',
                labelClassName: 'text-xs font-bold',
                buttonClassName: 'p-3',
              })}
            </div>
          )}
        </section>
        </>
        ) : null}

        <section className="bg-white rounded-2xl p-4">
          <button
            type="button"
            onClick={() => setShowShareInsights((value) => !value)}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={showShareInsights}
          >
            <p className="text-sm font-bold text-slate-800">Advanced Share Insights</p>
            {showShareInsights ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </button>
          {showShareInsights ? (
            <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
              <section className="rounded-2xl border border-slate-100 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[9px] font-medium uppercase tracking-widest text-slate-400">Shared Private Access</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (!event) return;
                      void fetchPrivateAccessUsers(event.id);
                    }}
                    disabled={privateAccessUsersLoading}
                    className="text-xs font-bold text-slate-500 hover:text-brand-600 transition-all disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">People who currently have direct private/shared access to this activity.</p>

                {privateAccessUsersLoading ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    Loading shared access list...
                  </div>
                ) : privateAccessUsersError ? (
                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-3 text-sm text-red-600">
                    {privateAccessUsersError}
                  </div>
                ) : privateAccessUsers.length > 0 ? (
                  <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                    {privateAccessUsers.map((entry) => (
                      <div key={entry.user_id} className="border-b border-slate-200 px-3 py-3 last:border-b-0">
                        <p className="truncate text-sm font-bold text-slate-800">{entry.display_name}</p>
                        <p className="truncate text-xs text-slate-500">{getDisplayWhatsapp(entry.whatsapp_number)}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                          {formatSharedSource(entry.source)} · {formatDate(entry.granted_at, event.timezone)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    Nobody has shared private access yet.
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-100 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[9px] font-medium uppercase tracking-widest text-slate-400">Private Link Access Log</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (!event) return;
                      void fetchEventAccessLog(event.id);
                    }}
                    disabled={eventAccessLogLoading}
                    className="text-xs font-bold text-slate-500 hover:text-brand-600 transition-all disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">Shows signed-in people who opened this activity’s private link.</p>

                {eventAccessLogLoading ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    Loading access log...
                  </div>
                ) : eventAccessLogError ? (
                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-3 text-sm text-red-600">
                    {eventAccessLogError}
                  </div>
                ) : eventAccessLog.length > 0 ? (
                  <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                    {eventAccessLog.map((entry) => (
                      <div key={entry.user_id} className="border-b border-slate-200 px-3 py-3 last:border-b-0">
                        <p className="truncate text-sm font-bold text-slate-800">{entry.display_name}</p>
                        <p className="truncate text-xs text-slate-500">{getDisplayWhatsapp(entry.whatsapp_number)}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                          Last opened {formatDate(entry.last_seen_at, event.timezone)}
                          {entry.view_count > 1 ? ` · ${entry.view_count} views` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    No signed-in private-link visits recorded yet.
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </section>
        </>
        ) : null}

        {activeTab === 'requests' && !canReviewJoinRequests && !canReviewAccessRequests ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-800">No request workflows enabled.</p>
            <p className="mt-1 text-sm text-slate-500">
              Turn on host approval in activity settings or use a semi-public activity to manage request queues here.
            </p>
          </section>
        ) : null}

        {activeTab === 'requests' && canReviewJoinRequests ? (
          <section className="bg-white rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-brand-600 tracking-tight">Join Requests</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setJoinRequestView('pending')}
                  className={`text-xs transition-all ${
                    joinRequestView === 'pending'
                      ? 'font-bold text-slate-500'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {pendingJoinRequests.length} pending
                </button>
                <button
                  type="button"
                  onClick={() => setJoinRequestView('approved')}
                  className={`text-xs underline transition-all ${
                    joinRequestView === 'approved'
                      ? 'font-bold text-slate-500'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Approved ({approvedJoinRequests.length})
                </button>
                <button
                  type="button"
                  onClick={() => setJoinRequestView('rejected')}
                  className={`text-xs underline transition-all ${
                    joinRequestView === 'rejected'
                      ? 'font-bold text-slate-500'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Rejected ({rejectedJoinRequests.length})
                </button>
              </div>
            </div>

            {visibleJoinRequests.length === 0 ? (
              <p className="text-sm text-slate-400">
                {joinRequestView === 'approved'
                  ? 'No approved join requests.'
                  : joinRequestView === 'rejected'
                    ? 'No rejected join requests.'
                    : 'No pending join requests.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-50">
                {visibleJoinRequests.slice(0, 10).map((request) => (
                  <div key={request.id} className="py-4 first:pt-0">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-bold text-slate-800 text-sm">{request.guest_name}</p>
                        <p className="text-xs text-slate-400">{getDisplayWhatsapp(request.whatsapp_number)}</p>
                        {request.request_note ? (
                          <p className="text-xs text-slate-500 mt-1">{request.request_note}</p>
                        ) : null}
                      </div>
                      <span className="text-[9px] font-medium uppercase tracking-widest text-slate-400">
                        {request.status}
                      </span>
                    </div>
                    {request.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproveJoinRequest(request.id)}
                          disabled={joinRequestActionLoadingId === request.id}
                          className="flex-1 px-3 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-500 transition-all active:scale-95 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectJoinRequest(request.id)}
                          disabled={joinRequestActionLoadingId === request.id}
                          className="px-3 py-2 rounded-xl text-red-400 text-xs font-bold hover:bg-red-50 transition-all active:scale-95 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        {request.status === 'approved'
                          ? 'Approved and added.'
                          : 'Rejected.'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {activeTab === 'requests' && canReviewAccessRequests && (
          <section className="bg-white rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-brand-600 tracking-tight">Access Requests</p>
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
                    ) : request.status === 'approved' ? (
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={() => openRequestWhatsapp(request, 'approve')}
                          disabled={requestActionLoadingId === request.id}
                          className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50"
                        >
                          Send Again
                        </button>
                        <p className="text-xs text-slate-400">Approved and archived.</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        Declined and archived.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'people' ? (
        <>
        {/* Attendee List */}
        <section className="bg-white rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <p className="text-sm font-black text-brand-600 tracking-tight">Going</p>
            <button 
              onClick={() => setShowAddModal(true)}
              className="text-brand-600 font-bold text-xs flex items-center gap-1 hover:text-brand-500 transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" /> Add Person
            </button>
          </div>
          {confirmed.length === 0 && pendingApprovalAttendees.length === 0 ? (
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
                      <p className="font-bold text-slate-800 text-sm">{getAttendeeDisplayName(a)}</p>
                      {getAddedByLabel(a) && (
                        <span className="text-[11px] text-slate-400">{getAddedByLabel(a)}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{getDisplayWhatsapp(a.whatsapp_number)}</p>
                  </div>
                  <button 
                    onClick={() => setShowDeleteModal({ show: true, type: 'attendee', id: a.id, name: getAttendeeDisplayName(a) })} 
                    className="p-2 text-slate-300 hover:text-red-400 rounded-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 active:scale-95"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {pendingApprovalAttendees.map((a) => (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between bg-slate-50/60">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-800 text-sm">{getAttendeeDisplayName(a)}</p>
                      <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest">Pending host approval</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{getDisplayWhatsapp(a.whatsapp_number)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Waitlist */}
        {event.allow_waitlist && waitlist.length > 0 && (
          <section className="bg-white rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <p className="text-sm font-black text-brand-600 tracking-tight">Waitlist</p>
              <span className="text-xs text-slate-400">{waitlist.length}</span>
            </div>
            <div className="divide-y divide-slate-50">
              {waitlist.map((a, i) => (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-all group">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-800 text-sm">{getAttendeeDisplayName(a)}</p>
                      {getAddedByLabel(a) && (
                        <span className="text-[11px] text-slate-400">{getAddedByLabel(a)}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">#{i + 1} on waitlist</p>
                  </div>
                  <button 
                    onClick={() => setShowDeleteModal({ show: true, type: 'attendee', id: a.id, name: getAttendeeDisplayName(a) })} 
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
            <p className="text-sm font-black text-brand-600 tracking-tight">Thinking About It</p>
            <span className="text-sm font-bold text-slate-800">{interests.length}</span>
          </div>
          {visibility === 'public' ? (
            <p className="text-xs text-slate-400 mt-2">Public activities show count only.</p>
          ) : namedInterests.length > 0 ? (
            <div className="mt-3 divide-y divide-slate-50">
              {namedInterests.slice(0, 6).map((interest) => (
                <div key={interest.id} className="py-2.5">
                  <p className="text-sm font-bold text-slate-800">{getDisplayName(interest.guest_name)}</p>
                  <p className="text-[11px] text-slate-400">{getDisplayWhatsapp(interest.whatsapp_number)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 mt-2">No named interest yet.</p>
          )}
        </section>
        </>
        ) : null}

        {/* Secondary actions */}
        {activeTab === 'settings' ? (
        <div className="space-y-4 pb-12 pt-2">
          <section className="rounded-2xl bg-white p-5">
            <div className="space-y-1">
              <p className="text-sm font-black tracking-tight text-brand-600">Joining Rules</p>
              <p className="text-xs text-slate-500">Control how guests can get into this activity.</p>
            </div>

            <div className="mt-4 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-slate-50 px-4 py-4">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  checked={!!event.allow_waitlist}
                  disabled={settingsSavingKey === 'allow_waitlist'}
                  onChange={(evt) => {
                    void updateEventSettings(
                      { allow_waitlist: evt.target.checked },
                      evt.target.checked ? 'Waitlist enabled.' : 'Waitlist disabled.',
                    );
                  }}
                />
                <div>
                  <p className="text-sm font-bold text-slate-700">Allow waitlist</p>
                  <p className="text-xs text-slate-400">Let people join the queue when the activity is full.</p>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-slate-50 px-4 py-4">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  checked={!!event.require_host_approval_for_join}
                  disabled={settingsSavingKey === 'require_host_approval_for_join'}
                  onChange={(evt) => {
                    void updateEventSettings(
                      { require_host_approval_for_join: evt.target.checked },
                      evt.target.checked ? 'Join approval enabled.' : 'Join approval disabled.',
                    );
                  }}
                />
                <div>
                  <p className="text-sm font-bold text-slate-700">Require approval to join</p>
                  <p className="text-xs text-slate-400">People request access first, then you approve them from the Requests tab.</p>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-slate-50 px-4 py-4">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  checked={!!event.require_guest_email_for_join}
                  disabled={settingsSavingKey === 'require_guest_email_for_join'}
                  onChange={(evt) => {
                    void updateEventSettings(
                      { require_guest_email_for_join: evt.target.checked },
                      evt.target.checked ? 'Guest email requirement enabled.' : 'Guest email requirement disabled.',
                    );
                  }}
                />
                <div>
                  <p className="text-sm font-bold text-slate-700">Require email for guest sign up</p>
                  <p className="text-xs text-slate-400">A true require-WhatsApp setting is not wired yet. Right now this only enforces email on the direct join flow.</p>
                </div>
              </label>
            </div>

            {settingsMessage ? (
              <p className="mt-4 text-xs font-bold text-slate-500">{settingsMessage}</p>
            ) : null}
          </section>

          <section className="rounded-2xl bg-white p-5">
            <div className="space-y-1">
              <p className="text-sm font-black tracking-tight text-brand-600">Notifications</p>
              <p className="text-xs text-slate-500">Send updates to guests and manage reminder behavior.</p>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4">
              <p className="text-sm font-bold text-slate-700">Guest notifications</p>
              <p className="mt-1 text-xs text-slate-400">Manual host messages are live. Scheduled reminders like "24 hours before" still need backend support.</p>
              <button
                type="button"
                onClick={openNotificationModal}
                className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-brand-500 active:scale-95"
              >
                Send notification now
              </button>
            </div>
          </section>

          <section className="flex justify-center pt-1">
            <button 
              onClick={() => {
                setConfirmText('');
                setShowDeleteModal({ show: true, type: 'event', id: event.id });
              }}
              className="text-sm text-red-400 transition-all hover:text-red-500"
            >
              Delete activity
            </button>
          </section>
        </div>
        ) : null}
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
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
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
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
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
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

      <AnimatePresence>
        {showInAppShareModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden overscroll-contain p-3 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowInAppShareModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-8"
            >
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-900">Share In App</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Suggestions include people who attended or viewed private links for your activities.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInAppShareModal(false)}
                  className="rounded-xl p-2 transition-all hover:bg-slate-50"
                  aria-label="Close share in app modal"
                >
                  <X className="h-6 w-6 text-slate-400" />
                </button>
              </div>

              {showInAppSharePrompt ? (
                <div className="mb-4 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Share in app</p>
                  <p className="mt-1 text-sm text-brand-700">
                    Pick from people who have engaged with your activities before. "Has attended" is prioritized over "Viewed link only".
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowInAppSharePrompt(false)}
                    className="mt-2 text-xs font-bold text-brand-700 underline"
                  >
                    Got it
                  </button>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-black tracking-tight text-brand-600">Suggested accounts</p>
                <button
                  type="button"
                  onClick={() => {
                    if (!event) return;
                    void fetchInAppShareCandidates(event.id);
                  }}
                  disabled={inAppShareLoading}
                  className="text-xs font-bold text-slate-500 transition-all hover:text-brand-600 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>

              {inAppShareLoading ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  Loading recipients...
                </div>
              ) : inAppShareCandidates.length > 0 ? (
                <div className="mt-3 space-y-3">
                  <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                    {inAppShareCandidates.map((candidate) => {
                      const checked = selectedShareUserIds.includes(candidate.user_id);
                      const engagementLabel = getEngagementTagLabel(candidate);
                      return (
                        <label key={candidate.user_id} className="flex cursor-pointer items-start gap-3 border-b border-slate-200 px-3 py-3 last:border-b-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(evt) => {
                              setSelectedShareUserIds((prev) => {
                                if (evt.target.checked) {
                                  if (prev.includes(candidate.user_id)) return prev;
                                  return [...prev, candidate.user_id];
                                }
                                return prev.filter((id) => id !== candidate.user_id);
                              });
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-800">{candidate.display_name}</p>
                            <p className="truncate text-xs text-slate-500">
                              {getDisplayWhatsapp(candidate.whatsapp_number)}
                            </p>
                            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                              {engagementLabel}
                              {candidate.already_shared ? ' · already shared' : ''}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedShareUserIds(inAppShareCandidates.map((candidate) => candidate.user_id))}
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedShareUserIds([])}
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
                      >
                        Clear
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void shareToSelectedUsers(selectedShareUserIds)}
                      disabled={inAppShareSaving || selectedShareUserIds.length === 0}
                      className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-500 disabled:opacity-50"
                    >
                      {inAppShareSaving ? 'Sharing...' : `Share selected (${selectedShareUserIds.length})`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  No share suggestions yet from your activity history.
                </div>
              )}

              <div className="mt-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Add by WhatsApp</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={manualWhatsappLookup}
                    onChange={(evt) => {
                      setManualWhatsappLookup(evt.target.value);
                      setLookupCandidate(null);
                      setLookupNotFound(false);
                    }}
                    placeholder="Enter WhatsApp number"
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  />
                  <button
                    type="button"
                    onClick={() => void lookupByWhatsapp()}
                    disabled={lookupLoading}
                    className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    {lookupLoading ? 'Checking...' : 'Find'}
                  </button>
                </div>

                {lookupCandidate ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-sm font-bold text-slate-800">{lookupCandidate.display_name}</p>
                    <p className="text-xs text-slate-500">{getDisplayWhatsapp(lookupCandidate.whatsapp_number)}</p>
                    <button
                      type="button"
                      onClick={() => void shareToSelectedUsers([lookupCandidate.user_id])}
                      disabled={inAppShareSaving}
                      className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-500 disabled:opacity-50"
                    >
                      {inAppShareSaving ? 'Sharing...' : 'Share with this account'}
                    </button>
                  </div>
                ) : null}

                {lookupNotFound ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-xs text-slate-500">No linked account found for that number.</p>
                    <button
                      type="button"
                      onClick={() => { void openWhatsAppToNumber(manualWhatsappLookup); }}
                      className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-500"
                    >
                      Send link via WhatsApp instead
                    </button>
                  </div>
                ) : null}
              </div>

              {inAppShareMessage ? (
                <p className="mt-3 text-xs font-bold text-slate-500">{inAppShareMessage}</p>
              ) : null}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showNotificationModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden overscroll-contain p-3 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNotificationModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-8"
            >
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-900">Send Notification</h2>
                  <p className="mt-1 text-sm text-slate-500">Send an in-app update to people related to this activity.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNotificationModal(false)}
                  className="rounded-xl p-2 transition-all hover:bg-slate-50"
                  aria-label="Close notification modal"
                >
                  <X className="h-6 w-6 text-slate-400" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Audience</span>
                  <select
                    value={notificationTarget}
                    onChange={(evt) => setNotificationTarget(evt.target.value as 'all_access' | 'confirmed' | 'waitlist' | 'selected')}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  >
                    <option value="all_access">Everyone with access</option>
                    <option value="confirmed">Confirmed attendees</option>
                    <option value="waitlist">Waitlisted users</option>
                    <option value="selected">Selected users</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Action</span>
                  <select
                    value={notificationAction}
                    onChange={(evt) => setNotificationAction(evt.target.value as NotificationActionOption)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  >
                    <option value="view_activity">View activity</option>
                    <option value="reply">Reply</option>
                    <option value="none">No action button</option>
                  </select>
                </label>
              </div>

              <label className="mt-3 block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Optional title</span>
                <input
                  type="text"
                  value={notificationTitle}
                  onChange={(evt) => setNotificationTitle(evt.target.value)}
                  placeholder={`Message from host: ${event.title}`}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                />
              </label>

              <label className="mt-3 block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Message</span>
                <textarea
                  value={notificationMessage}
                  onChange={(evt) => setNotificationMessage(evt.target.value)}
                  rows={4}
                  placeholder="Write a short message..."
                  className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                />
              </label>

              {notificationTarget === 'selected' ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Select recipients</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!event) return;
                          void fetchNotificationRecipients(event.id);
                        }}
                        disabled={notificationRecipientsLoading}
                        className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedNotificationUserIds(notificationRecipients.map((recipient) => recipient.user_id))}
                        className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedNotificationUserIds([])}
                        className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  {notificationRecipientsLoading ? (
                    <p className="text-sm text-slate-500">Loading recipients...</p>
                  ) : notificationRecipients.length === 0 ? (
                    <p className="text-sm text-slate-500">No eligible recipients found yet.</p>
                  ) : (
                    <div className="max-h-52 space-y-2 overflow-y-auto">
                      {notificationRecipients.map((recipient) => {
                        const checked = selectedNotificationUserIds.includes(recipient.user_id);
                        return (
                          <label key={recipient.user_id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(evt) => {
                                setSelectedNotificationUserIds((prev) => {
                                  if (evt.target.checked) return prev.includes(recipient.user_id) ? prev : [...prev, recipient.user_id];
                                  return prev.filter((id) => id !== recipient.user_id);
                                });
                              }}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-slate-800">{recipient.display_name}</p>
                              <p className="truncate text-xs text-slate-500">{getDisplayWhatsapp(recipient.whatsapp_number)}</p>
                              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.11em] text-slate-400">
                                {recipient.attendee_status || recipient.source}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {notificationTarget === 'selected'
                    ? `${selectedNotificationUserIds.length} selected`
                    : `${notificationRecipients.length} eligible recipients`}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNotificationModal(false)}
                    className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void sendHostNotification()}
                    disabled={notificationSending || !notificationMessage.trim()}
                    className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-brand-500 disabled:opacity-50"
                  >
                    {notificationSending ? 'Sending...' : 'Send notification'}
                  </button>
                </div>
              </div>

              {notificationSendMessage ? (
                <p className="mt-3 text-xs font-bold text-slate-500">{notificationSendMessage}</p>
              ) : null}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showManualShareModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowManualShareModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Share Activity</h2>
                <button onClick={() => setShowManualShareModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              <p className="text-sm text-slate-500 font-medium mb-5">
                Choose how you want to share your activity invite.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => {
                    window.location.href = `https://wa.me/?text=${encodeURIComponent(buildInviteText(manualShareUrl))}`;
                    setShowManualShareModal(false);
                  }}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-5 h-5" />
                  Share to WhatsApp
                </button>
                <button
                  onClick={() => {
                    window.location.href = `sms:&body=${encodeURIComponent(buildInviteText(manualShareUrl))}`;
                    setShowManualShareModal(false);
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-700 font-black py-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-5 h-5" />
                  Share by Text
                </button>
                <button
                  onClick={() => {
                    const eventTitle = event?.title || 'Activity invite';
                    window.location.href = `mailto:?subject=${encodeURIComponent(eventTitle)}&body=${encodeURIComponent(buildInviteText(manualShareUrl))}`;
                    setShowManualShareModal(false);
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-700 font-black py-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Mail className="w-5 h-5" />
                  Share by Email
                </button>
                <button
                  onClick={() => {
                    void copyInviteFallback(buildInviteText(manualShareUrl));
                    setShowManualShareModal(false);
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-700 font-black py-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Copy className="w-5 h-5" />
                  Copy Invite
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateSuccessModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
            >
              <button
                type="button"
                onClick={dismissCreateSuccessModal}
                className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
                aria-label="Close success modal"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 className="w-8 h-8 text-brand-600" />
              </div>

              <div className="text-center mb-6">
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">Activity created</h2>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {event.title} is ready. Share the private link now or head back to the app.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    clearCreateSuccessState();
                    setShowCreateSuccessModal(false);
                    setActiveTab('share');
                    setShowInAppSharePrompt(true);
                    setShowInAppShareModal(true);
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-brand-700 font-black py-4 rounded-2xl transition-all active:scale-95"
                >
                  Share in app
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearCreateSuccessState();
                    void shareWhatsApp();
                  }}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  <MessageCircle className="w-5 h-5 shrink-0 text-white" />
                  <span className="text-center leading-tight">Share Private Link on WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearCreateSuccessState();
                    navigate('/my-activities');
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-800 font-black py-4 rounded-2xl transition-all active:scale-95"
                >
                  Return to My Activities
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearCreateSuccessState();
                    navigate('/');
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl transition-all active:scale-95"
                >
                  Return Home
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

    </div>
  );
}
