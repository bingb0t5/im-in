import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils';
import { LoadingSpinner } from './LoadingSpinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

type ButtonClassOptions = {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string;
};

export function buttonClasses({
  variant = 'primary',
  fullWidth = true,
  className,
}: ButtonClassOptions = {}) {
  return cn(
    'inline-flex h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/10',
    'disabled:pointer-events-none disabled:opacity-60',
    'active:scale-[0.99]',
    fullWidth && 'w-full',
    variant === 'primary' &&
      'border-brand-600 bg-brand-600 text-white hover:bg-brand-500 hover:border-brand-500 active:bg-brand-700 active:border-brand-700',
    variant === 'secondary' &&
      'border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 active:bg-brand-100',
    variant === 'ghost' &&
      'border-transparent bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700',
    className,
  );
}

export function Button({
  children,
  className,
  disabled,
  fullWidth = true,
  leadingIcon,
  loading = false,
  trailingIcon,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? <LoadingSpinner className="h-4 w-4" /> : leadingIcon}
      <span>{children}</span>
      {!loading ? trailingIcon : null}
    </button>
  );
}
