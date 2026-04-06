import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';

type WhyVerifySheetProps = {
  open: boolean;
  onClose: () => void;
};

export function WhyVerifySheet({ open, onClose }: WhyVerifySheetProps) {
  useBodyScrollLock(open);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close why verify sheet"
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
        <p className="text-[10px] font-black uppercase tracking-widest text-brand-700">Why verify?</p>
        <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Keep activity access smoother</h3>
        <ul className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <li>- Saves access to activities under your account</li>
          <li>- Makes shared activity links easier to reopen later</li>
          <li>- Improves continuity across visits and devices</li>
        </ul>
        <div className="mt-4">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
