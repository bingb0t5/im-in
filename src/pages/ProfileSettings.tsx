import { FormEvent, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { guestService, getAccountNameFromUser, HostNotificationPreferences } from '../services/guestService';
import { goBackOr } from '../lib/navigation';

export default function ProfileSettings({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<HostNotificationPreferences>({
    email_on_request_to_view: true,
    email_on_request_to_join: true,
  });
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsMessage, setNotificationsMessage] = useState<string | null>(null);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  const hydrateProfile = async (authUser: User) => {
    const profile = await guestService.getProfileForUser(authUser);
    const composedName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
    const profileName = composedName || profile?.full_name || '';
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

        try {
          const prefs = await guestService.getHostNotificationPreferences(user);
          if (!cancelled) {
            setNotificationPrefs(prefs);
          }
        } catch (prefsError) {
          if (!cancelled) {
            setNotificationsError(
              prefsError instanceof Error ? prefsError.message : 'Could not load notification preferences.',
            );
          }
        }

        if (cancelled) return;
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load profile.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setNotificationsLoading(false);
        }
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

  const handleSaveNotifications = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNotificationsSaving(true);
    setNotificationsMessage(null);
    setNotificationsError(null);

    try {
      const updated = await guestService.updateHostNotificationPreferences(user, notificationPrefs);
      setNotificationPrefs(updated);
      setNotificationsMessage('Notification preferences saved.');
    } catch (saveError) {
      setNotificationsError(saveError instanceof Error ? saveError.message : 'Could not save notification preferences.');
    } finally {
      setNotificationsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => goBackOr(navigate, '/my-activities')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Profile</span>
          <div className="w-9" />
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 pt-8 space-y-6">
        <section className="bg-white rounded-2xl p-6">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Your profile</h1>
          <p className="text-sm text-slate-500 mt-1">
            Update your name and email. Your name is used for hosted activities and your own joins.
          </p>

          {loading ? (
            <div className="py-12 text-sm text-slate-400">Loading profile...</div>
          ) : (
            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Name</label>
                  <button
                    type="button"
                    onClick={() => setIsEditingName((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brand-600 hover:text-brand-500 transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
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
                  className={`w-full p-4 rounded-2xl border outline-none transition-all font-bold text-sm ${
                    isEditingName
                      ? 'bg-slate-50 border-slate-100 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600'
                      : 'bg-slate-100 border-slate-200 text-slate-600 cursor-not-allowed'
                  }`}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Email</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                />
              </div>

              {message ? <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-xl px-3 py-2">{message}</p> : null}
              {error ? <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p> : null}

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-base py-4 rounded-2xl transition-all active:scale-95 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save profile'}
              </button>
            </form>
          )}
        </section>

        <section className="bg-white rounded-2xl p-6">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Notifications</h2>
          <p className="text-sm text-slate-500 mt-1">
            These email notifications apply only to activities you host or co-host.
          </p>

          {notificationsLoading ? (
            <div className="py-10 text-sm text-slate-400">Loading notification settings...</div>
          ) : (
            <form onSubmit={handleSaveNotifications} className="mt-5 space-y-4">
              <label className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={notificationPrefs.email_on_request_to_view}
                  onChange={(e) =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      email_on_request_to_view: e.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                <div>
                  <p className="text-sm font-bold text-slate-800">Request to view</p>
                  <p className="text-xs text-slate-500">Email me when someone requests to view one of my activities.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={notificationPrefs.email_on_request_to_join}
                  onChange={(e) =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      email_on_request_to_join: e.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                <div>
                  <p className="text-sm font-bold text-slate-800">Request to join</p>
                  <p className="text-xs text-slate-500">Email me when someone requests to join one of my activities.</p>
                </div>
              </label>

              {notificationsMessage ? (
                <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-xl px-3 py-2">
                  {notificationsMessage}
                </p>
              ) : null}
              {notificationsError ? (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  {notificationsError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={notificationsSaving}
                className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-base py-4 rounded-2xl transition-all active:scale-95 disabled:opacity-50"
              >
                {notificationsSaving ? 'Saving...' : 'Save notifications'}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
