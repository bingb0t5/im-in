import { User } from '@supabase/supabase-js';
import { Outlet, useLocation } from 'react-router-dom';
import { AppBottomNav } from '../components/AppBottomNav';
import { AppTopBar } from '../components/AppTopBar';

type MainTabsLayoutProps = {
  user: User | null;
};

export function MainTabsLayout({ user }: MainTabsLayoutProps) {
  const location = useLocation();
  const showTopBar = !location.pathname.startsWith('/create-event');

  return (
    <div className={`min-h-screen bg-slate-50 pb-24 ${showTopBar ? 'pt-16' : ''}`}>
      {showTopBar ? <AppTopBar user={user} /> : null}
      <Outlet />
      <AppBottomNav user={user} />
    </div>
  );
}
