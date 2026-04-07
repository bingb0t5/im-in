import { Lock } from 'lucide-react';

export function LaloAuthHeader() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-full border border-white/55 bg-[rgba(233,226,245,0.72)] px-4 py-3 shadow-[0_18px_48px_rgba(107,77,163,0.12)] backdrop-blur-xl sm:px-6">
      <div className="flex items-center gap-3">
        <span className="text-lg font-black tracking-tight text-[var(--lalo-primary)] sm:text-xl">I&apos;m In</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--lalo-accent-lavender)] px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-[var(--lalo-primary)]">
          <Lock className="h-3.5 w-3.5" />
          WhatsApp verification
        </span>
      </div>
      <span className="text-xs font-semibold text-[var(--lalo-primary)]/70">Secure sign-in</span>
    </header>
  );
}
