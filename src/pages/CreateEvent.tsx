import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle, Mail } from 'lucide-react';
import { LaloVerifyPanel } from '../generated/lalo-verify/react';
import { motion, AnimatePresence } from 'motion/react';
import {
  buildDurationOptions,
  DEFAULT_EVENT_TIMEZONE,
  deriveDurationMinutes,
  EVENT_TIMEZONE_OPTIONS,
  toUtcIsoFromStartAndDuration,
  utcIsoToEventLocalInput,
} from '../utils';
import { pickWaitlistAttendeesForPromotion } from '../lib/rsvp';
import { buildAuthRedirectUrl } from '../lib/authRedirect';
import { invokeAuthedFunction, invokePublicFunction } from '../lib/functions';
import { goBackOr } from '../lib/navigation';
import { applyGoogleMapsAutofill, isGoogleMapsShortUrl, parseGoogleMapsLocation } from '../lib/googleMaps';
import { shouldModerateVisibility } from '../lib/moderation';
import { LOCKED_PUBLIC_LOCATION, LOCKED_PUBLIC_LOCATION_OPTIONS, normalizePublicLocationText } from '../lib/publicLocation';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { EventGalleryEditor, QueuedGalleryUpload } from '../components/EventGalleryEditor';
import {
  EVENT_GALLERY_BUCKET,
  EVENT_GALLERY_MAX_IMAGE_COUNT,
  buildEventGalleryStoragePath,
  createClientSideId,
  sanitizeEventGalleryFile,
  validateEventGalleryFile,
} from '../lib/eventGallery';
import { guestService, getAccountNameFromUser, isSystemGuestEmail, resolvePreferredAccountName } from '../services/guestService';
import { EventCustomJoinFieldConfig, EventGalleryImage, EventGalleryVisibility } from '../types';
import {
  buildCustomJoinFieldConfigForSave,
  normalizeCustomJoinFieldConfig,
  parseSelectOptionsFromText,
} from '../lib/customJoinField';
import { Button } from '../components/ui/Button';
import { StateScreen } from '../components/ui/StateScreen';
import {
  getStoredLaloAuthAttempt,
  isLaloWhatsAppAuthEnabled,
} from '../integrations/lalo/laloAuth';
import { completeWhatsAppAuth } from '../integrations/lalo/completeWhatsAppAuth';
import { createImInLaloVerifyClient } from '../integrations/lalo/laloVerifyImInClient';
import { useSupabaseSession } from '../hooks/useSupabaseSession';

const CREATE_EVENT_DRAFT_KEY = 'im_in_create_event_draft';
const CREATE_EVENT_PENDING_AUTH_KEY = 'im_in_create_event_pending_auth';
const CREATE_EVENT_SUCCESS_KEY = 'im_in_recently_created_event_id';
const CREATE_EVENT_AUTO_SUBMIT_AFTER_WHATSAPP_KEY = 'im_in_create_event_auto_submit_after_whatsapp';
const DETECTED_EVENT_TIMEZONE = (() => {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return EVENT_TIMEZONE_OPTIONS.some((option) => option.value === browserTimezone)
    ? browserTimezone
    : DEFAULT_EVENT_TIMEZONE;
})();
const VISIBILITY_OPTIONS = [
  {
    value: 'public' as const,
    label: 'Public',
    description: 'Anyone can find it on the public activities page and see the exact time, location and whos attending.',
  },
  {
    value: 'semi_public' as const,
    label: 'Semi-public',
    description: 'People can discover it, but the full details are only shared after you have approved their request to view.',
    recommended: true,
  },
  {
    value: 'private' as const,
    label: 'Private',
    description: 'Only people with your private link can access it.',
  },
];

type CreateEventDraft = {
  formData: {
    title: string;
    public_summary: string;
    description: string;
    public_location_text: string;
    location_text: string;
    google_maps_url: string;
    starts_at: string;
    timezone: string;
    duration_minutes: number;
    capacity: number;
    host_name: string;
    host_contact_text: string;
    show_host_publicly: boolean;
    visibility: 'public' | 'semi_public' | 'private';
    gallery_visibility: EventGalleryVisibility;
    participation_mode: 'rsvp' | 'interest_only';
    interest_visibility: 'count_only' | 'named' | 'hidden';
    allow_waitlist: boolean;
    require_host_approval_for_join: boolean;
    require_guest_email_for_join: boolean;
    custom_join_field_config: EventCustomJoinFieldConfig | null;
    is_public: boolean;
  };
  authEmail: string;
  needsProfileDetails: boolean;
  pendingAuth: boolean;
  /** True when the user just signed up via Lalo WhatsApp — only collect display name, not WhatsApp again. */
  laloNewUser?: boolean;
  /** Restore wizard step after auth (email magic link return or post–WhatsApp navigation). */
  resumeAfterAuthStep?: 1 | 2 | 3 | 4;
};

type SaveProgressState = {
  percent: number;
  message: string;
};

type EventGalleryManageResponse = {
  galleryVisibility: EventGalleryVisibility;
  images: EventGalleryImage[];
};

async function resolveHostDisplayNameAfterWhatsAppSignIn(sessionUser: User): Promise<string> {
  let profile: Awaited<ReturnType<typeof guestService.getOrCreateProfileForUser>> | null = null;
  try {
    profile = await guestService.getOrCreateProfileForUser(sessionUser);
  } catch {
    profile = null;
  }
  return resolvePreferredAccountName(profile, sessionUser);
}

