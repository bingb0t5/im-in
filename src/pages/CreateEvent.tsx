import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  buildDurationOptions,
  DEFAULT_EVENT_TIMEZONE,
  deriveDurationMinutes,
  EVENT_TIMEZONE_OPTIONS,
  generateSlug,
  toUtcIsoFromStartAndDuration,
  utcIsoToEventLocalInput,
} from '../utils';
import { pickWaitlistAttendeesForPromotion } from '../lib/rsvp';
import { buildAuthRedirectUrl } from '../lib/authRedirect';
import { invokeAuthedFunction, invokePublicFunction } from '../lib/functions';
import { goBackOr } from '../lib/navigation';
import { applyGoogleMapsAutofill, isGoogleMapsShortUrl, parseGoogleMapsLocation } from '../lib/googleMaps';
import { shouldModerateVisibility } from '../lib/moderation';
import { guestService, getAccountNameFromUser } from '../services/guestService';

const CREATE_EVENT_DRAFT_KEY = 'im_in_create_event_draft';
const CREATE_EVENT_PENDING_AUTH_KEY = 'im_in_create_event_pending_auth';
const CREATE_EVENT_SUCCESS_KEY = 'im_in_recently_created_event_id';
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
    allow_waitlist: boolean;
    require_host_approval_for_join: boolean;
    is_public: boolean;
  };
  authEmail: string;
  needsProfileDetails: boolean;
  pendingAuth: boolean;
};

