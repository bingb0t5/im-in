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
  /** Home and Explore share the same fixed header (logo + tagline + search); needs enough offset so first content (e.g. day headings) is not covered. */
  const hasHeaderSearch = hasMainTabsSearchHeader(location.pathname);
  const showBottomNav = !!user;

  const topPadding = showTopBar ? (hasHeaderSearch ? 'pt-34' : 'pt-16') : 'pt-4';
  const bottomPadding = showBottomNav ? 'pb-24' : 'pb-8';

  return (
    <div className={`min-h-screen bg-slate-50 ${bottomPadding} ${topPadding}`}>
      {showTopBar ? <AppTopBar user={user} /> : null}
      <Outlet />
      {showBottomNav ? <AppBottomNav user={user} /> : null}
    </div>
  );
}
