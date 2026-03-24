import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, MapPin, Users, ArrowLeft, Save, AlertCircle, Info } from 'lucide-react';
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
import { goBackOr } from '../lib/navigation';

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
  const pickHostNameFromProfile = (profile: any) => {
    const fullName = (profile?.full_name || '').trim();
    if (fullName) return fullName;
    const first = (profile?.first_name || '').trim();
    const last = (profile?.last_name || '').trim();
    return `${first} ${last}`.trim();
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
      const fallbackName = (user.user_metadata?.full_name || '').trim();
      if (fallbackName && !formData.host_name.trim()) {
        setFormData(prev => ({ ...prev, host_name: fallbackName }));
      }
      if (needsProfileDetails && !fallbackName && !formData.host_name.trim()) {
        setShowProfileModal(true);
        setAuthMessage('Welcome! Add your name to finish creating your event.');
      } else {
        setAuthMessage("You're signed in. Click Create Event to finish saving.");
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
      const { data: latestHostedEvent } = await supabase
        .from('events')
        .select('host_name, created_at')
        .eq('host_user_id', user.id)
        .not('host_name', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const hostedEventName = (latestHostedEvent?.host_name || '').trim();
      if (hostedEventName) {
        if (!cancelled) setAccountHostName(hostedEventName);
        return;
      }

      const metadataName = (user.user_metadata?.full_name || '').trim();
      if (metadataName) {
        if (!cancelled) setAccountHostName(metadataName);
        return;
      }

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

      if (!resolvedName && normalizedEmail) {
        resolvedName = normalizedEmail.split('@')[0].replace(/[._-]+/g, ' ').trim();
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

    if (error || data.host_user_id !== user?.id) {
      console.error(error);
      navigate('/');
    } else {
      const timezone = data.timezone || DEFAULT_EVENT_TIMEZONE;
      const durationMinutes = data.duration_minutes || deriveDurationMinutes(data.starts_at, data.ends_at);

      setFormData({
        title: data.title || '',
        public_summary: data.public_summary || '',
        description: data.description || '',
        public_location_text: data.public_location_text || '',
        location_text: data.location_text || '',
        google_maps_url: data.google_maps_url || '',
        starts_at: utcIsoToEventLocalInput(data.starts_at, timezone),
        timezone,
        duration_minutes: durationMinutes,
        capacity: data.capacity ?? 10,
        host_name: data.host_name || '',
        host_contact_text: data.host_contact_text || '',
        show_host_publicly: data.show_host_publicly ?? false,
        visibility: data.visibility || (data.is_public ? 'public' : 'private'),
        allow_waitlist: data.allow_waitlist ?? true,
        is_public: data.is_public ?? true,
      });
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
      const metadataName = (user.user_metadata?.full_name || '').trim();
      const emailName = (user.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
      const resolvedHostName = (accountHostName || formData.host_name || metadataName || emailName).trim();
      const resolvedHostContact = formData.host_contact_text.trim();
      const resolvedVisibility = formData.visibility || 'semi_public';
      if (!resolvedHostName) {
        throw new Error('Host name is required to create an event.');
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
        host_user_id: user.id,
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
        navigate(`/host/events/${result.data.id}`);
      }
    } catch (err: any) {
      console.error('Error saving event:', err);
      setError(err.message || 'Failed to save event. Please try again.');
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
    setAuthMessage(`Magic link sent to ${normalizedEmail}. After signing in, return here and click Create Event.`);
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
    setAuthMessage('Details saved. Click Create Event to finish.');
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
          <h1 className="text-lg font-black text-slate-900 tracking-tight">{isEditing ? 'Edit Event' : 'New Event'}</h1>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-8">
        <motion.form 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit} 
          className="space-y-8"
        >
          {/* Basic Info */}
          <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Event Title</label>
              <input
                required
                type="text"
                placeholder="e.g. Sunday Morning Yoga"
                className="w-full text-2xl font-black bg-transparent border-b-2 border-slate-50 focus:border-brand-600 outline-none pb-3 transition-all placeholder:text-slate-200"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                {formData.visibility === 'public' ? 'Event Description (Public)' : 'Full Event Description'}
              </label>
              <textarea
                rows={4}
                placeholder={formData.visibility === 'public' ? 'What should people know?' : 'Visible only via the direct event link'}
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all font-medium text-sm"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {formData.visibility !== 'public' && (
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Public Summary</label>
                <textarea
                  rows={3}
                  placeholder="Shown on the public events list"
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all font-medium text-sm"
                  value={formData.public_summary}
                  onChange={(e) => setFormData({ ...formData, public_summary: e.target.value })}
                />
              </div>
            )}
          </section>

          {/* Logistics */}
          <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                  <Calendar className="w-3.5 h-3.5 text-brand-600" /> Starts At
                </label>
                <input
                  required
                  type="datetime-local"
                  step={900}
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  value={formData.starts_at}
                  onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-300" /> Duration
                </label>
                <select
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
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
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Timezone</label>
              <select
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
              >
                {EVENT_TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 font-medium mt-2 px-1">
                All event times are saved in UTC and shown using this timezone.
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                <MapPin className="w-3.5 h-3.5 text-brand-600" /> {formData.visibility === 'public' ? 'Location' : 'Exact Location'}
              </label>
              <input
                type="text"
                placeholder={formData.visibility === 'public' ? 'Where is it happening?' : 'Exact location (shown on direct event link)'}
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                value={formData.location_text}
                onChange={(e) => setFormData({ ...formData, location_text: e.target.value })}
              />
            </div>

            {formData.visibility !== 'public' && (
              <div>
                <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                  <MapPin className="w-3.5 h-3.5 text-brand-600" /> Public Town / City
                </label>
                <input
                  type="text"
                  placeholder="e.g. Nelson, Wellington, Auckland"
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  value={formData.public_location_text}
                  onChange={(e) => setFormData({ ...formData, public_location_text: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                <MapPin className="w-3.5 h-3.5 text-brand-600" /> Google Maps Link (Optional)
              </label>
              <input
                type="url"
                placeholder="Paste Google Maps share URL"
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                value={formData.google_maps_url}
                onChange={(e) => setFormData({ ...formData, google_maps_url: e.target.value })}
              />
              <p className="text-xs text-slate-400 font-medium mt-2 px-1">
                Tip: use the Share button in Google Maps and paste the link here.
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                <Users className="w-3.5 h-3.5 text-brand-600" /> Capacity
              </label>
              <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                <input
                  required
                  type="number"
                  min="1"
                  className="w-full sm:w-28 p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-center text-sm"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                />
                <label className="flex items-center gap-2.5 text-slate-600 font-bold cursor-pointer select-none text-sm">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      className="peer w-5 h-5 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all"
                      checked={formData.allow_waitlist}
                      onChange={(e) => setFormData({ ...formData, allow_waitlist: e.target.checked })}
                    />
                  </div>
                  <span>Allow Waitlist</span>
                  <Info className="w-3.5 h-3.5 text-slate-300" />
                </label>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-50 space-y-5">
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Visibility</label>
                <select
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
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
                <p className="text-xs text-slate-400 font-medium mt-2 px-1">
                  Semi-public events appear in public browse with limited info. Full details are only visible via your shared link.
                </p>
              </div>

              <label className="flex items-center gap-4 text-slate-900 font-black cursor-pointer select-none group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    className="peer w-7 h-7 rounded-xl border-2 border-slate-200 text-brand-600 focus:ring-brand-600 transition-all"
                    checked={formData.show_host_publicly}
                    onChange={(e) => setFormData({ ...formData, show_host_publicly: e.target.checked })}
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-base tracking-tight">Show host on public listing</span>
                  <span className="text-xs text-slate-400 font-medium">If off, your name is hidden in public browse previews.</span>
                </div>
              </label>
            </div>
          </section>

          {/* Host Info */}
          {user ? (
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Host Name</label>
                  <input
                    required
                    type="text"
                    placeholder="Your Name"
                    readOnly
                    disabled
                    className="w-full p-4 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 outline-none transition-all font-bold text-sm cursor-not-allowed"
                    value={accountHostName || formData.host_name}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Contact Info (Optional)</label>
                  <input
                    type="text"
                    placeholder="WhatsApp / Phone"
                    className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                    value={formData.host_contact_text}
                    onChange={(e) => setFormData({ ...formData, host_contact_text: e.target.value })}
                  />
                </div>
              </div>
            </section>
          ) : (
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
              <p className="text-sm font-medium text-slate-600">
                You can fill out your event now. On save, we will ask for your email and send a magic link to finish.
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
            className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-brand-600/10 mt-2 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
          >
            {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Event'}
            {!loading && <Save className="w-5 h-5" />}
          </button>
        </motion.form>
      </main>

      <AnimatePresence>
        {showEmailModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
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
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl"
            >
              <h2 className="text-xl font-black text-slate-900 tracking-tight mb-2">Finish with Magic Link</h2>
              <p className="text-sm text-slate-500 font-medium mb-6">
                To create this event, enter your email and we will send you a magic link.
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
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
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl"
            >
              <h2 className="text-xl font-black text-slate-900 tracking-tight mb-2">One Last Step</h2>
              <p className="text-sm text-slate-500 font-medium mb-6">
                Add your host details for this event.
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

      <footer className="max-w-2xl mx-auto px-6 mt-12 pb-10 text-center">
        <p className="text-slate-300 text-[9px] font-bold uppercase tracking-[0.2em]">
          Powered by Lalo
        </p>
      </footer>
    </div>
  );
}
