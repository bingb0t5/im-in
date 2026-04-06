import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, MessageCircle, RefreshCw, Shield } from 'lucide-react';

import type { LaloVerifyClient, LaloVerifyFlowType, LaloVerifyStatusResponse } from '../types';
import { LaloWebsiteWhatsAppBubbleIcon, WhatsAppBrandFilledMark, WhatsAppGreenTile } from './WhatsAppCta';
import {
  LALO_VERIFY_POLL_INTERVAL_MS,
  LALO_VERIFY_SCREEN_STEP_DELAY_MS,
  LALO_VERIFY_WHATSAPP_APP_FALLBACK_DELAY_MS,
} from '../constants';
import { buildWhatsAppAppLink, wait } from '../whatsappLinks';

type VerifyScreenPhase = 'idle' | 'connecting' | 'generating' | 'handoff' | 'waiting' | 'verified';

type SessionStateShape = {
  clientSessionId: string;
  startData: Awaited<ReturnType<LaloVerifyClient['start']>>;
  status: LaloVerifyStatusResponse;
};

type PersistedVerifyBundle = {
  sessionState: SessionStateShape;
  verifyPhase: VerifyScreenPhase;
};

function readPersistedVerify(storageKey: string): PersistedVerifyBundle | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;

    if ('sessionState' in o && o.sessionState && typeof o.sessionState === 'object') {
      const ss = o.sessionState as SessionStateShape;
      if (!ss.clientSessionId || !ss.startData?.attempt_id) return null;
      const vp = o.verifyPhase;
      return {
        sessionState: {
          ...ss,
          status: ss.status ?? { status: 'pending', expiresAt: ss.startData.expires_at },
        },
        verifyPhase: (typeof vp === 'string' ? vp : 'waiting') as VerifyScreenPhase,
      };
    }

    const legacy = parsed as SessionStateShape;
    if (!legacy?.clientSessionId || !legacy?.startData?.attempt_id) return null;
    return {
      sessionState: {
        ...legacy,
        status: legacy.status ?? { status: 'pending', expiresAt: legacy.startData.expires_at },
      },
      verifyPhase: legacy.status?.status === 'completed' ? 'verified' : 'waiting',
    };
  } catch {
    return null;
  }
}

function writePersistedVerify(storageKey: string, sessionState: SessionStateShape, verifyPhase: VerifyScreenPhase) {
  try {
    const payload: PersistedVerifyBundle = { sessionState, verifyPhase };
    sessionStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Ignore session storage persistence failures.
  }
}

export type LaloVerifyPanelProps = {
  client: LaloVerifyClient;
  flowType: LaloVerifyFlowType;
  title: string;
  description: string;
  buttonLabel: string;
  layout?: 'card' | 'cta';
  helperText?: string;
  currentWhatsAppNumber?: string | null;
  getAuthToken?: (() => Promise<string | null>) | null;
  successTitle: string;
  successDescription: string;
  idleBadge?: string | null;
  /** Default storage key prefix; full key is `${storageKeyPrefix}_${flowType}`. */
  storageKeyPrefix?: string;
  /**
   * `lalo` - Lucide MessageCircle (white stroke), same as historical Lalo `/login` CTA.
   * `brand` - filled WhatsApp-style path inside the green tile.
   */
  ctaWhatsAppIcon?: 'lalo' | 'brand';
  /**
   * Host-specific session bridge (e.g. Clerk ticket sign-in).
   * Called when status is completed and payload includes bridge data.
   */
  onSessionBridge?: (status: LaloVerifyStatusResponse) => Promise<void>;
  onCompleted?: (status: LaloVerifyStatusResponse) => void | Promise<void>;
};

