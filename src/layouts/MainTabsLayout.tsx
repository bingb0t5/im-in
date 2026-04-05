import { User } from '@supabase/supabase-js';
import { Outlet, useLocation } from 'react-router-dom';
import { AppBottomNav } from '../components/AppBottomNav';
import { AppTopBar } from '../components/AppTopBar';

type MainTabsLayoutProps = {
  user: User | null;
};

export function MainTabsLayout({ user }: MainTabsLayoutProps) {
  const location = useLocation();
  const isLogin = location.pathname === '/login';
  const showTopBar = !isLogin;
  /** Home and Explore share the same fixed header (logo + tagline + search); needs enough offset so first content (e.g. day headings) is not covered. */
  const hasHeaderSearch = location.pathname === '/' || location.pathname === '/explore' || location.pathname === '/calendar';

  const topPadding = showTopBar ? (hasHeaderSearch ? 'pt-34' : 'pt-16') : 'pt-4';

  return (
    <div className={`min-h-screen bg-slate-50 pb-24 ${topPadding}`}>
      {showTopBar ? <AppTopBar user={user} /> : null}
      <Outlet />
      <AppBottomNav user={user} />
    </div>
  );
}
