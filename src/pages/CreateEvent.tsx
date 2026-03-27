import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle, Plus } from 'lucide-react';
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
import { invokeAuthedFunction } from '../lib/functions';
import { goBackOr } from '../lib/navigation';
import { shouldModerateVisibility } from '../lib/moderation';
import { guestService, getAccountNameFromUser } from '../services/guestService';

const CREATE_EVENT_DRAFT_KEY = 'im_in_create_event_draft';
const CREATE_EVENT_PENDING_AUTH_KEY = 'im_in_create_event_pending_auth';

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
    timezone: DEFAULT_EVENT_TIMEZONE,
    duration_minutes: 60,
    capacity: 10,
    host_name: '',
    host_contact_text: '',
    show_host_publicly: false,
    visibility: 'semi_public' as 'public' | 'semi_public' | 'private',
    allow_waitlist: true,
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
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const hasOptionalDetails = (draft?: Partial<CreateEventDraft['formData']> | null) =>
    !!draft?.google_maps_url?.trim();

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
        setShowOptionalFields(hasOptionalDetails(draft.formData));
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
        is_public: normalizedEvent.is_public ?? true,
      });
      setShowOptionalFields(
        hasOptionalDetails({
          google_maps_url: normalizedEvent.google_maps_url || '',
          public_summary: normalizedEvent.public_summary || '',
          public_location_text: normalizedEvent.public_location_text || '',
        }),
      );
      setInitialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

        navigate(`/host/events/${result.data.id}`);
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
          <button onClick={() => goBackOr(navigate, isEditing ? `/host/events/${id}` : '/')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-lg font-black text-slate-900 tracking-tight">{isEditing ? 'Edit Activity' : 'New Activity'}</h1>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-7">
        <motion.form 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit} 
          className="space-y-8"
        >
          <div className="-mt-3 mb-1 px-1">
            <p className="text-xs text-slate-400 leading-relaxed">
              Activities should be created by the person actually hosting them.
            </p>
          </div>

          {/* Basic Info */}
          <section className="bg-white rounded-2xl p-6 space-y-5">
            <div>
              <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Activity Title</label>
              <input
                required
                type="text"
                placeholder="e.g. Sunday Morning Yoga"
                className="w-full text-2xl font-black bg-transparent border-b-2 border-slate-100 focus:border-brand-600 outline-none pb-2 transition-all placeholder:text-slate-200"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">
                {formData.visibility === 'public' ? 'Description' : 'Full Description'}
              </label>
              <textarea
                rows={3}
                placeholder={formData.visibility === 'public' ? 'What should people know?' : 'Visible only via the direct activity link'}
                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all text-sm"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          </section>

          {/* Logistics */}
          <section className="bg-white rounded-2xl p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Starts At</label>
                <input
                  required
                  type="datetime-local"
                  step={900}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  value={formData.starts_at}
                  onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Duration</label>
                <select
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
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

            <div>
              <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Timezone</label>
              <select
                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
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

            <div>
              <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">
                {formData.visibility === 'public' ? 'Location' : 'Exact Location'}
              </label>
              <input
                type="text"
                placeholder={formData.visibility === 'public' ? 'Where is it happening?' : 'Exact location — only shown via your shared link'}
                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                value={formData.location_text}
                onChange={(e) => setFormData({ ...formData, location_text: e.target.value })}
              />
            </div>

            {formData.visibility === 'semi_public' && (
              <>
                <div>
                  <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Public Summary</label>
                  <textarea
                    rows={3}
                    placeholder="Shown on the public activities list"
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all text-sm"
                    value={formData.public_summary}
                    onChange={(e) => setFormData({ ...formData, public_summary: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Public Town / City</label>
                  <input
                    type="text"
                    placeholder="e.g. Nelson, Wellington, Auckland"
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                    value={formData.public_location_text}
                    onChange={(e) => setFormData({ ...formData, public_location_text: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4 items-start">
              <div>
                <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Capacity</label>
                <input
                  required
                  type="number"
                  min="1"
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-center text-sm"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                />
              </div>
              <div className="pt-7">
                <label className="flex items-center gap-2.5 cursor-pointer select-none text-sm text-slate-600 font-medium">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all"
                    checked={formData.allow_waitlist}
                    onChange={(e) => setFormData({ ...formData, allow_waitlist: e.target.checked })}
                  />
                  Allow waitlist
                </label>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-50 space-y-4">
              <div>
                <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Visibility</label>
                <select
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  value={formData.visibility}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      visibility: e.target.value as 'public' | 'semi_public' | 'private',
                    })
                  }
                >
                  <option value="semi_public">Semi-public (recommended)</option>
                  <option value="public">Public</option>
                  <option value="private">Private link only</option>
                </select>
                <p className="text-xs text-slate-400 mt-1.5">
                  Semi-public appears in browse with limited info. Full details via your shared link only.
                </p>
                {formData.visibility !== 'private' ? (
                  <p className="text-xs text-slate-400 mt-1.5">
                    Public-facing listings may stay limited at first while broader public discovery is reviewed.
                  </p>
                ) : null}
              </div>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all"
                  checked={formData.show_host_publicly}
                  onChange={(e) => setFormData({ ...formData, show_host_publicly: e.target.checked })}
                />
                <div>
                  <p className="text-sm font-bold text-slate-700">Show my name on public listing</p>
                  <p className="text-xs text-slate-400">Hidden in browse previews if off.</p>
                </div>
              </label>
            </div>

            {/* Optional extras — progressive disclosure */}
            {!showOptionalFields ? (
              <button
                type="button"
                onClick={() => setShowOptionalFields(true)}
                className="text-sm text-slate-400 hover:text-brand-600 transition-all flex items-center gap-1.5 pt-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add optional details
              </button>
            ) : (
              <div className="space-y-4 pt-2 border-t border-slate-50">
                <div>
                  <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Google Maps Link</label>
                  <input
                    type="url"
                    placeholder="Paste Google Maps share URL"
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                    value={formData.google_maps_url}
                    onChange={(e) => setFormData({ ...formData, google_maps_url: e.target.value })}
                  />
                  <p className="text-xs text-slate-400 mt-1.5">
                    Use the Share button in Google Maps, paste the URL here. Attendees see a "Directions" button.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Host Info */}
          {user ? (
            <section className="bg-white rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Host Name</label>
                  <input
                    required
                    type="text"
                    placeholder="Your Name"
                    readOnly
                    disabled
                    className="w-full p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 outline-none transition-all font-bold text-sm cursor-not-allowed"
                    value={accountHostName || formData.host_name}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-medium text-slate-400 uppercase tracking-widest mb-2">Contact (Optional)</label>
                  <input
                    type="text"
                    placeholder="WhatsApp / Phone"
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                    value={formData.host_contact_text}
                    onChange={(e) => setFormData({ ...formData, host_contact_text: e.target.value })}
                  />
                </div>
              </div>
            </section>
          ) : (
            <section className="bg-white rounded-2xl p-5">
              <p className="text-sm text-slate-500">
                Fill out your activity now. On save, we'll ask for your email and send a magic link to finish.
              </p>
            </section>
          )}

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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-500 text-white font-bold text-base py-4 rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
          >
            {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Activity'}
            {!loading && <Save className="w-4 h-4" />}
          </button>
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
