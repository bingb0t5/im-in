import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';
import { RuntimeEnvironment, getAddToHomeScreenInstructions } from '../../utils/runtimeEnvironment';

type AddToHomeScreenHelpSheetProps = {
  open: boolean;
  env: RuntimeEnvironment;
  onClose: () => void;
};

export function AddToHomeScreenHelpSheet({ open, env, onClose }: AddToHomeScreenHelpSheetProps) {
  useBodyScrollLock(open);
  if (!open) return null;

  const steps = getAddToHomeScreenInstructions(env);
  const isDesktopBrowser = !env.isMobile;
  const eyebrow = isDesktopBrowser ? 'Install App' : 'Add to Home Screen';
  const title = isDesktopBrowser ? "Install I'm In" : "Open I'm In like an app";
  const intro = isDesktopBrowser
    ? "Follow these quick steps to install and reopen I'm In faster."
    : 'Follow these quick steps for a faster, smoother way to reopen activities.';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close add to home screen help"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-5 w-5" />
        </button>
        <p className="text-[10px] font-black uppercase tracking-widest text-brand-700">{eyebrow}</p>
        <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{intro}</p>

        <ol className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          {steps.map((step, idx) => (
            <li key={step} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-black text-slate-500">
                {idx + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-4">
          <Button variant="secondary" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