export default function CreateEvent({ user: userFromApp }: { user: User | null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  /**
   * After auth handoffs, this page can render before App has pushed the latest `user` prop.
   * Keep a local mirror of the shared Supabase session bootstrap so the final submit step matches reality.
   */
  const { user: bootstrappedSessionUser } = useSupabaseSession();
  const [sessionMirrorUser, setSessionMirrorUser] = useState<User | null>(null);
  const user = userFromApp ?? bootstrappedSessionUser ?? sessionMirrorUser;

  const userFromAppRef = useRef<User | null>(userFromApp);
  const sessionMirrorUserRef = useRef<User | null>(sessionMirrorUser);
  userFromAppRef.current = userFromApp;
  sessionMirrorUserRef.current = sessionMirrorUser;

  useEffect(() => {
    if (!bootstrappedSessionUser) {
      setSessionMirrorUser(null);
    }
  }, [bootstrappedSessionUser]);

  const hasHydratedDraft = useRef(false);
  const currentStepRef = useRef<1 | 2 | 3 | 4>(1);
  const finalStepEnteredAtRef = useRef(0);
  /** Prevents overlapping finalize if Lalo fires completion more than once. */
  const createEventWhatsAppOnCompleteInFlightRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEditing);
  const [formData, setFormData] = useState({
    title: '',
    public_summary: '',
    description: '',
    public_location_text: LOCKED_PUBLIC_LOCATION,
    location_text: '',
    google_maps_url: '',
    starts_at: '',
    timezone: DETECTED_EVENT_TIMEZONE,
    duration_minutes: 60,
    capacity: 10,
    host_name: '',
    host_contact_text: '',
    show_host_publicly: true,
    visibility: 'semi_public' as 'public' | 'semi_public' | 'private',
    gallery_visibility: 'private_only' as EventGalleryVisibility,
    participation_mode: 'rsvp' as 'rsvp' | 'interest_only',
    interest_visibility: 'count_only' as 'count_only' | 'named' | 'hidden',
    allow_waitlist: true,
    require_host_approval_for_join: false,
    require_guest_email_for_join: false,
    custom_join_field_config: null as EventCustomJoinFieldConfig | null,
    is_public: true,
  });

  const [error, setError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileWhatsapp, setProfileWhatsapp] = useState('');
  const [needsProfileDetails, setNeedsProfileDetails] = useState(false);
  const [accountHostName, setAccountHostName] = useState('');
  const [accountHasLinkedWhatsapp, setAccountHasLinkedWhatsapp] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(isEditing ? 2 : 1);
  const [visibilitySelected, setVisibilitySelected] = useState(isEditing);
  const [showTimezoneField, setShowTimezoneField] = useState(isEditing);
  const [mapsAutofillLoading, setMapsAutofillLoading] = useState(false);
  const [mapsAutofillMessage, setMapsAutofillMessage] = useState<string | null>(null);
  const [mapsAutofillError, setMapsAutofillError] = useState<string | null>(null);
  const [createEventAuthStep, setCreateEventAuthStep] = useState<'choose' | 'email'>('choose');
  const [profileModalShowWhatsappField, setProfileModalShowWhatsappField] = useState(true);
  const [galleryImages, setGalleryImages] = useState<EventGalleryImage[]>([]);
  const [removedGalleryImages, setRemovedGalleryImages] = useState<EventGalleryImage[]>([]);
  const [queuedGalleryUploads, setQueuedGalleryUploads] = useState<QueuedGalleryUpload[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(isEditing);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [loadedEventVisibility, setLoadedEventVisibility] = useState<'public' | 'semi_public' | 'private' | null>(null);
  const [loadedGalleryVisibility, setLoadedGalleryVisibility] = useState<EventGalleryVisibility>('private_only');
  const [saveProgress, setSaveProgress] = useState<SaveProgressState | null>(null);
  const [customJoinFieldOptionsDraft, setCustomJoinFieldOptionsDraft] = useState('');
  const formDataRef = useRef(formData);
  const queuedGalleryUploadsRef = useRef<QueuedGalleryUpload[]>([]);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  useEffect(() => {
    queuedGalleryUploadsRef.current = queuedGalleryUploads;
  }, [queuedGalleryUploads]);

  useEffect(() => () => {
    queuedGalleryUploadsRef.current.forEach((upload) => {
      URL.revokeObjectURL(upload.previewUrl);
    });
  }, []);

  useEffect(() => {
    if (formData.visibility !== 'private') return;
    if (formData.gallery_visibility === 'private_only') return;
    setFormData((prev) => ({ ...prev, gallery_visibility: 'private_only' }));
  }, [formData.visibility, formData.gallery_visibility]);

  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  const laloAuthEnabled = isLaloWhatsAppAuthEnabled();

  const createEventVerifyClient = useMemo(
    () =>
      createImInLaloVerifyClient({
        redirectTo: '/create-event',
        imInMode: 'sign_in',
        beforeStart: () => {
          const draftToPersist: CreateEventDraft = {
            formData: { ...formDataRef.current },
            authEmail: '',
            // Completion handler rewrites after verify. Do not set CREATE_EVENT_PENDING_AUTH_KEY here:
            // when the session appears, the pending-auth effect can run before the handler finishes updating
            // the draft and wrongly opens "One Last Step".
            needsProfileDetails: true,
            pendingAuth: true,
            laloNewUser: false,
            resumeAfterAuthStep: currentStepRef.current,
          };
          localStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify(draftToPersist));
        },
      }),
    [],
  );

  const handleWhatsAppAuthCompletedForCreate = useCallback(async () => {
    if (createEventWhatsAppOnCompleteInFlightRef.current) return;
    createEventWhatsAppOnCompleteInFlightRef.current = true;
    try {
      const attempt = getStoredLaloAuthAttempt();
      if (!attempt) {
        setError('Verification finished but the session was lost. Try again.');
        return;
      }
      const result = await completeWhatsAppAuth(attempt, { suppressNameCaptureRedirect: true });
      await supabase.auth.refreshSession().catch(() => null);

      /** Mobile WebViews sometimes persist the session a tick after signInWithPassword; avoid a false "still logged out" pass. */
      let sessionUser = (await supabase.auth.getUser()).data.user;
      for (let i = 0; i < 8 && !sessionUser; i++) {
        await new Promise((r) => setTimeout(r, 120));
        await supabase.auth.refreshSession().catch(() => null);
        sessionUser = (await supabase.auth.getUser()).data.user;
      }
      setSessionMirrorUser(sessionUser ?? null);

      if (!sessionUser) {
        setError(
          'WhatsApp verified, but this tab did not receive your sign-in session yet. Tap Continue with WhatsApp once more, or use email sign-in.',
        );
        return;
      }

      const laloNewUser = !!result.isNewUser;
      let needProfileDetails = true;
      let resolvedAccountName = '';

      if (sessionUser) {
        resolvedAccountName = await resolveHostDisplayNameAfterWhatsAppSignIn(sessionUser);
        needProfileDetails = !resolvedAccountName.trim();
      }

      const draftRaw = localStorage.getItem(CREATE_EVENT_DRAFT_KEY);
      if (draftRaw) {
        try {
          const draft = JSON.parse(draftRaw) as CreateEventDraft;
          draft.needsProfileDetails = needProfileDetails;
          draft.laloNewUser = laloNewUser;
          draft.resumeAfterAuthStep = 4;
          if (resolvedAccountName) {
            draft.formData = {
              ...draft.formData,
              host_name: resolvedAccountName,
            };
          }
          localStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify(draft));
        } catch {
          /* keep going */
        }
      }

      if (!needProfileDetails) {
        sessionStorage.setItem(CREATE_EVENT_AUTO_SUBMIT_AFTER_WHATSAPP_KEY, '1');
      } else {
        sessionStorage.removeItem(CREATE_EVENT_AUTO_SUBMIT_AFTER_WHATSAPP_KEY);
      }

      finalStepEnteredAtRef.current = Date.now();
      setCurrentStep(4);
      setNeedsProfileDetails(needProfileDetails);
      if (resolvedAccountName) {
        setAccountHostName(resolvedAccountName);
        setFormData((prev) => ({ ...prev, host_name: resolvedAccountName }));
        setProfileName(resolvedAccountName);
      }
      setProfileModalShowWhatsappField(!laloNewUser);

      if (needProfileDetails) {
        let nameSeed = (resolvedAccountName || '').trim();
        if (!nameSeed && draftRaw) {
          try {
            const d = JSON.parse(draftRaw) as CreateEventDraft;
            nameSeed = (d.formData?.host_name || '').trim();
          } catch {
            /* noop */
          }
        }
        setProfileName(nameSeed);
        setShowProfileModal(true);
        setAuthMessage(
          laloNewUser
            ? 'Add how we should show your name as host (you already verified WhatsApp).'
            : 'Almost there — add how we should show your name as host.',
        );
      } else {
        setShowProfileModal(false);
        setAuthMessage('Signed in. Finishing your activity…');
      }

      setShowEmailModal(false);
      setCreateEventAuthStep('choose');
      navigate('/create-event', { replace: true });
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : 'Could not finish signing in.');
    } finally {
      createEventWhatsAppOnCompleteInFlightRef.current = false;
    }
  }, [navigate]);

  useEffect(() => {
    if (!showEmailModal) return;
    if (!laloAuthEnabled) {
      setCreateEventAuthStep('email');
    } else {
      setCreateEventAuthStep('choose');
    }
  }, [showEmailModal, laloAuthEnabled]);

  useBodyScrollLock(showEmailModal || showProfileModal);

  const pickHostNameFromProfile = (profile: any) => {
    const first = (profile?.first_name || '').trim();
    const last = (profile?.last_name || '').trim();
    const composed = `${first} ${last}`.trim();
    if (composed) return composed;
    return (profile?.full_name || '').trim();
  };

  const pickFirstNonEmpty = (...values: Array<string | null | undefined>) => {
    for (const value of values) {
      const trimmed = (value || '').trim();
      if (trimmed) return trimmed;
    }
    return '';
  };

  const getEmailLocalPart = (email?: string | null) =>
    ((email || '').split('@')[0] || '').trim().toLowerCase();

  const normalizeLooseName = (value?: string | null) =>
    (value || '')
      .trim()
      .toLowerCase()
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ');

  const isNameLikelyFromEmailHandle = (name?: string | null, email?: string | null) => {
    const normalizedName = normalizeLooseName(name);
    const localPart = normalizeLooseName(getEmailLocalPart(email));
    if (!normalizedName || !localPart) return false;
    return normalizedName === localPart;
  };

  const isTrustedHumanName = (name?: string | null, email?: string | null) => {
    const normalizedName = normalizeLooseName(name);
    if (!normalizedName) return false;
    return !isNameLikelyFromEmailHandle(normalizedName, email);
  };

  /** Synthetic auth emails (Lalo / guest) must not disqualify a real display name as "just the email handle". */
  const isTrustedHostDisplayName = (name?: string | null, email?: string | null) => {
    if (!(name || '').trim()) return false;
    if (isSystemGuestEmail(email)) return true;
    return isTrustedHumanName(name, email);
  };

  const runModerationForEvent = async (
    eventId: string,
    visibility: 'public' | 'semi_public' | 'private',
  ): Promise<{ ok: boolean; message?: string }> => {
    if (!shouldModerateVisibility(visibility)) return { ok: true };

    const invokeModeration = async () =>
      invokeAuthedFunction('moderate-activity', {
        eventId,
        telemetry_source: isEditing ? 'create_event_edit_auto' : 'create_event_new_auto',
      });
    try {
      await invokeModeration();
      return { ok: true };
    } catch (firstError) {
      console.error('Activity moderation failed on first attempt:', firstError);
      // Small retry handles transient network/session timing right after save.
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      try {
        await invokeModeration();
        return { ok: true };
      } catch (retryError) {
        console.error('Activity moderation failed after retry:', retryError);
        const details =
          retryError instanceof Error && retryError.message
            ? retryError.message
            : 'Automatic moderation did not run.';
        return {
          ok: false,
          message: `Activity saved, but automatic moderation did not run yet (${details}).`,
        };
      }
    }
  };

  useEffect(() => {
    if (isEditing && user) {
      fetchEvent();
    }
  }, [id, user?.id]);

  useEffect(() => {
    if (isEditing || hasHydratedDraft.current) return;
    hasHydratedDraft.current = true;

    const draftRaw = localStorage.getItem(CREATE_EVENT_DRAFT_KEY);
    if (!draftRaw) return;

    try {
      const draft = JSON.parse(draftRaw) as CreateEventDraft;
      if (draft?.formData) {
        setFormData((prev) => ({
          ...prev,
          ...draft.formData,
          public_location_text: normalizePublicLocationText(draft.formData.public_location_text),
          timezone: draft.formData.timezone || prev.timezone,
          duration_minutes: draft.formData.duration_minutes || prev.duration_minutes,
        }));
        setVisibilitySelected(true);
        const resumeAuthStep = localStorage.getItem(CREATE_EVENT_PENDING_AUTH_KEY) === 'true';
        const resumeFromDraft =
          draft.resumeAfterAuthStep === 1
          || draft.resumeAfterAuthStep === 2
          || draft.resumeAfterAuthStep === 3
          || draft.resumeAfterAuthStep === 4
            ? draft.resumeAfterAuthStep
            : null;
        const nextStep = resumeFromDraft ?? (resumeAuthStep ? 4 : 2);
        if (nextStep === 4) {
          finalStepEnteredAtRef.current = Date.now();
        }
        setCurrentStep(nextStep);
        setShowTimezoneField(
          !!draft.formData.timezone && draft.formData.timezone !== DETECTED_EVENT_TIMEZONE,
        );
      }
      setAuthEmail(draft.authEmail || '');
      setNeedsProfileDetails(!!draft.needsProfileDetails);
      setProfileName(draft.formData?.host_name || '');
      setProfileWhatsapp(draft.formData?.host_contact_text || '');
    } catch {
      localStorage.removeItem(CREATE_EVENT_DRAFT_KEY);
      localStorage.removeItem(CREATE_EVENT_PENDING_AUTH_KEY);
    }
  }, [isEditing]);

  useEffect(() => {
    if (isEditing || !user) return;
    if (localStorage.getItem(CREATE_EVENT_PENDING_AUTH_KEY) !== 'true') return;

    let cancelled = false;

    void (async () => {
      const resolvedName = (await resolveHostDisplayNameAfterWhatsAppSignIn(user)).trim();

      let draftSaysNeed = true;
      let laloNewUser = false;
      const draftRaw = localStorage.getItem(CREATE_EVENT_DRAFT_KEY);
      if (draftRaw) {
        try {
          const draft = JSON.parse(draftRaw) as CreateEventDraft;
          draftSaysNeed = !!draft.needsProfileDetails;
          laloNewUser = !!draft.laloNewUser;
        } catch {
          draftSaysNeed = true;
        }
      }

      const shouldCollectProfileDetails = draftSaysNeed && !resolvedName;

      if (cancelled) return;

      if (resolvedName) {
        try {
          if (draftRaw) {
            const draft = JSON.parse(draftRaw) as CreateEventDraft;
            draft.needsProfileDetails = false;
            draft.formData = {
              ...draft.formData,
              host_name: (draft.formData?.host_name || '').trim() || resolvedName,
            };
            localStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify(draft));
          }
        } catch {
          /* noop */
        }
        setAccountHostName(resolvedName);
        setFormData((prev) => ({
          ...prev,
          host_name: prev.host_name.trim() ? prev.host_name : resolvedName,
        }));
        setProfileName((prev) => prev.trim() || resolvedName);
      }

      if (cancelled) return;

      finalStepEnteredAtRef.current = Date.now();
      setCurrentStep(4);
      setNeedsProfileDetails(shouldCollectProfileDetails);
      if (shouldCollectProfileDetails) {
        let nameSeed = '';
        if (draftRaw) {
          try {
            const draft = JSON.parse(draftRaw) as CreateEventDraft;
            nameSeed = (draft.formData?.host_name || '').trim();
          } catch {
            /* noop */
          }
        }
        setProfileName(nameSeed);
        setProfileModalShowWhatsappField(!laloNewUser);
        setShowProfileModal(true);
        setAuthMessage(
          laloNewUser
            ? 'Add how we should show your name as host (you already verified WhatsApp).'
            : 'Welcome! Add your name to finish creating your activity.',
        );
      } else {
        setShowProfileModal(false);
        setAuthMessage('You are signed in. Review your details and click Create Activity.');
      }
      localStorage.removeItem(CREATE_EVENT_PENDING_AUTH_KEY);
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditing, user]);

  /** If draft / sync state still say "need profile" but the merged profile already has a host name, close the modal. */
  useEffect(() => {
    if (isEditing || !user || !needsProfileDetails) return;
    let cancelled = false;
    void (async () => {
      const resolved = (await resolveHostDisplayNameAfterWhatsAppSignIn(user)).trim();
      if (cancelled || !resolved) return;
      setNeedsProfileDetails(false);
      setShowProfileModal(false);
      setAccountHostName(resolved);
      setFormData((prev) => ({
        ...prev,
        host_name: prev.host_name.trim() ? prev.host_name : resolved,
      }));
      setProfileName((prev) => prev.trim() || resolved);
      const raw = localStorage.getItem(CREATE_EVENT_DRAFT_KEY);
      if (raw) {
        try {
          const draft = JSON.parse(raw) as CreateEventDraft;
          draft.needsProfileDetails = false;
          draft.formData = {
            ...draft.formData,
            host_name: (draft.formData?.host_name || '').trim() || resolved,
          };
          localStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify(draft));
        } catch {
          /* noop */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, user, needsProfileDetails]);

  useEffect(() => {
    if (!user) {
      setAccountHostName('');
      setAccountHasLinkedWhatsapp(false);
      return;
    }
    let cancelled = false;

    const hydrateDefaultHostDetails = async () => {
      const profile = await guestService.getProfileForUser(user).catch(() => null);
      const resolvedName = resolvePreferredAccountName(profile, user).trim();
      const resolvedWhatsapp = (profile?.whatsapp_number || '').trim();
      const hasLinkedWhatsapp = !!(
        resolvedWhatsapp
        || profile?.lalo_user_id
        || profile?.whatsapp_verified_at
        || profile?.auth_provider === 'lalo_whatsapp'
      );

      if (cancelled) return;

      setAccountHasLinkedWhatsapp(hasLinkedWhatsapp);
      if (resolvedName) {
        setAccountHostName(resolvedName);
      }
      if (resolvedWhatsapp) {
        setProfileWhatsapp((prev) => prev.trim() || resolvedWhatsapp);
        setFormData((prev) => (
          prev.host_contact_text.trim() ? prev : { ...prev, host_contact_text: resolvedWhatsapp }
        ));
      }
    };

    void hydrateDefaultHostDetails();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !accountHostName) return;
    setFormData((prev) => (prev.host_name === accountHostName ? prev : { ...prev, host_name: accountHostName }));
    if (!needsProfileDetails) {
      setProfileName((prev) => prev || accountHostName);
    }
  }, [user, accountHostName, needsProfileDetails]);

  useEffect(() => {
    if (!user || !accountHostName.trim() || !needsProfileDetails) return;
    setNeedsProfileDetails(false);
    setShowProfileModal(false);
    setProfileName((prev) => prev.trim() || accountHostName);
  }, [user, accountHostName, needsProfileDetails]);

  const fetchEvent = async () => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !user) {
      console.error(error);
      navigate('/');
      return;
    }

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
      const preferredHostName =
        pickFirstNonEmpty(
          isTrustedHumanName(getAccountNameFromUser(user), user.email) ? getAccountNameFromUser(user) : '',
          isTrustedHumanName(pickHostNameFromProfile(profile), user.email) ? pickHostNameFromProfile(profile) : '',
          isTrustedHumanName((data.host_name || '').trim(), user.email) ? (data.host_name || '').trim() : '',
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

    {
      const timezone = normalizedEvent.timezone || DEFAULT_EVENT_TIMEZONE;
      const durationMinutes = normalizedEvent.duration_minutes || deriveDurationMinutes(normalizedEvent.starts_at, normalizedEvent.ends_at);

      setFormData({
        title: normalizedEvent.title || '',
        public_summary: normalizedEvent.public_summary || '',
        description: normalizedEvent.description || '',
        public_location_text: normalizePublicLocationText(normalizedEvent.public_location_text),
        location_text: normalizedEvent.location_text || '',
        google_maps_url: normalizedEvent.google_maps_url || '',
        starts_at: utcIsoToEventLocalInput(normalizedEvent.starts_at, timezone),
        timezone,
        duration_minutes: durationMinutes,
        capacity: normalizedEvent.capacity ?? 10,
        host_name: normalizedEvent.host_name || '',
        host_contact_text: normalizedEvent.host_contact_text || '',
        show_host_publicly: normalizedEvent.show_host_publicly ?? false,
        visibility: normalizedEvent.visibility || (normalizedEvent.is_public ? 'public' : 'private'),
        gallery_visibility: normalizedEvent.gallery_visibility || 'private_only',
        participation_mode: (normalizedEvent.participation_mode as 'rsvp' | 'interest_only') || 'rsvp',
        interest_visibility: (normalizedEvent.interest_visibility as 'count_only' | 'named' | 'hidden') || 'count_only',
        allow_waitlist: normalizedEvent.allow_waitlist ?? true,
        require_host_approval_for_join: normalizedEvent.require_host_approval_for_join ?? false,
        require_guest_email_for_join: normalizedEvent.require_guest_email_for_join ?? false,
        custom_join_field_config: normalizeCustomJoinFieldConfig(normalizedEvent.custom_join_field_config),
        is_public: normalizedEvent.is_public ?? true,
      });
      setLoadedEventVisibility((normalizedEvent.visibility || (normalizedEvent.is_public ? 'public' : 'private')) as 'public' | 'semi_public' | 'private');
      setLoadedGalleryVisibility((normalizedEvent.gallery_visibility || 'private_only') as EventGalleryVisibility);
      setVisibilitySelected(true);
      setCurrentStep((prev) => (prev === 1 ? 2 : prev));
      setShowTimezoneField(timezone !== DETECTED_EVENT_TIMEZONE);
      setGalleryLoading(true);
      try {
        const galleryResponse = await invokeAuthedFunction<EventGalleryManageResponse>('event-gallery', {
          mode: 'manage',
          eventId: normalizedEvent.id,
        });
        setGalleryImages(galleryResponse.images || []);
        setRemovedGalleryImages([]);
        setGalleryError(null);
      } catch (galleryLoadError: any) {
        console.error('Error loading gallery:', galleryLoadError);
        setGalleryImages([]);
        setRemovedGalleryImages([]);
        setGalleryError(galleryLoadError?.message || 'Could not load the saved gallery images.');
      } finally {
        setGalleryLoading(false);
      }
      setInitialLoading(false);
    }
  };

  const handlePickGalleryFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const existingCount = galleryImages.length + queuedGalleryUploads.length;
    const nextFiles = Array.from(files);
    if (existingCount + nextFiles.length > EVENT_GALLERY_MAX_IMAGE_COUNT) {
      setGalleryError(`You can add up to ${EVENT_GALLERY_MAX_IMAGE_COUNT} images per activity.`);
      return;
    }

    const accepted: QueuedGalleryUpload[] = [];
    for (const file of nextFiles) {
      try {
        validateEventGalleryFile(file);
        accepted.push({
          id: createClientSideId(),
          file,
          previewUrl: URL.createObjectURL(file),
        });
      } catch (validationError: any) {
        setGalleryError(validationError?.message || 'One of those files could not be added.');
        accepted.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
        return;
      }
    }

    setQueuedGalleryUploads((prev) => [...prev, ...accepted]);
    setGalleryError(null);
  };

  const handleRemoveExistingGalleryImage = (imageId: string) => {
    setGalleryImages((prev) => {
      const imageToRemove = prev.find((image) => image.id === imageId);
      if (imageToRemove) {
        setRemovedGalleryImages((current) => [...current, imageToRemove]);
      }
      return prev.filter((image) => image.id !== imageId);
    });
  };

  const handleRemoveQueuedGalleryUpload = (uploadId: string) => {
    setQueuedGalleryUploads((prev) => {
      const next = prev.filter((upload) => {
        if (upload.id !== uploadId) return true;
        URL.revokeObjectURL(upload.previewUrl);
        return false;
      });
      return next;
    });
  };

  const syncEventGallery = useCallback(
    async ({
      eventId,
      resolvedVisibility,
    }: {
      eventId: string;
      resolvedVisibility: 'public' | 'semi_public' | 'private';
    }) => {
      const effectiveGalleryVisibility: EventGalleryVisibility =
        resolvedVisibility === 'private' ? 'private_only' : formData.gallery_visibility;
      const wasPublicPreview =
        !!loadedEventVisibility
        && loadedEventVisibility !== 'private'
        && loadedGalleryVisibility === 'public_preview';
      const isPublicPreview =
        resolvedVisibility !== 'private'
        && effectiveGalleryVisibility === 'public_preview';
      const shouldModerateGallery =
        (queuedGalleryUploads.length > 0 && isPublicPreview)
        || wasPublicPreview !== isPublicPreview;
      const totalSteps =
        (removedGalleryImages.length * 2)
        + (queuedGalleryUploads.length * 3)
        + (shouldModerateGallery ? 1 : 0);
      let completedSteps = 0;
      const advanceGalleryProgress = (message: string) => {
        if (totalSteps <= 0) return;
        completedSteps += 1;
        const percent = Math.min(92, Math.max(36, Math.round(36 + (completedSteps / totalSteps) * 56)));
        setSaveProgress({ percent, message });
      };

      for (const image of removedGalleryImages) {
        if (!image.id || !image.storage_path) continue;
        const bucket = image.storage_bucket || EVENT_GALLERY_BUCKET;
        advanceGalleryProgress(`Removing ${image.original_file_name || 'photo'}...`);
        const { error: removeStorageError } = await supabase.storage
          .from(bucket)
          .remove([image.storage_path]);
        if (removeStorageError) {
          throw removeStorageError;
        }
        advanceGalleryProgress(`Updating gallery after removing ${image.original_file_name || 'photo'}...`);
        const { error: deleteRowError } = await supabase
          .from('event_gallery_images')
          .delete()
          .eq('id', image.id);
        if (deleteRowError) {
          throw deleteRowError;
        }
      }

      let sortOrder = galleryImages.length;

      for (const upload of queuedGalleryUploads) {
        advanceGalleryProgress(`Preparing ${upload.file.name}...`);
        const prepared = await sanitizeEventGalleryFile(upload.file);
        const storagePath = buildEventGalleryStoragePath(eventId, prepared.extension);
        advanceGalleryProgress(`Uploading ${upload.file.name}...`);
        const { error: uploadError } = await supabase.storage
          .from(EVENT_GALLERY_BUCKET)
          .upload(storagePath, prepared.blob, {
            contentType: prepared.contentType,
            upsert: false,
          });
        if (uploadError) {
          throw uploadError;
        }

        advanceGalleryProgress(`Saving ${upload.file.name}...`);
        const { error: insertError } = await supabase
          .from('event_gallery_images')
          .insert({
            event_id: eventId,
            storage_bucket: EVENT_GALLERY_BUCKET,
            storage_path: storagePath,
            original_file_name: upload.file.name,
            content_type: prepared.contentType,
            file_size_bytes: prepared.blob.size,
            width: prepared.width,
            height: prepared.height,
            sort_order: sortOrder,
            created_by_user_id: user?.id,
            public_visibility_status: isPublicPreview ? 'pending' : 'private_only',
          });
        if (insertError) {
          throw insertError;
        }
        sortOrder += 1;
      }

      if (shouldModerateGallery) {
        advanceGalleryProgress('Checking gallery moderation...');
        await invokeAuthedFunction('moderate-event-gallery', { eventId });
      }

      queuedGalleryUploads.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
      setQueuedGalleryUploads([]);
      setRemovedGalleryImages([]);
      setLoadedEventVisibility(resolvedVisibility);
      setLoadedGalleryVisibility(effectiveGalleryVisibility);
    },
    [
      formData.gallery_visibility,
      galleryImages,
      loadedEventVisibility,
      loadedGalleryVisibility,
      removedGalleryImages,
      queuedGalleryUploads,
      user?.id,
    ],
  );

  const runCreateEventSave = useCallback(
    async (options?: { skipStep3TimingGuard?: boolean }) => {
      if (currentStep !== 4) return;
      if (!options?.skipStep3TimingGuard && Date.now() - finalStepEnteredAtRef.current < 450) return;
      if (!user) {
        createEventWhatsAppOnCompleteInFlightRef.current = false;
        setShowEmailModal(true);
        return;
      }
      if (!isEditing && needsProfileDetails && !formData.host_name.trim()) {
        setProfileModalShowWhatsappField(!(accountHasLinkedWhatsapp || formData.host_contact_text.trim() || profileWhatsapp.trim()));
        setShowProfileModal(true);
        return;
      }

      setLoading(true);
      setError(null);
      setSaveProgress({
        percent: 5,
        message: isEditing ? 'Saving activity details...' : 'Creating activity...',
      });

      try {
        let oldCapacity = 0;
        if (isEditing) {
          const { data: oldEvent } = await supabase
            .from('events')
            .select('capacity')
            .eq('id', id)
            .single();
          oldCapacity = oldEvent?.capacity || 0;
        }

        const metadataName = getAccountNameFromUser(user);
        const resolvedHostName = pickFirstNonEmpty(
          formData.host_name,
          accountHostName,
          metadataName,
        ).trim();
        const resolvedHostContact = formData.host_contact_text.trim();
        const resolvedVisibility = formData.visibility || 'semi_public';
        if (!resolvedHostName) {
          setProfileName('');
          setNeedsProfileDetails(true);
          setProfileModalShowWhatsappField(!(accountHasLinkedWhatsapp || formData.host_contact_text.trim() || profileWhatsapp.trim()));
          setShowProfileModal(true);
          throw new Error('Please add your name before creating this activity.');
        }
        await guestService.getOrCreateProfileForUser(user, resolvedHostName);
        if (!formData.starts_at) {
          throw new Error('Start time is required.');
        }

        const { startsAtUtcIso, endsAtUtcIso } = toUtcIsoFromStartAndDuration(
          formData.starts_at,
          formData.duration_minutes,
          formData.timezone || DEFAULT_EVENT_TIMEZONE,
        );

        const submissionData: any = {
          ...formData,
          starts_at: startsAtUtcIso,
          ends_at: endsAtUtcIso,
          host_name: resolvedHostName,
          visibility: resolvedVisibility,
          gallery_visibility: resolvedVisibility === 'private' ? 'private_only' : formData.gallery_visibility,
          is_public: resolvedVisibility !== 'private',
          show_host_publicly: resolvedVisibility !== 'private',
          description: formData.description.trim() || null,
          public_summary: formData.public_summary.trim() || null,
          location_text: formData.location_text.trim() || null,
          public_location_text: normalizePublicLocationText(formData.public_location_text),
          google_maps_url: formData.google_maps_url.trim() || null,
          timezone: formData.timezone || DEFAULT_EVENT_TIMEZONE,
          duration_minutes: formData.duration_minutes || 60,
          host_contact_text: resolvedHostContact || null,
          custom_join_field_config: buildCustomJoinFieldConfigForSave(formData.custom_join_field_config),
        };

        if (formData.participation_mode === 'interest_only') {
          submissionData.allow_waitlist = false;
          submissionData.require_host_approval_for_join = false;
          submissionData.require_guest_email_for_join = false;
          submissionData.custom_join_field_config = null;
        }

        if (resolvedVisibility === 'public') {
          submissionData.public_summary = submissionData.public_summary || submissionData.description;
        }

        if (!isEditing) {
          submissionData.host_user_id = user.id;
          submissionData.status = 'scheduled';
        }

        let result;
        if (isEditing) {
          result = await supabase
            .from('events')
            .update(submissionData)
            .eq('id', id)
            .select()
            .single();
        } else {
          result = await supabase
            .from('events')
            .insert([submissionData])
            .select()
            .single();
        }

        if (result.error) {
          throw result.error;
        }

        if (result.data) {
          let gallerySyncWarning: string | null = null;
          setSaveProgress({ percent: 18, message: 'Saving host access...' });
          await supabase
            .from('event_hosts')
            .upsert(
              [
                {
                  event_id: result.data.id,
                  user_id: user.id,
                  added_by_user_id: user.id,
                },
              ],
              { onConflict: 'event_id,user_id' },
            );

          try {
            setSaveProgress({
              percent: queuedGalleryUploads.length > 0 || removedGalleryImages.length > 0
                ? 28
                : 40,
              message:
                queuedGalleryUploads.length > 0 || removedGalleryImages.length > 0
                  ? 'Uploading photos...'
                  : 'Checking gallery settings...',
            });
            await syncEventGallery({
              eventId: result.data.id,
              resolvedVisibility,
            });
          } catch (gallerySyncError: any) {
            console.error('Error syncing gallery:', gallerySyncError);
            gallerySyncWarning = gallerySyncError?.message || 'Some gallery images could not be saved.';
          }

          if (!isEditing) {
            localStorage.removeItem(CREATE_EVENT_DRAFT_KEY);
            localStorage.removeItem(CREATE_EVENT_PENDING_AUTH_KEY);
            sessionStorage.removeItem(CREATE_EVENT_AUTO_SUBMIT_AFTER_WHATSAPP_KEY);
            setNeedsProfileDetails(false);
          }
          if (isEditing && formData.capacity > oldCapacity) {
            setSaveProgress({ percent: 94, message: 'Updating attendee access...' });
            const { data: waitlist } = await supabase
              .from('event_attendees')
              .select('*')
              .eq('event_id', id)
              .eq('status', 'waitlist')
              .order('joined_at', { ascending: true });

            if (waitlist && waitlist.length > 0) {
              const { data: confirmed } = await supabase
                .from('event_attendees')
                .select('id')
                .eq('event_id', id)
                .eq('status', 'confirmed');

              const currentConfirmedCount = confirmed?.length || 0;
              const spotsAvailable = formData.capacity - currentConfirmedCount;

              if (spotsAvailable > 0) {
                const toPromote = pickWaitlistAttendeesForPromotion(waitlist, spotsAvailable);
                for (const person of toPromote) {
                  await supabase
                    .from('event_attendees')
                    .update({ status: 'confirmed', promoted_at: new Date().toISOString() })
                    .eq('id', person.id);
                }
              }
            }
          }

          setSaveProgress({ percent: 97, message: 'Running final checks...' });
          const moderationRun = await runModerationForEvent(result.data.id, resolvedVisibility);

          if (gallerySyncWarning) {
            if (isEditing) {
              setError(`Activity details saved, but the gallery update failed: ${gallerySyncWarning}`);
              setLoading(false);
              setSaveProgress(null);
              return;
            }
            window.alert(`Activity created, but the gallery update failed: ${gallerySyncWarning}`);
          }

          if (!isEditing) {
            sessionStorage.setItem(CREATE_EVENT_SUCCESS_KEY, result.data.id);
          }

          setSaveProgress({ percent: 100, message: 'Done. Opening activity...' });
          navigate(`/host/events/${result.data.id}`, {
            state: {
              ...(isEditing ? {} : { justCreated: true }),
              ...(moderationRun.ok
                ? {}
                : {
                    moderationAutoRunFailed: true,
                    moderationAutoRunMessage: moderationRun.message,
                  }),
            },
          });
        }
      } catch (err: any) {
        console.error('Error saving activity:', err);
        setError(err.message || 'Failed to save activity. Please try again.');
        setLoading(false);
        setSaveProgress(null);
      }
    },
    [
      accountHostName,
      currentStep,
      formData,
      galleryImages.length,
      id,
      isEditing,
      navigate,
      needsProfileDetails,
      removedGalleryImages.length,
      queuedGalleryUploads.length,
      syncEventGallery,
      user,
    ],
  );

  useEffect(() => {
    if (isEditing) return;
    if (sessionStorage.getItem(CREATE_EVENT_AUTO_SUBMIT_AFTER_WHATSAPP_KEY) !== '1') return;
    if (!user || currentStep !== 4 || showProfileModal || showEmailModal || loading) return;
    if (needsProfileDetails && !formData.host_name.trim()) return;

    sessionStorage.removeItem(CREATE_EVENT_AUTO_SUBMIT_AFTER_WHATSAPP_KEY);
    void runCreateEventSave({ skipStep3TimingGuard: true });
  }, [
    currentStep,
    formData.host_name,
    isEditing,
    loading,
    needsProfileDetails,
    runCreateEventSave,
    showEmailModal,
    showProfileModal,
    user,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep !== 4) return;
    if (Date.now() - finalStepEnteredAtRef.current < 450) return;
    await runCreateEventSave({ skipStep3TimingGuard: true });
  };

  const finalSubmitLabel = loading
    ? `${saveProgress?.message || 'Saving...'} ${saveProgress?.percent ?? 0}%`
    : isEditing
      ? 'Save Changes'
      : 'Create Activity';

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setError(null);

    const normalizedEmail = authEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setError('Please add your email to continue.');
      setAuthLoading(false);
      return;
    }

    let shouldCollectProfileDetails = true;
    const { data: existingProfile } = await supabase
      .from('attendee_profiles')
      .select('id, first_name, last_name, full_name')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (existingProfile) {
      const profileName = pickFirstNonEmpty(
        `${existingProfile.first_name || ''} ${existingProfile.last_name || ''}`.trim(),
        existingProfile.full_name || '',
      );
      /** Any stored profile display name skips the modal — same rule as post–WhatsApp merge. */
      const hasProfileName = !!profileName.trim();
      shouldCollectProfileDetails = !hasProfileName;
    }

    const draftToPersist: CreateEventDraft = {
      formData: {
        ...formData,
        host_name: formData.host_name,
        host_contact_text: formData.host_contact_text,
      },
      authEmail: normalizedEmail,
      needsProfileDetails: shouldCollectProfileDetails,
      pendingAuth: true,
      resumeAfterAuthStep: 4,
    };
    localStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify(draftToPersist));
    localStorage.setItem(CREATE_EVENT_PENDING_AUTH_KEY, 'true');
    setNeedsProfileDetails(shouldCollectProfileDetails);

    const { error: loginError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: buildAuthRedirectUrl('/create-event'),
      },
    });

    if (loginError) {
      setError(loginError.message);
      setAuthLoading(false);
      return;
    }

    setShowEmailModal(false);
    setAuthMessage(`Magic link sent to ${normalizedEmail}. After signing in, return here and click Create Activity.`);
    setAuthLoading(false);
  };

  const handleProfileDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedName = profileName.trim();
    if (!normalizedName) {
      setError('Please add your name to continue.');
      return;
    }
    try {
      setError(null);
      if (user) {
        await guestService.getOrCreateProfileForUser(user, normalizedName);
      }
      setAccountHostName(normalizedName);
      setFormData(prev => ({
        ...prev,
        host_name: normalizedName,
        host_contact_text: profileWhatsapp.trim(),
      }));
      setNeedsProfileDetails(false);
      setShowProfileModal(false);
      setAuthMessage('Details saved. Click Create Activity to finish.');

      const persistedDraftRaw = localStorage.getItem(CREATE_EVENT_DRAFT_KEY);
      if (persistedDraftRaw) {
        try {
          const draft = JSON.parse(persistedDraftRaw) as CreateEventDraft;
          draft.needsProfileDetails = false;
          draft.laloNewUser = false;
          draft.formData = {
            ...draft.formData,
            host_name: normalizedName,
            host_contact_text: profileWhatsapp.trim(),
          };
          localStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify(draft));
        } catch {
          /* noop */
        }
      }
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : 'Could not save your profile details.');
    }
  };

  const selectedVisibilityOption = VISIBILITY_OPTIONS.find((option) => option.value === formData.visibility);

  const handleSelectVisibility = (visibility: 'public' | 'semi_public' | 'private') => {
    setFormData((prev) => ({
      ...prev,
      visibility,
      is_public: visibility !== 'private',
      show_host_publicly: visibility !== 'private',
    }));
    setVisibilitySelected(true);
    setCurrentStep(2);
  };

  const goToStep = (step: 1 | 2 | 3 | 4) => {
    if (step === 4) {
      finalStepEnteredAtRef.current = Date.now();
    }
    setCurrentStep(step);
  };

  const handleHeaderBack = () => {
    if (currentStep === 4) {
      goToStep(3);
      return;
    }
    if (currentStep === 3) {
      goToStep(2);
      return;
    }
    if (currentStep === 2) {
      goToStep(1);
      return;
    }
    goBackOr(navigate, isEditing ? `/host/events/${id}` : '/');
  };

  const handleFillLocationFromGoogleMaps = async () => {
    const rawUrl = formData.google_maps_url.trim();
    const selectedPublicLocation = normalizePublicLocationText(formData.public_location_text);

    if (!rawUrl) {
      setMapsAutofillError('Paste a Google Maps share link first.');
      setMapsAutofillMessage(null);
      return;
    }

    setMapsAutofillLoading(true);
    setMapsAutofillError(null);
    setMapsAutofillMessage(null);

    try {
      let resolvedUrl = rawUrl;

      if (isGoogleMapsShortUrl(rawUrl)) {
        const response = await invokePublicFunction<{ resolvedUrl: string }>('resolve-google-maps-link', {
          url: rawUrl,
        });
        resolvedUrl = response.resolvedUrl || rawUrl;
      }

      const parsedLocation = parseGoogleMapsLocation(resolvedUrl);
      const nextFields = applyGoogleMapsAutofill(
        {
          google_maps_url: formData.google_maps_url,
          location_text: formData.location_text,
          public_location_text: formData.public_location_text,
        },
        parsedLocation,
        { lockedPublicLocation: selectedPublicLocation },
      );

      setFormData((prev) => ({
        ...prev,
        google_maps_url: nextFields.google_maps_url,
        location_text: nextFields.location_text,
        public_location_text: nextFields.public_location_text,
      }));

      if (parsedLocation.exactLocation && parsedLocation.publicLocation) {
        setMapsAutofillMessage(`Filled the exact location from the link. Public location stays set to ${selectedPublicLocation}.`);
      } else if (parsedLocation.exactLocation) {
        setMapsAutofillMessage(`Filled the exact location from the link. Public location stays set to ${selectedPublicLocation}.`);
      } else {
        setMapsAutofillMessage(`Saved the link. Public location stays set to ${selectedPublicLocation}.`);
      }
    } catch (autofillError) {
      setMapsAutofillError(
        autofillError instanceof Error
          ? autofillError.message
          : 'Could not read the Google Maps link.',
      );
    } finally {
      setMapsAutofillLoading(false);
    }
  };

  const stepTitle =
    currentStep === 1
      ? 'Who should be able to find this activity?'
      : currentStep === 2
        ? 'Activity details'
        : currentStep === 3
          ? 'Activity photos'
          : 'Joining settings';

  const isPrivateVisibility = formData.visibility === 'private';
  const customJoinFieldConfig = formData.custom_join_field_config || {
    enabled: false,
    type: 'text' as const,
    label: '',
    required: false,
    options: [],
  };
  useEffect(() => {
    if (!customJoinFieldConfig.enabled || customJoinFieldConfig.type !== 'select') {
      setCustomJoinFieldOptionsDraft('');
      return;
    }
    setCustomJoinFieldOptionsDraft((customJoinFieldConfig.options || []).join('\n'));
  }, [customJoinFieldConfig.enabled, customJoinFieldConfig.type]);
  const updateCustomJoinFieldConfig = (updates: Partial<EventCustomJoinFieldConfig>) => {
    setFormData((prev) => {
      const base = prev.custom_join_field_config || {
        enabled: false,
        type: 'text' as const,
        label: '',
        required: false,
        options: [],
      };
      const next = normalizeCustomJoinFieldConfig({
        ...base,
        ...updates,
      });
      return {
        ...prev,
        custom_join_field_config: next,
      };
    });
  };
  const publicBadgeClass = 'bg-orange-100 text-orange-700';
  const privateBadgeClass = 'bg-slate-100 text-slate-500';

  if (initialLoading) {
    return (
      <StateScreen
        status="loading"
        title={isEditing ? 'Loading activity' : 'Preparing activity'}
        subtitle="Getting your details ready"
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={handleHeaderBack} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-lg font-black text-slate-900 tracking-tight">{isEditing ? 'Edit Activity' : 'New Activity'}</h1>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-6">
        <motion.form 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit} 
          className="space-y-8"
        >
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-brand-600 uppercase tracking-[0.25em]">Step {currentStep} of 4</p>
            {currentStep > 1 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      className={`h-1.5 flex-1 rounded-full ${
                        step <= currentStep ? 'bg-brand-600' : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>

                <div className="ui-card px-4 py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Visibility</p>
                    <p className="text-base font-black text-slate-900">{selectedVisibilityOption?.label || 'Not selected'}</p>
                  </div>
                  <button
                    type="button"
                      onClick={() => goToStep(1)}
                    className="text-sm font-bold text-brand-600 hover:text-brand-500 transition-all"
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {currentStep === 1 ? (
            <section className="space-y-5">
              <div>
                <h2 className="text-3xl font-black text-slate-900 tracking-tight">{stepTitle}</h2>
                <p className="text-sm text-slate-500 mt-2">Choose the visibility first. You can change it later.</p>
              </div>

              <div className="ui-card overflow-hidden">
                {VISIBILITY_OPTIONS.map((option, index) => {
                  const isSelected = visibilitySelected && formData.visibility === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelectVisibility(option.value)}
                      className={`w-full px-5 py-5 text-left transition-all ${
                        isSelected ? 'bg-brand-50' : 'bg-white hover:bg-slate-50'
                      } ${index > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-xl font-black text-slate-900">{option.label}</h3>
                            {option.recommended ? (
                              <span className="rounded-full bg-brand-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-700">
                                Recommended
                              </span>
                            ) : null}
                          </div>
                          <p className="text-sm text-slate-500 mt-2 leading-relaxed pr-2">{option.description}</p>
                        </div>
                        <div
                          className={`mt-1 h-5 w-5 min-h-5 min-w-5 shrink-0 rounded-full border-2 ${
                            isSelected ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-white'
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <>
              <div className="-mt-1 px-1">
                <p className="text-xs text-slate-400">Activities should be created by the person actually hosting them.</p>
              </div>

              {currentStep === 2 ? (
                <>
                  <section className="ui-card overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-100">
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight">{stepTitle}</h2>
                    </div>

                    <div className="px-6 py-5">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Title</label>
                      <input
                        required
                        type="text"
                        placeholder="e.g. Sunday Morning Yoga"
                        className="w-full text-2xl font-black bg-transparent border-b-2 border-slate-100 focus:border-brand-600 outline-none pb-2 transition-all placeholder:text-slate-200"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      />
                    </div>

                    <div className="px-6 py-5 border-t border-slate-100 space-y-4">
                      <div>
                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                          <span>Short description</span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] ${isPrivateVisibility ? privateBadgeClass : publicBadgeClass}`}>
                            {isPrivateVisibility ? 'Private' : 'Public'}
                          </span>
                        </label>
                        <textarea
                          rows={3}
                          placeholder="A quick summary people can read at a glance"
                          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all text-sm"
                          value={formData.public_summary}
                          onChange={(e) => setFormData({ ...formData, public_summary: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                          <span>Detailed description (optional)</span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] ${
                            formData.visibility === 'public' ? publicBadgeClass : privateBadgeClass
                          }`}>
                            {formData.visibility === 'public' ? 'Public' : 'Private'}
                          </span>
                        </label>
                        <textarea
                          rows={4}
                          placeholder="Put info here that you only want people with the private link to be able to see."
                          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all text-sm"
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="px-6 py-5 border-t border-slate-100 space-y-4">
                      <div className="space-y-1">
                        <p className="ui-eyebrow">Schedule</p>
                        <p className="text-sm font-medium text-slate-500">Set when the activity happens and which timezone to use.</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                            <span>Start date and time</span>
                            {formData.visibility === 'semi_public' ? (
                              <>
                                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[9px] text-orange-700 normal-case tracking-normal">
                                  DATE IS PUBLIC
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-500 normal-case tracking-normal">
                                  TIME IS PRIVATE
                                </span>
                              </>
                            ) : null}
                          </label>
                          <input
                            required
                            type="datetime-local"
                            step={900}
                            className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                            value={formData.starts_at}
                            onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Duration</label>
                          <select
                            className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                            value={String(formData.duration_minutes)}
                            onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value, 10) })}
                          >
                            {buildDurationOptions(360, 15).map((minutes) => {
                              const hours = Math.floor(minutes / 60);
                              const remainder = minutes % 60;
                              const label =
                                hours > 0 && remainder > 0
                                  ? `${hours}h ${remainder}m`
                                  : hours > 0
                                    ? `${hours}h`
                                    : `${minutes}m`;
                              return (
                                <option key={minutes} value={minutes}>
                                  {label}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>

                      <div className="mt-4">
                        {showTimezoneField ? (
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Timezone</label>
                            <select
                              className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                              value={formData.timezone}
                              onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                            >
                              {EVENT_TIMEZONE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                            <div>
                              <p className="text-sm font-bold text-slate-700">Timezone: {formData.timezone}</p>
                              <p className="text-xs text-slate-400">Using your current timezone.</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowTimezoneField(true)}
                              className="text-sm font-bold text-brand-600 hover:text-brand-500 transition-all"
                            >
                              Change
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="px-6 py-5 border-t border-slate-100 space-y-4">
                      <div className="space-y-1">
                        <p className="ui-eyebrow">Location</p>
                        <p className="text-sm font-medium text-slate-500">Keep the public view simple and add the exact details where appropriate.</p>
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                          <span>Google Maps link (optional)</span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] ${
                            formData.visibility === 'public' ? publicBadgeClass : privateBadgeClass
                          }`}>
                            {formData.visibility === 'public' ? 'Public' : 'Private'}
                          </span>
                        </label>
                        <input
                          type="url"
                          placeholder="Paste a Google Maps share link"
                          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                          value={formData.google_maps_url}
                          onChange={(e) => {
                            setFormData({ ...formData, google_maps_url: e.target.value });
                            setMapsAutofillError(null);
                            setMapsAutofillMessage(null);
                          }}
                        />
                        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <p className="text-xs text-slate-400">
                            Paste a shared Google Maps link and we will try to fill the location fields for you.
                          </p>
                          <button
                            type="button"
                            onClick={() => { void handleFillLocationFromGoogleMaps(); }}
                            disabled={mapsAutofillLoading}
                            className="inline-flex items-center justify-center rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 transition-all disabled:opacity-50"
                          >
                            {mapsAutofillLoading ? 'Reading link...' : 'Fill from link'}
                          </button>
                        </div>
                        {mapsAutofillMessage ? (
                          <p className="mt-3 text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-2xl px-4 py-3">
                            {mapsAutofillMessage}
                          </p>
                        ) : null}
                        {mapsAutofillError ? (
                          <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
                            {mapsAutofillError}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                          <span>Public location</span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] ${isPrivateVisibility ? privateBadgeClass : publicBadgeClass}`}>
                            {isPrivateVisibility ? 'Private' : 'Public'}
                          </span>
                        </label>
                        <select
                          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                          value={formData.public_location_text}
                          onChange={(e) =>
                            setFormData({ ...formData, public_location_text: normalizePublicLocationText(e.target.value) })
                          }
                        >
                          {LOCKED_PUBLIC_LOCATION_OPTIONS.map((locationOption) => (
                            <option key={locationOption} value={locationOption}>
                              {locationOption}
                            </option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs text-slate-400">
                          Public locations are currently limited to approved city filters.
                        </p>
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                          <span>Exact location</span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] ${
                            formData.visibility === 'public' ? publicBadgeClass : privateBadgeClass
                          }`}>
                            {formData.visibility === 'public' ? 'Public' : 'Private'}
                          </span>
                        </label>
                        <input
                          type="text"
                          placeholder="The exact meetup spot"
                          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                          value={formData.location_text}
                          onChange={(e) => setFormData({ ...formData, location_text: e.target.value })}
                        />
                      </div>
                    </div>
                  </section>

                  {authMessage && (
                    <div className="ui-feedback ui-feedback-info">
                      {authMessage}
                    </div>
                  )}

                  {error && (
                    <div className="ui-feedback ui-feedback-error flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p className="font-bold text-sm">{error}</p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      type="button"
                      onClick={() => goToStep(1)}
                      variant="secondary"
                      className="sm:w-40"
                    >
                      Back
                    </Button>
                    <Button
                      type="button"
                      onClick={() => goToStep(3)}
                      className="sm:flex-1 sm:min-w-0"
                    >
                      Next
                    </Button>
                  </div>
                </>
              ) : currentStep === 3 ? (
                <>
                  <EventGalleryEditor
                    eventVisibility={formData.visibility}
                    galleryVisibility={formData.gallery_visibility}
                    images={galleryImages}
                    queuedUploads={queuedGalleryUploads}
                    canUpload={!!user}
                    isLoading={galleryLoading || loading}
                    errorMessage={galleryError}
                    onGalleryVisibilityChange={(value) => {
                      setFormData((prev) => ({
                        ...prev,
                        gallery_visibility: prev.visibility === 'private' ? 'private_only' : value,
                      }));
                    }}
                    onPickFiles={handlePickGalleryFiles}
                    onRemoveExisting={handleRemoveExistingGalleryImage}
                    onRemoveQueued={handleRemoveQueuedGalleryUpload}
                  />

                  {authMessage && (
                    <div className="ui-feedback ui-feedback-info">
                      {authMessage}
                    </div>
                  )}

                  {error && (
                    <div className="ui-feedback ui-feedback-error flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p className="font-bold text-sm">{error}</p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      type="button"
                      onClick={() => goToStep(2)}
                      variant="secondary"
                      className="sm:w-40"
                    >
                      Back
                    </Button>
                    <Button
                      type="button"
                      onClick={() => goToStep(4)}
                      className="sm:flex-1 sm:min-w-0"
                    >
                      Next
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <section className="ui-card overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-100">
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight">{stepTitle}</h2>
                    </div>

                    <div className="px-6 py-5 space-y-4">
                      <div className="space-y-1">
                        <p className="ui-eyebrow">Joining rules</p>
                        <p className="text-sm font-medium text-slate-500">Choose whether this activity uses RSVP or lightweight interest tracking.</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              participation_mode: 'rsvp',
                            }))
                          }
                          className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                            formData.participation_mode === 'rsvp'
                              ? 'border-brand-300 bg-brand-50'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <p className="text-sm font-bold text-slate-800">RSVP activity</p>
                          <p className="mt-1 text-xs text-slate-500">People can join, waitlist, and request approval.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              participation_mode: 'interest_only',
                              allow_waitlist: false,
                              require_host_approval_for_join: false,
                              require_guest_email_for_join: false,
                              custom_join_field_config: null,
                            }))
                          }
                          className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                            formData.participation_mode === 'interest_only'
                              ? 'border-brand-300 bg-brand-50'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <p className="text-sm font-bold text-slate-800">Non-signup activity</p>
                          <p className="mt-1 text-xs text-slate-500">People can save interest without native RSVP.</p>
                        </button>
                      </div>

                      {formData.participation_mode === 'rsvp' ? (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Capacity</label>
                              <input
                                required
                                type="number"
                                min="1"
                                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                                value={formData.capacity}
                                onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value, 10) })}
                              />
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer select-none rounded-2xl bg-slate-50 px-4 py-4">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all"
                                checked={formData.allow_waitlist}
                                onChange={(e) => setFormData({ ...formData, allow_waitlist: e.target.checked })}
                              />
                              <div>
                                <p className="text-sm font-bold text-slate-700">Allow waitlist</p>
                                <p className="text-xs text-slate-400">Let people join the queue when it fills up.</p>
                              </div>
                            </label>
                          </div>

                          <label className="mt-4 flex items-start gap-3 cursor-pointer select-none rounded-2xl bg-slate-50 px-4 py-4">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all mt-0.5"
                              checked={formData.require_host_approval_for_join}
                              onChange={(e) => setFormData({ ...formData, require_host_approval_for_join: e.target.checked })}
                            />
                            <div>
                              <p className="text-sm font-bold text-slate-700">Require approval to join</p>
                              <p className="text-xs text-slate-400">People can request to join, and you approve them later.</p>
                            </div>
                          </label>

                          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Guest sign-up</p>
                            <label className="flex items-start gap-3 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all mt-0.5"
                                checked={formData.require_guest_email_for_join}
                                onChange={(e) => setFormData({ ...formData, require_guest_email_for_join: e.target.checked })}
                              />
                              <div>
                                <p className="text-sm font-bold text-slate-700">Require email for guest sign up</p>
                                <p className="text-xs text-slate-400">
                                  If off, guests can join with just a name and add email later for recovery.
                                </p>
                              </div>
                            </label>
                          </div>

                          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Custom join field (1)</p>
                            <label className="flex items-start gap-3 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all mt-0.5"
                                checked={customJoinFieldConfig.enabled}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    updateCustomJoinFieldConfig({ enabled: true });
                                  } else {
                                    setFormData((prev) => ({ ...prev, custom_join_field_config: null }));
                                  }
                                }}
                              />
                              <div>
                                <p className="text-sm font-bold text-slate-700">Ask one extra question when someone joins</p>
                                <p className="text-xs text-slate-400">Answers are only visible in your host dashboard.</p>
                              </div>
                            </label>

                            {customJoinFieldConfig.enabled ? (
                              <div className="grid grid-cols-1 gap-3">
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Field label</label>
                                  <input
                                    required={customJoinFieldConfig.enabled}
                                    type="text"
                                    maxLength={120}
                                    className="w-full p-3 rounded-xl bg-white border border-slate-200 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-semibold text-sm"
                                    placeholder="e.g. Child age, Shirt size, Dietary needs"
                                    value={customJoinFieldConfig.label}
                                    onChange={(e) => updateCustomJoinFieldConfig({ label: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Field type</label>
                                  <select
                                    className="w-full p-3 rounded-xl bg-white border border-slate-200 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-semibold text-sm"
                                    value={customJoinFieldConfig.type}
                                    onChange={(e) => updateCustomJoinFieldConfig({ type: e.target.value as EventCustomJoinFieldConfig['type'] })}
                                  >
                                    <option value="text">Text</option>
                                    <option value="number">Number</option>
                                    <option value="select">Dropdown / multiple choice</option>
                                  </select>
                                </div>
                                <label className="flex items-start gap-3 cursor-pointer select-none rounded-xl bg-white border border-slate-200 px-3 py-3">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all mt-0.5"
                                    checked={customJoinFieldConfig.required}
                                    onChange={(e) => updateCustomJoinFieldConfig({ required: e.target.checked })}
                                  />
                                  <div>
                                    <p className="text-sm font-bold text-slate-700">Required field</p>
                                    <p className="text-xs text-slate-400">If off, guests can skip it.</p>
                                  </div>
                                </label>
                                {customJoinFieldConfig.type === 'select' ? (
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Options (one per line)</label>
                                    <textarea
                                      rows={4}
                                      className="w-full p-3 rounded-xl bg-white border border-slate-200 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium text-sm"
                                      value={customJoinFieldOptionsDraft}
                                      onChange={(e) => {
                                        setCustomJoinFieldOptionsDraft(e.target.value);
                                        updateCustomJoinFieldConfig({ options: parseSelectOptionsFromText(e.target.value) });
                                      }}
                                      placeholder={'Small\nMedium\nLarge'}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Interest visibility</p>
                          <p className="text-xs text-slate-500">Choose how much interest activity is visible for this non-signup activity.</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            {[
                              { value: 'count_only', label: 'Show count only' },
                              { value: 'named', label: 'Show names' },
                              { value: 'hidden', label: 'Show nothing' },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    interest_visibility: option.value as 'count_only' | 'named' | 'hidden',
                                  }))
                                }
                                className={`rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
                                  formData.interest_visibility === option.value
                                    ? 'border-brand-300 bg-white text-brand-700'
                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="px-6 py-5 border-t border-slate-100 space-y-4">
                      <div className="space-y-1">
                        <p className="ui-eyebrow">Host details</p>
                        <p className="text-sm font-medium text-slate-500">Keep the organiser details clear and easy to review.</p>
                      </div>
                      {user ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                              <span>Host name</span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[9px] ${
                                  formData.visibility !== 'private'
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}
                              >
                                {formData.visibility !== 'private' ? 'Public' : 'Private'}
                              </span>
                            </label>
                            <input
                              required
                              type="text"
                              placeholder="Your name"
                              readOnly
                              disabled
                              className="w-full p-4 rounded-2xl bg-slate-100 border border-slate-200 text-slate-600 outline-none transition-all font-bold text-sm cursor-not-allowed"
                              value={accountHostName || formData.host_name}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Contact (optional)</label>
                            <input
                              type="text"
                              placeholder="WhatsApp or phone"
                              className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                              value={formData.host_contact_text}
                              onChange={(e) => setFormData({ ...formData, host_contact_text: e.target.value })}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-slate-50 p-4 space-y-2">
                          <p className="text-sm text-slate-600">
                            Host name and contact are set after you sign in. When you tap <span className="font-bold">Create Activity</span>, choose{' '}
                            {laloAuthEnabled ? 'WhatsApp or email' : 'email'} to finish — then you can review these fields as the organiser.
                          </p>
                        </div>
                      )}
                    </div>
                  </section>

                  {authMessage && (
                    <div className="ui-feedback ui-feedback-info">
                      {authMessage}
                    </div>
                  )}

                  {error && (
                    <div className="ui-feedback ui-feedback-error flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p className="font-bold text-sm">{error}</p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      type="button"
                      onClick={() => goToStep(3)}
                      variant="secondary"
                      className="sm:w-40"
                      disabled={loading}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      loading={loading}
                      className="sm:flex-1 sm:min-w-0"
                    >
                      {finalSubmitLabel}
                    </Button>
                  </div>
                  {loading && saveProgress ? (
                    <div className="rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3 text-xs font-bold text-brand-700">
                        <span>{saveProgress.message}</span>
                        <span>{saveProgress.percent}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/80">
                        <div
                          className="h-full rounded-full bg-brand-600 transition-all duration-300"
                          style={{ width: `${saveProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </motion.form>
      </main>

      <AnimatePresence>
        {showEmailModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowEmailModal(false);
                setCreateEventAuthStep('choose');
              }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-8 shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
            >
              {createEventAuthStep === 'choose' && laloAuthEnabled ? (
                <>
                  <h2 className="mb-2 text-xl font-black tracking-tight text-slate-900">Sign in to create this activity</h2>
                  <p className="mb-6 text-sm font-medium text-slate-500">
                    Continue with WhatsApp, or use email for a magic link below.
                  </p>
                  <div className="space-y-3">
                    <LaloVerifyPanel
                      client={createEventVerifyClient}
                      storageKeyPrefix="im_in_lalo_verify_create_event"
                      flowType="login"
                      layout="cta"
                      platformName="I'm In"
                      title="Sign in with WhatsApp"
                      description="Secure verification for your account"
                      buttonLabel="Continue with WhatsApp"
                      successTitle="WhatsApp verified"
                      successDescription="Completing your sign-in now."
                      idleBadge={null}
                      onCompleted={handleWhatsAppAuthCompletedForCreate}
                    />
                    <button
                      type="button"
                      onClick={() => setCreateEventAuthStep('email')}
                      className="block w-full max-w-none rounded-[2rem] border border-slate-200/90 bg-white px-4 py-4 text-left shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition-transform duration-150 hover:-translate-y-0.5 sm:px-5 sm:py-4"
                    >
                      <span className="flex items-center gap-4">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.15rem] border border-brand-100/80 bg-brand-50 text-brand-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                          <Mail className="h-6 w-6" strokeWidth={2} />
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-lg font-black tracking-tight text-slate-900">Continue with email</span>
                          <span className="mt-0.5 block text-sm font-medium text-slate-500">We&apos;ll send a magic link</span>
                        </span>
                      </span>
                    </button>
                  </div>
                  <div className="mt-6">
                    <Button
                      type="button"
                      onClick={() => {
                        setShowEmailModal(false);
                        setCreateEventAuthStep('choose');
                      }}
                      variant="secondary"
                      className="w-full"
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mb-2 text-xl font-black tracking-tight text-slate-900">Finish with email</h2>
                  <p className="mb-6 text-sm font-medium text-slate-500">
                    Enter your email and we will send you a magic link to sign in, then you can finish creating this activity.
                  </p>

                  <form onSubmit={handleSendMagicLink} className="space-y-4">
                    <div>
                      <label className="mb-2 block px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Email
                      </label>
                      <input
                        required
                        type="email"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="ui-input"
                      />
                    </div>
                    <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                      {laloAuthEnabled ? (
                        <Button type="button" onClick={() => setCreateEventAuthStep('choose')} variant="secondary">
                          Back
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => {
                            setShowEmailModal(false);
                            setCreateEventAuthStep('choose');
                          }}
                          variant="secondary"
                        >
                          Cancel
                        </Button>
                      )}
                      <Button type="submit" loading={authLoading} className="sm:flex-1 sm:min-w-0">
                        Send magic link
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProfileModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
            >
              <h2 className="text-xl font-black text-slate-900 tracking-tight mb-2">One Last Step</h2>
              <p className="text-sm text-slate-500 font-medium mb-6">
                {profileModalShowWhatsappField
                  ? 'Add your host details for this activity.'
                  : 'Add how we should show your name as host — your WhatsApp is already linked.'}
              </p>
              <form onSubmit={handleProfileDetailsSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Your Name</label>
                  <input
                    required
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="Your Name"
                    className="ui-input"
                  />
                </div>
                {profileModalShowWhatsappField ? (
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">WhatsApp (Optional)</label>
                  <input
                    type="text"
                    value={profileWhatsapp}
                    onChange={(e) => setProfileWhatsapp(e.target.value)}
                    placeholder="WhatsApp / Phone"
                    className="ui-input"
                  />
                </div>
                ) : null}
                <div className="flex w-full flex-col gap-3 pt-2 sm:flex-row sm:flex-nowrap">
                  <Button
                    type="button"
                    fullWidth={false}
                    className="w-full min-w-0 sm:flex-1"
                    onClick={() => setShowProfileModal(false)}
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" fullWidth={false} className="w-full min-w-0 sm:flex-1">
                    Continue
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
