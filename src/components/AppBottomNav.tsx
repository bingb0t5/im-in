import { Home, Compass, PlusSquare, CalendarCheck2, UserCircle2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { cn } from '../utils';

type AppBottomNavProps = {
  user: User | null;
};

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/create-event', label: 'Create', icon: PlusSquare },
];

export function AppBottomNav({ user }: AppBottomNavProps) {
  const accountItems = [
    { to: user ? '/my-activities' : '/login', label: 'My Activities', icon: CalendarCheck2 },
    { to: user ? '/profile' : '/login', label: 'Profile', icon: UserCircle2 },
  ];

  const items = [...navItems, ...accountItems];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl items-stretch justify-between px-3 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] font-bold transition-colors',
                  isActive ? 'text-brand-700' : 'text-slate-400 hover:text-slate-600',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-2xl transition-colors',
                      isActive ? 'bg-brand-50 text-brand-700' : 'bg-transparent',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="truncate text-center leading-tight">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
