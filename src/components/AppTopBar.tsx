import { FormEvent, useEffect, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Menu, Search, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { cn } from '../utils';

type AppTopBarProps = {
  user: User | null;
};

export function AppTopBar({ user }: AppTopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isHome = location.pathname === '/';
  const isExplore = location.pathname === '/explore' || location.pathname === '/calendar';
  const showHeaderSearch = isHome || isExplore;
  const currentQuery = new URLSearchParams(location.search).get('q') || '';

  useEffect(() => {
    if (showHeaderSearch) {
      setSearchValue(currentQuery);
    }
  }, [showHeaderSearch, currentQuery, location.pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [menuOpen]);

  const getTitle = () => {
    if (location.pathname === '/') return 'Home';
    if (location.pathname === '/explore' || location.pathname === '/calendar') return 'Public Activities';
    if (location.pathname === '/my-activities') return 'My Activities';
    if (location.pathname === '/profile') return 'Profile';
    if (location.pathname === '/login') return 'Sign In';
    return '';
  };

  const title = getTitle();
  const searchPlaceholder = isExplore ? 'Search public activities' : 'Search activities';

  const handleHeaderSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchValue.trim();
    navigate(query ? `/explore?q=${encodeURIComponent(query)}` : '/explore');
  };

  const handleHeaderSearchChange = (value: string) => {
    setSearchValue(value);
    if (!isExplore && !isHome) return;
    const query = value.trim();
    navigate(query ? `/explore?q=${encodeURIComponent(query)}` : '/explore', { replace: isExplore });
  };

  const handleMenuNavigate = (to: string) => {
    setMenuOpen(false);
    navigate(to);
  };

  const handleMenuSignOut = async () => {
    setMenuOpen(false);
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className={cn('mx-auto max-w-2xl px-6', showHeaderSearch ? 'pt-1.5 pb-2' : '')}>
        <div className={cn('relative flex items-center justify-between', showHeaderSearch ? 'h-12' : 'h-16')}>
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
              ) : title === 'My Activities' ? (
                <span className="text-center text-[10px] font-bold uppercase leading-tight tracking-[0.22em] text-slate-400">
                  My
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
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-brand-700"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[250px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                {!user ? (
                  <button
                    type="button"
                    onClick={() => handleMenuNavigate('/login')}
                    className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Sign In
                  </button>
                ) : null}
                {!user ? (
                  <button
                    type="button"
                    onClick={() => handleMenuNavigate('/login?create=true')}
                    className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Create Account
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleMenuNavigate('/?action=why')}
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Why <span className="mx-1 italic">I&apos;m In</span> Exists
                </button>
                <button
                  type="button"
                  onClick={() => handleMenuNavigate('/?action=build')}
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Help Build <span className="mx-1 italic">I&apos;m In</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMenuNavigate('/moderation')}
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Moderation Transparency
                </button>
                <button
                  type="button"
                  onClick={() => handleMenuNavigate('/?action=feedback')}
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Send feedback
                </button>
                {user ? (
                  <>
                    <div className="my-1 h-px bg-slate-100" />
                    <button
                      type="button"
                      onClick={() => void handleMenuSignOut()}
                      className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Sign out
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {showHeaderSearch ? (
          <div className="mt-0 space-y-0">
            {isHome ? (
              <p className="-mt-1 text-center text-sm font-semibold leading-tight text-slate-500">
                See what&apos;s on. Say <span className="italic">I&apos;m In.</span>
              </p>
            ) : null}
            <form onSubmit={handleHeaderSearchSubmit} className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-300" />
              <input
                type="text"
                value={searchValue}
                onChange={(event) => handleHeaderSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="ui-input rounded-2xl border-slate-200 bg-white py-2 pl-12 pr-4 shadow-sm"
              />
            </form>
          </div>
        ) : null}
      </div>
    </header>
  );
}
