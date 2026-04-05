import { User } from '@supabase/supabase-js';
import { Outlet, useLocation } from 'react-router-dom';
import { AppBottomNav } from '../components/AppBottomNav';
import { AppTopBar } from '../components/AppTopBar';

type MainTabsLayoutProps = {
  user: User | null;
};

export function MainTabsLayout({ user }: MainTabsLayoutProps) {
  const location = useLocation();
  const showTopBar = true;
  const hasHeaderSearch = location.pathname === '/' || location.pathname === '/explore' || location.pathname === '/calendar';
  const homeHasSubtitle = location.pathname === '/';

  return (
    <div className={`min-h-screen bg-slate-50 pb-24 ${showTopBar ? (hasHeaderSearch ? (homeHasSubtitle ? 'pt-32' : 'pt-28') : 'pt-16') : ''}`}>
      {showTopBar ? <AppTopBar user={user} /> : null}
      <Outlet />
      <AppBottomNav user={user} />
    </div>
  );
}
