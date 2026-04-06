import { useEffect, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { AddToHomeScreenHelpSheet } from './AddToHomeScreenHelpSheet';
import { WhyVerifySheet } from './WhyVerifySheet';
import { useAttendeeProfile } from '../../hooks/useAttendeeProfile';
import {
  clearPostVerifySuccessPending,
  clearPromptDismissal,
  dismissPromptForDays,
  isPostVerifySuccessPending,
  isPromptDismissed,
} from '../../utils/inAppBrowserPromptState';
import { getPromptDecision } from '../../utils/installPromptEligibility';
import { detectRuntimeEnvironment } from '../../utils/runtimeEnvironment';
import { isLaloWhatsAppAuthEnabled } from '../../integrations/lalo/laloAuth';
import { isMainTabsRoute } from '../../lib/mainTabsRoutes';

type InAppBrowserPromptProps = {
  user: User | null;
};

export function InAppBrowserPrompt({ user }: InAppBrowserPromptProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const env = useMemo(() => detectRuntimeEnvironment(), []);
  const { profile, refreshProfile } = useAttendeeProfile(user);
  const [showWhyVerify, setShowWhyVerify] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showPostVerifySuccess, setShowPostVerifySuccess] = useState(false);
  const [dismissedInSession, setDismissedInSession] = useState(false);
  const laloEnabled = isLaloWhatsAppAuthEnabled();

  useEffect(() => {
    if (!env.isBrowser || env.isStandalone || !isPostVerifySuccessPending(user?.id || null)) {
      return;
    }
    // Post-verify success should also trigger a profile refresh so prompt
    // eligibility can switch from verify to install without a full reload.
    refreshProfile();
    clearPromptDismissal('verify_whatsapp');
    setShowPostVerifySuccess(true);
  }, [env.isBrowser, env.isStandalone, location.key, refreshProfile, user?.id]);

  useEffect(() => {
    if (env.isStandalone && isPostVerifySuccessPending(user?.id || null)) {
      clearPostVerifySuccessPending();
    }
  }, [env.isStandalone, user?.id]);

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

  useEffect(() => {
    setDismissedInSession(false);
  }, [effectivePromptDecision, location.pathname, location.search, user?.id]);

  const bannerVisible =
    !hiddenRoutes
    && !(showPostVerifySuccess || debugPromptOverride === 'success')
    && !dismissedInSession
    && effectivePromptDecision !== 'none';

  const dismissBanner = () => {
    if (effectivePromptDecision === 'none') return;
    dismissPromptForDays(effectivePromptDecision, 7);
    setDismissedInSession(true);
  };

  const goVerify = () => {
    if (!laloEnabled) {
      setShowWhyVerify(true);
      return;
    }
    const returnPath = `${location.pathname}${location.search}`;
    if (!user) {
      navigate(`/login?from=${encodeURIComponent(returnPath)}`);
      return;
    }
    navigate('/profile?startWhatsapp=1');
  };

  const handleSuccessContinue = () => {
    refreshProfile();
    clearPostVerifySuccessPending();
    setShowPostVerifySuccess(false);
  };

  const handleSuccessShowHelp = () => {
    refreshProfile();
    clearPostVerifySuccessPending();
    setShowPostVerifySuccess(false);
    setShowInstallHelp(true);
  };

  const isTabsRoute = isMainTabsRoute(location.pathname);
  const hasBottomNav = isTabsRoute && !!user;
  const isDesktopBrowser = !env.isMobile;
  const installPromptBody = isDesktopBrowser
    ? "Install I'm In for faster access and a more app-like experience."
    : "Add I'm In to your Home Screen for faster access and a more app-like experience.";
  const installPrimaryCtaLabel = isDesktopBrowser ? 'Install app' : 'Add to Home Screen';
  const postVerifyBody = isDesktopBrowser
    ? "For the best experience, install I'm In so it's easier to reopen next time."
    : "For the best experience, add I'm In to your Home Screen so it's easier to reopen next time.";

  return (
    <>
      {bannerVisible ? (
        <div
          className="pointer-events-none fixed left-3 right-3 z-40"
          style={{
            bottom: hasBottomNav
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
                  <Button
                    fullWidth={false}
                    className="flex-1"
                    onClick={goVerify}
                    disabled={!laloEnabled}
                  >
                    Verify with WhatsApp
                  </Button>
                  <Button fullWidth={false} variant="secondary" className="flex-1" onClick={() => setShowWhyVerify(true)}>
                    Why verify?
                  </Button>
                </div>
                {!laloEnabled ? (
                  <p className="mt-2 text-[11px] text-slate-500">
                    WhatsApp verification is currently unavailable in this build.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black tracking-tight text-slate-900">Open I&apos;m In like an app</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {installPromptBody}
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
                    {installPrimaryCtaLabel}
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

      {(showPostVerifySuccess || debugPromptOverride === 'success') && (env.isBrowser || debugPromptOverride === 'success') && !env.isStandalone ? (
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
              {postVerifyBody}
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
