import { useEffect, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { CircleHelp, Compass, FileText, LayoutDashboard, LogIn, LogOut, Menu, MessageSquarePlus, PlusCircle, Shield, UserPlus, UserRoundCog, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { clearAllLaloStateForSignOut } from '../integrations/lalo/laloAuth';
import { canAccessAnyAdminFrontend } from '../lib/admin';
import { guestService } from '../services/guestService';

type MainMenuButtonProps = {
  user: User | null;
};

export function MainMenuButton({ user }: MainMenuButtonProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasRememberedGuest, setHasRememberedGuest] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canAccessAdminPanel = !!user && canAccessAnyAdminFrontend(user.email);

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

  useEffect(() => {
    if (user) {
      setHasRememberedGuest(false);
      return;
    }

    let cancelled = false;
    void guestService.getStoredGuestSession().then((session) => {
      if (!cancelled) {
        setHasRememberedGuest(!!session);
      }
    }).catch(() => {
      if (!cancelled) {
        setHasRememberedGuest(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id, location.pathname, location.search, menuOpen]);

  const handleMenuNavigate = (to: string) => {
    setMenuOpen(false);
    navigate(to);
  };

  const handleMenuAction = (action: string) => {
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('action', action);
    setMenuOpen(false);
    navigate({
      pathname: location.pathname,
      search: `?${nextParams.toString()}`,
    });
  };

  const handleMenuSignOut = async () => {
    setMenuOpen(false);
    await supabase.auth.signOut();
    clearAllLaloStateForSignOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setMenuOpen((open) => !open)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-[1.15rem] border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-brand-700"
      >
        {menuOpen ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
      </button>
      {menuOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[calc(100vw-3rem)] max-w-[calc(100vw-3rem)] overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.16)] sm:w-[320px] sm:max-w-[320px]">
          {!user ? (
            <button
              type="button"
              onClick={() => handleMenuNavigate('/login')}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <LogIn className="h-4.5 w-4.5 shrink-0 text-brand-600" />
              Sign In
            </button>
          ) : null}
          {!user && hasRememberedGuest ? (
            <button
              type="button"
              onClick={() => handleMenuNavigate('/bookings')}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <UserRoundCog className="h-4.5 w-4.5 shrink-0 text-brand-600" />
              Guest Activities On This Device
            </button>
          ) : null}
          {!user ? <div className="my-1 h-px bg-slate-100" /> : null}
          <button
            type="button"
            onClick={() => handleMenuNavigate('/create-event')}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <PlusCircle className="h-4.5 w-4.5 shrink-0 text-brand-600" />
            Create Activity
          </button>
          <button
            type="button"
            onClick={() => handleMenuNavigate('/explore')}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Compass className="h-4.5 w-4.5 shrink-0 text-brand-600" />
            Explore Activities
          </button>
          <div className="my-1 h-px bg-slate-100" />
          {!user ? (
            <button
              type="button"
              onClick={() => handleMenuNavigate('/login?create=true')}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <UserPlus className="h-4.5 w-4.5 shrink-0 text-brand-600" />
              Create Account
            </button>
          ) : null}
          {!user ? <div className="my-1 h-px bg-slate-100" /> : null}
          <button
            type="button"
            onClick={() => handleMenuNavigate('/?action=why')}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <CircleHelp className="h-4.5 w-4.5 shrink-0 text-brand-600" />
            Why <span className="italic">I&apos;m In</span> Exists
          </button>
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            onClick={() => handleMenuNavigate('/?action=build')}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <UserRoundCog className="h-4.5 w-4.5 shrink-0 text-brand-600" />
            Help Build <span className="italic">I&apos;m In</span>
          </button>
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            onClick={() => handleMenuAction('moderation')}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Shield className="h-4.5 w-4.5 shrink-0 text-brand-600" />
            Moderation Transparency
          </button>
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            onClick={() => handleMenuNavigate('/changelog')}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FileText className="h-4.5 w-4.5 shrink-0 text-brand-600" />
            App Updates and Changelog
          </button>
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            onClick={() => handleMenuNavigate('/?action=feedback')}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <MessageSquarePlus className="h-4.5 w-4.5 shrink-0 text-brand-600" />
            Send feedback
          </button>
          {canAccessAdminPanel ? <div className="my-1 h-px bg-slate-100" /> : null}
          {canAccessAdminPanel ? (
            <button
              type="button"
              onClick={() => handleMenuNavigate('/admin')}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <LayoutDashboard className="h-4.5 w-4.5 shrink-0 text-brand-600" />
              Admin Panel
            </button>
          ) : null}
          {user ? (
            <>
              <div className="my-1 h-px bg-slate-100" />
              <button
                type="button"
                onClick={() => void handleMenuSignOut()}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <LogOut className="h-4.5 w-4.5 shrink-0 text-brand-600" />
                Sign out
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
