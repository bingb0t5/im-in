import { Mail, MessageCircle, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { isLaloWhatsAppAuthEnabled } from '../integrations/lalo/laloAuth';

type AuthPromptModalProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  /**
   * Path (+ query) to return to after sign-in (WhatsApp or email magic link).
   * Defaults to the current location when omitted.
   */
  postAuthRedirect?: string;
};

function buildLoginUrl(path: string, opts: { withEmail?: boolean }) {
  const params = new URLSearchParams();
  params.set('from', path);
  if (opts.withEmail) {
    params.set('withEmail', '1');
  }
  return `/login?${params.toString()}`;
}

export function AuthPromptModal({ open, title, message, onClose, postAuthRedirect }: AuthPromptModalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const laloEnabled = isLaloWhatsAppAuthEnabled();
  const returnPath =
    postAuthRedirect != null && postAuthRedirect.startsWith('/') && !postAuthRedirect.startsWith('//')
      ? postAuthRedirect
      : `${location.pathname}${location.search}`;

  useBodyScrollLock(open);

  if (!open) return null;

  const goWhatsApp = () => {
    navigate(buildLoginUrl(returnPath, {}));
  };

  const goEmail = () => {
    navigate(buildLoginUrl(returnPath, { withEmail: true }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close sign in prompt"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="ui-eyebrow">Sign in</p>
            <h2 className="text-2xl font-black tracking-tight text-slate-900">{title}</h2>
            <p className="text-sm leading-relaxed text-slate-500">{message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-slate-300 transition-colors hover:bg-slate-50 hover:text-slate-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {laloEnabled ? (
            <>
              <button
                type="button"
                onClick={goWhatsApp}
                className="btn-primary-action block w-full p-4 text-left sm:p-5"
              >
                <span className="flex items-center gap-4">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.15rem] bg-[#25D366] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] sm:h-16 sm:w-16 sm:rounded-[1.35rem]">
                    <MessageCircle className="h-7 w-7 text-white sm:h-8 sm:w-8" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-lg font-black tracking-tight text-white sm:text-xl">Continue with WhatsApp</span>
                    <span className="mt-0.5 block text-sm font-medium text-white/70">Powered by Lalo Verify</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={goEmail}
                className="block w-full max-w-none rounded-[2rem] border border-slate-200/90 bg-white px-4 py-4 text-left shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition-transform duration-150 hover:-translate-y-0.5 sm:px-5 sm:py-4"
              >
                <span className="flex items-center gap-4">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.15rem] border border-brand-100/80 bg-brand-50 text-brand-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                    <Mail className="h-6 w-6" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-lg font-black tracking-tight text-slate-900">Continue with email</span>
                    <span className="mt-0.5 block text-sm font-medium text-slate-500">Magic link sign-in</span>
                  </span>
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={goEmail}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand-600 bg-brand-600 px-4 text-sm font-bold text-white transition-all hover:border-brand-500 hover:bg-brand-500"
            >
              Sign in
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
