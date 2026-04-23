import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { Users, Copy, MessageCircle, ArrowLeft, Trash2, CheckCircle2, Clock, Edit2, Plus, X, AlertCircle, Calendar, ChevronDown, ChevronUp, MessageSquare, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate, formatDurationMinutes } from '../utils';
import {
  Event,
  Attendee,
  EventAccessRequest,
  EventCustomJoinFieldConfig,
  EventInterest,
  EventJoinRequest,
  EventSignupFieldAnswer,
} from '../types';
import { getModerationBannerCopy, getModerationStatusBadge } from '../lib/moderation';
import { LOCKED_PUBLIC_LOCATION } from '../lib/publicLocation';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { guestService, getAccountNameFromUser } from '../services/guestService';
import { buildPrivateActivityUrl, buildPrivateWhatsappShareText } from '../lib/eventShare';
import { buildEventPath } from '../lib/events';
import { invokeAuthedFunction } from '../lib/functions';
import { buildEventGalleryStoragePath, EVENT_GALLERY_BUCKET } from '../lib/eventGallery';
import { captureProductEvent } from '../lib/productAnalytics';
import { buildShareLinkUrl, createShareLink, type ShareLinkAccessType, type ShareLinkChannel } from '../lib/shareLinks';
import {
  buildCustomJoinFieldConfigForSave,
  normalizeCustomJoinFieldConfig,
  parseSelectOptionsFromText,
  validateCustomJoinAnswer,
} from '../lib/customJoinField';

