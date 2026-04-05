import { useEffect, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { AddToHomeScreenHelpSheet } from './AddToHomeScreenHelpSheet';
import { WhyVerifySheet } from './WhyVerifySheet';
import { AttendeeProfile, guestService } from '../../services/guestService';
import {
  clearPostVerifySuccessPending,
  dismissPromptForDays,
  isPostVerifySuccessPending,
  isPromptDismissed,
} from '../../utils/inAppBrowserPromptState';
import { getPromptDecision } from '../../utils/installPromptEligibility';
import { detectRuntimeEnvironment } from '../../utils/runtimeEnvironment';
import { isLaloWhatsAppAuthEnabled } from '../../integrations/lalo/laloAuth';

type InAppBrowserPromptProps = {
  user: User | null;
};

export function InAppBrowserPrompt({ user }: InAppBrowserPromptProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const env = useMemo(() => detectRuntimeEnvironment(), []);
  const [profile, setProfile] = useState<AttendeeProfile | null>(null);
  const [showWhyVerify, setShowWhyVerify] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showPostVerifySuccess, setShowPostVerifySuccess] = useState(false);
  const [storageVersion, setStorageVersion] = useState(0);
  const laloEnabled = isLaloWhatsAppAuthEnabled();

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void guestService.getProfileForUser(user).then((nextProfile) => {
      if (!cancelled) setProfile(nextProfile);
    }).catch(() => {
      if (!cancelled) setProfile(null);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!env.isInAppBrowser || env.isStandalone || !isPostVerifySuccessPending()) {
      return;
    }
    setShowPostVerifySuccess(true);
  }, [env.isInAppBrowser, env.isStandalone, location.key]);

  useEffect(() => {
    if (env.isStandalone && isPostVerifySuccessPending()) {
      clearPostVerifySuccessPending();
    }
  }, [env.isStandalone]);

  const debugPromptOverride = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const params = new URLSearchParams(location.search);
    const value = params.get('webviewPrompt');
    if (value === 'verify' || value === 'install' || value === 'success') {
      return value;
    }
    return null;
  }, [location.search]);

  const hiddenRoutes = location.pathname.startsWith('/auth/whatsapp/');
  const verifyDismissed = isPromptDismissed('verify_whatsapp');
  const addToHomeDismissed = isPromptDismissed('add_to_home_screen');
  const promptDecision = getPromptDecision({
    env,
    user,
    profile,
    verifyDismissed,
    addToHomeDismissed,
  });
  const effectivePromptDecision =
    debugPromptOverride === 'verify'
      ? 'verify_whatsapp'
      : debugPromptOverride === 'install'
        ? 'add_to_home_screen'
        : promptDecision;

  const bannerVisible =
    !hiddenRoutes
    && !(showPostVerifySuccess || debugPromptOverride === 'success')
    && effectivePromptDecision !== 'none'
    && (effectivePromptDecision !== 'verify_whatsapp' || laloEnabled);

  const dismissBanner = () => {
    if (effectivePromptDecision === 'none') return;
    dismissPromptForDays(effectivePromptDecision, 7);
    setStorageVersion((prev) => prev + 1);
  };

  const goVerify = () => {
    const returnPath = `${location.pathname}${location.search}`;
    if (!user) {
      navigate(`/login?from=${encodeURIComponent(returnPath)}`);
      return;
    }
    navigate('/profile?startWhatsapp=1');
  };

  const handleSuccessContinue = () => {
    clearPostVerifySuccessPending();
    setShowPostVerifySuccess(false);
  };

  const handleSuccessShowHelp = () => {
    clearPostVerifySuccessPending();
    setShowPostVerifySuccess(false);
    setShowInstallHelp(true);
  };

  const isTabsRoute =
    location.pathname === '/'
    || location.pathname.startsWith('/explore')
    || location.pathname.startsWith('/calendar')
    || location.pathname.startsWith('/create-event')
    || location.pathname.startsWith('/my-activities')
    || location.pathname.startsWith('/profile')
    || location.pathname.startsWith('/login');

  // Touch storageVersion so banner re-renders immediately after dismiss.
  void storageVersion;

  return (
    <>
      {bannerVisible ? (
        <div
          className="pointer-events-none fixed left-3 right-3 z-40"
          style={{
            bottom: isTabsRoute
              ? 'calc(env(safe-area-inset-bottom, 0px) + 5.2rem)'
              : 'calc(env(safe-area-inset-bottom, 0px) + 0.9rem)',
          }}
        >
          <div className="pointer-events-auto rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
            {effectivePromptDecision === 'verify_whatsapp' ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black tracking-tight text-slate-900">Get the full I&apos;m In experience</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Verify with WhatsApp to save your access, reopen activities more easily, and use I&apos;m In more smoothly next time.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={dismissBanner}
                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button fullWidth={false} className="flex-1" onClick={goVerify}>
                    Verify with WhatsApp
                  </Button>
                  <Button fullWidth={false} variant="secondary" className="flex-1" onClick={() => setShowWhyVerify(true)}>
                    Why verify?
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black tracking-tight text-slate-900">Open I&apos;m In like an app</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Add I&apos;m In to your Home Screen for faster access and a more app-like experience.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={dismissBanner}
                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button fullWidth={false} className="flex-1" onClick={() => setShowInstallHelp(true)}>
                    Add to Home Screen
                  </Button>
                  <Button fullWidth={false} variant="secondary" className="flex-1" onClick={dismissBanner}>
                    Not now
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {(showPostVerifySuccess || debugPromptOverride === 'success') && (env.isInAppBrowser || debugPromptOverride === 'success') && !env.isStandalone ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6">
          <button
            type="button"
            onClick={handleSuccessContinue}
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
            aria-label="Close verified prompt"
          />
          <div className="relative w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-700">You&apos;re verified</p>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Keep it app-like</h3>
            <p className="mt-2 text-sm text-slate-600">
              For the best experience, add I&apos;m In to your Home Screen so it&apos;s easier to reopen next time.
            </p>
            <div className="mt-4 flex gap-2">
              <Button fullWidth={false} className="flex-1" onClick={handleSuccessShowHelp}>
                Show me how
              </Button>
              <Button fullWidth={false} variant="secondary" className="flex-1" onClick={handleSuccessContinue}>
                Continue
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <WhyVerifySheet open={showWhyVerify} onClose={() => setShowWhyVerify(false)} />
      <AddToHomeScreenHelpSheet open={showInstallHelp} env={env} onClose={() => setShowInstallHelp(false)} />
    </>
  );
}
