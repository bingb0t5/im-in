import { User } from '@supabase/supabase-js';
import { UserCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

type AppTopBarProps = {
  user: User | null;
};

export function AppTopBar({ user }: AppTopBarProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
        <Link to="/" className="transition-opacity hover:opacity-80">
          <img
            src="/im-in-svg-logo-size.svg"
            alt="I'm In"
            className="h-7 w-auto"
          />
        </Link>
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
