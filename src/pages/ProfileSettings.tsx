import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { BadgeCheck, Bell, Check, LogOut, Mail, MessageCircle, Pencil } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthPromptModal } from '../components/AuthPromptModal';
import { ProfileNamePromptModal } from '../components/profile/ProfileNamePromptModal';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { supabase } from '../supabase';
import { buildAuthRedirectUrl } from '../lib/authRedirect';
import {
  clearAllLaloAuthState,
  clearAllLaloStateForSignOut,
  isLaloWhatsAppAuthEnabled,
} from '../integrations/lalo/laloAuth';
import { accountMergeClient } from '../integrations/accountMerge/accountMergeClient';
import {
  guestService,
  isSystemGuestEmail,
  profileNeedsRealName,
  resolvePreferredAccountName,
  type AttendeeProfile,
} from '../services/guestService';
import {
  canManagePushNotifications,
  fetchMyNotificationPreferences,
  fetchMyPushSubscriptions,
  getExistingPushSubscription,
  getPushAvailability,
  PUSH_NOTIFICATION_CATEGORIES,
  saveMyNotificationPreference,
  subscribeCurrentDeviceToPush,
  syncPushSubscriptionToServer,
  unsubscribeCurrentDeviceFromPush,
} from '../lib/pushNotifications';
import { isWhatsAppVerifiedProfile } from '../utils/installPromptEligibility';

const PUSH_CATEGORY_LABELS: Record<string, string> = {
  activity_shared: 'Activity shared with you',
  activity_updated: 'Activity updates',
  waitlist_added: 'Added to waitlist',
  waitlist_promoted: 'Promoted from waitlist',
  attendance_changed: 'Attendance changes',
  host_join: 'Someone joined your activity',
  host_message: 'Host messages',
  guest_reply: 'Guest replies',
  system: 'System announcements',
};

