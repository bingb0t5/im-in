import { User } from '@supabase/supabase-js';
import { UserCircle2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

type AppTopBarProps = {
  user: User | null;
};

export function AppTopBar({ user }: AppTopBarProps) {
  const location = useLocation();

  const getTitle = () => {
    if (location.pathname === '/') return 'Home';
    if (location.pathname === '/explore' || location.pathname === '/calendar') return 'Public Activities';
    if (location.pathname === '/my-activities') return 'My Activities';
    if (location.pathname === '/profile') return 'Profile';
    if (location.pathname === '/login') return 'Sign In';
    return '';
  };

  const title = getTitle();

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="relative mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
        <Link to="/" className="transition-opacity hover:opacity-80">
          <img
            src="/im-in-svg-logo-size.svg"
            alt="I'm In"
            className="h-12 w-auto max-w-[132px] object-contain object-left"
          />
        </Link>
        {title ? (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center">
            {title === 'Public Activities' ? (
              <span className="text-center text-[10px] font-bold uppercase leading-tight tracking-[0.22em] text-slate-400">
                Public
                <br />
                Activities
              </span>
            ) : (
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                {title}
              </span>
            )}
          </div>
        ) : null}
        <Link
          to={user ? '/profile' : '/login'}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-brand-700"
        >
          <UserCircle2 className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
