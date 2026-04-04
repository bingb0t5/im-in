import { User } from '@supabase/supabase-js';
import { Outlet } from 'react-router-dom';
import { AppBottomNav } from '../components/AppBottomNav';

type MainTabsLayoutProps = {
  user: User | null;
};

export function MainTabsLayout({ user }: MainTabsLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <Outlet />
      <AppBottomNav user={user} />
    </div>
  );
}
