import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';

type AuthPromptModalProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
};

export function AuthPromptModal({ open, title, message, onClose }: AuthPromptModalProps) {
  const navigate = useNavigate();
  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close sign in prompt"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-sm rounded-[2rem] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="ui-eyebrow">Sign in</p>
            <h2 className="text-2xl font-black tracking-tight text-slate-900">{title}</h2>
            <p className="text-sm leading-relaxed text-slate-500">{message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-300 transition-colors hover:bg-slate-50 hover:text-slate-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand-600 bg-brand-600 px-4 text-sm font-bold text-white transition-all hover:border-brand-500 hover:bg-brand-500"
          >
            Sign in
          </button>
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