export function LaloVerifyPanel({
  client,
  flowType,
  title,
  description,
  buttonLabel,
  layout = 'card',
  helperText,
  currentWhatsAppNumber,
  getAuthToken,
  successTitle: _successTitle,
  successDescription,
  idleBadge,
  storageKeyPrefix = 'lalo_verify',
  ctaWhatsAppIcon = 'lalo',
  onSessionBridge,
  onCompleted,
}: LaloVerifyPanelProps) {
  const [isStarting, setIsStarting] = React.useState(false);
  const [isPolling, setIsPolling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isBridgingSession, setIsBridgingSession] = React.useState(false);
  /** True while `onCompleted` is running - do not show "Done" yet (user dismissing early caused half-finished sign-in). */
  const [awaitingHostOnCompleted, setAwaitingHostOnCompleted] = React.useState(false);
  const [completionFollowUpError, setCompletionFollowUpError] = React.useState<string | null>(null);
  const [verifyPhase, setVerifyPhase] = React.useState<VerifyScreenPhase>('idle');
  const [copied, setCopied] = React.useState(false);
  const [sessionState, setSessionState] = React.useState<SessionStateShape | null>(null);
  const hasTriggeredCompletionRef = React.useRef(false);
  const storageKey = React.useMemo(() => `${storageKeyPrefix}_${flowType}`, [flowType, storageKeyPrefix]);

  const clearFlowState = React.useCallback(() => {
    setSessionState(null);
    setVerifyPhase('idle');
    setCopied(false);
    setCompletionFollowUpError(null);
    setAwaitingHostOnCompleted(false);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore session storage clear failures.
    }
  }, [storageKey]);

  const handleCopyMessage = React.useCallback(async () => {
    if (!sessionState?.startData.whatsapp_login_message) return;
    await navigator.clipboard.writeText(sessionState.startData.whatsapp_login_message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [sessionState?.startData.whatsapp_login_message]);

  const handleOpenWhatsApp = React.useCallback(() => {
    if (!sessionState?.startData.whatsapp_deep_link) return;
    setError(null);
    /** Same-tab handoff can freeze React before effects run - persist first so restore shows the overlay. */
    writePersistedVerify(storageKey, sessionState, 'waiting');
    setVerifyPhase('waiting');

    const webLink = sessionState.startData.whatsapp_deep_link;
    const appLink = buildWhatsAppAppLink(webLink);

    if (!appLink) {
      const openedWindow = window.open(webLink, '_blank', 'noopener,noreferrer');
      if (!openedWindow) {
        setError('Unable to open WhatsApp automatically. Please allow pop-ups or try again.');
      }
      return;
    }

    let fallbackTimeout = 0;
    const clearFallback = () => {
      if (fallbackTimeout) {
        window.clearTimeout(fallbackTimeout);
        fallbackTimeout = 0;
      }
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', clearFallback);
      window.removeEventListener('blur', clearFallback);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearFallback();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', clearFallback);
    window.addEventListener('blur', clearFallback);

    fallbackTimeout = window.setTimeout(() => {
      clearFallback();
      window.open(webLink, '_blank', 'noopener,noreferrer');
    }, LALO_VERIFY_WHATSAPP_APP_FALLBACK_DELAY_MS);

    window.location.href = appLink;
  }, [sessionState, storageKey]);

  const pollStatus = React.useCallback(
    async (clientSessionId: string, attemptId: string) => {
      const status = await client.getStatus({ clientSessionId, attemptId });

      setSessionState((prev) => (prev ? { ...prev, status } : prev));

      if (status.status === 'completed' && !hasTriggeredCompletionRef.current) {
        hasTriggeredCompletionRef.current = true;
        /** Set before `verified` phase so the overlay never briefly shows the static check while host sign-in runs. */
        if (onCompleted) {
          setAwaitingHostOnCompleted(true);
          setCompletionFollowUpError(null);
        }
        setVerifyPhase('verified');
        await wait(600);

        const bridgeToken =
          status.status === 'completed' && 'clerkSignInToken' in status ? status.clerkSignInToken : null;
        if (onSessionBridge && bridgeToken) {
          setIsBridgingSession(true);
          try {
            await onSessionBridge(status);
          } catch (bridgeError: unknown) {
            const message = bridgeError instanceof Error ? bridgeError.message : 'WhatsApp verified, but automatic sign-in failed.';
            setError(message);
          } finally {
            setIsBridgingSession(false);
          }
        }

        try {
          await onCompleted?.(status);
        } catch (completionError: unknown) {
          const message =
            completionError instanceof Error
              ? completionError.message
              : 'Could not finish signing in after WhatsApp verification.';
          setCompletionFollowUpError(message);
        } finally {
          setAwaitingHostOnCompleted(false);
        }
      }

      return status;
    },
    [client, onSessionBridge, onCompleted],
  );

  React.useEffect(() => {
    const bundle = readPersistedVerify(storageKey);
    if (!bundle) return;
    setSessionState(bundle.sessionState);
    setVerifyPhase(bundle.verifyPhase);
  }, [storageKey]);

  /** Keep overlay restorable after app switch / reload while a flow is in progress (do not drop on `completed`). */
  React.useEffect(() => {
    try {
      if (sessionState && verifyPhase !== 'idle') {
        writePersistedVerify(storageKey, sessionState, verifyPhase);
      } else if (!sessionState) {
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // Ignore session storage persistence failures.
    }
  }, [sessionState, verifyPhase, storageKey]);

  React.useEffect(() => {
    if (!sessionState) return;
    if (sessionState.status.status !== 'pending') return;

    let cancelled = false;
    setIsPolling(true);

    if (verifyPhase === 'idle') {
      setVerifyPhase('waiting');
    }

    const runPoll = async () => {
      try {
        const status = await pollStatus(sessionState.clientSessionId, sessionState.startData.attempt_id);
        if (cancelled) return;
        if (status.status !== 'pending') {
          setIsPolling(false);
          return;
        }
      } catch (pollError: unknown) {
        if (!cancelled) {
          const message = pollError instanceof Error ? pollError.message : 'Unable to check WhatsApp login status';
          setError(message);
          setIsPolling(false);
        }
      }
    };

    const intervalId = window.setInterval(runPoll, LALO_VERIFY_POLL_INTERVAL_MS);
    runPoll();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      setIsPolling(false);
    };
  }, [pollStatus, sessionState, verifyPhase]);

  const handleStart = React.useCallback(async () => {
    setIsStarting(true);
    setError(null);
    setCopied(false);
    setCompletionFollowUpError(null);
    setVerifyPhase('connecting');
    hasTriggeredCompletionRef.current = false;

    try {
      const token = getAuthToken ? await getAuthToken() : null;
      if (flowType === 'link_existing' && !token) {
        throw new Error('Please sign in first to link or replace your WhatsApp number.');
      }

      await wait(LALO_VERIFY_SCREEN_STEP_DELAY_MS);
      setVerifyPhase('generating');

      const clientSessionId = `${flowType}-${Date.now()}`;
      const startData = await client.start({
        clientSessionId,
        flowType,
        token,
      });

      const nextSessionState = {
        clientSessionId,
        startData,
        status: {
          status: 'pending' as const,
          flowType,
          expiresAt: startData.expires_at,
        } satisfies LaloVerifyStatusResponse,
      };

      setSessionState(nextSessionState);
      const nextPhase: VerifyScreenPhase = startData.whatsapp_deep_link ? 'handoff' : 'waiting';
      writePersistedVerify(storageKey, nextSessionState, nextPhase);

      if (startData.whatsapp_deep_link) {
        setVerifyPhase('handoff');
      } else {
        setVerifyPhase('waiting');
      }
    } catch (startError: unknown) {
      setVerifyPhase('idle');
      const message = startError instanceof Error ? startError.message : 'Unable to start WhatsApp auth';
      setError(message);
    } finally {
      setIsStarting(false);
    }
  }, [client, flowType, getAuthToken, storageKey]);

  const hasDeepLink = Boolean(sessionState?.startData.whatsapp_deep_link);
  const showVerifyScreen = verifyPhase !== 'idle';
  const isCtaLayout = layout === 'cta';
  /** After Lalo marks complete, keep spinner / "Verifying" until host `onCompleted` finishes (no brief "verified" flash). */
  const overlayVisualPhase: VerifyScreenPhase =
    verifyPhase === 'verified' && (awaitingHostOnCompleted || isBridgingSession) ? 'waiting' : verifyPhase;
  const verifyTitle = overlayVisualPhase === 'verified' ? 'Verified with Lalo' : 'Verifying with Lalo';
  const verifyDescription =
    verifyPhase === 'connecting'
      ? 'Connecting to Lalo Verify System'
      : verifyPhase === 'generating'
        ? 'Generating WhatsApp code'
        : verifyPhase === 'handoff'
          ? 'We are ready to open WhatsApp in a separate tab. Please send the prefilled message to Lalo Verify, then return to this screen.'
          : verifyPhase === 'waiting'
            ? 'Return to this screen after sending the message. Lalo will check automatically.'
            : isBridgingSession || awaitingHostOnCompleted
              ? 'Finalising your sign-in...'
              : successDescription;

  const purple = 'var(--lv-brand-primary, #6B4DA3)';
  const purpleSoft = 'color-mix(in srgb, var(--lv-brand-primary, #6B4DA3) 20%, transparent)';

  return (
    <div className={isCtaLayout ? 'w-full space-y-3' : 'space-y-4 rounded-3xl border border-stone-100 bg-white p-5 shadow-sm'}>
      {isCtaLayout ? (
        <button
          type="button"
          onClick={handleStart}
          disabled={isStarting}
          className="lv-btn-primary-action flex w-full min-h-[5.25rem] items-center px-6 py-4 text-left disabled:opacity-60 sm:min-h-[5.5rem] sm:py-5"
        >
          <div className="flex w-full items-center gap-4">
            <WhatsAppGreenTile>
              {ctaWhatsAppIcon === 'brand' ? (
                <WhatsAppBrandFilledMark className="h-8 w-8 text-white sm:h-9 sm:w-9" />
              ) : (
                <LaloWebsiteWhatsAppBubbleIcon />
              )}
            </WhatsAppGreenTile>
            <div className="min-w-0 flex-1">
              <p className="text-[1.05rem] font-bold leading-tight tracking-tight text-white sm:text-lg">
                {isStarting ? 'Preparing WhatsApp...' : buttonLabel}
              </p>
              <p className="mt-1.5 text-sm font-medium leading-snug text-white/75 sm:text-[0.9375rem]">
                {description}
              </p>
            </div>
          </div>
        </button>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: purpleSoft, color: purple }}
                >
                  <MessageCircle size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-stone-900">{title}</h4>
                  {idleBadge ? (
                    <span
                      className="mt-1 inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-widest"
                      style={{ backgroundColor: purpleSoft, color: purple }}
                    >
                      {idleBadge}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-stone-500">{description}</p>
              {currentWhatsAppNumber ? (
                <p className="text-[11px] text-stone-400">
                  Current WhatsApp login: <span className="font-semibold text-stone-700">{currentWhatsAppNumber}</span>
                </p>
              ) : null}
              {helperText ? <p className="text-[11px] text-stone-400">{helperText}</p> : null}
            </div>
          </div>

          <button
            type="button"
            onClick={handleStart}
            disabled={isStarting}
            className="w-full rounded-2xl py-3 text-sm font-bold text-white shadow-lg disabled:opacity-60"
            style={{
              backgroundColor: purple,
              boxShadow: `0 10px 15px -3px color-mix(in srgb, ${purple} 35%, transparent)`,
            }}
          >
            {isStarting ? 'Preparing WhatsApp...' : buttonLabel}
          </button>
        </>
      )}

      {error ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600">{error}</div>
      ) : null}

      <AnimatePresence>
        {showVerifyScreen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lv-verify-overlay-gradient fixed inset-0 z-[220] flex flex-col items-center justify-center p-6 text-white backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="flex w-full max-w-sm flex-col items-center space-y-6 text-center"
            >
              <div className="relative">
                <div
                  className="absolute inset-[-26px] rounded-full blur-2xl"
                  style={{ backgroundColor: purpleSoft }}
                />
                {overlayVisualPhase === 'verified' ? (
                  <div
                    className="h-20 w-20 rounded-full border shadow-[0_0_50px_rgba(124,58,237,0.35)]"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--lv-brand-primary, #6B4DA3) 15%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--lv-brand-primary, #6B4DA3) 30%, transparent)',
                    }}
                  />
                ) : (
                  <div className="relative">
                    <div className="absolute inset-0 scale-[1.32] rounded-full border border-white/10" />
                    <RefreshCw
                      size={64}
                      className="animate-spin drop-shadow-[0_0_20px_rgba(139,92,246,0.55)]"
                      style={{ color: purple }}
                    />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-xl shadow-black/20 ring-1 ring-white/70">
                    <Shield size={18} style={{ color: purple }} strokeWidth={2.2} />
                    <div
                      className="absolute -bottom-0.5 -right-0.5 flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-full text-white shadow-md"
                      style={{ backgroundColor: purple }}
                    >
                      <Check size={10} strokeWidth={3} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="max-w-[18rem] space-y-2">
                <h3 className="text-[2rem] font-bold leading-none tracking-tight">{verifyTitle}</h3>
                <p className="text-sm leading-relaxed text-white/[0.68]">{verifyDescription}</p>
              </div>

              {sessionState?.status.expiresAt && overlayVisualPhase !== 'verified' ? (
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">
                  Expires at {new Date(sessionState.status.expiresAt).toLocaleTimeString()}
                </p>
              ) : null}

              {sessionState && (verifyPhase === 'handoff' || verifyPhase === 'waiting' || verifyPhase === 'verified') ? (
                <div className="w-full max-w-[19rem] space-y-3">
                  {hasDeepLink && verifyPhase === 'handoff' ? (
                    <button type="button" onClick={handleOpenWhatsApp} className="lv-overlay-white-cta">
                      Send message to Lalo Verify using WhatsApp
                    </button>
                  ) : null}

                  {!hasDeepLink ? (
                    <div className="flex items-start justify-between gap-3 rounded-2xl border border-white/15 bg-white/10 p-3.5 text-left backdrop-blur-sm">
                      <code className="break-all text-[11px] leading-relaxed text-white/90">
                        {sessionState.startData.whatsapp_login_message}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyMessage}
                        className="flex shrink-0 items-center gap-1 text-xs font-bold text-white"
                      >
                        <Copy size={14} />
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ) : null}

                  {verifyPhase === 'handoff' ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-xs text-white/60 backdrop-blur-sm">
                      This opens WhatsApp with your Lalo Verify message already filled in.
                    </div>
                  ) : null}

                  {verifyPhase === 'waiting' ||
                  (verifyPhase === 'verified' && (awaitingHostOnCompleted || isBridgingSession)) ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-xs text-white/60 backdrop-blur-sm">
                      {verifyPhase === 'verified' && (awaitingHostOnCompleted || isBridgingSession)
                        ? 'Finishing sign-in in this app...'
                        : isPolling
                          ? 'Waiting for your WhatsApp message and checking automatically...'
                          : 'Waiting for your WhatsApp message...'}
                    </div>
                  ) : null}

                  {completionFollowUpError ? (
                    <div className="rounded-2xl border border-red-300/40 bg-red-500/25 px-4 py-3 text-left text-sm text-white">
                      {completionFollowUpError}
                    </div>
                  ) : null}

                  {verifyPhase === 'verified' && !isBridgingSession && !awaitingHostOnCompleted && completionFollowUpError ? (
                    <button type="button" onClick={clearFlowState} className="lv-overlay-white-cta">
                      Close
                    </button>
                  ) : null}

                  {verifyPhase === 'verified' && !isBridgingSession && !awaitingHostOnCompleted && !onCompleted ? (
                    <button type="button" onClick={clearFlowState} className="lv-overlay-white-cta">
                      Done
                    </button>
                  ) : null}

                  {verifyPhase === 'verified' && sessionState.status.status === 'completed' && sessionState.status.waId ? (
                    <p className="text-xs text-white/50">Verified number: {sessionState.status.waId}</p>
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
