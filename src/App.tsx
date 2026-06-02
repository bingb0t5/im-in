/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';

// Pages
import Home from './pages/Home';
import Login from './pages/Login';
import CreateEvent from './pages/CreateEvent';
import EventDetail from './pages/EventDetail';
import HostDashboard from './pages/HostDashboard';
import Calendar from './pages/Calendar';
import Changelog from './pages/Changelog';
import Recovery from './pages/Recovery';
import Bookings from './pages/Bookings';
import MyActivities from './pages/MyActivities';
import ProfileSettings from './pages/ProfileSettings';
import AdminHome from './pages/AdminHome';
import AdminModeration from './pages/AdminModeration';
import AdminModerationSettings from './pages/AdminModerationSettings';
import AdminFeedback from './pages/AdminFeedback';
import AdminGalleryReview from './pages/AdminGalleryReview';
import AdminBetaFeatures from './pages/AdminBetaFeatures';
import AdminImportedListings from './pages/AdminImportedListings';
import ModerationTransparency from './pages/ModerationTransparency';
import WhatsAppAuthPrep from './pages/WhatsAppAuthPrep';
import WhatsAppAuthVerify from './pages/WhatsAppAuthVerify';
import WhatsAppAuthSuccess from './pages/WhatsAppAuthSuccess';
import AccountMergeComplete from './pages/AccountMergeComplete';
import EventShortLinkPage from './pages/EventShortLinkPage';
import { GuestProfileMergePromptModal } from './components/GuestProfileMergePromptModal';
import {
  classifyGuestAutoClaimReasons,
  evaluateGuestOwnershipCheck,
  getProfileDisplayName,
  guestService,
  HARD_BLOCK_GUEST_AUTO_CLAIM_REASONS,
  PROMPTABLE_GUEST_AUTO_CLAIM_REASONS,
  type AttendeeProfile,
  type GuestAutoClaimResult,
  type GuestSession,
} from './services/guestService';
import { MainTabsLayout } from './layouts/MainTabsLayout';
import { GlobalFeedbackWidget } from './components/GlobalFeedbackWidget';
import { ModerationTransparencyModal } from './components/ModerationTransparencyModal';
import { ScrollToTop } from './components/ScrollToTop';
import { InAppBrowserPrompt } from './components/system/InAppBrowserPrompt';
import { useSupabaseSession } from './hooks/useSupabaseSession';
import { maintainPushSubscriptionHealth } from './lib/pushDiagnostics';

const GUEST_MERGE_PROMPT_DISMISS_PREFIX = 'im_in_guest_merge_prompt_dismissed:';
const DEBUG_IDENTITY_STORAGE_KEY = 'im_in_debug_identity';

function buildGuestMergePromptDismissKey(result: GuestAutoClaimResult) {
  const guestProfileId = result.guestProfile?.id || 'unknown-guest';
  return `${GUEST_MERGE_PROMPT_DISMISS_PREFIX}${result.targetProfile.id}:${guestProfileId}`;
}

