import { User } from '@supabase/supabase-js';
import { Outlet, useLocation } from 'react-router-dom';
import { AppBottomNav } from '../components/AppBottomNav';
import { AppTopBar } from '../components/AppTopBar';
import { hasMainTabsSearchHeader, showsMainTabsTopBar } from '../lib/mainTabsRoutes';

type MainTabsLayoutProps = {
  user: User | null;
};

export function MainTabsLayout({ user }: MainTabsLayoutProps) {
  const location = useLocation();
  const showTopBar = showsMainTabsTopBar(location.pathname);
  const showBottomNav = !!user;

  const bottomPadding = showBottomNav ? 'pb-24' : 'pb-8';

  return (
    <div
      className={`min-h-screen bg-slate-50 ${bottomPadding}`}
      style={{ paddingTop: showTopBar ? 'var(--app-topbar-height, 4rem)' : '1rem' }}
    >
      {showTopBar ? <AppTopBar user={user} /> : null}
      <Outlet />
      {showBottomNav ? <AppBottomNav user={user} /> : null}
    </div>
  );
}
