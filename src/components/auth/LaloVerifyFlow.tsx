import { type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { LaloAuthHeader } from './LaloAuthHeader';

type LaloVerifyFlowProps = {
  children: ReactNode;
  showHero?: boolean;
};

export function LaloVerifyFlow({ children, showHero = true }: LaloVerifyFlowProps) {
  return (
    <div className="page-tint relative min-h-screen overflow-hidden">
      <div className="login-hero-glow pointer-events-none absolute left-1/2 top-[18%] h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 opacity-90" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[38rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.44),transparent)]" />

      <div className="relative min-h-screen px-4 py-5 sm:px-6">
        <LaloAuthHeader />

        {showHero ? (
          <div className="mx-auto flex min-h-[calc(100svh-6.5rem)] max-w-5xl items-center justify-center">
            <div className="w-full max-w-xl text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[2rem] border border-white/70 bg-white/78 shadow-[0_18px_46px_rgba(107,77,163,0.14)] backdrop-blur-xl">
                <ShieldCheck className="h-11 w-11 text-[var(--lalo-primary)]" strokeWidth={1.8} />
              </div>
              <p className="mt-6 text-[11px] font-black uppercase tracking-[0.34em] text-[var(--lalo-primary)]/70">Secure verification</p>
              <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--lalo-text-dark)] sm:text-5xl">WhatsApp verification</h1>
              <p className="mx-auto mt-3 max-w-md text-sm font-medium leading-6 text-slate-600 sm:text-[15px]">
                Confirm your WhatsApp account to continue securely with I&apos;m In.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {children}
    </div>
  );
}
