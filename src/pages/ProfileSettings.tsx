import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { BadgeCheck, Bell, LogOut, Mail, MessageCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthPromptModal } from '../components/AuthPromptModal';
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
import { guestService, getAccountNameFromUser, isSystemGuestEmail, type AttendeeProfile } from '../services/guestService';
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

const PUSH_CATEGORY_LABELS: Record<string, string> = {
  activity_shared: 'Activity shared with you',
  activity_updated: 'Activity updates',
  waitlist_added: 'Added to waitlist',
  waitlist_promoted: 'Promoted from waitlist',
  attendance_changed: 'Attendance changes',
  host_message: 'Host messages',
  guest_reply: 'Guest replies',
  system: 'System announcements',
};

export default function ProfileSettings({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<AttendeeProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const hydrateProfile = async (authUser: User) => {
    const profile = await guestService.getProfileForUser(authUser);
    const composedName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
    const profileName = composedName || profile?.full_name || '';
    setProfile(profile);
    setFullName(profileName || getAccountNameFromUser(authUser) || '');
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

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const result = await guestService.updateSignedInProfile(user, { fullName, email });
      await hydrateProfile(user);
      setMessage(
        result.emailChangeRequested
          ? 'We sent a magic link to your new email. Open it to finish changing your email address.'
          : result.nameSyncComplete
            ? 'Profile saved. Your name has been updated across your activities.'
            : 'Profile saved. Some older activity names may take a moment to refresh.',
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save profile.');
    } finally {
      setSaving(false);
    }
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

  const hasLinkedWhatsapp = !!profile?.lalo_user_id;
  const isWhatsappPrimaryAccount = hasLinkedWhatsapp && isSystemGuestEmail(user.email || profile?.email || '');
  const hasVerifiedEmail = Boolean(user.email_confirmed_at);
  const verifiedWhatsappNumber = profile?.whatsapp_number?.trim() || null;
  const whatsappHelper = hasLinkedWhatsapp
    ? verifiedWhatsappNumber
      ? 'Verified and linked to this account.'
      : 'Verified and linked to this account. If Lalo returns your WhatsApp number, it will appear here automatically.'
    : 'Add WhatsApp to this account through verification. Your email remains your backup sign-in, and any older WhatsApp-only account will be merged into this one.';
  const emailHelper = hasVerifiedEmail
    ? 'Verified and available as your backup sign-in.'
    : 'If you change this email, we will send a magic link to the new address to verify it.';

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

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <main className="max-w-xl mx-auto px-6 pt-2">
        <div className="space-y-5">
          <Card className="space-y-5">
            <div className="space-y-1">
              <p className="ui-eyebrow">Profile</p>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">Account details</h2>
              <p className="text-sm text-slate-500">
                Keep your name, email, and WhatsApp connected to one account. Email stays as your backup sign-in.
              </p>
            </div>

            {loading ? (
              <div className="py-12 text-sm text-slate-400">Loading profile...</div>
            ) : (
              <>
                <form onSubmit={handleSave} className="space-y-0">
                  <section className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Name</p>
                      <input
                        required
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Your name"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-900 outline-none transition-all focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                      />
                      <p className="text-xs text-slate-500">Used for hosted activities and your own joins.</p>
                    </div>
                  </section>

                  <div className="my-5 h-px bg-slate-100" />

                  <section className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">WhatsApp</p>
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
                      <>
                        <p className="text-sm text-slate-500">
                          To change your WhatsApp number, verify again from the WhatsApp account you want to use.
                        </p>
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
                      </>
                    ) : (
                      <p className="text-sm text-slate-500">WhatsApp verification is not enabled in this environment yet.</p>
                    )}
                  </section>

                  <div className="my-5 h-px bg-slate-100" />

                  <section className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email</p>
                        <p className="mt-1 break-all text-base font-bold text-slate-900">{email || 'No email on file'}</p>
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
                    <p className="text-sm text-slate-500">{emailHelper}</p>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold outline-none transition-all focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                    />
                    <Button type="submit" loading={saving}>
                      Save name and email
                    </Button>
                  </section>

                  <div className="my-5 h-px bg-slate-100" />

                  <section className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Push notifications</p>
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
                </form>

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
    </div>
  );
}
