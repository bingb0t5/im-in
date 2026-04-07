import { FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '../ui/Button';

type ProfileNamePromptModalProps = {
  open: boolean;
  value: string;
  loading?: boolean;
  title?: string;
  description: string;
  submitLabel?: string;
  closeLabel?: string;
  canClose?: boolean;
  error?: string | null;
  helperText?: string | null;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose?: () => void;
};

export function ProfileNamePromptModal({
  open,
  value,
  loading = false,
  title = 'Add your name',
  description,
  submitLabel = 'Save name',
  closeLabel = 'Not now',
  canClose = true,
  error,
  helperText,
  onChange,
  onSubmit,
  onClose,
}: ProfileNamePromptModalProps) {
  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={canClose ? onClose : undefined}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl overflow-y-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto"
          >
            <h2 className="mb-2 text-xl font-black tracking-tight text-slate-900">{title}</h2>
            <p className="mb-6 text-sm font-medium text-slate-500">{description}</p>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Your name</label>
                <input
                  required
                  autoFocus
                  type="text"
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder="Your name"
                  className="ui-input"
                />
                {helperText ? <p className="mt-2 text-xs text-slate-500">{helperText}</p> : null}
              </div>
              {error ? <p className="ui-feedback ui-feedback-error">{error}</p> : null}
              <div className="flex w-full flex-col gap-3 pt-2 sm:flex-row sm:flex-nowrap">
                {canClose ? (
                  <Button
                    type="button"
                    fullWidth={false}
                    className="w-full min-w-0 sm:flex-1"
                    onClick={onClose}
                    variant="secondary"
                  >
                    {closeLabel}
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  loading={loading}
                  fullWidth={false}
                  className="w-full min-w-0 sm:flex-1"
                >
                  {submitLabel}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
