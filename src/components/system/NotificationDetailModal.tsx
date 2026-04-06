import { ExternalLink, X } from 'lucide-react';
import { NotificationItem } from '../../types';
import { formatDate } from '../../utils';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';

type NotificationDetailModalProps = {
  open: boolean;
  notification: NotificationItem | null;
  onClose: () => void;
  onAction?: (notification: NotificationItem) => void;
};

const formatNotificationTypeLabel = (type: string) =>
  type
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export function NotificationDetailModal({
  open,
  notification,
  onClose,
  onAction,
}: NotificationDetailModalProps) {
  useBodyScrollLock(open);

  if (!open || !notification) return null;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-label="Close notification detail"
      />
      <div className="relative z-[170] w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{formatNotificationTypeLabel(notification.type)}</p>
        <h3 className="mt-1 pr-8 text-xl font-black tracking-tight text-slate-900">{notification.title}</h3>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{notification.message}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-400">
          <span>{formatDate(notification.created_at)}</span>
          {!notification.read_at ? (
            <span className="rounded-full bg-brand-50 px-2 py-1 text-brand-700">Unread</span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">Read</span>
          )}
        </div>
        {notification.action_url ? (
          <button
            type="button"
            onClick={() => {
              if (onAction) onAction(notification);
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-brand-600 bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-all hover:border-brand-500 hover:bg-brand-500"
          >
            {notification.action_label || 'Open'}
            <ExternalLink className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