export default function ProfileSettings({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<AttendeeProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [mergeEmail, setMergeEmail] = useState('');
  const [mergeLoading, setMergeLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [devicePushEnabled, setDevicePushEnabled] = useState(false);
  const [pushPrefs, setPushPrefs] = useState<Record<string, boolean>>({});
  const autoStartAttemptedRef = useRef(false);
  const autoOpenedNamePromptRef = useRef(false);

  const hydrateProfile = async (authUser: User) => {
    const profile = await guestService.getProfileForUser(authUser);
    setProfile(profile);
    setFullName(resolvePreferredAccountName(profile, authUser));
    setEmail(profile?.email || authUser.email || '');
    return profile;
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        await hydrateProfile(user);
        if (cancelled) return;
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load profile.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const pushAvailability = useMemo(() => getPushAvailability(profile), [profile]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermissionState('unsupported');
      return;
    }
    setPermissionState(Notification.permission);
  }, [profile?.id]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadPushSettings = async () => {
      setPushLoading(true);
      setPushError(null);
      try {
        const [prefs, subscriptions, browserSubscription] = await Promise.all([
          fetchMyNotificationPreferences(),
          fetchMyPushSubscriptions(),
          getExistingPushSubscription(),
        ]);
        if (cancelled) return;

        const nextPrefs = Object.fromEntries(
          PUSH_NOTIFICATION_CATEGORIES.map((category) => {
            const row = prefs.find((item) => item.category === category);
            return [category, row?.push_enabled ?? true];
          }),
        );
        setPushPrefs(nextPrefs);

        const activeSubscription = subscriptions.find((row) => !row.revoked_at && row.endpoint === browserSubscription?.endpoint);
        setDevicePushEnabled(Boolean(activeSubscription && browserSubscription));
      } catch (settingsError) {
        if (cancelled) return;
        setPushError(settingsError instanceof Error ? settingsError.message : 'Could not load push notification settings.');
      } finally {
        if (!cancelled) setPushLoading(false);
      }
    };

    void loadPushSettings();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const showAuthPrompt = !user && searchParams.get('signin') === 'true';

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 pb-20">
        <main className="max-w-xl mx-auto px-6 pt-2">
          <div className="space-y-5">
            <Card className="space-y-3">
              <h2 className="text-2xl font-black tracking-tight text-slate-900">Your profile</h2>
              <p className="text-sm text-slate-500">Sign in to manage your details, connect WhatsApp, and keep everything tied to one account.</p>
            </Card>

            <Card className="space-y-4">
              <div className="space-y-1">
                <p className="ui-eyebrow">Sign-in methods</p>
                <h2 className="text-xl font-black tracking-tight text-slate-900">Email and WhatsApp</h2>
                <p className="text-sm text-slate-500">Once you sign in, you can keep email as backup and connect WhatsApp through verification.</p>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email backup</p>
                  <p className="mt-1 text-base font-bold text-slate-900">Not connected yet</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">WhatsApp verification</p>
                  <p className="mt-1 text-base font-bold text-slate-900">Not linked yet</p>
                  <p className="mt-2 text-sm text-slate-500">Add WhatsApp to this account through verification after you sign in.</p>
                </div>
              </div>
            </Card>
          </div>
        </main>
        <AuthPromptModal
          open={showAuthPrompt}
          onClose={() => navigate('/profile', { replace: true })}
          title="Sign in to manage your profile"
          message="Keep your email and WhatsApp connected to one account and update your profile details."
          postAuthRedirect="/profile"
        />
      </div>
    );
  }

  const handleSaveNameOnly = async () => {
    const normalizedName = fullName.trim();
    const currentName = resolvePreferredAccountName(profile, user).trim();
    if (normalizedName === currentName) {
      setError(null);
      setMessage('Name is already up to date.');
      return true;
    }

    setNameSaving(true);
    setError(null);
    setMessage(null);

    try {
      const result = await guestService.updateSignedInProfileName(user, fullName);
      await hydrateProfile(user);
      setShowNamePrompt(false);
      setMessage(
        result.nameSyncComplete
          ? 'Name saved. This will now show correctly across your activities.'
          : 'Name saved. Some older activity names may take a moment to refresh.',
      );

      if (searchParams.get('completeName') === '1') {
        const returnTo = searchParams.get('returnTo') || '/profile';
        navigate(returnTo, { replace: true });
      }
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your name.');
      return false;
    } finally {
      setNameSaving(false);
    }
  };

  const handleSaveEmailOnly = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const currentEmail = (profile?.email || user.email || '').trim().toLowerCase();
    if (normalizedEmail === currentEmail) {
      setError(null);
      setMessage('Email is already up to date.');
      return true;
    }
    if (!normalizedEmail) {
      setError('Please provide your email.');
      return false;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const userEmail = (user.email || '').trim().toLowerCase();
      let emailChangeRequested = false;
      if (normalizedEmail !== userEmail) {
        const { error: authUpdateError } = await supabase.auth.updateUser({ email: normalizedEmail });
        if (authUpdateError) throw authUpdateError;
        emailChangeRequested = true;
      }

      let targetProfile = profile;
      if (!targetProfile) {
        const fallbackName = fullName.trim() || resolvePreferredAccountName(profile, user).trim() || 'Guest';
        targetProfile = await guestService.getOrCreateProfileForUser(user, fallbackName);
      }

      await guestService.addEmailToProfile(targetProfile.id, normalizedEmail);
      await hydrateProfile(user);
      setMessage(
        emailChangeRequested
          ? 'We sent a magic link to your new email. Open it to finish changing your email address.'
          : 'Email saved.',
      );
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your email.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleNamePromptSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSaveNameOnly();
  };

  const handleStartWhatsappVerification = () => {
    if (!isLaloWhatsAppAuthEnabled()) {
      setError('WhatsApp verification is not enabled yet.');
      return;
    }

    setWhatsappLoading(true);
    setError(null);
    setMessage(null);
    clearAllLaloAuthState();
    navigate('/auth/whatsapp/verify?mode=link_existing&autostart=1&returnTo=%2Fprofile', { replace: true });
  };

  const handleStartAccountMerge = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalizedMergeEmail = mergeEmail.trim().toLowerCase();

    if (!normalizedMergeEmail) {
      setError('Enter the email account you want to merge into this WhatsApp account.');
      return;
    }

    setMergeLoading(true);
    setError(null);
    setMessage(null);

    try {
      const mergeStart = await accountMergeClient.start(normalizedMergeEmail);
      const redirectUrl = buildAuthRedirectUrl(`/auth/account-merge/complete?request=${encodeURIComponent(mergeStart.request_id)}`);
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalizedMergeEmail,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (authError) {
        throw authError;
      }

      setMessage(`We sent a magic link to ${normalizedMergeEmail}. Open it on this device to finish merging your accounts.`);
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : 'Could not start account merge.');
    } finally {
      setMergeLoading(false);
    }
  };

  const hasLinkedWhatsapp = isWhatsAppVerifiedProfile(profile);
  const isWhatsappPrimaryAccount = hasLinkedWhatsapp && isSystemGuestEmail(user.email || profile?.email || '');
  const needsRealName = profileNeedsRealName(profile, user);
  const isForcedNamePrompt = searchParams.get('completeName') === '1';
  const hasVerifiedEmail = Boolean(user.email_confirmed_at);
  const verifiedWhatsappNumber = profile?.whatsapp_number?.trim() || null;
  const emailOnFile = email || profile?.email || user.email || '';
  const showBackupEmailPlaceholder = isSystemGuestEmail(emailOnFile);
  const whatsappHelper = hasLinkedWhatsapp
    ? verifiedWhatsappNumber
      ? 'Verified and linked to this account.'
      : 'Verified and linked to this account. If Lalo returns your WhatsApp number, it will appear here automatically.'
    : 'Add WhatsApp to this account through verification. Your email remains your backup sign-in, and any older WhatsApp-only account will be merged into this one.';
  const canManagePush = canManagePushNotifications(user, profile);
  const pushPublicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined;

  const handleEnablePush = async () => {
    if (!canManagePush) {
      setPushError('Push notifications are only available in the installed app after linking WhatsApp.');
      return;
    }
    if (!pushPublicKey?.trim()) {
      setPushError('Push notifications are not configured yet in this environment.');
      return;
    }

    setPushBusy(true);
    setPushError(null);
    setPushMessage(null);
    try {
      const subscription = await subscribeCurrentDeviceToPush(pushPublicKey);
      const env = window.navigator.userAgent || '';
      await syncPushSubscriptionToServer({
        subscription,
        userAgent: env,
        platform: pushAvailability.isStandalone ? 'standalone' : 'browser',
        isStandalone: pushAvailability.isStandalone,
      });
      setPermissionState('granted');
      setDevicePushEnabled(true);
      setPushMessage('Push notifications are enabled on this device.');
    } catch (enableError) {
      setPushError(enableError instanceof Error ? enableError.message : 'Could not enable push notifications.');
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermissionState(Notification.permission);
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    setPushError(null);
    setPushMessage(null);
    try {
      const existing = await getExistingPushSubscription();
      await unsubscribeCurrentDeviceFromPush(existing?.endpoint);
      setDevicePushEnabled(false);
      setPushMessage('Push notifications were disabled on this device.');
    } catch (disableError) {
      setPushError(disableError instanceof Error ? disableError.message : 'Could not disable push notifications.');
    } finally {
      setPushBusy(false);
    }
  };

  const handleTogglePushPreference = async (category: string, enabled: boolean) => {
    setPushError(null);
    setPushMessage(null);
    setPushBusy(true);
    try {
      await saveMyNotificationPreference(category, enabled);
      setPushPrefs((prev) => ({
        ...prev,
        [category]: enabled,
      }));
    } catch (prefError) {
      setPushError(prefError instanceof Error ? prefError.message : 'Could not update push preference.');
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (!user || loading || autoStartAttemptedRef.current) return;
    if (!isLaloWhatsAppAuthEnabled()) return;
    if (hasLinkedWhatsapp) return;

    const shouldStart = searchParams.get('startWhatsapp') === '1';
    if (!shouldStart) return;

    autoStartAttemptedRef.current = true;
    void handleStartWhatsappVerification();
  }, [user, loading, hasLinkedWhatsapp, searchParams]);

  useEffect(() => {
    if (!user || loading) return;
    if (!needsRealName) {
      setShowNamePrompt(false);
      return;
    }
    if (isForcedNamePrompt || !autoOpenedNamePromptRef.current) {
      autoOpenedNamePromptRef.current = true;
      setShowNamePrompt(true);
    }
  }, [user, loading, needsRealName, isForcedNamePrompt]);

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <main className="max-w-xl mx-auto px-6 pt-2">
        <div className="space-y-5">
          <Card className="space-y-5">
            <div className="space-y-1">
              <h2 className="text-2xl font-black tracking-tight text-slate-900">Account details</h2>
              <p className="text-sm text-slate-500">
                Keep your name, email, and WhatsApp connected to one account. Email stays as your backup sign-in.
              </p>
            </div>

            {loading ? (
              <div className="py-12 text-sm text-slate-400">Loading profile...</div>
            ) : (
              <>
                <div className="space-y-0">
                  {needsRealName ? (
                    <>
                      <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Profile completion</p>
                          <h3 className="text-lg font-black tracking-tight text-slate-900">Add your real name</h3>
                          <p className="text-sm text-slate-600">
                            Your WhatsApp account is ready, but we still need the name hosts and guests should see.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setError(null);
                            setMessage(null);
                            setShowNamePrompt(true);
                          }}
                        >
                          Add my name
                        </Button>
                      </section>

                      <div className="my-5 h-px bg-slate-100" />
                    </>
                  ) : null}

                  <section className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600">Name</p>
                      <div className="flex items-center gap-3">
                        <input
                          required
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Your name"
                          disabled={!editingName}
                          className={`w-full rounded-2xl border p-4 text-sm font-bold outline-none transition-all ${
                            editingName
                              ? 'border-slate-200 bg-white text-slate-900 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10'
                              : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (editingName) {
                              const saved = await handleSaveNameOnly();
                              if (saved) setEditingName(false);
                              return;
                            }
                            setError(null);
                            setMessage(null);
                            setEditingName(true);
                          }}
                          disabled={nameSaving}
                          aria-label={editingName ? 'Save name' : 'Edit name'}
                          className={`inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-2xl border text-sm font-bold transition-all duration-150 ${
                            editingName
                              ? 'min-w-[5.5rem] border-brand-600 bg-brand-600 px-3 text-white hover:border-brand-500 hover:bg-brand-500'
                              : 'w-11 border-brand-600 bg-gradient-to-br from-teal-300 via-brand-500 to-teal-700 text-white shadow-[0_8px_18px_rgba(13,148,136,0.32)] ring-1 ring-white/70 hover:brightness-105'
                          }`}
                        >
                          {editingName ? (
                            <>
                              <Check className="h-4 w-4" />
                              <span>Save</span>
                            </>
                          ) : (
                            <Pencil className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </section>

                  <div className="my-5 h-px bg-slate-100" />

                  <section className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600">WhatsApp</p>
                        <p className="mt-1 break-all text-base font-bold text-slate-900">
                          {verifiedWhatsappNumber || (hasLinkedWhatsapp ? 'Verified and linked' : 'Not linked yet')}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                          hasLinkedWhatsapp ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {hasLinkedWhatsapp ? <BadgeCheck className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                        {hasLinkedWhatsapp ? 'Verified' : 'Available'}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">{whatsappHelper}</p>
                    {isLaloWhatsAppAuthEnabled() ? (
                      <Button
                        type="button"
                        onClick={() => {
                          void handleStartWhatsappVerification();
                        }}
                        loading={whatsappLoading}
                        leadingIcon={<MessageCircle className="h-4 w-4" />}
                      >
                        {hasLinkedWhatsapp ? 'Change WhatsApp number' : 'Verify WhatsApp'}
                      </Button>
                    ) : (
                      <p className="text-sm text-slate-500">WhatsApp verification is not enabled in this environment yet.</p>
                    )}
                  </section>

                  <div className="my-5 h-px bg-slate-100" />

                  <section className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600">Email</p>
                        <p className="mt-1 break-all text-base font-bold text-slate-900">
                          {showBackupEmailPlaceholder ? 'No backup email yet' : (email || 'No email on file')}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                          hasVerifiedEmail ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-600'
                        }`}
                      >
                        <Mail className="h-3.5 w-3.5" />
                        {hasVerifiedEmail ? 'Verified' : 'Pending'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        required
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={showBackupEmailPlaceholder ? 'Add a backup email' : 'you@example.com'}
                        disabled={!editingEmail}
                        className={`w-full rounded-2xl border p-4 text-sm font-bold outline-none transition-all ${
                          editingEmail
                            ? 'border-slate-200 bg-white text-slate-900 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10'
                            : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (editingEmail) {
                            const saved = await handleSaveEmailOnly();
                            if (saved) setEditingEmail(false);
                            return;
                          }
                          setError(null);
                          setMessage(null);
                          setEditingEmail(true);
                        }}
                        disabled={saving}
                        aria-label={editingEmail ? 'Save email' : 'Edit email'}
                        className={`inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-2xl border text-sm font-bold transition-all duration-150 ${
                          editingEmail
                            ? 'min-w-[5.5rem] border-brand-600 bg-brand-600 px-3 text-white hover:border-brand-500 hover:bg-brand-500'
                            : 'w-11 border-brand-600 bg-gradient-to-br from-teal-300 via-brand-500 to-teal-700 text-white shadow-[0_8px_18px_rgba(13,148,136,0.32)] ring-1 ring-white/70 hover:brightness-105'
                        }`}
                      >
                        {editingEmail ? (
                          <>
                            <Check className="h-4 w-4" />
                            <span>Save</span>
                          </>
                        ) : (
                          <Pencil className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </section>

                  <div className="my-5 h-px bg-slate-100" />

                  <section className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600">Push notifications</p>
                      <h3 className="flex items-center gap-2 text-xl font-black tracking-tight text-slate-900">
                        <Bell className="h-5 w-5" />
                        Installed app notifications
                      </h3>
                      <p className="text-sm text-slate-500">
                        Push is available only when you open the installed app and your account is linked to WhatsApp.
                      </p>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Eligibility</p>
                          <p className="mt-1 text-sm font-bold text-slate-900">
                            {pushAvailability.isStandalone ? 'Installed app detected' : 'Open the installed app'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {hasLinkedWhatsapp ? 'WhatsApp linked' : 'Link WhatsApp to unlock push notifications'}
                          </p>
                        </div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${canManagePush ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                          {canManagePush ? 'Eligible' : 'Locked'}
                        </span>
                      </div>
                      {!pushAvailability.supported && pushAvailability.reason ? (
                        <p className="text-xs text-amber-700">{pushAvailability.reason}</p>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">This device</p>
                          <p className="text-xs text-slate-500">
                            Permission: {permissionState === 'unsupported' ? 'unsupported' : permissionState}
                          </p>
                        </div>
                        {devicePushEnabled ? (
                          <Button type="button" fullWidth={false} variant="secondary" onClick={() => void handleDisablePush()} loading={pushBusy}>
                            Disable push
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            fullWidth={false}
                            onClick={() => void handleEnablePush()}
                            loading={pushBusy}
                            disabled={!canManagePush || !pushAvailability.supported}
                          >
                            Enable push
                          </Button>
                        )}
                      </div>
                      {!pushAvailability.isStandalone ? (
                        <p className="text-xs text-slate-500">Install the app and open it from your home screen to enable push on this device.</p>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                      <p className="text-sm font-bold text-slate-900">Notification categories</p>
                      {PUSH_NOTIFICATION_CATEGORIES.map((category) => (
                        <label key={category} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                          <span className="text-sm text-slate-700">{PUSH_CATEGORY_LABELS[category] || category}</span>
                          <input
                            type="checkbox"
                            checked={pushPrefs[category] ?? true}
                            onChange={(event) => {
                              void handleTogglePushPreference(category, event.target.checked);
                            }}
                            disabled={pushLoading || pushBusy || !canManagePush}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600/40"
                          />
                        </label>
                      ))}
                      {!canManagePush ? (
                        <p className="text-xs text-slate-500">
                          Category toggles unlock after you open the installed app and link WhatsApp.
                        </p>
                      ) : null}
                    </div>

                    {pushMessage ? <p className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700">{pushMessage}</p> : null}
                    {pushError ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{pushError}</p> : null}
                  </section>
                </div>

                {isWhatsappPrimaryAccount ? (
                  <>
                    <div className="h-px bg-slate-100" />
                    <section className="space-y-3">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Merge accounts</p>
                        <h3 className="text-xl font-black tracking-tight text-slate-900">Bring in your older email account</h3>
                        <p className="text-sm text-slate-500">
                          If this account started with WhatsApp and you already have an older email account, merge it here.
                        </p>
                      </div>

                      <form onSubmit={handleStartAccountMerge} className="space-y-3">
                        <input
                          type="email"
                          value={mergeEmail}
                          onChange={(e) => setMergeEmail(e.target.value)}
                          placeholder="Older account email"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold outline-none transition-all focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                        />
                        <p className="text-sm text-slate-500">
                          We will send a magic link to that address. Open it on this device to move your WhatsApp identity
                          and activity data onto the older email account.
                        </p>
                        <Button type="submit" loading={mergeLoading}>
                          Merge with email account
                        </Button>
                      </form>
                    </section>
                  </>
                ) : null}

                {message ? <p className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700">{message}</p> : null}
                {error ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p> : null}
              </>
            )}
          </Card>

          <Button
            variant="ghost"
            leadingIcon={<LogOut className="h-4 w-4" />}
            onClick={async () => {
              await supabase.auth.signOut();
              clearAllLaloStateForSignOut();
              navigate('/login', { replace: true });
            }}
          >
            Log out
          </Button>
        </div>
      </main>
      <ProfileNamePromptModal
        open={showNamePrompt}
        value={fullName}
        loading={nameSaving}
        title={isForcedNamePrompt ? 'One last step' : 'Add your name'}
        description={
          isForcedNamePrompt
            ? 'Finish setting up your WhatsApp account by adding the real name you want shown across the app.'
            : 'Add the real name you want shown to hosts and guests.'
        }
        submitLabel="Save and continue"
        canClose={!isForcedNamePrompt}
        error={error}
        helperText="This replaces placeholder names like “WhatsApp user 5701”."
        onChange={setFullName}
        onSubmit={handleNamePromptSubmit}
        onClose={() => setShowNamePrompt(false)}
      />
    </div>
  );
}