type InAppShareCandidate = {
  recipient_key: string;
  recipient_type: 'user' | 'guest_profile' | string;
  user_id: string | null;
  attendee_profile_id: string | null;
  suggestion_group: 'previous_activity' | 'other_people' | string;
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
type CopyProgressState = {
  percent: number;
  message: string;
};

function inferGalleryCopyExtension(image: {
  content_type?: string | null;
  storage_path?: string | null;
  original_file_name?: string | null;
}) {
  const contentType = (image.content_type || '').trim().toLowerCase();
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/jpeg') return 'jpg';

  const candidate = (image.storage_path || image.original_file_name || '').trim().toLowerCase();
  if (candidate.endsWith('.png')) return 'png';
  if (candidate.endsWith('.webp')) return 'webp';
  return 'jpg';
}

export default function HostDashboard({ user }: { user: User | null }) {
  const CREATE_EVENT_SUCCESS_KEY = 'im_in_recently_created_event_id';
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<HostAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAttendee, setNewAttendee] = useState({ name: '', whatsapp: '', customAnswer: '' });
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
  const [manualShareAccessType, setManualShareAccessType] = useState<ShareLinkAccessType>('private');
  const [inAppShareCandidates, setInAppShareCandidates] = useState<InAppShareCandidate[]>([]);
  const [selectedShareCandidateKeys, setSelectedShareCandidateKeys] = useState<string[]>([]);
  const [shareSuggestionGroup, setShareSuggestionGroup] = useState<'previous_activity' | 'other_people'>('previous_activity');
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
  const [copyProgress, setCopyProgress] = useState<CopyProgressState | null>(null);
  const [settingsSavingKey, setSettingsSavingKey] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [customJoinFieldDraft, setCustomJoinFieldDraft] = useState<EventCustomJoinFieldConfig | null>(null);
  const [customJoinFieldOptionsDraft, setCustomJoinFieldOptionsDraft] = useState('');
  const [signupAnswersByAttendeeId, setSignupAnswersByAttendeeId] = useState<Record<string, EventSignupFieldAnswer>>({});
  const [signupAnswersByJoinRequestId, setSignupAnswersByJoinRequestId] = useState<Record<string, EventSignupFieldAnswer>>({});
  const [activeTab, setActiveTab] = useState<HostDashboardTab>('requests');
  const [showShareInsights, setShowShareInsights] = useState(false);
  const [autoModerationWarning, setAutoModerationWarning] = useState<string | null>(null);
  const [moderationRetrying, setModerationRetrying] = useState(false);

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
    || showNotificationModal
    || copyProgress !== null,
  );

  useEffect(() => {
    setCopyProgress(null);
  }, [id]);

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

  useEffect(() => {
    setCustomJoinFieldDraft(normalizeCustomJoinFieldConfig(event?.custom_join_field_config));
  }, [event?.id, event?.custom_join_field_config]);

  useEffect(() => {
    const normalized = normalizeCustomJoinFieldConfig(customJoinFieldDraft);
    if (!normalized?.enabled || normalized.type !== 'select') {
      setCustomJoinFieldOptionsDraft('');
      return;
    }
    setCustomJoinFieldOptionsDraft((normalized.options || []).join('\n'));
  }, [event?.id, customJoinFieldDraft?.enabled, customJoinFieldDraft?.type]);

  const getEngagementTagLabel = (candidate: InAppShareCandidate) => {
    if (candidate.attended_previous || candidate.engagement_tag === 'attended' || candidate.engagement_tag === 'both') {
      return 'Joined last session';
    }
    if (candidate.engagement_tag === 'approved_access') {
      return 'Had access';
    }
    if (candidate.engagement_tag === 'shared_before') {
      return 'Had access';
    }
    return 'Viewed link only';
  };

  const normalizeWhatsapp = (value: string) => value.replace(/[^\d]/g, '');
  const normalizeGuestName = (value: string) => value.trim().replace(/\s+/g, ' ');
  const HOST_ADD_ATTENDEE_TIMEOUT_MS = 15000;
  const isDuplicateAttendeeConstraintError = (error: { code?: string; message?: string; details?: string; constraint?: string } | null | undefined) => {
    if (!error) return false;
    const text = `${error.message || ''} ${error.details || ''} ${error.constraint || ''}`.toLowerCase();
    return error.code === '23505' || (text.includes('duplicate key value') && text.includes('event_attendees'));
  };
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

  const buildInviteText = (accessType: ShareLinkAccessType, fallbackUrl = '') => {
    if (!event) return fallbackUrl;
    if (accessType === 'private') {
      return buildPrivateWhatsappShareText(window.location.origin, event, fallbackUrl || getPrivateShareUrl());
    }

    return `${event.title} – ${formatDate(event.starts_at, event.timezone)}\nJoin here:\n${fallbackUrl || getPublicPreviewUrl()}`;
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

  const openManualShareModal = (accessType: ShareLinkAccessType) => {
    setManualShareAccessType(accessType);
    setShowManualShareModal(true);
  };

  const ensurePrivateAccessUrl = async () => {
    if (!event) return '';
    return getPrivateShareUrl();
  };

  const createTrackedShareLink = async (
    accessType: ShareLinkAccessType,
    shareChannel: ShareLinkChannel,
  ) => {
    if (!event) {
      throw new Error('Activity not loaded.');
    }

    const targetSlug = accessType === 'private'
      ? event.private_slug || event.join_code || event.slug
      : event.public_slug || event.slug;

    const link = await createShareLink({
      eventId: event.id,
      targetSlug,
      accessType,
      source: 'host_dashboard',
      shareChannel,
    });

    return {
      accessType: link.access_type,
      linkId: link.link_id,
      url: buildShareLinkUrl(window.location.origin, link.token),
    };
  };

  const trackSharedEvent = (
    shareChannel: ShareLinkChannel,
    linkId: string,
    accessType: ShareLinkAccessType,
  ) => {
    if (!event) return;

    captureProductEvent('event_shared', {
      activity_id: event.id,
      link_id: linkId,
      source: 'host_dashboard',
      share_channel: shareChannel,
      visibility_type: accessType,
      page: '/host/events/:id',
    });
  };

  const openWhatsAppToNumber = async (rawNumber: string) => {
    if (!event) return;
    const number = normalizeWhatsapp(rawNumber);
    if (!number) {
      alert('Please enter a valid WhatsApp number.');
      return;
    }
    const preparedLink = await createTrackedShareLink('private', 'whatsapp');
    const inviteText = buildInviteText('private', preparedLink.url);
    trackSharedEvent('whatsapp', preparedLink.linkId, preparedLink.accessType);
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
      setSelectedShareCandidateKeys(
        candidates
          .filter((candidate) => candidate.selected_by_default)
          .map((candidate) => candidate.recipient_key),
      );
    } catch (error) {
      console.warn('Could not load in-app share candidates:', error);
      setInAppShareCandidates([]);
      setSelectedShareCandidateKeys([]);
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
    setShareSuggestionGroup('previous_activity');
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

  const saveCustomJoinFieldSettings = async () => {
    if (!event) return;
    const payload = buildCustomJoinFieldConfigForSave(customJoinFieldDraft);
    if (customJoinFieldDraft?.enabled && !payload) {
      setSettingsMessage('Add a field label first. Dropdown fields also need at least one option.');
      return;
    }
    await updateEventSettings(
      { custom_join_field_config: payload },
      payload ? 'Custom join field saved.' : 'Custom join field removed.',
    );
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

  const shareToSelectedRecipients = async (
    userIds: string[],
    attendeeProfileIds: string[] = [],
  ) => {
    if (!event || (userIds.length === 0 && attendeeProfileIds.length === 0)) return;
    try {
      setInAppShareSaving(true);
      setInAppShareMessage(null);
      const { data, error } = await supabase.rpc('host_share_event_with_users', {
        p_event_id: event.id,
        p_user_ids: userIds,
        p_source: 'link',
        p_attendee_profile_ids: attendeeProfileIds,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);

      const sharedCount = Number(data?.shared_count || 0);
      const fallbackSubmittedCount = userIds.length + attendeeProfileIds.length;
      const submittedCount = Number(data?.submitted_count || fallbackSubmittedCount);
      if (sharedCount > 0) {
        setInAppShareMessage(`Shared with ${sharedCount} ${sharedCount === 1 ? 'person' : 'people'}.`);
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

  const buildRecipientPayloadFromKeys = (
    keys: string[],
  ): { userIds: string[]; attendeeProfileIds: string[]; selectedCount: number } => {
    const selected = inAppShareCandidates.filter((candidate) => keys.includes(candidate.recipient_key));
    const userIds: string[] = Array.from(new Set<string>(
      selected
        .map((candidate) => candidate.user_id)
        .filter((value): value is string => !!value),
    ));
    const attendeeProfileIds: string[] = Array.from(new Set<string>(
      selected
        .map((candidate) => candidate.attendee_profile_id)
        .filter((value): value is string => !!value),
    ));
    return {
      userIds,
      attendeeProfileIds,
      selectedCount: selected.length,
    };
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

      const rows = ((data || []) as Array<{
        user_id: string;
        display_name: string;
        whatsapp_number: string | null;
      }>).map((row) => ({
        recipient_key: `user:${row.user_id}`,
        recipient_type: 'user',
        user_id: row.user_id,
        attendee_profile_id: null,
        suggestion_group: 'other_people',
        display_name: row.display_name,
        whatsapp_number: row.whatsapp_number,
        attended_previous: false,
        viewed_previous: false,
        engagement_tag: 'viewed_private',
        already_shared: false,
        selected_by_default: false,
      }));
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
    const routeState = location.state as {
      justCreated?: boolean;
      openInAppShare?: boolean;
      moderationAutoRunFailed?: boolean;
      moderationAutoRunMessage?: string;
    } | null;
    const justCreatedEventId = sessionStorage.getItem(CREATE_EVENT_SUCCESS_KEY);
    const shouldOpenSuccessModal = routeState?.justCreated || (!!id && justCreatedEventId === id);
    if (!shouldOpenSuccessModal) return;

    setShowCreateSuccessModal(true);
  }, [id, location.state]);

  useEffect(() => {
    const routeState = location.state as {
      openInAppShare?: boolean;
      moderationAutoRunFailed?: boolean;
      moderationAutoRunMessage?: string;
    } | null;
    if (routeState?.openInAppShare) {
      setActiveTab('share');
      setShowInAppSharePrompt(true);
      setShowInAppShareModal(true);
      setShareSuggestionGroup('previous_activity');
    }
    if (routeState?.moderationAutoRunFailed) {
      setAutoModerationWarning(
        routeState.moderationAutoRunMessage
          || 'Activity saved, but automatic moderation did not run yet. Retry below to unlock public discovery.',
      );
      setActiveTab('settings');
    }
  }, [location.state]);

  useEffect(() => {
    const copiedEvent = !!event?.copied_from_event_id;
    if (!copiedEvent) {
      if (shareSuggestionGroup !== 'other_people') {
        setShareSuggestionGroup('other_people');
      }
    }
  }, [event?.copied_from_event_id, shareSuggestionGroup]);

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
      fetchSignupAnswers(normalizedEvent.id);
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
      void fetchSignupAnswers(eventId);
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

    if (data) {
      setJoinRequests(data as HostJoinRequest[]);
      void fetchSignupAnswers(eventId);
    }
  };

  const fetchSignupAnswers = async (eventId: string) => {
    const { data, error } = await supabase
      .from('event_signup_field_answers')
      .select('*')
      .eq('event_id', eventId);

    if (error) {
      console.error('Could not load custom signup answers:', error);
      setSignupAnswersByAttendeeId({});
      setSignupAnswersByJoinRequestId({});
      return;
    }

    const byAttendeeId: Record<string, EventSignupFieldAnswer> = {};
    const byJoinRequestId: Record<string, EventSignupFieldAnswer> = {};
    (data || []).forEach((answer) => {
      const row = answer as EventSignupFieldAnswer;
      if (row.event_attendee_id) byAttendeeId[row.event_attendee_id] = row;
      if (row.event_join_request_id) byJoinRequestId[row.event_join_request_id] = row;
    });
    setSignupAnswersByAttendeeId(byAttendeeId);
    setSignupAnswersByJoinRequestId(byJoinRequestId);
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

    const guestName = normalizeGuestName(newAttendee.name);
    if (!guestName) {
      alert('Guest name is required');
      setActionLoading(false);
      return;
    }

    const whatsapp = (newAttendee.whatsapp || '').trim();
    const customAnswerValidation = validateCustomJoinAnswer(
      normalizeCustomJoinFieldConfig(event.custom_join_field_config),
      newAttendee.customAnswer,
    );

    if (!customAnswerValidation.ok) {
      alert(customAnswerValidation.error);
      setActionLoading(false);
      return;
    }

    try {
      const rpcResult = await Promise.race([
        supabase.rpc('host_add_attendee_with_custom_answer', {
          p_event_id: event.id,
          p_guest_name: guestName,
          p_whatsapp: whatsapp || null,
          p_custom_join_answer: customAnswerValidation.normalizedAnswer || null,
        }),
        new Promise<{ data: null; error: { message: string } }>((resolve) =>
          setTimeout(
            () => resolve({ data: null, error: { message: 'Add attendee request timed out. Please try again.' } }),
            HOST_ADD_ATTENDEE_TIMEOUT_MS,
          ),
        ),
      ]);
      const { data, error } = rpcResult;
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);

      setShowAddModal(false);
      setNewAttendee({ name: '', whatsapp: '', customAnswer: '' });
      fetchAttendees(event.id);
      fetchSignupAnswers(event.id);
    } catch (error: any) {
      console.error('Add Attendee Error:', error);
      if (isDuplicateAttendeeConstraintError(error)) {
        alert('This attendee is already on the activity.');
        return;
      }
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
    setCopyProgress({
      percent: 5,
      message: 'Creating next week\'s activity...',
    });
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
          gallery_visibility: event.gallery_visibility || 'private_only',
          allow_waitlist: event.allow_waitlist,
          require_host_approval_for_join: event.require_host_approval_for_join,
          is_public: event.is_public,
          require_guest_email_for_join: event.require_guest_email_for_join,
          copied_from_event_id: event.id,
          host_user_id: user?.id,
          status: 'scheduled',
        }])
        .select()
        .single();

      if (error) throw error;

      setCopyProgress({
        percent: 20,
        message: 'Copying host access...',
      });
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

      const copiedVisibility = (newEvent.visibility || (newEvent.is_public ? 'public' : 'private')) as 'public' | 'semi_public' | 'private';
      const copiedGalleryVisibility = newEvent.gallery_visibility || 'private_only';
      const shouldRunGalleryModeration =
        copiedVisibility !== 'private' && copiedGalleryVisibility === 'public_preview';
      const copyWarnings: string[] = [];

      try {
        setCopyProgress({
          percent: 32,
          message: 'Loading photos from the original activity...',
        });
        const { data: sourceGalleryImages, error: sourceGalleryError } = await supabase
          .from('event_gallery_images')
          .select('storage_bucket, storage_path, original_file_name, content_type, file_size_bytes, width, height, sort_order')
          .eq('event_id', event.id)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true });

        if (sourceGalleryError) {
          throw sourceGalleryError;
        }

        const copiedGalleryRows = [];
        const sourceGalleryCount = sourceGalleryImages?.length || 0;
        let copiedGalleryCount = 0;
        for (const image of sourceGalleryImages || []) {
          if (!image.storage_path) continue;
          const bucket = image.storage_bucket || EVENT_GALLERY_BUCKET;
          const nextStoragePath = buildEventGalleryStoragePath(
            newEvent.id,
            inferGalleryCopyExtension(image),
          );
          const { error: copyStorageError } = await supabase.storage
            .from(bucket)
            .copy(image.storage_path, nextStoragePath);
          if (copyStorageError) {
            throw copyStorageError;
          }
          copiedGalleryCount += 1;
          if (sourceGalleryCount > 0) {
            const percent = Math.min(72, Math.round(40 + (copiedGalleryCount / sourceGalleryCount) * 28));
            setCopyProgress({
              percent,
              message: `Copying photos... ${copiedGalleryCount} of ${sourceGalleryCount}`,
            });
          }

          copiedGalleryRows.push({
            event_id: newEvent.id,
            storage_bucket: bucket,
            storage_path: nextStoragePath,
            original_file_name: image.original_file_name,
            content_type: image.content_type,
            file_size_bytes: image.file_size_bytes,
            width: image.width,
            height: image.height,
            sort_order: image.sort_order,
            created_by_user_id: user?.id,
            public_visibility_status: shouldRunGalleryModeration ? 'pending' : 'private_only',
            public_moderation_reasons: [],
            public_moderation_confidence: null,
            public_moderated_at: null,
            public_hidden_at: null,
            public_hidden_reason: null,
            review_requested_at: null,
            report_count: 0,
          });
        }

        if (copiedGalleryRows.length > 0) {
          setCopyProgress({
            percent: 76,
            message: 'Saving copied photos...',
          });
          const { error: insertGalleryError } = await supabase
            .from('event_gallery_images')
            .insert(copiedGalleryRows);
          if (insertGalleryError) {
            throw insertGalleryError;
          }

          if (shouldRunGalleryModeration) {
            setCopyProgress({
              percent: 84,
              message: 'Reviewing copied photos for public preview...',
            });
            await invokeAuthedFunction('moderate-event-gallery', {
              eventId: newEvent.id,
            });
          }
        } else {
          setCopyProgress({
            percent: 76,
            message: 'No photos to copy.',
          });
        }
      } catch (galleryCopyError) {
        console.error('Copy gallery auto-copy failed:', galleryCopyError);
        copyWarnings.push(
          galleryCopyError instanceof Error && galleryCopyError.message
            ? `Gallery images were not copied (${galleryCopyError.message}).`
            : 'Gallery images were not copied.',
        );
      }

      if (copiedVisibility === 'public' || copiedVisibility === 'semi_public') {
        try {
          setCopyProgress({
            percent: 92,
            message: 'Running activity moderation...',
          });
          await invokeAuthedFunction('moderate-activity', {
            eventId: newEvent.id,
            telemetry_source: 'host_dashboard_copy_auto',
          });
        } catch (moderationError) {
          console.error('Copy moderation auto-run failed:', moderationError);
          copyWarnings.push(
            moderationError instanceof Error && moderationError.message
              ? `Automatic moderation did not run yet (${moderationError.message}).`
              : 'Automatic moderation did not run yet.',
          );
        }
      }

      setCopyProgress({
        percent: 100,
        message: 'Done. Opening copied activity...',
      });
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      setCopyProgress(null);
      navigate(`/host/events/${newEvent.id}`, {
        state: {
          openInAppShare: true,
          ...(copyWarnings.length > 0
            ? {
                moderationAutoRunFailed: true,
                moderationAutoRunMessage: `Copied activity saved, but ${copyWarnings.join(' ')}`,
              }
            : {}),
        },
      });
    } catch (error: any) {
      console.error('Copy Activity Error:', error);
      setCopyProgress(null);
      alert(error.message || 'Failed to copy activity');
    } finally {
      setActionLoading(false);
    }
  };

  const copyLink = async () => {
    try {
      const preparedLink = await createTrackedShareLink('private', 'copy');
      await copyInviteFallback(preparedLink.url);
      trackSharedEvent('copy', preparedLink.linkId, preparedLink.accessType);
    } catch (error: any) {
      alert(error.message || 'Could not prepare private link');
    }
  };

  const copyPublicPreviewLink = async () => {
    try {
      const preparedLink = await createTrackedShareLink('public', 'copy');
      await copyInviteFallback(preparedLink.url);
      trackSharedEvent('copy', preparedLink.linkId, preparedLink.accessType);
    } catch (error: any) {
      alert(error.message || 'Could not prepare public link');
    }
  };

  const shareWhatsApp = async () => {
    try {
      if (!event) {
        return;
      }
      const preparedLink = await createTrackedShareLink('private', 'whatsapp');
      const inviteText = buildInviteText('private', preparedLink.url);
      trackSharedEvent('whatsapp', preparedLink.linkId, preparedLink.accessType);
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;
      // Use same-tab navigation so returning from WhatsApp lands back on this activity page.
      window.location.href = whatsappUrl;
    } catch (error: any) {
      openManualShareModal('private');
      alert(error.message || 'Could not prepare share');
    }
  };

  const handleManualShare = async (shareChannel: ShareLinkChannel) => {
    try {
      const preparedLink = await createTrackedShareLink(manualShareAccessType, shareChannel);
      const inviteText = buildInviteText(manualShareAccessType, preparedLink.url);
      trackSharedEvent(shareChannel, preparedLink.linkId, preparedLink.accessType);

      if (shareChannel === 'copy') {
        await copyInviteFallback(inviteText);
      } else if (shareChannel === 'whatsapp') {
        window.location.href = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;
      } else if (shareChannel === 'sms') {
        window.location.href = `sms:&body=${encodeURIComponent(inviteText)}`;
      } else if (shareChannel === 'email') {
        const eventTitle = event?.title || 'Activity';
        window.location.href = `mailto:?subject=${encodeURIComponent(eventTitle)}&body=${encodeURIComponent(inviteText)}`;
      }

      setShowManualShareModal(false);
    } catch (error: any) {
      alert(error?.message || 'Could not prepare share');
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
      text = `Hi ${request.requester_name}, thanks for requesting access to ${event.title}. Here are the activity details:\n\n${buildInviteText('private', eventLink)}`;
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
  const participationMode = event.participation_mode || 'rsvp';
  const isInterestOnly = participationMode === 'interest_only';
  const namedInterests = interests.filter((interest) => interest.visibility_mode === 'named');
  const pendingRequests = accessRequests.filter((r) => r.status === 'pending');
  const approvedRequests = accessRequests.filter((r) => r.status === 'approved');
  const declinedRequests = accessRequests.filter((r) => r.status === 'declined');
  const pendingJoinRequests = joinRequests.filter((r) => r.status === 'pending');
  const approvedJoinRequests = joinRequests.filter((r) => r.status === 'approved');
  const rejectedJoinRequests = joinRequests.filter((r) => r.status === 'rejected');
  const moderationBanner = getModerationBannerCopy(event);
  const moderationStatusBadge = getModerationStatusBadge(event);
  const canRetryModeration = visibility === 'public' || visibility === 'semi_public';
  const moderationDebugLine = `Visibility: ${visibility} | Status: ${event.status} | Discovery: ${event.public_discovery_enabled ? 'on' : 'off'} | Moderation: ${event.moderation_status || 'unknown'}`;
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
  const isCopiedEvent = !!event.copied_from_event_id;
  const previousActivityCandidates = inAppShareCandidates.filter((candidate) => candidate.suggestion_group === 'previous_activity');
  const otherPeopleCandidates = inAppShareCandidates.filter((candidate) => candidate.suggestion_group === 'other_people');
  const sortedPreviousActivityCandidates = [...previousActivityCandidates].sort((a, b) => {
    const rank = (candidate: InAppShareCandidate) => {
      if (candidate.recipient_type === 'guest_profile') return 2;
      if (candidate.attended_previous || candidate.engagement_tag === 'attended' || candidate.engagement_tag === 'both') return 0;
      return 1;
    };
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.display_name.localeCompare(b.display_name);
  });
  const visibleShareCandidates = isCopiedEvent
    ? (shareSuggestionGroup === 'previous_activity' ? sortedPreviousActivityCandidates : otherPeopleCandidates)
    : inAppShareCandidates;
  const canReviewJoinRequests = !isInterestOnly && event.require_host_approval_for_join;
  const canReviewAccessRequests = visibility === 'semi_public';
  const customJoinFieldLabel = normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.label || 'Custom answer';
  const customJoinFieldDraftValue = customJoinFieldDraft || {
    enabled: false,
    type: 'text' as const,
    label: '',
    required: false,
    options: [],
  };
  const getAnswerForAttendee = (attendeeId: string) => signupAnswersByAttendeeId[attendeeId]?.answer_value || '';
  const getAnswerForJoinRequest = (requestId: string) => signupAnswersByJoinRequestId[requestId]?.answer_value || '';
  const renderCustomJoinAnswer = (answer: string) => {
    const value = answer.trim();
    if (!value) return null;
    return (
      <div className="mt-2 inline-flex max-w-full items-start gap-2 rounded-xl bg-brand-50 px-2.5 py-2 text-xs text-brand-900 border border-brand-100">
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-brand-600 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wider text-brand-700">{customJoinFieldLabel}</p>
          <p className="font-semibold break-words">{value}</p>
        </div>
      </div>
    );
  };
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
            <p className="mb-1 text-[9px] font-medium uppercase tracking-widest text-slate-400">{isInterestOnly ? 'Interested' : 'Going'}</p>
            <p className="text-lg font-bold tracking-tight text-slate-900">
              {isInterestOnly ? interests.length : <>{confirmed.length} <span className="text-base font-light text-slate-300">/</span> {event.capacity}</>}
            </p>
            {!isInterestOnly && pendingApprovalAttendees.length > 0 ? (
              <p className="mt-0.5 text-[10px] text-slate-400">{pendingApprovalAttendees.length} pending approval</p>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('people')}
            className="rounded-2xl bg-white px-3 py-2.5 text-left transition-all hover:bg-slate-50 active:scale-[0.99]"
            aria-label="View activity waitlist"
          >
            <p className="mb-1 text-[9px] font-medium uppercase tracking-widest text-slate-400">{isInterestOnly ? 'Mode' : 'Waitlist'}</p>
            <p className="text-lg font-bold tracking-tight text-slate-900">{isInterestOnly ? 'Interest' : waitlist.length}</p>
          </button>
        </section>

        <section className="rounded-2xl bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-black tracking-tight text-brand-600">Quick Actions</p>
            <button
              type="button"
              onClick={() => navigate(buildEventPath(event, { preferPrivateAccess: true }))}
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
            <p className="text-xs text-slate-400 mt-2">{moderationDebugLine}</p>
            {canRetryModeration && !event.public_discovery_enabled ? (
              <button
                type="button"
                onClick={async () => {
                  setModerationRetrying(true);
                  setAutoModerationWarning(null);
                  try {
                    await invokeAuthedFunction('moderate-activity', {
                      eventId: event.id,
                      rerun: true,
                      telemetry_source: 'host_dashboard_retry_manual',
                    });
                    await fetchEvent();
                  } catch (retryError) {
                    setAutoModerationWarning(
                      retryError instanceof Error
                        ? retryError.message
                        : 'Could not re-run moderation right now.',
                    );
                  } finally {
                    setModerationRetrying(false);
                  }
                }}
                disabled={moderationRetrying}
                className="mt-3 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-60"
              >
                {moderationRetrying ? 'Retrying moderation...' : 'Retry moderation now'}
              </button>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'settings' && autoModerationWarning ? (
          <section className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <p className="text-sm font-bold text-amber-700">Automatic moderation needs attention</p>
            <p className="mt-1 text-sm text-amber-700/90">{autoModerationWarning}</p>
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
            {normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.enabled ? (
              <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-700">Host-only join answer</p>
                <p className="text-xs text-brand-800">
                  Scanning field: <span className="font-bold">{customJoinFieldLabel}</span>
                </p>
              </div>
            ) : null}

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
                        {renderCustomJoinAnswer(getAnswerForJoinRequest(request.id))}
                      </div>
                      <span className="text-[9px] font-medium uppercase tracking-widest text-slate-400">
                        {request.status}
                      </span>
                    </div>
                    {request.grant_source === 'copy_inheritance' ? (
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        Copied forward
                      </p>
                    ) : null}
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
          {normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.enabled ? (
            <div className="mx-5 mb-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-700">Host-only join answer</p>
              <p className="text-xs text-brand-800">
                Field: <span className="font-bold">{customJoinFieldLabel}</span>
              </p>
            </div>
          ) : null}
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
                    {renderCustomJoinAnswer(getAnswerForAttendee(a.id))}
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
                    {renderCustomJoinAnswer(getAnswerForAttendee(a.id))}
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
                    {renderCustomJoinAnswer(getAnswerForAttendee(a.id))}
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
              <p className="text-sm font-black tracking-tight text-brand-600">Participation mode</p>
              <p className="text-xs text-slate-500">Switch between native RSVP and lightweight interest tracking.</p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={settingsSavingKey === 'participation_mode'}
                onClick={() => {
                  void updateEventSettings(
                    { participation_mode: 'rsvp' },
                    'Participation mode set to RSVP.',
                  );
                }}
                className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                  participationMode === 'rsvp'
                    ? 'border-brand-300 bg-brand-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <p className="text-sm font-bold text-slate-800">RSVP activity</p>
                <p className="mt-1 text-xs text-slate-500">People can join, waitlist, and request approval.</p>
              </button>
              <button
                type="button"
                disabled={settingsSavingKey === 'participation_mode'}
                onClick={() => {
                  void updateEventSettings(
                    {
                      participation_mode: 'interest_only',
                      allow_waitlist: false,
                      require_host_approval_for_join: false,
                      require_guest_email_for_join: false,
                      custom_join_field_config: null,
                    },
                    'Participation mode set to non-signup.',
                  );
                }}
                className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                  participationMode === 'interest_only'
                    ? 'border-brand-300 bg-brand-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <p className="text-sm font-bold text-slate-800">Non-signup activity</p>
                <p className="mt-1 text-xs text-slate-500">People can track interest without RSVP.</p>
              </button>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5">
            <div className="space-y-1">
              <p className="text-sm font-black tracking-tight text-brand-600">Joining Rules</p>
              <p className="text-xs text-slate-500">
                {isInterestOnly ? 'RSVP controls are disabled while this activity is in non-signup mode.' : 'Control how guests can get into this activity.'}
              </p>
            </div>

            {!isInterestOnly ? (
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

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Custom join field</p>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                    checked={customJoinFieldDraftValue.enabled}
                    onChange={(evt) => {
                      if (evt.target.checked) {
                        setCustomJoinFieldDraft((prev) => normalizeCustomJoinFieldConfig({
                          ...(prev || {
                            type: 'text',
                            label: '',
                            required: false,
                            options: [],
                          }),
                          enabled: true,
                        }));
                      } else {
                        setCustomJoinFieldDraft(null);
                      }
                    }}
                  />
                  <div>
                    <p className="text-sm font-bold text-slate-700">Ask one extra question on join</p>
                    <p className="text-xs text-slate-400">Responses stay private to hosts.</p>
                  </div>
                </label>

                {customJoinFieldDraftValue.enabled ? (
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Field label</label>
                      <input
                        type="text"
                        maxLength={120}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none transition-all focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                        value={customJoinFieldDraftValue.label}
                        onChange={(evt) =>
                          setCustomJoinFieldDraft((prev) => normalizeCustomJoinFieldConfig({
                            ...(prev || {}),
                            enabled: true,
                            label: evt.target.value,
                          }))
                        }
                        placeholder="e.g. Child age"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Field type</label>
                      <select
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none transition-all focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                        value={customJoinFieldDraftValue.type}
                        onChange={(evt) =>
                          setCustomJoinFieldDraft((prev) => normalizeCustomJoinFieldConfig({
                            ...(prev || {}),
                            enabled: true,
                            type: evt.target.value,
                          }))
                        }
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="select">Dropdown / multiple choice</option>
                      </select>
                    </div>
                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                        checked={customJoinFieldDraftValue.required}
                        onChange={(evt) =>
                          setCustomJoinFieldDraft((prev) => normalizeCustomJoinFieldConfig({
                            ...(prev || {}),
                            enabled: true,
                            required: evt.target.checked,
                          }))
                        }
                      />
                      <div>
                        <p className="text-sm font-bold text-slate-700">Required field</p>
                        <p className="text-xs text-slate-400">If off, people can skip this answer.</p>
                      </div>
                    </label>
                    {customJoinFieldDraftValue.type === 'select' ? (
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Options (one per line)</label>
                        <textarea
                          rows={4}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none transition-all focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                          value={customJoinFieldOptionsDraft}
                          onChange={(evt) => {
                            setCustomJoinFieldOptionsDraft(evt.target.value);
                            setCustomJoinFieldDraft((prev) => normalizeCustomJoinFieldConfig({
                              ...(prev || {}),
                              enabled: true,
                              options: parseSelectOptionsFromText(evt.target.value),
                            }));
                          }}
                          placeholder={'Small\nMedium\nLarge'}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        void saveCustomJoinFieldSettings();
                      }}
                      disabled={settingsSavingKey === 'custom_join_field_config'}
                      className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-brand-500 active:scale-95 disabled:opacity-50"
                    >
                      Save custom field
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Interest visibility</p>
                <p className="text-xs text-slate-500">Choose what interest data is shown for this activity.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { value: 'count_only', label: 'Count only', message: 'Only count is visible.' },
                    { value: 'named', label: 'Names', message: 'Names can be shown where allowed.' },
                    { value: 'hidden', label: 'Hidden', message: 'No visible interest roster/count.' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={settingsSavingKey === 'interest_visibility'}
                      onClick={() => {
                        void updateEventSettings(
                          { interest_visibility: option.value as Event['interest_visibility'] },
                          `Interest visibility set to ${option.label.toLowerCase()}.`,
                        );
                      }}
                      className={`rounded-xl border px-3 py-2 text-left text-xs font-bold transition-all ${
                        (event.interest_visibility || 'count_only') === option.value
                          ? 'border-brand-300 bg-white text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <p>{option.label}</p>
                      <p className="mt-0.5 text-[10px] font-medium text-slate-400">{option.message}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

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

      <AnimatePresence>
        {copyProgress ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden overscroll-contain p-3 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative my-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8"
            >
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-900">Copying activity</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Duplicating the activity details, hosts, and any saved gallery images.
                  </p>
                </div>
                <div className="rounded-2xl border border-brand-100 bg-brand-50 px-4 py-4">
                  <div className="flex items-center justify-between gap-3 text-sm font-bold text-brand-700">
                    <span>{copyProgress.message}</span>
                    <span>{copyProgress.percent}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all duration-300"
                      style={{ width: `${copyProgress.percent}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-400">
                  Please wait while we finish preparing the copied activity.
                </p>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

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
              onClick={() => {
                setActionLoading(false);
                setShowAddModal(false);
                setNewAttendee({ name: '', whatsapp: '', customAnswer: '' });
              }}
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
                <button
                  type="button"
                  onClick={() => {
                    setActionLoading(false);
                    setShowAddModal(false);
                    setNewAttendee({ name: '', whatsapp: '', customAnswer: '' });
                  }}
                  className="p-2 hover:bg-slate-50 rounded-xl transition-all"
                >
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
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">WhatsApp (Optional)</label>
                  <input
                    type="tel"
                    className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                    placeholder="e.g. +61 412 345 678"
                    value={newAttendee.whatsapp}
                    onChange={e => setNewAttendee({ ...newAttendee, whatsapp: e.target.value })}
                  />
                </div>
                {normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.enabled ? (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">
                      {customJoinFieldLabel}
                    </label>
                    {normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.type === 'select' ? (
                      <select
                        required={!!normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.required}
                        className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                        value={newAttendee.customAnswer}
                        onChange={e => setNewAttendee({ ...newAttendee, customAnswer: e.target.value })}
                      >
                        <option value="">Select an option</option>
                        {(normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.options || []).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required={!!normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.required}
                        type={normalizeCustomJoinFieldConfig(event.custom_join_field_config)?.type === 'number' ? 'number' : 'text'}
                        className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                        placeholder="Answer"
                        value={newAttendee.customAnswer}
                        onChange={e => setNewAttendee({ ...newAttendee, customAnswer: e.target.value })}
                      />
                    )}
                  </div>
                ) : null}
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
                    {isCopiedEvent
                      ? 'Use Last session for safe carry-forward, or From your activities for optional extras.'
                      : 'Suggestions include people who attended or viewed private links for your activities.'}
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
                    {event?.copied_from_event_id
                      ? 'Carry forward access for people from the last session, including eligible guest accounts.'
                      : 'Pick from people who have engaged with your activities before. "Has attended" is prioritized over "Viewed link only".'}
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
                <p className="text-sm font-black tracking-tight text-brand-600">Suggested people</p>
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

              {isCopiedEvent ? (
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setShareSuggestionGroup('previous_activity')}
                    className={`rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                      shareSuggestionGroup === 'previous_activity'
                        ? 'bg-white text-brand-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    Last session ({previousActivityCandidates.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareSuggestionGroup('other_people')}
                    className={`rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                      shareSuggestionGroup === 'other_people'
                        ? 'bg-white text-brand-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    From your activities ({otherPeopleCandidates.length})
                  </button>
                </div>
              ) : null}

              {isCopiedEvent ? (
                <p className="mt-2 text-xs text-slate-500">
                  {shareSuggestionGroup === 'previous_activity'
                    ? 'People who had access to last session'
                    : 'People from your recent activities (not added by default)'}
                </p>
              ) : null}

              {inAppShareLoading ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  Loading recipients...
                </div>
              ) : visibleShareCandidates.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {isCopiedEvent && shareSuggestionGroup === 'previous_activity' ? (
                    <p className="text-xs font-semibold text-brand-700">✓ These people will be carried forward</p>
                  ) : null}
                  {isCopiedEvent && shareSuggestionGroup === 'other_people' ? (
                    <p className="text-xs text-slate-500">Not added automatically — select people to include</p>
                  ) : null}
                  <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                    {visibleShareCandidates.map((candidate) => {
                      const checked = selectedShareCandidateKeys.includes(candidate.recipient_key);
                      const engagementLabel = getEngagementTagLabel(candidate);
                      return (
                        <label key={candidate.recipient_key} className="flex cursor-pointer items-start gap-3 border-b border-slate-200 px-3 py-3 last:border-b-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(evt) => {
                              setSelectedShareCandidateKeys((prev) => {
                                if (evt.target.checked) {
                                  if (prev.includes(candidate.recipient_key)) return prev;
                                  return [...prev, candidate.recipient_key];
                                }
                                return prev.filter((key) => key !== candidate.recipient_key);
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
                              {candidate.recipient_type === 'guest_profile' ? ' · Guest' : ''}
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
                        onClick={() => setSelectedShareCandidateKeys(visibleShareCandidates.map((candidate) => candidate.recipient_key))}
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedShareCandidateKeys([])}
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
                      >
                        Clear
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const payload = buildRecipientPayloadFromKeys(selectedShareCandidateKeys);
                        void shareToSelectedRecipients(payload.userIds, payload.attendeeProfileIds);
                      }}
                      disabled={inAppShareSaving || selectedShareCandidateKeys.length === 0}
                      className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-500 disabled:opacity-50"
                    >
                      {inAppShareSaving
                        ? 'Sharing...'
                        : `Give access to selected (${selectedShareCandidateKeys.length})`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  {isCopiedEvent && shareSuggestionGroup === 'previous_activity'
                    ? 'No one from the last session. Try "From your activities"'
                    : isCopiedEvent
                      ? 'No recent people to suggest'
                      : 'No suggestions in this group yet.'}
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
                      onClick={() => {
                        if (!lookupCandidate.user_id) return;
                        void shareToSelectedRecipients([lookupCandidate.user_id]);
                      }}
                      disabled={inAppShareSaving || !lookupCandidate.user_id}
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
                    void handleManualShare('whatsapp');
                  }}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-5 h-5" />
                  Share to WhatsApp
                </button>
                <button
                  onClick={() => {
                    void handleManualShare('sms');
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-700 font-black py-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-5 h-5" />
                  Share by Text
                </button>
                <button
                  onClick={() => {
                    void handleManualShare('email');
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-700 font-black py-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Mail className="w-5 h-5" />
                  Share by Email
                </button>
                <button
                  onClick={() => {
                    void handleManualShare('copy');
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
