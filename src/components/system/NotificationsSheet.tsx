import { Bell, ExternalLink, RefreshCw, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { NotificationItem } from '../../types';
import { formatDate } from '../../utils';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';

type NotificationsSheetProps = {
  open: boolean;
  notifications: NotificationItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onOpenNotification: (notification: NotificationItem) => void;
  isNotificationActionable?: (notification: NotificationItem) => boolean;
  onMarkAllRead: () => void;
};

export function NotificationsSheet({
  open,
  notifications,
  loading,
  error,
  onClose,
  onRefresh,
  onOpenNotification,
  isNotificationActionable,
  onMarkAllRead,
}: NotificationsSheetProps) {
  useBodyScrollLock(open);

  const unreadCount = notifications.filter((item) => !item.read_at).length;

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal((
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[120]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            aria-label="Close notifications"
          />
          <motion.div
            className="absolute inset-x-0 top-0 z-[130] mx-auto flex max-h-[78vh] max-w-2xl flex-col overflow-hidden rounded-b-3xl border border-slate-200 bg-white shadow-2xl"
            initial={{ y: '-108%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-108%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.9 }}
          >
            <div className="border-b border-slate-200">
              <div className="flex justify-center pt-2">
                <span className="h-1 w-10 rounded-full bg-slate-200" />
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-base font-black tracking-tight text-slate-900">Notifications</p>
                  <p className="text-xs text-slate-400">{unreadCount} unread</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    disabled={unreadCount === 0}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
                  >
                    Mark all read
                  </button>
                  <button
                    type="button"
                    onClick={onRefresh}
                    className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100"
                    aria-label="Refresh notifications"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto p-4">
              {loading && notifications.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  Loading notifications...
                </div>
              ) : null}

              {error ? (
                <div className="mb-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              ) : null}

              {!loading && notifications.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  <Bell className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                  No notifications yet.
                </div>
              ) : null}

              {notifications.length > 0 ? (
                <div className="space-y-2">
                  {notifications.map((notification) => {
                    const unread = !notification.read_at;
                    const actionable = isNotificationActionable ? isNotificationActionable(notification) : false;
                    return (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => onOpenNotification(notification)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                          unread
                            ? 'border-brand-200 bg-brand-50/50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-sm ${unread ? 'font-black text-slate-900' : 'font-bold text-slate-700'}`}>
                              {notification.title}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{notification.message}</p>
                            <p className="mt-2 text-[11px] font-medium text-slate-400">{formatDate(notification.created_at)}</p>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            {actionable ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-brand-100 bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-700">
                                Open
                                <ExternalLink className="h-3 w-3" />
                              </span>
                            ) : null}
                            {unread ? <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  ), document.body);
}