export default function CreateEvent({ user }: { user: User | null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  const hasHydratedDraft = useRef(false);
  const step3EnteredAtRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEditing);
  const [formData, setFormData] = useState({
    title: '',
    public_summary: '',
    description: '',
    public_location_text: '',
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
    allow_waitlist: true,
    require_host_approval_for_join: false,
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
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(isEditing ? 2 : 1);
  const [visibilitySelected, setVisibilitySelected] = useState(isEditing);
  const [showTimezoneField, setShowTimezoneField] = useState(isEditing);
  const [mapsAutofillLoading, setMapsAutofillLoading] = useState(false);
  const [mapsAutofillMessage, setMapsAutofillMessage] = useState<string | null>(null);
  const [mapsAutofillError, setMapsAutofillError] = useState<string | null>(null);

  const pickHostNameFromProfile = (profile: any) => {
    const fullName = (profile?.full_name || '').trim();
    if (fullName) return fullName;
    const first = (profile?.first_name || '').trim();
    const last = (profile?.last_name || '').trim();
    return `${first} ${last}`.trim();
  };

  const humanizeEmailName = (email?: string | null) =>
    ((email || '').split('@')[0] || '')
      .replace(/[._-]+/g, ' ')
      .trim();

  const runModerationForEvent = async (eventId: string, visibility: 'public' | 'semi_public' | 'private') => {
    if (!shouldModerateVisibility(visibility)) return;

    try {
      await invokeAuthedFunction('moderate-activity', { eventId });
    } catch (error) {
      console.error('Activity moderation failed:', error);
    }
  };

  useEffect(() => {
    if (isEditing && user) {
      fetchEvent();
    }
  }, [id, user]);

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
          timezone: draft.formData.timezone || prev.timezone,
          duration_minutes: draft.formData.duration_minutes || prev.duration_minutes,
        }));
        setVisibilitySelected(true);
        setCurrentStep(2);
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
    if (localStorage.getItem(CREATE_EVENT_PENDING_AUTH_KEY) === 'true') {
      const fallbackName = getAccountNameFromUser(user);
      if (fallbackName && !formData.host_name.trim()) {
        setFormData(prev => ({ ...prev, host_name: fallbackName }));
      }
      if (needsProfileDetails && !fallbackName && !formData.host_name.trim()) {
        setShowProfileModal(true);
        setAuthMessage('Welcome! Add your name to finish creating your activity.');
      } else {
        setAuthMessage("You're signed in. Click Create Activity to finish saving.");
      }
      localStorage.removeItem(CREATE_EVENT_PENDING_AUTH_KEY);
    }
  }, [isEditing, user, needsProfileDetails, formData.host_name]);

  useEffect(() => {
    if (!user) {
      setAccountHostName('');
      return;
    }
    let cancelled = false;

    const hydrateDefaultHostName = async () => {
      const normalizedEmail = (user.email || '').trim().toLowerCase();

      const { data: byUserId } = await supabase
        .from('attendee_profiles')
        .select('full_name, first_name, last_name')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let resolvedName = pickHostNameFromProfile(byUserId);
      if (!resolvedName && normalizedEmail) {
        const { data: byEmail } = await supabase
          .from('attendee_profiles')
          .select('full_name, first_name, last_name')
          .eq('email', normalizedEmail)
          .maybeSingle();
        resolvedName = pickHostNameFromProfile(byEmail);
      }

      const metadataName = getAccountNameFromUser(user);
      if (!resolvedName && metadataName) {
        resolvedName = metadataName;
      }

      if (!resolvedName) {
        const { data: latestHostedEvent } = await supabase
          .from('events')
          .select('host_name, created_at')
          .eq('host_user_id', user.id)
          .not('host_name', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        resolvedName = (latestHostedEvent?.host_name || '').trim();
      }

      if (!resolvedName && normalizedEmail) {
        resolvedName = humanizeEmailName(normalizedEmail);
      }

      if (!cancelled && resolvedName) {
        setAccountHostName(resolvedName);
      }
    };

    hydrateDefaultHostName();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !accountHostName) return;
    setFormData((prev) => (prev.host_name === accountHostName ? prev : { ...prev, host_name: accountHostName }));
    setProfileName((prev) => prev || accountHostName);
  }, [user, accountHostName]);

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
        getAccountNameFromUser(user) ||
        pickHostNameFromProfile(profile) ||
        (data.host_name || '').trim() ||
        humanizeEmailName(user.email);

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
        public_location_text: normalizedEvent.public_location_text || '',
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
        allow_waitlist: normalizedEvent.allow_waitlist ?? true,
        require_host_approval_for_join: normalizedEvent.require_host_approval_for_join ?? false,
        is_public: normalizedEvent.is_public ?? true,
      });
      setVisibilitySelected(true);
      setCurrentStep(2);
      setShowTimezoneField(timezone !== DETECTED_EVENT_TIMEZONE);
      setInitialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep !== 3) return;
    if (Date.now() - step3EnteredAtRef.current < 450) return;
    if (!user) {
      setShowEmailModal(true);
      return;
    }
    if (!isEditing && needsProfileDetails && !formData.host_name.trim()) {
      setShowProfileModal(true);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // Fetch old capacity for comparison
      let oldCapacity = 0;
      if (isEditing) {
        const { data: oldEvent } = await supabase
          .from('events')
          .select('capacity')
          .eq('id', id)
          .single();
        oldCapacity = oldEvent?.capacity || 0;
      }

      // Clean up optional fields: convert empty strings to null
      const metadataName = getAccountNameFromUser(user);
      const emailName = (user.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
      const resolvedHostName = (accountHostName || formData.host_name || metadataName || emailName).trim();
      const resolvedHostContact = formData.host_contact_text.trim();
      const resolvedVisibility = formData.visibility || 'semi_public';
      if (!resolvedHostName) {
        throw new Error('Host name is required to create an activity.');
      }
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
        is_public: resolvedVisibility !== 'private',
        show_host_publicly: resolvedVisibility !== 'private',
        description: formData.description.trim() || null,
        public_summary: formData.public_summary.trim() || null,
        location_text: formData.location_text.trim() || null,
        public_location_text: formData.public_location_text.trim() || null,
        google_maps_url: formData.google_maps_url.trim() || null,
        timezone: formData.timezone || DEFAULT_EVENT_TIMEZONE,
        duration_minutes: formData.duration_minutes || 60,
        host_contact_text: resolvedHostContact || null,
      };

      if (resolvedVisibility === 'public') {
        submissionData.public_summary = submissionData.public_summary || submissionData.description;
        submissionData.public_location_text = submissionData.public_location_text || submissionData.location_text;
      }

      if (!isEditing) {
        submissionData.host_user_id = user.id;
        submissionData.slug = `${generateSlug(formData.title)}-${Math.random().toString(36).substring(2, 7)}`;
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
        // Keep co-host membership in sync for creator/editor.
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

        if (!isEditing) {
          localStorage.removeItem(CREATE_EVENT_DRAFT_KEY);
          localStorage.removeItem(CREATE_EVENT_PENDING_AUTH_KEY);
          setNeedsProfileDetails(false);
        }
        // If capacity increased, promote people from waitlist
        if (isEditing && formData.capacity > oldCapacity) {
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

        await runModerationForEvent(result.data.id, resolvedVisibility);

        if (!isEditing) {
          sessionStorage.setItem(CREATE_EVENT_SUCCESS_KEY, result.data.id);
        }

        navigate(`/host/events/${result.data.id}`, {
          state: isEditing ? undefined : { justCreated: true },
        });
      }
    } catch (err: any) {
      console.error('Error saving activity:', err);
      setError(err.message || 'Failed to save activity. Please try again.');
      setLoading(false);
    }
  };

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
      .select('id, first_name, last_name')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (existingProfile) {
      const hasProfileName = !!(
        existingProfile.first_name?.trim() || existingProfile.last_name?.trim()
      );
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

  const handleProfileDetailsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedName = profileName.trim();
    if (!normalizedName) {
      setError('Please add your name to continue.');
      return;
    }
    setFormData(prev => ({
      ...prev,
      host_name: normalizedName,
      host_contact_text: profileWhatsapp.trim(),
    }));
    setNeedsProfileDetails(false);
    setShowProfileModal(false);
    setAuthMessage('Details saved. Click Create Activity to finish.');
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

  const goToStep = (step: 1 | 2 | 3) => {
    if (step === 3) {
      step3EnteredAtRef.current = Date.now();
    }
    setCurrentStep(step);
  };

  const handleHeaderBack = () => {
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
      );

      setFormData((prev) => ({
        ...prev,
        google_maps_url: nextFields.google_maps_url,
        location_text: nextFields.location_text,
        public_location_text: nextFields.public_location_text,
      }));

      if (parsedLocation.exactLocation && parsedLocation.publicLocation) {
        setMapsAutofillMessage('Filled the public and exact location from the link. You can still edit both fields.');
      } else if (parsedLocation.exactLocation) {
        setMapsAutofillMessage('Filled the exact location from the link. Check the public location before saving.');
      } else {
        setMapsAutofillMessage('Saved the link, but could not read a location from it. You can still type the fields manually.');
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
        : 'Joining settings';

  const isPrivateVisibility = formData.visibility === 'private';
  const publicBadgeClass = 'bg-orange-100 text-orange-700';
  const privateBadgeClass = 'bg-slate-100 text-slate-500';

  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
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

      <main className="max-w-2xl mx-auto px-6 pt-4">
        <motion.form 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit} 
          className="space-y-6"
        >
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-brand-600 uppercase tracking-[0.25em]">Step {currentStep} of 3</p>
            {currentStep > 1 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {[1, 2, 3].map((step) => (
                    <div
                      key={step}
                      className={`h-1.5 flex-1 rounded-full ${
                        step <= currentStep ? 'bg-brand-600' : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>

                <div className="bg-white rounded-2xl px-4 py-3 flex items-center justify-between gap-4">
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

              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
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
                  <section className="bg-white rounded-3xl overflow-hidden">
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

                    <div className="px-6 py-5 border-t border-slate-100">
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
                        <input
                          type="text"
                          placeholder="City, suburb, or general area"
                          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                          value={formData.public_location_text}
                          onChange={(e) => setFormData({ ...formData, public_location_text: e.target.value })}
                        />
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
                    <div className="p-4 bg-brand-50 border border-brand-100 rounded-2xl text-brand-700 text-sm font-medium">
                      {authMessage}
                    </div>
                  )}

                  {error && (
                    <div className="p-5 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p className="font-bold text-sm">{error}</p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() => goToStep(1)}
                      className="sm:w-40 bg-white border border-slate-200 text-slate-600 font-bold text-base py-4 rounded-2xl transition-all active:scale-95"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => goToStep(3)}
                      className="flex-1 bg-brand-600 hover:bg-brand-500 text-white font-bold text-base py-4 rounded-2xl transition-all active:scale-95"
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <section className="bg-white rounded-3xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-100">
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight">{stepTitle}</h2>
                    </div>

                    <div className="px-6 py-5">
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
                    </div>

                    <div className="px-6 py-5 border-t border-slate-100 space-y-4">
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
                        <div className="rounded-2xl bg-slate-50 p-4">
                          <p className="text-sm text-slate-500">
                            You can fill this out now. We’ll ask for your email when you create the activity.
                          </p>
                        </div>
                      )}
                    </div>
                  </section>

                  {authMessage && (
                    <div className="p-4 bg-brand-50 border border-brand-100 rounded-2xl text-brand-700 text-sm font-medium">
                      {authMessage}
                    </div>
                  )}

                  {error && (
                    <div className="p-5 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p className="font-bold text-sm">{error}</p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() => goToStep(2)}
                      className="sm:w-40 bg-white border border-slate-200 text-slate-600 font-bold text-base py-4 rounded-2xl transition-all active:scale-95"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 bg-brand-600 hover:bg-brand-500 text-white font-bold text-base py-4 rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
                    >
                      {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Activity'}
                      {!loading && <Save className="w-4 h-4" />}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </motion.form>
      </main>

      <AnimatePresence>
        {showEmailModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 overflow-y-auto overscroll-contain">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEmailModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
            >
              <h2 className="text-xl font-black text-slate-900 tracking-tight mb-2">Finish with Magic Link</h2>
              <p className="text-sm text-slate-500 font-medium mb-6">
                To create this activity, enter your email and we will send you a magic link.
              </p>

              <form onSubmit={handleSendMagicLink} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Email</label>
                  <input
                    required
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(false)}
                    className="flex-1 p-3.5 rounded-xl bg-slate-50 text-slate-500 font-bold hover:bg-slate-100 transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="flex-1 p-3.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-500 transition-all shadow-lg shadow-brand-600/10 disabled:opacity-50 active:scale-95"
                  >
                    {authLoading ? 'Sending...' : 'Send Magic Link'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 overflow-y-auto overscroll-contain">
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
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
            >
              <h2 className="text-xl font-black text-slate-900 tracking-tight mb-2">One Last Step</h2>
              <p className="text-sm text-slate-500 font-medium mb-6">
                Add your host details for this activity.
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
                    className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">WhatsApp (Optional)</label>
                  <input
                    type="text"
                    value={profileWhatsapp}
                    onChange={(e) => setProfileWhatsapp(e.target.value)}
                    placeholder="WhatsApp / Phone"
                    className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowProfileModal(false)}
                    className="flex-1 p-3.5 rounded-xl bg-slate-50 text-slate-500 font-bold hover:bg-slate-100 transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 p-3.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-500 transition-all shadow-lg shadow-brand-600/10 active:scale-95"
                  >
                    Continue
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
