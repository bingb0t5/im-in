import { ReactNode } from 'react';
import { Card } from './Card';
import { LoadingSpinner } from './LoadingSpinner';
import { cn } from '../../utils';

type StateScreenProps = {
  badge?: string;
  title: string;
  subtitle?: string;
  helper?: string;
  status?: 'loading' | 'success' | 'error' | 'neutral';
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function StateScreen({
  actions,
  badge,
  className,
  helper,
  icon,
  status = 'neutral',
  subtitle,
  title,
}: StateScreenProps) {
  const defaultIcon =
    status === 'loading' ? (
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <LoadingSpinner className="h-6 w-6" />
      </div>
    ) : (
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-2xl text-sm font-black',
          status === 'success' && 'bg-brand-50 text-brand-700',
          status === 'error' && 'bg-red-50 text-red-600',
          status === 'neutral' && 'bg-slate-100 text-slate-500',
        )}
      >
        {status === 'success' ? 'OK' : status === 'error' ? '!' : '...'}
      </div>
    );

  return (
    <div className={cn('ui-page-shell py-10', className)}>
      <Card className="mx-auto max-w-md text-center">
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex justify-center">{icon || defaultIcon}</div>
            <div className="space-y-3">
              {badge ? <p className="ui-eyebrow">{badge}</p> : null}
              <div className="space-y-2">
                <h1 className="text-3xl font-black tracking-tight text-slate-900">{title}</h1>
                {subtitle ? <p className="text-base font-medium text-slate-600">{subtitle}</p> : null}
              </div>
              {helper ? <p className="text-sm leading-relaxed text-slate-500">{helper}</p> : null}
            </div>
          </div>
          {actions ? <div className="space-y-3">{actions}</div> : null}
        </div>
      </Card>
    </div>
  );
}
