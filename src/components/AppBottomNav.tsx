import { Home, Compass, CalendarCheck2, UserCircle2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { cn } from '../utils';

type AppBottomNavProps = {
  user: User | null;
};

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/create-event', label: 'Create', isCreate: true },
];

export function AppBottomNav({ user }: AppBottomNavProps) {
  const accountItems = [
    { to: user ? '/my-activities' : '/my-activities?signin=true', label: 'My Activities', icon: CalendarCheck2 },
    { to: user ? '/profile' : '/profile?signin=true', label: 'Profile', icon: UserCircle2 },
  ];

  const items = [...navItems, ...accountItems];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl items-stretch justify-between px-3 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isCreateItem = !!item.isCreate;
          return (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] font-bold transition-colors',
                  isCreateItem
                    ? 'text-slate-500'
                    : isActive
                      ? 'text-brand-700'
                      : 'text-slate-400 hover:text-slate-600',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isCreateItem ? (
                    <div
                      className={cn(
                        'relative -mt-5 flex h-14 w-14 items-center justify-center rounded-2xl shadow-[0_10px_24px_rgba(13,148,136,0.38)] ring-1 ring-white/80 transition-all',
                        isActive
                          ? 'scale-[1.03] bg-gradient-to-br from-teal-300 via-brand-600 to-teal-700'
                          : 'bg-gradient-to-br from-teal-300/95 via-brand-500 to-teal-700',
                      )}
                    >
                      <span className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/30 via-white/10 to-transparent" />
                      <span
                        className="relative h-9 w-9 bg-white"
                        style={{
                          WebkitMaskImage: 'url(/im-in-svg-logo-icon_plus.svg)',
                          maskImage: 'url(/im-in-svg-logo-icon_plus.svg)',
                          WebkitMaskRepeat: 'no-repeat',
                          maskRepeat: 'no-repeat',
                          WebkitMaskPosition: 'center',
                          maskPosition: 'center',
                          WebkitMaskSize: 'contain',
                          maskSize: 'contain',
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-2xl transition-colors',
                        isActive ? 'bg-brand-50 text-brand-700' : 'bg-transparent',
                      )}
                    >
                      {Icon ? <Icon className="h-5 w-5" /> : null}
                    </div>
                  )}
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
