import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { CircleHelp, LogIn, LogOut, Menu, MessageSquarePlus, Search, Shield, UserPlus, UserRoundCog, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { clearAllLaloStateForSignOut } from '../integrations/lalo/laloAuth';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { cn } from '../utils';
import { useNotifications } from '../hooks/useNotifications';
import { NotificationItem } from '../types';
import { NotificationBell } from './system/NotificationBell';
import { NotificationsSheet } from './system/NotificationsSheet';
import { NotificationDetailModal } from './system/NotificationDetailModal';

type AppTopBarProps = {
  user: User | null;
};

const REPLY_TO_HOST_ACTION = 'im-in://reply-to-host';

export function AppTopBar({ user }: AppTopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [replyNotification, setReplyNotification] = useState<NotificationItem | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyFeedback, setReplyFeedback] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    error: notificationsError,
    refresh: refreshNotifications,
    markRead,
    markAllRead,
  } = useNotifications(user);
  useBodyScrollLock(!!replyNotification);

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
    setNotificationsOpen(false);
    setSelectedNotification(null);
    setReplyNotification(null);
    setReplyMessage('');
    setReplyFeedback(null);
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
  const searchPlaceholder = "See what's on. Say I'm In.";

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const root = document.documentElement;
    const updateHeaderHeight = () => {
      root.style.setProperty('--app-topbar-height', `${header.offsetHeight}px`);
    };

    updateHeaderHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateHeaderHeight();
    });
    resizeObserver.observe(header);

    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, [showHeaderSearch, title, user]);

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

  const handleMenuAction = (action: string) => {
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('action', action);
    setMenuOpen(false);
    navigate({
      pathname: location.pathname,
      search: `?${nextParams.toString()}`,
    });
  };

  const handleOpenNotification = async (notification: NotificationItem) => {
    const readAt = notification.read_at || new Date().toISOString();
    if (!notification.read_at) {
      await markRead(notification.id);
    }
    setSelectedNotification({
      ...notification,
      read_at: readAt,
    });
  };

  const getReplyEventLabel = (notification: NotificationItem | null) => {
    if (!notification) return 'this activity';
    const eventTitle = notification.metadata?.event_title;
    if (typeof eventTitle === 'string' && eventTitle.trim()) {
      return eventTitle.trim();
    }
    return notification.title;
  };

  const handleSendReply = async () => {
    if (!replyNotification?.event_id) {
      setReplyFeedback('This notification is missing activity details.');
      return;
    }
    if (!replyMessage.trim()) {
      setReplyFeedback('Write a reply first.');
      return;
    }

    try {
      setReplySending(true);
      setReplyFeedback(null);
      const { data, error } = await supabase.rpc('reply_to_event_hosts', {
        p_event_id: replyNotification.event_id,
        p_message: replyMessage.trim(),
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
      const sentCount = Number(data?.sent_count || 0);
      setReplyFeedback(`Reply sent to ${sentCount} host${sentCount === 1 ? '' : 's'}.`);
      setReplyMessage('');
    } catch (error: any) {
      setReplyFeedback(error?.message || 'Could not send your reply right now.');
    } finally {
      setReplySending(false);
    }
  };

  const handleMenuSignOut = async () => {
    setMenuOpen(false);
    await supabase.auth.signOut();
    clearAllLaloStateForSignOut();
    navigate('/login', { replace: true });
  };

  return (
    <header ref={headerRef} className="fixed inset-x-0 top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className={cn('mx-auto max-w-2xl px-6', showHeaderSearch ? 'pt-1 pb-1.5' : '')}>
        <div className={cn('relative flex items-center justify-between', showHeaderSearch ? 'h-10' : 'h-14')}>
          <Link to="/" className="transition-opacity hover:opacity-80">
            <img
              src="/im-in-svg-logo-size.svg"
              alt="I'm In"
              className="h-9 w-auto max-w-[112px] object-contain object-left"
            />
          </Link>
          {title ? (
            <div className="pointer-events-none absolute inset-x-0 flex justify-center">
              {title === 'Public Activities' ? (
                <span className="text-center text-[10px] font-bold uppercase leading-tight tracking-[0.22em] text-brand-600">
                  Public
                  <br />
                  Activities
                </span>
              ) : title === 'My Activities' ? (
                <span className="text-center text-[10px] font-bold uppercase leading-tight tracking-[0.22em] text-brand-600">
                  My
                  <br />
                  Activities
                </span>
              ) : (
                <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-600">
                  {title}
                </span>
              )}
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            {user ? (
              <NotificationBell
                unreadCount={unreadCount}
                onClick={() => {
                  setNotificationsOpen(true);
                  void refreshNotifications();
                }}
              />
            ) : null}
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
                {!user ? <div className="my-1 h-px bg-slate-100" /> : null}
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
                  onClick={() => handleMenuNavigate('/?action=feedback')}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <MessageSquarePlus className="h-4.5 w-4.5 shrink-0 text-brand-600" />
                  Send feedback
                </button>
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
          </div>
        </div>
        {showHeaderSearch ? (
          <div className="mt-1.5">
            <form onSubmit={handleHeaderSearchSubmit} className="relative">
              <Search className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-300" />
              <input
                type="text"
                value={searchValue}
                onChange={(event) => handleHeaderSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="ui-input min-h-[2.7rem] rounded-2xl border-slate-200 bg-white py-1.5 pl-11 pr-4 text-sm shadow-sm"
              />
            </form>
          </div>
        ) : null}
      </div>
      <NotificationsSheet
        open={notificationsOpen}
        notifications={notifications}
        loading={notificationsLoading}
        error={notificationsError}
        onClose={() => {
          setNotificationsOpen(false);
          setSelectedNotification(null);
        }}
        onRefresh={() => void refreshNotifications()}
        onOpenNotification={(notification) => {
          void handleOpenNotification(notification);
        }}
        onMarkAllRead={() => void markAllRead()}
      />
      <NotificationDetailModal
        open={!!selectedNotification}
        notification={selectedNotification}
        onClose={() => setSelectedNotification(null)}
        onAction={(notification) => {
          if (!notification.action_url) return;
          if (notification.action_url === REPLY_TO_HOST_ACTION) {
            setReplyNotification(notification);
            setReplyMessage('');
            setReplyFeedback(null);
            setSelectedNotification(null);
            setNotificationsOpen(false);
            return;
          }
          if (notification.action_url.startsWith('/')) {
            navigate(notification.action_url);
          } else {
            window.location.href = notification.action_url;
          }
          setSelectedNotification(null);
          setNotificationsOpen(false);
        }}
      />
      {replyNotification ? (
        <div className="fixed inset-0 z-[170] flex items-center justify-center p-4 sm:p-6">
          <button
            type="button"
            onClick={() => setReplyNotification(null)}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            aria-label="Close reply modal"
          />
          <div className="relative z-[180] w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <button
              type="button"
              onClick={() => setReplyNotification(null)}
              className="absolute right-3 top-3 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Reply</p>
            <h3 className="mt-1 pr-8 text-xl font-black tracking-tight text-slate-900">Message the host</h3>
            <p className="mt-2 text-sm text-slate-500">
              Send a quick reply about <span className="font-semibold text-slate-700">{getReplyEventLabel(replyNotification)}</span>.
            </p>
            <label className="mt-4 block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Message</span>
              <textarea
                value={replyMessage}
                onChange={(event) => setReplyMessage(event.target.value)}
                rows={4}
                placeholder="Write your reply..."
                className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
              />
            </label>
            {replyFeedback ? (
              <p className="mt-3 text-xs font-bold text-slate-500">{replyFeedback}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReplyNotification(null)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSendReply()}
                disabled={replySending || !replyMessage.trim()}
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
              >
                {replySending ? 'Sending...' : 'Send reply'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
