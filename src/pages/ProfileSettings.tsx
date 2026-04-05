import { FormEvent, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { LogOut, MessageCircle, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { supabase } from '../supabase';
import { buildAuthRedirectUrl } from '../lib/authRedirect';
import {
  clearAllLaloAuthState,
  isLaloWhatsAppAuthEnabled,
  startLaloWhatsAppAuth,
} from '../integrations/lalo/laloAuth';
import { accountMergeClient } from '../integrations/accountMerge/accountMergeClient';
import { guestService, getAccountNameFromUser, isSystemGuestEmail, type AttendeeProfile } from '../services/guestService';

export default function ProfileSettings({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<AttendeeProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [mergeEmail, setMergeEmail] = useState('');
  const [mergeLoading, setMergeLoading] = useState(false);

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

  if (!user) return null;

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const result = await guestService.updateSignedInProfile(user, { fullName, email });
      await hydrateProfile(user);
      setIsEditingName(false);
      setMessage(
        result.emailChangeRequested
          ? 'Profile saved. Check your new email inbox to confirm the email change.'
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

  const handleStartWhatsappVerification = async () => {
    if (!isLaloWhatsAppAuthEnabled()) {
      setError('WhatsApp verification is not enabled yet.');
      return;
    }

    setWhatsappLoading(true);
    setError(null);
    setMessage(null);
    clearAllLaloAuthState();

    try {
      const attempt = await startLaloWhatsAppAuth('/profile', {
        mode: 'link_account',
      });

      navigate('/auth/whatsapp/verify', { replace: true });
      window.setTimeout(() => {
        const popup = window.open(attempt.whatsappUrl, '_blank', 'noopener,noreferrer');
        if (!popup) {
          window.location.href = attempt.whatsappUrl;
        }
      }, 50);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start WhatsApp verification.');
      setWhatsappLoading(false);
    }
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
  const whatsappHelper = hasLinkedWhatsapp
    ? profile?.whatsapp_number
      ? 'Verified and linked to this account.'
      : 'Verified and linked to this account. If Lalo returns your WhatsApp number, it will appear here automatically.'
    : 'Add WhatsApp to this account through verification. Your email remains your backup sign-in, and any older WhatsApp-only account will be merged into this one.';

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <main className="max-w-xl mx-auto px-6 pt-2">
        <div className="space-y-5">
          <Card>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Your profile</h2>
            <p className="mt-1 text-sm text-slate-500">
              Update your name and email. Your name is used for hosted activities and your own joins.
            </p>

            {loading ? (
              <div className="py-12 text-sm text-slate-400">Loading profile...</div>
            ) : (
              <form onSubmit={handleSave} className="mt-5 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">Name</label>
                    <button
                      type="button"
                      onClick={() => setIsEditingName((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brand-600 transition-colors hover:text-brand-500"
                    >
                      <Pencil className="h-3 w-3" />
                      {isEditingName ? 'Lock' : 'Edit'}
                    </button>
                  </div>
                  <input
                    required
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                    readOnly={!isEditingName}
                    className={`w-full rounded-2xl border p-4 text-sm font-bold outline-none transition-all ${
                      isEditingName
                        ? 'border-slate-100 bg-slate-50 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10'
                        : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-600'
                    }`}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Email</label>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold outline-none transition-all focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  />
                </div>

                <Button type="submit" loading={saving}>
                  Save profile
                </Button>
              </form>
            )}
          </Card>

          <Card className="space-y-4">
            <div className="space-y-1">
              <p className="ui-eyebrow">Sign-in methods</p>
              <h2 className="text-xl font-black tracking-tight text-slate-900">Email and WhatsApp</h2>
              <p className="text-sm text-slate-500">Email stays as your backup sign-in while WhatsApp verification can be linked to this account and merged if it already exists elsewhere.</p>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email backup</p>
                <p className="mt-1 text-base font-bold text-slate-900">{email || 'No email on file'}</p>
              </div>

              <div className={`rounded-2xl border p-4 ${hasLinkedWhatsapp ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">WhatsApp verification</p>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      {profile?.whatsapp_number || (hasLinkedWhatsapp ? 'WhatsApp linked' : 'Not linked yet')}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${hasLinkedWhatsapp ? 'bg-white text-brand-700' : 'bg-white text-slate-500'}`}>
                    {hasLinkedWhatsapp ? 'Verified' : 'Available'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">{whatsappHelper}</p>
              </div>
            </div>

            {isLaloWhatsAppAuthEnabled() ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Lalo verifies the WhatsApp identity from your WhatsApp account. If that WhatsApp was already linked to an older account, it will be moved onto this one.
                </div>
                <Button
                  onClick={() => {
                    void handleStartWhatsappVerification();
                  }}
                  loading={whatsappLoading}
                  leadingIcon={<MessageCircle className="h-4 w-4" />}
                >
                  {hasLinkedWhatsapp ? 'Re-verify WhatsApp' : 'Add WhatsApp to this account'}
                </Button>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                WhatsApp verification is not enabled in this environment yet.
              </div>
            )}
          </Card>

          {isWhatsappPrimaryAccount ? (
            <Card className="space-y-4">
              <div className="space-y-1">
                <p className="ui-eyebrow">Merge accounts</p>
                <h2 className="text-xl font-black tracking-tight text-slate-900">Bring in your older email account</h2>
                <p className="text-sm text-slate-500">
                  If you first created an account with WhatsApp and already have an older email account, we can merge the WhatsApp account into that email account.
                </p>
              </div>

              <form onSubmit={handleStartAccountMerge} className="space-y-4">
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Older account email</label>
                  <input
                    type="email"
                    value={mergeEmail}
                    onChange={(e) => setMergeEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold outline-none transition-all focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  We will email a magic link to that address. Open it on this device and we will move your WhatsApp identity and activity data onto the older email account.
                </div>
                <Button type="submit" loading={mergeLoading}>
                  Merge with email account
                </Button>
              </form>
            </Card>
          ) : null}

          {message ? <p className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700">{message}</p> : null}
          {error ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p> : null}

          <Button
            variant="ghost"
            leadingIcon={<LogOut className="h-4 w-4" />}
            onClick={async () => {
              await supabase.auth.signOut();
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
