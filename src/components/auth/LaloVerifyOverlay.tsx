import { Check, ChevronLeft, MessageCircle, ShieldCheck } from 'lucide-react';
import { type ReactNode } from 'react';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { cn } from '../../utils';

export type LaloVerifyPhase = 'idle' | 'connecting' | 'generating' | 'handoff' | 'waiting' | 'verified';

type OverlayAction = {
  label: string;
  onClick: () => void;
  loading?: boolean;
  icon?: ReactNode;
};

type SecondaryAction = {
  label: string;
  onClick: () => void;
};

type LaloVerifyOverlayProps = {
  phase: LaloVerifyPhase;
  title?: string;
  description?: string;
  expiresAt?: string | null;
  verifiedNumber?: string | null;
  primaryAction?: OverlayAction;
  helperCard?: string | null;
  secondaryAction?: SecondaryAction;
  footerAction?: SecondaryAction;
  error?: string | null;
  detailCard?: ReactNode;
};

const phaseDescriptions: Record<LaloVerifyPhase, string> = {
  idle: 'Preparing WhatsApp verification',
  connecting: 'Connecting to secure WhatsApp verification',
  generating: 'Generating WhatsApp code',
  handoff:
    'We are ready to open WhatsApp in a separate tab. Please send the prefilled message, then return to this screen.',
  waiting: 'Return to this screen after sending the message. Verification will continue automatically.',
  verified: 'Finalising your sign-in...',
};

function formatExpiry(expiresAt?: string | null) {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function LaloVerifyOverlay({
  phase,
  title,
  description,
  expiresAt,
  verifiedNumber,
  primaryAction,
  helperCard,
  secondaryAction,
  footerAction,
  error,
  detailCard,
}: LaloVerifyOverlayProps) {
  const isVerified = phase === 'verified';
  const expiryLabel = formatExpiry(expiresAt);
  const resolvedTitle = title || (isVerified ? 'WhatsApp verified' : 'Verifying your WhatsApp');
  const resolvedDescription = description || phaseDescriptions[phase];

  return (
    <div className="fixed inset-0 z-50">
      <div className="verify-overlay-gradient absolute inset-0 backdrop-blur-xl" />

      <div className="relative flex min-h-screen items-center justify-center px-5 py-8 sm:px-6">
        <div className="w-full max-w-md">
          <div className="rounded-[2rem] border border-white/12 bg-white/8 p-6 text-center text-white shadow-[0_30px_90px_rgba(9,8,15,0.34)] backdrop-blur-2xl sm:p-8">
            <div className="relative mx-auto mb-6 flex h-28 w-28 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.48)_0%,rgba(139,92,246,0.22)_38%,rgba(139,92,246,0)_72%)] blur-sm" />
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-white/14 bg-white/8 shadow-[0_0_50px_rgba(139,92,246,0.32)]">
                {isVerified ? (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[var(--lalo-primary)] shadow-[0_10px_30px_rgba(255,255,255,0.24)]">
                    <Check className="h-8 w-8" />
                  </div>
                ) : (
                  <>
                    <ShieldCheck className="h-12 w-12 text-white" strokeWidth={1.75} />
                    {phase !== 'handoff' ? (
                      <LoadingSpinner className="absolute -right-1 top-3 h-5 w-5 border-[3px] text-white/90" />
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {expiryLabel ? (
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.28em] text-white/58">Expires at {expiryLabel}</p>
            ) : null}

            <h1 className="text-3xl font-black tracking-tight sm:text-[2.15rem]">{resolvedTitle}</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm font-medium leading-6 text-white/72 sm:text-[15px]">{resolvedDescription}</p>

            {verifiedNumber ? (
              <div className="mt-5 rounded-[1.35rem] border border-white/12 bg-white/10 px-4 py-3 text-left text-sm text-white/82">
                <span className="block text-[10px] font-black uppercase tracking-[0.24em] text-white/45">Verified number</span>
                <span className="mt-1 block font-semibold text-white">{verifiedNumber}</span>
              </div>
            ) : null}

            {detailCard ? <div className="mt-5">{detailCard}</div> : null}

            {error ? (
              <div className="mt-5 rounded-[1.35rem] border border-red-300/28 bg-red-400/12 px-4 py-3 text-left text-sm font-medium text-red-100">
                {error}
              </div>
            ) : null}

            {primaryAction ? (
              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.loading}
                className="mt-6 flex w-full items-center justify-center gap-3 rounded-[1.6rem] bg-white px-5 py-4 text-center text-sm font-black text-[var(--lalo-text-dark)] shadow-[0_16px_34px_rgba(255,255,255,0.12)] transition-transform duration-150 hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {primaryAction.loading ? (
                  <LoadingSpinner className="h-4 w-4 text-[var(--lalo-primary)]" />
                ) : (
                  primaryAction.icon || <MessageCircle className="h-4 w-4" />
                )}
                <span>{primaryAction.label}</span>
              </button>
            ) : null}

            {helperCard ? (
              <div className="mt-4 rounded-[1.35rem] border border-white/12 bg-white/8 px-4 py-3 text-left text-sm font-medium leading-6 text-white/70">
                {helperCard}
              </div>
            ) : null}

            {secondaryAction ? (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="mt-4 inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-white/76 transition-colors hover:text-white"
              >
                {secondaryAction.label}
              </button>
            ) : null}

            {footerAction ? (
              <button
                type="button"
                onClick={footerAction.onClick}
                className={cn(
                  'mt-5 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  footerAction.label.toLowerCase().includes('back') ? 'text-white/72 hover:text-white' : 'text-white/76 hover:text-white',
                )}
              >
                {footerAction.label.toLowerCase().includes('back') ? <ChevronLeft className="h-4 w-4" /> : null}
                <span>{footerAction.label}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
