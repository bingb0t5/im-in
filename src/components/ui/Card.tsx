import { HTMLAttributes } from 'react';
import { cn } from '../../utils';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
};

export function Card({ children, className, padded = true, ...props }: CardProps) {
  return (
    <div
      className={cn('ui-card', padded && 'ui-card-padding', className)}
      {...props}
    >
      {children}
    </div>
  );
}