function IdentityDebugPanel({
  user,
  result,
  promptOpen,
}: {
  user: User | null;
  result: GuestAutoClaimResult | null;
  promptOpen: boolean;
}) {
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [actualGuestSession, setActualGuestSession] = useState<GuestSession | null>(null);
  const [actualSignedInProfile, setActualSignedInProfile] = useState<AttendeeProfile | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const searchParams = new URLSearchParams(location.search);
  const queryEnabled = searchParams.get('debugIdentity') === '1';
  const persistedEnabled = typeof window !== 'undefined' && localStorage.getItem(DEBUG_IDENTITY_STORAGE_KEY) === '1';
  const enabled = import.meta.env.DEV || queryEnabled || persistedEnabled;

  useEffect(() => {
    if (!queryEnabled) return;
    localStorage.setItem(DEBUG_IDENTITY_STORAGE_KEY, '1');
  }, [queryEnabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const nextGuestSession = await guestService.getStoredGuestSession().catch(() => null);
      if (cancelled) return;
      setActualGuestSession(nextGuestSession);

      if (!user) {
        setActualSignedInProfile(null);
        return;
      }

      const nextProfile = await guestService.getProfileForUser(user).catch(() => null);
      if (cancelled) return;
      setActualSignedInProfile(nextProfile);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, user?.id, location.pathname, location.search, refreshTick, result?.status, promptOpen]);

  useEffect(() => {
    if (!enabled) return;
    const intervalId = window.setInterval(() => {
      setRefreshTick((prev) => prev + 1);
    }, 1500);
    return () => window.clearInterval(intervalId);
  }, [enabled]);

  if (!enabled || dismissed) return null;

  const status = result?.status || 'not_run';
  const reasons = result?.reasons || [];
  const { hardBlocked: hardBlockedReasons, promptable: promptableReasons } = classifyGuestAutoClaimReasons(reasons);
  const promptEligible = !!result?.canPromptForMerge;
  const storedGuestSessionPresent = !!actualGuestSession;
  const guestProfileId = actualGuestSession?.profile?.id || '-';
  const guestProfileName = getProfileDisplayName(actualGuestSession?.profile).trim() || '-';
  const signedInProfileId = user?.id ? (actualSignedInProfile?.id || '-') : '-';
  const signedInProfileName = user?.id ? (getProfileDisplayName(actualSignedInProfile).trim() || '-') : '-';
  const ownershipCheck = result?.ownershipCheck || (
    user && actualGuestSession ? evaluateGuestOwnershipCheck(actualGuestSession.profile, user) : null
  );
  const blockedReason = result?.blockedReason || (status === 'skipped_blocked' ? 'unknown_blocked' : '-');
  const debugError = result?.debugError || '-';
  const guestProfileUserId = ownershipCheck?.guestProfileUserId || '-';
  const ownershipAllowsAutoClaim = ownershipCheck ? (ownershipCheck.ownershipAllowsAutoClaim ? 'true' : 'false') : '-';
  const identityMatchesAuth = ownershipCheck ? (ownershipCheck.identityMatchesAuth ? 'true' : 'false') : '-';
  const guestEmail = ownershipCheck?.guestEmail || '-';
  const authEmail = ownershipCheck?.authEmail || '-';
  const guestLaloUserId = actualGuestSession?.profile?.lalo_user_id || '-';
  const guestWhatsapp = actualGuestSession?.profile?.whatsapp_number || '-';
  const signedInLaloUserId = actualSignedInProfile?.lalo_user_id || '-';
  const signedInWhatsapp = actualSignedInProfile?.whatsapp_number || '-';

  return (
    <div className="fixed bottom-3 left-3 right-3 z-[200] max-w-xl rounded-2xl border border-slate-300 bg-white p-3 shadow-2xl sm:left-auto sm:right-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Identity debug</p>
          <p className="text-xs font-semibold text-slate-700">guest to auth merge flow</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-500"
        >
          Dismiss
        </button>
      </div>
      <div className="max-h-56 space-y-1 overflow-auto rounded-xl bg-slate-50 p-2 text-[11px] text-slate-700">
        <p><span className="font-bold">auth user:</span> {user ? `yes (${user.id})` : 'no'}</p>
        <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">actual current state</p>
        <p><span className="font-bold">stored guest session:</span> {storedGuestSessionPresent ? 'yes' : 'no'}</p>
        <p><span className="font-bold">guest profile id:</span> {guestProfileId}</p>
        <p><span className="font-bold">guest profile user_id:</span> {guestProfileUserId}</p>
        <p><span className="font-bold">guest profile name:</span> {guestProfileName}</p>
        <p><span className="font-bold">guest email:</span> {guestEmail}</p>
        <p><span className="font-bold">guest lalo_user_id:</span> {guestLaloUserId}</p>
        <p><span className="font-bold">guest whatsapp_number:</span> {guestWhatsapp}</p>
        <p><span className="font-bold">signed-in profile id:</span> {signedInProfileId}</p>
        <p><span className="font-bold">signed-in profile name:</span> {signedInProfileName}</p>
        <p><span className="font-bold">auth email:</span> {authEmail}</p>
        <p><span className="font-bold">signed-in lalo_user_id:</span> {signedInLaloUserId}</p>
        <p><span className="font-bold">signed-in whatsapp_number:</span> {signedInWhatsapp}</p>
        <p><span className="font-bold">ownership allows auto-claim:</span> {ownershipAllowsAutoClaim}</p>
        <p><span className="font-bold">identity matches auth:</span> {identityMatchesAuth}</p>
        <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">latest merge result</p>
        <p><span className="font-bold">result status:</span> {status}</p>
        <p><span className="font-bold">blocked reason:</span> {blockedReason}</p>
        <p><span className="font-bold">debug error:</span> {debugError}</p>
        <p><span className="font-bold">reasons:</span> {reasons.length > 0 ? reasons.join(', ') : '-'}</p>
        <p>
          <span className="font-bold">promptable reasons:</span>{' '}
          {promptableReasons.length > 0 ? promptableReasons.join(', ') : '-'}
        </p>
        <p>
          <span className="font-bold">hard-block reasons:</span>{' '}
          {hardBlockedReasons.length > 0 ? hardBlockedReasons.join(', ') : '-'}
        </p>
        <p><span className="font-bold">promptEligible:</span> {promptEligible ? 'true' : 'false'}</p>
        <p><span className="font-bold">promptOpen:</span> {promptOpen ? 'true' : 'false'}</p>
        <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">policy classification</p>
        <p><span className="font-bold">promptable policy:</span> {PROMPTABLE_GUEST_AUTO_CLAIM_REASONS.join(', ')}</p>
        <p><span className="font-bold">hard-block policy:</span> {HARD_BLOCK_GUEST_AUTO_CLAIM_REASONS.join(', ')}</p>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading, configError } = useSupabaseSession();
  const [pendingGuestMerge, setPendingGuestMerge] = useState<GuestAutoClaimResult | null>(null);
  const [lastGuestAutoClaimResult, setLastGuestAutoClaimResult] = useState<GuestAutoClaimResult | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [preferredNameSource, setPreferredNameSource] = useState<'guest' | 'signed_in'>('signed_in');
  const hasRunMergeRef = useRef<string | null>(null);

  const mergePromptDismissKey = useMemo(
    () => (pendingGuestMerge ? buildGuestMergePromptDismissKey(pendingGuestMerge) : null),
    [pendingGuestMerge],
  );

  useEffect(() => {
    if (!user) {
      console.info('[identity-debug] app-guest-sync:exit-no-user');
      hasRunMergeRef.current = null;
      setPendingGuestMerge(null);
      setLastGuestAutoClaimResult(null);
      setMergeError(null);
      return;
    }

    console.info('[identity-debug] app-guest-sync:user-changed-reset', {
      userId: user.id,
    });
    hasRunMergeRef.current = null;
    setPendingGuestMerge(null);
    setLastGuestAutoClaimResult(null);
    setMergeError(null);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    let retryTimeoutId: number | null = null;
    let attemptCount = 0;
    const MAX_ATTEMPTS = 8;
    const RETRY_MS = 700;

    const clearRetry = () => {
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
    };

    const runMergeSyncIfReady = async (trigger: string) => {
      if (cancelled) return;
      if (hasRunMergeRef.current === user.id) {
        console.info('[identity-debug] app-guest-sync:exit-already-ran', {
          userId: user.id,
          trigger,
        });
        return;
      }

      const guestSession = await guestService.getStoredGuestSession().catch(() => null);
      if (cancelled) return;

      if (!guestSession) {
        console.info('[identity-debug] app-guest-sync:exit-no-guest-session', {
          userId: user.id,
          trigger,
          attemptCount,
        });
        if (attemptCount < MAX_ATTEMPTS) {
          attemptCount += 1;
          clearRetry();
          retryTimeoutId = window.setTimeout(() => {
            void runMergeSyncIfReady('retry');
          }, RETRY_MS);
        }
        return;
      }

      hasRunMergeRef.current = user.id;
      clearRetry();
      console.info('[identity-debug] app-guest-sync:invoke-merge-sync', {
        userId: user.id,
        trigger,
        guestProfileId: guestSession.profile.id,
      });

      try {
        const result = await guestService.syncStoredGuestSessionForUser(user);
        if (cancelled) return;
        setLastGuestAutoClaimResult(result);
        console.info('[identity-debug] app-guest-sync:result', {
          status: result.status,
          reasons: result.reasons,
          canPromptForMerge: result.canPromptForMerge,
          guestProfileId: result.guestProfile?.id || null,
          targetProfileId: result.targetProfile.id,
        });

        if (
          result.status === 'skipped_conflict'
          && result.canPromptForMerge
          && !sessionStorage.getItem(buildGuestMergePromptDismissKey(result))
        ) {
          console.info('[identity-debug] app-guest-sync:prompt-open', {
            reasons: result.reasons,
          });
          setPendingGuestMerge(result);
          setPreferredNameSource(result.reasons.includes('name_conflict') ? 'signed_in' : 'signed_in');
        } else {
          console.info('[identity-debug] app-guest-sync:prompt-closed', {
            reason: result.status,
          });
          setPendingGuestMerge(null);
        }
        setMergeError(null);
      } catch (err) {
        console.error('[identity-debug] app-guest-sync:error', err);
        hasRunMergeRef.current = null;
      }
    };

    void runMergeSyncIfReady('initial');
    const onFocus = () => {
      void runMergeSyncIfReady('focus');
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'im_in_guest_session') {
        void runMergeSyncIfReady('storage');
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      clearRetry();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    const syncPushHealth = async () => {
      const profile = await guestService.getProfileForUser(user).catch(() => null);
      if (cancelled) return;
      await maintainPushSubscriptionHealth(profile);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncPushHealth();
      }
    };

    void syncPushHealth();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user?.id]);

  const handleKeepGuestProfilesSeparate = () => {
    console.info('[identity-debug] app-guest-sync:keep-separate');
    if (mergePromptDismissKey) {
      sessionStorage.setItem(mergePromptDismissKey, new Date().toISOString());
    }
    setPendingGuestMerge(null);
    setMergeError(null);
  };

  const handleMergeGuestProfiles = async () => {
    if (!user || !pendingGuestMerge) return;

    console.info('[identity-debug] app-guest-sync:merge-clicked', {
      reasons: pendingGuestMerge.reasons,
    });
    setMergeLoading(true);
    setMergeError(null);
    try {
      await guestService.mergeStoredGuestSessionIntoUser(user, {
        targetProfile: pendingGuestMerge.targetProfile,
        preferredNameSource: pendingGuestMerge.reasons.includes('name_conflict') ? preferredNameSource : 'signed_in',
      });
      if (mergePromptDismissKey) {
        sessionStorage.removeItem(mergePromptDismissKey);
      }
      setPendingGuestMerge(null);
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : 'Could not merge those profiles right now.');
    } finally {
      setMergeLoading(false);
    }
  };

  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
        <div className="max-w-md bg-white p-10 rounded-4xl shadow-2xl shadow-slate-200/50 border border-slate-50">
          <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">Setup Required</h1>
          <p className="text-slate-500 mb-8 leading-relaxed font-medium">
            <span className="italic">I&apos;m In</span> needs Supabase to store your activities. Please add your Supabase URL and Anon Key to the environment variables.
          </p>
          <div className="bg-slate-50 p-6 rounded-2xl text-left text-xs font-mono text-slate-400 break-all mb-10 border border-slate-100">
            {configError}
          </div>
          <a 
            href="https://supabase.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-block bg-slate-900 text-white px-8 py-4 rounded-2xl font-black hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-900/20"
          >
            Go to Supabase
          </a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <Router>
      <ScrollToTop />
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-brand-100">
        <InAppBrowserPrompt user={user} />
        <GlobalFeedbackWidget user={user} />
        <ModerationTransparencyModal />
        <IdentityDebugPanel
          user={user}
          result={lastGuestAutoClaimResult}
          promptOpen={!!pendingGuestMerge}
        />
        <GuestProfileMergePromptModal
          open={!!pendingGuestMerge}
          result={pendingGuestMerge}
          mergeLoading={mergeLoading}
          mergeError={mergeError}
          preferredNameSource={preferredNameSource}
          onPreferredNameSourceChange={setPreferredNameSource}
          onMerge={() => void handleMergeGuestProfiles()}
          onKeepSeparate={handleKeepGuestProfilesSeparate}
        />
        <Routes>
          <Route path="/auth/whatsapp/prep" element={<WhatsAppAuthPrep />} />
          <Route path="/auth/whatsapp/verify" element={<WhatsAppAuthVerify />} />
          <Route path="/auth/whatsapp/success" element={<WhatsAppAuthSuccess />} />
          <Route element={<MainTabsLayout user={user} />}>
            <Route path="/login" element={<Login user={user} />} />
            <Route path="/" element={<Home user={user} />} />
            <Route path="/explore" element={<Calendar user={user} />} />
            <Route path="/calendar" element={<Navigate to="/explore" replace />} />
            <Route path="/changelog" element={<Changelog />} />
            <Route path="/create-event" element={<CreateEvent user={user} />} />
            <Route path="/my-activities" element={<MyActivities user={user} />} />
            <Route path="/profile" element={<ProfileSettings user={user} />} />
          </Route>
          <Route path="/auth/account-merge/complete" element={<AccountMergeComplete user={user} />} />
          <Route path="/loc/:code" element={<EventShortLinkPage kind="loc" />} />
          <Route path="/gcal/:code" element={<EventShortLinkPage kind="gcal" />} />
          <Route path="/ical/:code" element={<EventShortLinkPage kind="ical" />} />
          <Route path="/host/events/:id/edit" element={user ? <CreateEvent user={user} /> : <Navigate to="/login" />} />
          <Route path="/events/:slug" element={<EventDetail user={user} />} />
          <Route path="/host/events/:id" element={user ? <HostDashboard user={user} /> : <Navigate to="/login" />} />
          <Route path="/moderation" element={<ModerationTransparency />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/recover" element={<Recovery />} />
          <Route path="/admin" element={user ? <AdminHome user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/moderation" element={user ? <AdminModeration user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/moderation/settings" element={user ? <AdminModerationSettings user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/gallery" element={user ? <AdminGalleryReview user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/imported-listings" element={user ? <AdminImportedListings user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/feedback" element={user ? <AdminFeedback user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/beta-features" element={user ? <AdminBetaFeatures user={user} /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </Router>
  );
}

