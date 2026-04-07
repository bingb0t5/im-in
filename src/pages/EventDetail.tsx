import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { Calendar, MapPin, Users, CheckCircle2, AlertCircle, ArrowLeft, Share2, MessageCircle, MessageSquare, Mail, Copy, X, Plus, Download, ThumbsUp, CircleHelp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { buildGoogleCalendarEventUrl, buildIcsEventContent, formatDate, formatDay, formatDurationMinutes, generateSlug } from '../utils';
import { Event, Attendee, EventInterest } from '../types';
import { guestService, AttendeeProfile, getAccountNameFromUser, isSystemGuestEmail } from '../services/guestService';
import { getAttendanceSummary, getMyRsvpBuckets } from '../lib/attendees';
import { decideRsvpStatus, getConfirmedCount, isRsvpBlocked } from '../lib/rsvp';
import { findMyInterest, getNamedThinkingInterests, getThinkingCount } from '../lib/interests';
import { goBackOr } from '../lib/navigation';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const TRAILING_PUNCTUATION_PATTERN = /[),.!?:;]+$/;

function renderTextWithAutoLinks(text: string) {
  const blocks = text.split('\n');

  return blocks.map((block, blockIndex) => {
    const matches = Array.from(block.matchAll(URL_PATTERN));
    const children: React.ReactNode[] = [];
    let lastIndex = 0;

    matches.forEach((match, matchIndex) => {
      const rawUrl = match[0];
      const matchIndexInBlock = match.index ?? 0;
      const trimmedUrl = rawUrl.replace(TRAILING_PUNCTUATION_PATTERN, '');
      const trailingText = rawUrl.slice(trimmedUrl.length);

      if (matchIndexInBlock > lastIndex) {
        children.push(block.slice(lastIndex, matchIndexInBlock));
      }

      if (trimmedUrl) {
        const href = trimmedUrl.startsWith('www.') ? `https://${trimmedUrl}` : trimmedUrl;
        children.push(
          <a
            key={`link-${blockIndex}-${matchIndex}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-500"
          >
            {trimmedUrl}
          </a>,
        );
      }

      if (trailingText) {
        children.push(trailingText);
      }

      lastIndex = matchIndexInBlock + rawUrl.length;
    });

    if (lastIndex < block.length) {
      children.push(block.slice(lastIndex));
    }

    return (
      <React.Fragment key={`description-line-${blockIndex}`}>
        {children.length > 0 ? children : block}
        {blockIndex < blocks.length - 1 ? <br /> : null}
      </React.Fragment>
    );
  });
}

export default function EventDetail({ user }: { user: User | null }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [showRsvpModal, setShowRsvpModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showProxyModal, setShowProxyModal] = useState(false);
  const [showShareChoiceModal, setShowShareChoiceModal] = useState(false);
  const [showManualShareModal, setShowManualShareModal] = useState(false);
  const [manualShareUrl, setManualShareUrl] = useState('');
  const [proxyName, setProxyName] = useState('');
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [proxyOwnerName, setProxyOwnerName] = useState('');
  const [proxyOwnerEmail, setProxyOwnerEmail] = useState('');
  const [guestInfo, setGuestInfo] = useState({ name: '', email: '' });
  const [guestProfile, setGuestProfile] = useState<AttendeeProfile | null>(null);
  const [signedInPreferredName, setSignedInPreferredName] = useState('');
  const [signedInProfileId, setSignedInProfileId] = useState<string | null>(null);
  const [myRsvps, setMyRsvps] = useState<Attendee[]>([]);
  const [interests, setInterests] = useState<EventInterest[]>([]);
  const [thinkingLoading, setThinkingLoading] = useState(false);
  const [showThinkingModal, setShowThinkingModal] = useState(false);
  const [isEventHostViewer, setIsEventHostViewer] = useState(false);
  const [adderNamesByProfileId, setAdderNamesByProfileId] = useState<Record<string, string>>({});
  const [adderHasEmailByProfileId, setAdderHasEmailByProfileId] = useState<Record<string, boolean>>({});
  const [successType, setSuccessType] = useState<'self' | 'proxy'>('self');
  const [proxyPendingApproval, setProxyPendingApproval] = useState(false);
  const [selfPendingApproval, setSelfPendingApproval] = useState(false);
  const [emailUpgradeValue, setEmailUpgradeValue] = useState('');
  const [emailUpgradeSaving, setEmailUpgradeSaving] = useState(false);
  const [emailUpgradeMessage, setEmailUpgradeMessage] = useState<string | null>(null);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestWhatsapp, setRequestWhatsapp] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState(false);
  const [myJoinRequestStatus, setMyJoinRequestStatus] = useState<'pending' | 'approved' | 'rejected' | 'cancelled' | null>(null);
  const [rsvpToCancel, setRsvpToCancel] = useState<Attendee | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [hasPublicModerationHistory, setHasPublicModerationHistory] = useState(false);
  const [canViewFullDetails, setCanViewFullDetails] = useState(false);

  useBodyScrollLock(
    showRequestModal
    || showRsvpModal
    || showSuccessModal
    || showCancelModal
    || showProxyModal
    || showThinkingModal
    || showShareChoiceModal
    || showManualShareModal,
  );

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

  const fallbackNameFromEmail = (email?: string | null) => {
    if (!email || isSystemGuestEmail(email)) return '';
    const localPart = (email || '').split('@')[0] || '';
    const words = localPart
      .replace(/[._-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const pickFirstNonEmpty = (...values: Array<string | null | undefined>) => {
    for (const value of values) {
      const trimmed = (value || '').trim();
      if (trimmed) return trimmed;
    }
    return '';
  };

  const shouldReplaceAutoFilledName = (currentValue: string, fallbackValue: string) => {
    const current = currentValue.trim();
    const fallback = fallbackValue.trim();
    if (!current) return true;
    if (!fallback) return false;
    return current.toLowerCase() === fallback.toLowerCase();
  };

  const getDisplayName = (person: {
    guest_name?: string | null;
    guest_email?: string | null;
    resolved_display_name?: string | null;
  }) => {
    return pickFirstNonEmpty(person.resolved_display_name, person.guest_name, fallbackNameFromEmail(person.guest_email)) || 'Guest';
  };

  const getDisplayEmail = (email?: string | null) => {
    if (!email || isSystemGuestEmail(email)) return '';
    return email;
  };

  const getCurrentProfileId = () => {
    return user ? signedInProfileId || guestProfile?.id || null : guestProfile?.id || signedInProfileId || null;
  };

  const getAddedByLabel = (attendee: Attendee) => {
    if (!attendee.added_by_type || attendee.added_by_type === 'self') return null;
    if (attendee.added_by_type === 'host') return 'added by host';
    if (attendee.added_by_type === 'proxy') {
      const adderId = attendee.added_by_attendee_profile_id || '';
      if (signedInProfileId && adderId && signedInProfileId === adderId && signedInPreferredName) {
        return `added by ${signedInPreferredName}`;
      }
      if (guestProfile?.id && adderId && guestProfile.id === adderId && signedInPreferredName) {
        return `added by ${signedInPreferredName}`;
      }
      const adderName = adderNamesByProfileId[adderId];
      const adderHasEmail = adderHasEmailByProfileId[adderId];
      if (adderHasEmail === false) {
        return `added by ${adderName || 'attendee'} (guest)`;
      }
      if (adderName) return `added by ${adderName}`;
      return 'added by attendee';
    }
    return null;
  };

  const isGuestAccountAttendee = (attendee: Attendee) => {
    if (attendee.user_id || attendee.resolved_user_id) return false;
    if (attendee.added_by_type && attendee.added_by_type !== 'self') return false;
    return !attendee.guest_email || isSystemGuestEmail(attendee.guest_email);
  };

  const getAttendeeDisplayName = (attendee: Attendee) => {
    const baseName = getDisplayName(attendee);
    return isGuestAccountAttendee(attendee) ? `${baseName} (guest account)` : baseName;
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
      setAdderHasEmailByProfileId({});
      return;
    }

    const { data } = await supabase
      .from('attendee_profiles')
      .select('id, full_name, email')
      .in('id', ids);

    const map: Record<string, string> = {};
    const hasEmailMap: Record<string, boolean> = {};
    (data || []).forEach((profile: any) => {
      const fullName = (profile.full_name || '').trim();
      const fallback = fallbackNameFromEmail(profile.email);
      map[profile.id] = fullName || fallback || 'attendee';
      hasEmailMap[profile.id] = !!(profile.email && !isSystemGuestEmail(profile.email));
    });
    if (signedInProfileId && signedInPreferredName) {
      map[signedInProfileId] = signedInPreferredName;
    }
    setAdderNamesByProfileId(map);
    setAdderHasEmailByProfileId(hasEmailMap);
  };

  useEffect(() => {
    const checkGuestSession = async () => {
      const token = guestService.getStoredSession();
      if (token) {
        const profile = await guestService.validateSession(token);
        if (profile) {
          setGuestProfile(profile);
          setGuestInfo({ name: profile.full_name, email: getDisplayEmail(profile.email) });
        } else {
          guestService.clearStoredSession();
        }
      }
    };
    checkGuestSession();
  }, []);

  useEffect(() => {
    if (!user) return;
    setGuestInfo((prev) => ({
      name: pickFirstNonEmpty(prev.name, getAccountNameFromUser(user), signedInPreferredName, fallbackNameFromEmail(user.email)),
      email: user.email || prev.email,
    }));
  }, [user, signedInPreferredName]);

  useEffect(() => {
    const defaultName = pickFirstNonEmpty(
      getAccountNameFromUser(user),
      signedInPreferredName,
      guestProfile?.full_name,
      guestInfo.name,
      fallbackNameFromEmail(user?.email || guestInfo.email),
    );
    const currentRequestName = requestName.trim();
    const fallbackHandleName = fallbackNameFromEmail(user?.email || guestInfo.email);
    const shouldReplace = shouldReplaceAutoFilledName(currentRequestName, fallbackHandleName);
    if (defaultName && shouldReplace) {
      setRequestName(defaultName);
    }
  }, [user, signedInPreferredName, guestProfile?.full_name, guestInfo.name, guestInfo.email, requestName]);

  useEffect(() => {
    const fallbackHandleName = fallbackNameFromEmail(user?.email || guestInfo.email);
    const defaultProxyOwnerName = user
      ? pickFirstNonEmpty(
          getAccountNameFromUser(user),
          signedInPreferredName,
          guestInfo.name,
          fallbackHandleName,
        )
      : pickFirstNonEmpty(guestInfo.name, fallbackHandleName);

    if (defaultProxyOwnerName && shouldReplaceAutoFilledName(proxyOwnerName, fallbackHandleName)) {
      setProxyOwnerName(defaultProxyOwnerName);
    }

    if (user) {
      setProxyOwnerEmail(user.email || '');
      return;
    }
    setProxyOwnerEmail(guestInfo.email || '');
  }, [user, signedInPreferredName, guestInfo.name, guestInfo.email, proxyOwnerName]);

  useEffect(() => {
    const hydrateSignedInProfile = async () => {
      if (!user) {
        setSignedInProfileId(null);
        return;
      }

      try {
        const profile = await guestService.getOrCreateProfileForUser(
          user,
          pickFirstNonEmpty(getAccountNameFromUser(user), signedInPreferredName),
        );
        setSignedInProfileId(profile.id);
      } catch {
        setSignedInProfileId(null);
      }
    };

    hydrateSignedInProfile();
  }, [user, signedInPreferredName]);

  useEffect(() => {
    const hydrateHostViewer = async () => {
      if (!user || !event?.id) {
        setIsEventHostViewer(false);
        return;
      }

      if (event.host_user_id === user.id) {
        setIsEventHostViewer(true);
        return;
      }

      const { data } = await supabase
        .from('event_hosts')
        .select('id')
        .eq('event_id', event.id)
        .eq('user_id', user.id)
        .maybeSingle();

      setIsEventHostViewer(!!data?.id);
    };

    hydrateHostViewer();
  }, [user, event?.id, event?.host_user_id]);

  useEffect(() => {
    const hydrateSignedInPreferredName = async () => {
      if (!user) {
        setSignedInPreferredName('');
        return;
      }

      const { data: profileData } = await supabase
        .from('attendee_profiles')
        .select('full_name, first_name, last_name, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const profileName = pickFirstNonEmpty(
        profileData?.full_name,
        `${profileData?.first_name || ''} ${profileData?.last_name || ''}`.trim(),
      );

      const immediate = pickFirstNonEmpty(
        profileName,
        getAccountNameFromUser(user),
        event?.host_user_id === user.id ? event?.host_name : '',
      );
      if (immediate) {
        setSignedInPreferredName(immediate);
        return;
      }

      const { data } = await supabase
        .from('events')
        .select('host_name, created_at')
        .eq('host_user_id', user.id)
        .not('host_name', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const hostedName = pickFirstNonEmpty(data?.host_name);
      if (hostedName) {
        setSignedInPreferredName(hostedName);
      } else {
        setSignedInPreferredName('');
      }
    };

    hydrateSignedInPreferredName();
  }, [user, event?.id]);

  useEffect(() => {
    fetchEvent();
    // Subscribe to changes
    const channel = supabase
      .channel('event_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_attendees' }, () => {
        fetchAttendees();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_interests' }, () => {
        fetchInterests();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [slug, searchParams.toString()]);

  useEffect(() => {
    const loadModerationHistoryPresence = async () => {
      if (!event?.id) {
        setHasPublicModerationHistory(false);
        return;
      }

      const visibility = event.visibility || (event.is_public ? 'public' : 'private');
      if (visibility !== 'public') {
        setHasPublicModerationHistory(false);
        return;
      }

      const { data, error } = await supabase.rpc('list_public_moderation_log', {
        p_target_id: event.id,
        p_limit: 1,
        p_offset: 0,
      });

      if (error) {
        setHasPublicModerationHistory(false);
        return;
      }

      setHasPublicModerationHistory(Array.isArray(data) && data.length > 0);
    };

    void loadModerationHistoryPresence();
  }, [event?.id, event?.visibility, event?.is_public]);

  useEffect(() => {
    if (attendees.length > 0) {
      const currentProfileId = getCurrentProfileId() || undefined;
      const { selfRsvps, managedProxyRsvps } = getMyRsvpBuckets(attendees, {
        userId: user?.id,
        userEmail: user?.email,
        profileId: currentProfileId,
      });
      setMyRsvps([...selfRsvps, ...managedProxyRsvps]);
    } else {
      setMyRsvps([]);
    }
  }, [user, guestProfile, signedInProfileId, attendees]);

  useEffect(() => {
    const loadMyJoinRequestState = async () => {
      if (!event?.id) {
        setMyJoinRequestStatus(null);
        return;
      }

      const email = (user?.email || guestInfo.email || '').trim().toLowerCase();
      if (!user && !guestProfile?.id && !email) {
        setMyJoinRequestStatus(null);
        return;
      }

      const { data, error } = await supabase.rpc('get_my_join_request_for_event', {
        p_event_id: event.id,
        p_guest_email: email || null,
        p_attendee_profile_id: guestProfile?.id || null,
      });

      if (error) {
        setMyJoinRequestStatus(null);
        return;
      }

      const status = (data?.status || null) as 'pending' | 'approved' | 'rejected' | 'cancelled' | null;
      setMyJoinRequestStatus(status);
    };

    void loadMyJoinRequestState();
  }, [event?.id, user?.id, user?.email, guestProfile?.id, guestInfo.email]);

  useEffect(() => {
    if (!showSuccessModal) return;
    if (guestInfo.email && !isSystemGuestEmail(guestInfo.email)) {
      setEmailUpgradeValue(guestInfo.email);
    } else {
      setEmailUpgradeValue('');
    }
    setEmailUpgradeMessage(null);
  }, [showSuccessModal, guestInfo.email]);

  const fetchEvent = async () => {
    if (!slug) {
      setEvent(null);
      setAttendees([]);
      setInterests([]);
      setCanViewFullDetails(false);
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.rpc('get_event_for_view', {
      p_slug: slug,
      p_access_code: searchParams.get('access'),
    });

    if (error || !Array.isArray(data) || data.length === 0) {
      console.error(error);
      setEvent(null);
      setAttendees([]);
      setInterests([]);
      setCanViewFullDetails(false);
      setLoading(false);
      return;
    }

    const nextEvent = data[0] as Event & { can_view_full_details?: boolean };
    const requestedSlug = (slug || '').trim();
    const canonicalPublicSlug = (nextEvent.public_slug || nextEvent.slug || '').trim();
    const canonicalPrivateSlug = (nextEvent.private_slug || nextEvent.join_code || '').trim();
    const legacyAccessToken = searchParams.get('access');
    const visibility = nextEvent.visibility || (nextEvent.is_public ? 'public' : 'private');

    if (legacyAccessToken && canonicalPrivateSlug) {
      navigate(`/events/${canonicalPrivateSlug}`, { replace: true });
      setLoading(false);
      return;
    }

    const isKnownCanonicalSlug =
      (canonicalPublicSlug && requestedSlug === canonicalPublicSlug)
      || (canonicalPrivateSlug && requestedSlug === canonicalPrivateSlug);
    const shouldPreservePrivatePath =
      !!canonicalPrivateSlug
      && (
        requestedSlug === canonicalPrivateSlug
        || !!legacyAccessToken
        || (
          requestedSlug !== canonicalPublicSlug
          && visibility !== 'public'
          && !!nextEvent.can_view_full_details
        )
      );
    if (requestedSlug && !isKnownCanonicalSlug && (canonicalPublicSlug || canonicalPrivateSlug)) {
      const targetSlug = shouldPreservePrivatePath ? canonicalPrivateSlug : canonicalPublicSlug;
      if (!targetSlug) {
        setLoading(false);
        return;
      }
      const nextSearch = searchParams.toString();
      navigate(`/events/${targetSlug}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true });
      setLoading(false);
      return;
    }

    setEvent(nextEvent);
    setCanViewFullDetails(!!nextEvent.can_view_full_details);

    await Promise.all([
      fetchAttendees(nextEvent.id),
      fetchInterests(nextEvent.id),
    ]);

    setLoading(false);
  };

  const fetchAttendees = async (eventId?: string) => {
    const id = eventId || event?.id;
    if (!id) return;

    const { data } = await supabase.rpc('list_event_attendees_for_view', {
      p_event_id: id,
      p_access_code: searchParams.get('access') || slug || null,
    });

    if (data) {
      setAttendees(data);
      await hydrateAdderNames(data as Attendee[]);
    } else {
      setAttendees([]);
      setAdderNamesByProfileId({});
    }
  };

  const fetchInterests = async (eventId?: string) => {
    const id = eventId || event?.id;
    if (!id) return;

    const { data } = await supabase.rpc('list_event_interests_for_view', {
      p_event_id: id,
      p_access_code: searchParams.get('access') || slug || null,
    });

    if (data) {
      setInterests(data as EventInterest[]);
    } else {
      setInterests([]);
    }
  };

  const clearMyInterest = async (
    eventId: string,
    currentProfileId: string | null,
    email?: string | null,
  ) => {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const { error } = await supabase
      .from('event_interests')
      .delete()
      .eq('event_id', eventId)
      .or(
        [
          user?.id ? `user_id.eq.${user.id}` : '',
          currentProfileId ? `attendee_profile_id.eq.${currentProfileId}` : '',
          normalizedEmail ? `guest_email.eq.${normalizedEmail}` : '',
        ]
          .filter(Boolean)
          .join(','),
      );
    if (error) {
      console.error('Could not clear thinking-about-it state after RSVP', error);
    }
  };

  const handleToggleThinking = async () => {
    if (!event) return;
    if (hasSelfRsvp) {
      alert('You are already in this activity.');
      return;
    }

    const rawEmail = (user?.email || guestInfo.email || '').trim().toLowerCase();
    const requireGuestEmail = !user && event.require_guest_email_for_join === true;
    const name = pickFirstNonEmpty(
      user?.id && event.host_user_id === user.id ? event.host_name : '',
      user?.user_metadata?.full_name,
      signedInPreferredName,
      guestProfile?.full_name,
      guestInfo.name,
      fallbackNameFromEmail(rawEmail),
    );

    if (!name || (requireGuestEmail && !rawEmail)) {
      if (user?.email && !guestInfo.email) {
        setGuestInfo(prev => ({ ...prev, email: user.email! }));
      }
      setShowRsvpModal(true);
      return;
    }

    try {
      setThinkingLoading(true);
      let currentProfileId = getCurrentProfileId();

      if (user && !currentProfileId) {
        const profile = await guestService.getOrCreateProfileForUser(user);
        currentProfileId = profile.id;
        setGuestProfile(profile);
        setSignedInProfileId(profile.id);
      }

      if (!user && !currentProfileId) {
        const names = name.split(' ');
        const firstName = names[0];
        const lastName = names.slice(1).join(' ') || '';
        const { profile } = await guestService.createGuestSession(firstName, lastName, { email: rawEmail || null });
        currentProfileId = profile.id;
        setGuestProfile(profile);
        setGuestInfo((prev) => ({
          ...prev,
          name: profile.full_name || prev.name,
          email: getDisplayEmail(profile.email),
        }));
      }

      const rpcEmail = (rawEmail || (currentProfileId ? `guest+${currentProfileId}@guest.im-in.local` : '')).toLowerCase();

      const eventVisibility = event.visibility || (event.is_public ? 'public' : 'private');
      const visibilityMode = eventVisibility === 'public' ? 'count_only' : 'named';

      const { data, error } = await supabase.rpc('toggle_event_interest', {
        p_event_id: event.id,
        p_guest_name: name,
        p_guest_email: rpcEmail,
        p_visibility_mode: visibilityMode,
        p_user_id: user?.id || null,
        p_attendee_profile_id: currentProfileId || null,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await fetchInterests(event.id);
    } catch (error: any) {
      console.error('Thinking toggle error:', error);
      alert(error.message || 'Could not update thinking-about-it status. Please try again.');
    } finally {
      setThinkingLoading(false);
    }
  };

  const handleRsvp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!event) return;
    setRsvpLoading(true);

    const rawEmail = (user?.email || guestInfo.email || '').trim().toLowerCase();
    const requireGuestEmail = !user && event.require_guest_email_for_join === true;
    const name = pickFirstNonEmpty(
      user?.id && event.host_user_id === user.id ? event.host_name : '',
      user?.user_metadata?.full_name,
      signedInPreferredName,
      guestProfile?.full_name,
      guestInfo.name,
      fallbackNameFromEmail(rawEmail),
    );

    if (!name || (requireGuestEmail && !rawEmail)) {
      if (user?.email && !guestInfo.email) {
        setGuestInfo(prev => ({ ...prev, email: user.email! }));
      }
      setShowRsvpModal(true);
      setRsvpLoading(false);
      return;
    }

    try {
      let currentProfileId = getCurrentProfileId();

      if (user && !currentProfileId) {
        const profile = await guestService.getOrCreateProfileForUser(user);
        currentProfileId = profile.id;
        setGuestProfile(profile);
        setSignedInProfileId(profile.id);
      }

      // 1. For guests, create a profile/session if missing.
      if (!user && !currentProfileId) {
        const names = name.split(' ');
        const firstName = names[0];
        const lastName = names.slice(1).join(' ') || '';
        const { profile } = await guestService.createGuestSession(firstName, lastName, { email: rawEmail || null });
        currentProfileId = profile.id;
        setGuestProfile(profile);
        setGuestInfo((prev) => ({
          ...prev,
          name: profile.full_name || prev.name,
          email: getDisplayEmail(profile.email),
        }));
      }
      const rpcEmail = (rawEmail || (currentProfileId ? `guest+${currentProfileId}@guest.im-in.local` : '')).toLowerCase();

      // 2. Use request-aware RSVP path so host-approval activities create pending requests.
      const { data, error } = await supabase.rpc('request_or_submit_rsvp', {
        p_event_id: event.id,
        p_guest_name: name,
        p_guest_email: rpcEmail,
        p_attendee_profile_id: currentProfileId || null,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = data?.result as string | undefined;
      if (result === 'request_pending' || result === 'already_pending') {
        setMyJoinRequestStatus('pending');
        setShowRsvpModal(false);
        setSelfPendingApproval(true);
        setSuccessType('self');
        setShowSuccessModal(true);
        await clearMyInterest(event.id, currentProfileId || null, rpcEmail);
        fetchInterests();
        return;
      }

      if (result === 'already_member') {
        alert('You are already in this activity.');
        fetchAttendees();
        return;
      }

      setMyJoinRequestStatus(null);
      setShowRsvpModal(false);
      setSelfPendingApproval(false);
      setSuccessType('self');
      setShowSuccessModal(true);
      await clearMyInterest(event.id, currentProfileId || null, rpcEmail);
      fetchAttendees();
      fetchInterests();
    } catch (error: any) {
      console.error('RSVP Error:', error);
      alert(error.message || 'Failed to join activity. Please try again.');
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleProxyRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !proxyName.trim()) return;
    setRsvpLoading(true);
    setProxyError(null);

    const rawEmail = (user?.email || proxyOwnerEmail.trim() || guestInfo.email || '').trim().toLowerCase();
    const requireGuestEmail = !user && event.require_guest_email_for_join === true;
    let currentProfileId = getCurrentProfileId();

    if (requireGuestEmail && !rawEmail) {
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

      if (!user && !currentProfileId) {
        const ownerName = pickFirstNonEmpty(proxyOwnerName, guestInfo.name, fallbackNameFromEmail(rawEmail));
        if (!ownerName) {
          setProxyError('Please enter your name.');
          setRsvpLoading(false);
          return;
        }
        const names = ownerName.split(' ');
        const firstName = names[0];
        const lastName = names.slice(1).join(' ') || '';
        const { profile } = await guestService.createGuestSession(firstName, lastName, { email: rawEmail || null });
        currentProfileId = profile.id;
        setGuestProfile(profile);
        setGuestInfo({ name: profile.full_name, email: getDisplayEmail(profile.email) });
      }

      if (!currentProfileId) {
        setProxyError('You must be signed in or have a guest session to add someone else.');
        setRsvpLoading(false);
        return;
      }

      const approvalRequiredForEvent = Boolean(event.require_host_approval_for_join);
      // 2. Determine status from shared RSVP strategy only when direct joins are allowed.
      if (!approvalRequiredForEvent) {
        const decision = decideRsvpStatus(getConfirmedCount(attendees), event.capacity, event.allow_waitlist);
        if (isRsvpBlocked(decision)) {
          setProxyError(decision.reason);
          setRsvpLoading(false);
          return;
        }
      }

      const rpcEmail = (rawEmail || (currentProfileId ? `guest+${currentProfileId}@guest.im-in.local` : '')).toLowerCase();

      // 3. Use server-side upsert path for proxy RSVP (handles legacy constraints + auth).
      const sessionToken = guestService.getStoredSession();
      const { data, error } = await supabase.rpc('add_proxy_attendee', {
        p_event_id: event.id,
        p_proxy_name: proxyName.trim(),
        p_attendee_profile_id: currentProfileId,
        p_user_id: user?.id || null,
        p_owner_email: rpcEmail,
        p_session_token: sessionToken,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setShowProxyModal(false);
      setProxyName('');
      setSuccessType('proxy');
      setProxyPendingApproval(data?.result === 'request_pending' || data?.result === 'already_pending');
      setShowSuccessModal(true);
      fetchAttendees();
      fetchInterests();
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
      fetchInterests();
    } catch (error: unknown) {
      console.error('Cancel Error:', error);
      setCancelError(getErrorMessage(error, 'Failed to cancel RSVP'));
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleAccessRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;

    const name = requestName.trim();
    const whatsapp = requestWhatsapp.trim();
    if (!name || !whatsapp) {
      setRequestError('Please add your name and WhatsApp number.');
      return;
    }

    try {
      setRequestLoading(true);
      setRequestError(null);
      const { data: existingPending } = await supabase
        .from('event_access_requests')
        .select('id')
        .eq('event_id', event.id)
        .eq('requester_whatsapp', whatsapp)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingPending?.id) {
        setRequestError('You already have a pending request for this activity.');
        setRequestLoading(false);
        return;
      }

      const { error } = await supabase.from('event_access_requests').insert([
        {
          event_id: event.id,
          requester_user_id: user?.id || null,
          requester_name: name,
          requester_whatsapp: whatsapp,
          requester_note: requestNote.trim() || null,
          status: 'pending',
        },
      ]);

      if (error) throw error;
      setRequestSuccess(true);
      setRequestNote('');
    } catch (error) {
      setRequestError(getErrorMessage(error, 'Could not submit request. Please try again.'));
    } finally {
      setRequestLoading(false);
    }
  };

  const handleSaveEmailUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestProfile?.id) return;
    const normalized = emailUpgradeValue.trim().toLowerCase();
    if (!normalized) {
      setEmailUpgradeMessage('Please enter an email address.');
      return;
    }

    try {
      setEmailUpgradeSaving(true);
      setEmailUpgradeMessage(null);
      const updated = await guestService.addEmailToProfile(guestProfile.id, normalized);
      setGuestProfile(updated);
      setGuestInfo((prev) => ({ ...prev, email: normalized, name: updated.full_name || prev.name }));
      setEmailUpgradeValue('');
      setEmailUpgradeMessage('Email saved. You can now recover this guest account with email, or link WhatsApp later.');
    } catch (error: any) {
      setEmailUpgradeMessage(error?.message || 'Could not save email right now.');
    } finally {
      setEmailUpgradeSaving(false);
    }
  };

  const handleStartGuestWhatsappUpgrade = () => {
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/auth/whatsapp/prep?returnTo=${encodeURIComponent(returnTo)}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
          <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="w-9 h-9 bg-slate-100 rounded-xl animate-pulse" />
            <div className="w-24 h-4 bg-slate-100 rounded-full animate-pulse" />
            <div className="w-16 h-8 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        </div>
        <main className="max-w-xl mx-auto px-6 pt-8 space-y-6">
          <div className="space-y-3">
            <div className="h-8 bg-slate-100 rounded-xl animate-pulse w-3/4" />
            <div className="h-5 bg-slate-100 rounded-xl animate-pulse w-1/2" />
            <div className="h-5 bg-slate-100 rounded-xl animate-pulse w-2/3" />
          </div>
          <div className="h-24 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}
          </div>
        </main>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-slate-50">
        <AlertCircle className="w-16 h-16 text-slate-200 mb-6" />
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Activity not found</h1>
        <p className="text-slate-500 mt-2 max-w-xs mx-auto">The link might be broken or the activity was deleted.</p>
        <button onClick={() => navigate('/')} className="mt-10 text-brand-600 font-bold hover:text-brand-500 transition-colors">Go Home</button>
      </div>
    );
  }

  const eventVisibility = event.visibility || (event.is_public ? 'public' : 'private');
  const accessToken = searchParams.get('access');
  const moderationHistoryParams = new URLSearchParams(location.search);
  moderationHistoryParams.set('action', 'moderation');
  moderationHistoryParams.set('activity', event.id);
  const moderationHistoryHref = {
    pathname: location.pathname,
    search: `?${moderationHistoryParams.toString()}`,
  };
  const hasAccessToken = !!(accessToken && event.access_code && accessToken === event.access_code);
  const isHostViewer = isEventHostViewer;
  const hasFullEventAccess = canViewFullDetails || hasAccessToken || isHostViewer;
  const publicEventSlug = event.public_slug || event.slug;
  const privateEventSlug = event.private_slug || event.join_code || event.slug;
  const publicEventUrl = `${window.location.origin}/events/${publicEventSlug}`;
  const privateEventUrl = `${window.location.origin}/events/${privateEventSlug}`;
  const { confirmedCount, waitlistCount, isFull, spotsRemaining } = getAttendanceSummary(attendees, event.capacity);
  const approvalRequired = !!event.require_host_approval_for_join;
  const joinRequestPending = approvalRequired && myJoinRequestStatus === 'pending' && myRsvps.length === 0;
  const mySelfRsvps = myRsvps.filter((rsvp) => rsvp.added_by_type !== 'proxy');
  const myManagedRsvps = myRsvps.filter((rsvp) => rsvp.added_by_type === 'proxy');
  const myInterest = findMyInterest(interests, {
    userId: user?.id,
    userEmail: user?.email,
    guestProfileId: getCurrentProfileId() || undefined,
  });
  const thinkingCount = getThinkingCount(interests);
  const namedThinkingInterests = getNamedThinkingInterests(interests);
  const hasSelfRsvp = mySelfRsvps.length > 0;
  const hasManagedRsvps = myManagedRsvps.length > 0;
  const rsvpButtonDisabled = rsvpLoading || joinRequestPending || (!approvalRequired && isFull && !event.allow_waitlist);
  const rsvpButtonLabel = rsvpLoading
    ? 'Saving'
    : hasSelfRsvp
      ? 'Going'
      : joinRequestPending
        ? 'Pending'
        : approvalRequired
          ? 'Request'
          : isFull
            ? 'Waitlist'
            : "I'm in";
  const thinkingButtonDisabled = thinkingLoading || hasSelfRsvp;
  const thinkingButtonActive = Boolean(myInterest) && !hasSelfRsvp;
  const confirmedDetailsEmail = getDisplayEmail(user?.email || guestProfile?.email || guestInfo.email);
  const confirmedDetailsName =
    pickFirstNonEmpty(
      user?.id && event.host_user_id === user.id ? event.host_name : '',
      user?.user_metadata?.full_name,
      signedInPreferredName,
      guestProfile?.full_name,
      guestInfo.name,
      fallbackNameFromEmail(confirmedDetailsEmail),
    ) || 'Guest';
  const shouldPromptEmailUpgrade =
    !user &&
    !!guestProfile?.id &&
    isSystemGuestEmail(guestProfile?.email || guestInfo.email) &&
    event.require_guest_email_for_join === false;
  const isGuestEmailRequired = event.require_guest_email_for_join === true;

  const buildInviteText = (url: string) =>
    `${event.title} – ${formatDate(event.starts_at, event.timezone)}\n${spotsRemaining} spots left. Join here:\n${url}`;

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

  const shareInvite = (url: string) => {
    const nativeText = `${event.title} – ${formatDate(event.starts_at, event.timezone)}\n${spotsRemaining} spots left. Join here:`;
    const isAppleMobile = /iPhone|iPad|iPod/i.test(window.navigator.userAgent);

    if (navigator.share) {
      const sharePromise = isAppleMobile
        ? navigator.share({ url })
        : navigator.share({ title: event.title, text: nativeText, url });

      sharePromise.catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        openManualShareModal(url);
      });
      return;
    }

    openManualShareModal(url);
  };

  const openDirections = () => {
    const url = (event.google_maps_url || '').trim();
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const buildCalendarDetails = (activityUrl: string) => {
    return [
      event.description?.trim() || '',
      event.location_text?.trim() ? `Exact location: ${event.location_text.trim()}` : '',
      '',
      `View activity: ${activityUrl}`,
      event.google_maps_url?.trim() ? `Directions: ${event.google_maps_url.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const buildCalendarLocation = () => {
    const mapsUrl = event.google_maps_url?.trim() || '';

    if (mapsUrl) {
      return mapsUrl;
    }

    return event.location_text?.trim() || '';
  };

  const openGoogleCalendar = () => {
    const activityUrl = eventVisibility === 'semi_public' ? privateEventUrl : window.location.href;
    const details = buildCalendarDetails(activityUrl);
    const location = buildCalendarLocation();

    const calendarUrl = buildGoogleCalendarEventUrl({
      title: event.title,
      startsAtIso: event.starts_at,
      endsAtIso: event.ends_at || null,
      durationMinutes: event.duration_minutes || 60,
      timezone: event.timezone,
      location,
      details,
    });

    window.open(calendarUrl, '_blank', 'noopener,noreferrer');
  };

  const downloadCalendarFile = () => {
    const activityUrl = eventVisibility === 'semi_public' ? privateEventUrl : window.location.href;
    const details = buildCalendarDetails(activityUrl);
    const location = buildCalendarLocation();
    const startsAtStamp = new Date(event.starts_at).toISOString().replace(/\W/g, '').slice(0, 12);
    const uid = `${event.id}.${startsAtStamp}@joinimin.com`;
    const icsContent = buildIcsEventContent({
      uid,
      title: event.title,
      startsAtIso: event.starts_at,
      endsAtIso: event.ends_at || null,
      durationMinutes: event.duration_minutes || 60,
      location,
      description: details,
      url: activityUrl,
      status: event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
    });
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${generateSlug(event.title || 'activity')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  if (!hasFullEventAccess) {
    const dayOnly = formatDay(event.starts_at, event.timezone);
    const previewLocation = event.public_location_text || 'Town/city shared by host';
    const previewSummary = event.public_summary || 'Request access to view full details and join this activity.';

    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
          <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
            <button onClick={() => goBackOr(navigate, '/calendar')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <span className="text-[10px] font-bold text-brand-600 uppercase tracking-widest">Activity Preview</span>
            <button
              onClick={() => shareInvite(publicEventUrl)}
              className="px-3 py-2 hover:bg-slate-50 rounded-xl transition-all flex items-center gap-1.5"
            >
              <Share2 className="w-5 h-5 text-slate-600" />
              <span className="text-xs font-bold text-slate-500">Share</span>
            </button>
          </div>
        </div>

        <main className="max-w-xl mx-auto px-6 pt-8 space-y-8">
          <section className="space-y-6">
            <span className="inline-flex items-center gap-1.5 text-indigo-500 text-[10px] font-bold uppercase tracking-widest">
              <Users className="w-3 h-3" /> Semi Public
            </span>
            <h1 className="text-[1.25rem] font-black tracking-tight leading-tight text-slate-900">{event.title}</h1>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                  <Calendar className="w-4 h-4 text-brand-600 shrink-0" />
                <p className="font-bold text-slate-800 text-sm">{dayOnly}</p>
              </div>
              <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-brand-600 shrink-0" />
                <p className="font-bold text-slate-800 text-sm">{previewLocation}</p>
              </div>
              {event.show_host_publicly && event.host_name && (
                <div className="flex items-center gap-3">
                    <Users className="w-4 h-4 text-brand-600 shrink-0" />
                  <p className="font-bold text-slate-800 text-sm">Hosted by {event.host_name}</p>
                </div>
              )}
            </div>

            <p className="text-slate-500 leading-relaxed whitespace-pre-wrap text-sm">{previewSummary}</p>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                if (document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur();
                }
                setRequestError(null);
                setRequestSuccess(false);
                setShowRequestModal(true);
              }}
              className="relative w-full overflow-hidden rounded-2xl border border-brand-600 bg-gradient-to-br from-teal-300 via-brand-500 to-teal-700 py-4 text-base font-bold text-white shadow-[0_10px_24px_rgba(13,148,136,0.34)] ring-1 ring-white/70 transition-all hover:brightness-105 active:scale-95"
            >
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-white/10 to-transparent" />
              <span className="relative">Request to View</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/explore')}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-4 text-base font-bold text-brand-600 transition-all hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 active:scale-95"
            >
              Explore Activities
            </button>
          </div>
        </main>

        <AnimatePresence>
          {showRequestModal && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowRequestModal(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Request to View</h2>
                    <p className="text-slate-500 font-medium text-sm">Send your details to the host and they can share the full link.</p>
                  </div>
                  <button onClick={() => setShowRequestModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                {requestSuccess ? (
                  <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4 text-sm font-medium text-brand-700">
                    Request sent. The host can contact you via WhatsApp.
                  </div>
                ) : (
                  <form onSubmit={handleAccessRequest} className="space-y-4">
                    {requestError && (
                      <p className="text-red-500 text-xs font-bold bg-red-50 p-3 rounded-xl border border-red-100">
                        {requestError}
                      </p>
                    )}
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Your Name</label>
                      <input
                        required
                        type="text"
                        className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                        value={requestName}
                        onChange={(e) => setRequestName(e.target.value)}
                        placeholder="e.g. Sarah Jones"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">WhatsApp Number</label>
                      <input
                        required
                        type="text"
                        className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                        value={requestWhatsapp}
                        onChange={(e) => setRequestWhatsapp(e.target.value)}
                        placeholder="+64..."
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Note (Optional)</label>
                      <textarea
                        rows={3}
                        className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium text-sm"
                        value={requestNote}
                        onChange={(e) => setRequestNote(e.target.value)}
                        placeholder="Anything else you'd like the host to know"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={requestLoading}
                      className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {requestLoading ? 'Sending...' : 'Send Request'}
                    </button>
                  </form>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom)+11rem)] sm:pb-48">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-6 h-11 flex items-center justify-between">
          <button onClick={() => goBackOr(navigate, '/calendar')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Activity Details</span>
          <button 
            onClick={() => {
              if (eventVisibility === 'semi_public' && hasFullEventAccess) {
                setShowShareChoiceModal(true);
                return;
              }
              shareInvite(privateEventUrl);
            }}
            className="px-3 py-2 hover:bg-slate-50 rounded-xl transition-all flex items-center gap-1.5"
          >
            <Share2 className="w-5 h-5 text-slate-600" />
            <span className="text-xs font-bold text-slate-500">Share</span>
          </button>
        </div>
      </div>

      <main className="max-w-xl mx-auto px-6 pt-8 space-y-8">
        {/* Hero Info */}
        <section className="space-y-5">
          <div className="flex items-center gap-2">
            {eventVisibility === 'public' ? (
              <span className="text-[10px] font-bold text-brand-600 uppercase tracking-widest">Public</span>
            ) : eventVisibility === 'semi_public' ? (
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Semi Public</span>
            ) : (
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Private Link</span>
            )}
            {(eventVisibility === 'public' || eventVisibility === 'semi_public') && hasPublicModerationHistory ? (
              <Link
                to={moderationHistoryHref}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
              >
                View moderation history
              </Link>
            ) : null}
          </div>

          <h1 className="text-[1.4rem] font-black tracking-tight leading-tight text-slate-900">
            {event.title}
          </h1>
          
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-3 min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-brand-600 shrink-0" />
                <div>
                  <p className="font-bold text-slate-800 text-sm">{formatDate(event.starts_at, event.timezone)}</p>
                  <p className="text-xs text-slate-400">{formatDurationMinutes(event.duration_minutes)}</p>
                </div>
              </div>

              {event.location_text && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{event.location_text}</p>
                    {event.google_maps_url && (
                      <button
                        type="button"
                        onClick={openDirections}
                        className="mt-1 text-xs font-bold text-brand-600 hover:text-brand-500 transition-all active:scale-95"
                      >
                        Get directions →
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-brand-600 shrink-0" />
                <div>
                  <p className="font-bold text-slate-800 text-sm">{confirmedCount} / {event.capacity} going</p>
                  {isFull ? (
                    <p className="text-xs text-amber-500">
                      {event.allow_waitlist ? `${waitlistCount} on waitlist` : 'Full'}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400">{spotsRemaining} spots left</p>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 pt-0.5">
              <p className="text-[9px] font-bold text-brand-600 uppercase tracking-widest mb-1.5 text-right">Save to calendar</p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={openGoogleCalendar}
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 px-3 py-2 transition-all active:scale-[0.99] text-left"
                >
                  <span className="inline-flex items-center gap-1.5 text-sm font-black leading-none">
                    <Calendar className="w-4 h-4" />
                    Google
                  </span>
                </button>
                <button
                  type="button"
                  onClick={downloadCalendarFile}
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 px-3 py-2 transition-all active:scale-[0.99] text-left"
                >
                  <span className="inline-flex items-center gap-1.5 text-sm font-black leading-none">
                    <Download className="w-4 h-4" />
                    Apple (.ics)
                  </span>
                </button>
              </div>
            </div>
          </div>

          {event.description && (
            <div className="text-slate-500 leading-relaxed text-sm pt-2">
              {renderTextWithAutoLinks(event.description)}
            </div>
          )}
        </section>

        {/* Attendee Preview */}
        {attendees.length > 0 && (
          <section className="bg-white rounded-2xl overflow-hidden">
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest px-5 pt-4 pb-3">Going</p>
            <div className="divide-y divide-slate-50">
              {attendees.map((attendee, i) => (
                <div key={attendee.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-300 w-5 text-right">{i + 1}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-700 text-sm">{getAttendeeDisplayName(attendee)}</span>
                      {getAddedByLabel(attendee) && (
                        <span className="text-[11px] text-slate-400">{getAddedByLabel(attendee)}</span>
                      )}
                    </div>
                  </div>
                  {attendee.status === 'waitlist' && (
                    <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">
                      Waitlist
                    </span>
                  )}
                  {attendee.status === 'pending_approval' && (
                    <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest">
                      Pending host approval
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="bg-white rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest">Thinking about it</p>
            <button
              onClick={() => setShowThinkingModal(true)}
              className="text-sm font-bold text-indigo-500 hover:text-indigo-400 transition-colors"
              disabled={thinkingCount === 0 || (eventVisibility === 'public' && namedThinkingInterests.length === 0)}
            >
              {thinkingCount}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {eventVisibility === 'public'
              ? `${thinkingCount} people are thinking about it`
              : `${namedThinkingInterests.length} people visible by name`}
          </p>
        </section>

        {attendees.length === 0 && (
          <p className="text-slate-400 text-sm px-1">Be the first to join!</p>
        )}

        {/* Host Info */}
        <section className="flex items-center justify-between py-4 border-t border-slate-100">
          <div>
            <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-0.5">Hosted by</p>
            <p className="text-base font-bold text-slate-800">{event.host_name || 'Anonymous'}</p>
          </div>
          {event.host_contact_text && event.host_contact_text.replace(/\D/g, '') && (
            <a 
              href={`https://wa.me/${event.host_contact_text.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${event.host_name}, I'm interested in your activity: ${event.title}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-11 h-11 bg-brand-600 hover:bg-brand-500 text-white rounded-xl flex items-center justify-center transition-all active:scale-95"
              title="Message on WhatsApp"
            >
              <MessageCircle className="w-5 h-5" />
            </a>
          )}
        </section>
      </main>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] bg-white/95 backdrop-blur-lg border-t border-slate-100 z-20">
        <div className="max-w-xl mx-auto space-y-2">
          {approvalRequired && myRsvps.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {myJoinRequestStatus === 'pending'
                ? 'Join request pending host approval.'
                : myJoinRequestStatus === 'rejected'
                  ? 'Your previous join request was declined. You can submit a new request.'
                  : "This activity requires host approval before you're added."}
            </div>
          ) : null}
          {myRsvps.length > 0 ? (
            <>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {myRsvps.map(rsvp => (
                  <div key={rsvp.id} className="flex items-center justify-between bg-brand-50 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-600" />
                      <span className="text-sm font-bold text-brand-700">{getAttendeeDisplayName(rsvp)}</span>
                      {rsvp.status === 'waitlist' && (
                        <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">Waitlist</span>
                      )}
                      {rsvp.status === 'pending_approval' && (
                        <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest">
                          Pending host approval
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
                      className="text-xs text-slate-400 hover:text-red-400 transition-all active:scale-95"
                    >
                      {rsvp.status === 'pending_approval' ? 'Cancel request' : 'Cancel'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                if (hasSelfRsvp || rsvpButtonDisabled) return;
                handleRsvp();
              }}
              disabled={rsvpButtonDisabled}
              aria-label={
                hasSelfRsvp
                  ? "You're already in this activity"
                  : joinRequestPending
                    ? 'Join request pending'
                    : approvalRequired
                      ? 'Request to join'
                      : isFull
                        ? 'Join waitlist'
                        : "I'm in"
              }
              className={[
                'flex min-h-[3.45rem] w-full flex-col items-center justify-center gap-0.5 rounded-[1.15rem] border px-2 py-1.5 text-center backdrop-blur-md transition-all active:scale-[0.98]',
                hasSelfRsvp
                  ? 'border-white/70 bg-gradient-to-b from-brand-100/95 to-brand-50/90 text-brand-700 shadow-[0_14px_30px_rgba(20,184,166,0.18)]'
                  : rsvpButtonDisabled
                    ? 'cursor-not-allowed border-white/70 bg-gradient-to-b from-slate-100/95 to-slate-50/90 text-slate-400 shadow-sm'
                    : 'border-white/45 bg-gradient-to-b from-brand-500 via-brand-600 to-cyan-600 text-white shadow-[0_18px_36px_rgba(13,148,136,0.3)] hover:from-brand-400 hover:via-brand-500 hover:to-cyan-500',
              ].join(' ')}
            >
              <ThumbsUp className="h-4.5 w-4.5" />
              <span className="text-[10px] font-bold leading-tight sm:text-[11px]">{rsvpButtonLabel}</span>
            </button>

            <button
              type="button"
              onClick={() => handleToggleThinking()}
              disabled={thinkingButtonDisabled}
              aria-pressed={thinkingButtonActive}
              aria-label={thinkingButtonActive ? "Remove I'm thinking about it" : "I'm thinking about it"}
              className={[
                'flex min-h-[3.45rem] w-full flex-col items-center justify-center gap-0.5 rounded-[1.15rem] border px-2 py-1.5 text-center backdrop-blur-md transition-all active:scale-[0.98]',
                thinkingButtonDisabled
                  ? 'cursor-not-allowed border-white/70 bg-gradient-to-b from-slate-100/95 to-slate-50/90 text-slate-400 shadow-sm'
                  : thinkingButtonActive
                    ? 'border-white/70 bg-gradient-to-b from-brand-100/95 to-cyan-50/90 text-brand-600 shadow-[0_14px_30px_rgba(20,184,166,0.18)]'
                    : 'border-white/70 bg-gradient-to-b from-white/95 to-brand-50/80 text-brand-600 shadow-[0_14px_30px_rgba(20,184,166,0.12)] hover:from-brand-50/95 hover:to-cyan-50/90',
              ].join(' ')}
            >
              <CircleHelp className="h-4.5 w-4.5" />
              <span className="text-[10px] font-bold leading-tight sm:text-[11px]">Thinking about it</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setProxyError(null);
                setShowProxyModal(true);
              }}
              className="flex min-h-[3.45rem] w-full flex-col items-center justify-center gap-0.5 rounded-[1.15rem] border border-white/45 bg-gradient-to-b from-brand-500 via-brand-600 to-cyan-600 px-2 py-1.5 text-center text-white backdrop-blur-md shadow-[0_18px_36px_rgba(13,148,136,0.3)] transition-all hover:from-brand-400 hover:via-brand-500 hover:to-cyan-500 active:scale-[0.98]"
            >
              <Plus className="h-4.5 w-4.5" />
              <span className="text-[10px] font-bold leading-tight sm:text-[11px]">My Kids in</span>
            </button>
          </div>
        </div>
      </div>

      {/* RSVP Modal */}
      <AnimatePresence>
        {showRsvpModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
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
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">
                    {guestProfile ? `Joining as ${guestProfile.first_name}` : 'Almost there!'}
                  </h2>
                  <p className="text-slate-500 font-medium text-sm">
                    {guestProfile
                      ? "We've remembered you on this device."
                      : isGuestEmailRequired
                        ? "This host asks people signing up to add an email address to help stop spam and confirm you're a real person. Your email is only used for account recovery."
                        : "Just add your name and you're in."}
                  </p>
                </div>
                <button onClick={() => setShowRsvpModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              
              <form onSubmit={handleRsvp} className="space-y-5">
                {!guestProfile && (!user || !pickFirstNonEmpty(user.user_metadata?.full_name, guestInfo.name, fallbackNameFromEmail(user.email))) ? (
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
                    {!user && isGuestEmailRequired && (
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
                      <p className="font-black text-slate-900">{confirmedDetailsName}</p>
                      {confirmedDetailsEmail && <p className="text-xs text-slate-500">{confirmedDetailsEmail}</p>}
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
                  disabled={rsvpLoading || joinRequestPending}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-brand-600/10 mt-2 transition-all active:scale-95"
                >
                  {rsvpLoading
                    ? 'Joining...'
                    : joinRequestPending
                      ? 'Request pending'
                      : approvalRequired
                        ? 'Request to join'
                        : "I'm in"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showThinkingModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowThinkingModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-slate-900">Thinking about it</h2>
                <button onClick={() => setShowThinkingModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              {eventVisibility === 'public' ? (
                <p className="text-sm text-slate-500">This public activity shows count only.</p>
              ) : namedThinkingInterests.length === 0 ? (
                <p className="text-sm text-slate-500">No one yet.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                  {namedThinkingInterests.map((interest) => (
                    <div key={interest.id} className="py-2.5">
                      <p className="text-sm font-bold text-slate-800">{getDisplayName(interest)}</p>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {showSuccessModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
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
              className="relative w-full max-w-sm bg-white rounded-[2.5rem] p-10 shadow-2xl text-center overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
            >
              <div className="w-20 h-20 bg-brand-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10 text-brand-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">
                {successType === 'proxy'
                  ? (proxyPendingApproval ? 'Request sent!' : "They're in!")
                  : (selfPendingApproval ? 'Request sent!' : "You're in!")}
              </h2>
              <p className="text-slate-500 font-medium mb-8 text-sm leading-relaxed">
                {successType === 'proxy'
                  ? (proxyPendingApproval
                    ? 'They now appear in the list as pending host approval.'
                    : "We've added them to the list. You can manage this activity in your bookings.")
                  : (selfPendingApproval
                    ? 'Your request has been sent to the host for approval.'
                    : "You're on the list. You can manage all your activities in one place.")}
              </p>

              {shouldPromptEmailUpgrade && (
                <form onSubmit={handleSaveEmailUpgrade} className="mb-6 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-left space-y-3">
                  <p className="text-sm font-bold text-brand-700">Save this guest account with WhatsApp or email</p>
                  <p className="text-xs text-brand-700/90">
                    Link WhatsApp for the easiest sign-in next time, or add an email if you prefer recovery links.
                    Either option helps keep this guest account tied back to you.
                  </p>
                  <button
                    type="button"
                    onClick={handleStartGuestWhatsappUpgrade}
                    className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-3 rounded-xl transition-all active:scale-95"
                  >
                    Continue with WhatsApp
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-brand-200/70" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-brand-600/80">or</span>
                    <div className="h-px flex-1 bg-brand-200/70" />
                  </div>
                  <input
                    type="email"
                    value={emailUpgradeValue}
                    onChange={(e) => setEmailUpgradeValue(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full p-3 rounded-xl bg-white border border-brand-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all text-sm font-bold"
                  />
                  {emailUpgradeMessage && <p className="text-xs text-brand-700">{emailUpgradeMessage}</p>}
                  <button
                    type="submit"
                    disabled={emailUpgradeSaving}
                    className="w-full bg-white hover:bg-brand-100 text-brand-700 font-black py-3 rounded-xl transition-all active:scale-95"
                  >
                    {emailUpgradeSaving ? 'Saving...' : 'Save my email instead'}
                  </button>
                </form>
              )}

              <div className="space-y-3">
                <button
                  onClick={() => {
                    setShowSuccessModal(false);
                    setProxyError(null);
                    setProxyName('');
                    setShowProxyModal(true);
                  }}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                >
                  Add Another Person
                </button>
                <button
                  onClick={() => navigate('/bookings')}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-brand-600 font-black py-4 rounded-2xl transition-all active:scale-95"
                >
                  Manage My Activities
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
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
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl text-center overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
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

      {/* Share Choice Modal */}
      <AnimatePresence>
        {showShareChoiceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShareChoiceModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Share Link</h2>
                <button onClick={() => setShowShareChoiceModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              <p className="text-sm text-slate-500 font-medium mb-5">
                Choose whether to share the public preview or private access link.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setShowShareChoiceModal(false);
                    shareInvite(publicEventUrl);
                  }}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                >
                  Share Public Link
                </button>
                <button
                  onClick={() => {
                    setShowShareChoiceModal(false);
                    shareInvite(privateEventUrl);
                  }}
                  className="w-full bg-slate-50 hover:bg-slate-100 text-slate-700 font-black py-4 rounded-2xl transition-all active:scale-95"
                >
                  Share Private Link
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manual Share Modal */}
      <AnimatePresence>
        {showManualShareModal && (
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
                This browser is not exposing the native share sheet, so choose how you want to share it.
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
                    window.location.href = `mailto:?subject=${encodeURIComponent(event.title)}&body=${encodeURIComponent(buildInviteText(manualShareUrl))}`;
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
        )}
      </AnimatePresence>

      {/* Proxy RSVP Modal */}
      <AnimatePresence>
        {showProxyModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
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
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
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
                {!user && !guestProfile && (
                  <>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Your Name</label>
                      <input
                        required
                        type="text"
                        className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                        placeholder="e.g. Sarah Jones"
                        value={proxyOwnerName}
                        onChange={e => setProxyOwnerName(e.target.value)}
                      />
                    </div>
                    {isGuestEmailRequired && (
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Your Email</label>
                        <input
                          required
                          type="email"
                          className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold"
                          placeholder="you@example.com"
                          value={proxyOwnerEmail}
                          onChange={e => setProxyOwnerEmail(e.target.value)}
                        />
                      </div>
                    )}
                  </>
                )}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Their Name</label>
                  <input
                    required
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

    </div>
  );
}
