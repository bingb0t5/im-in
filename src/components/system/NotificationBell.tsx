import { Bell } from 'lucide-react';

type NotificationBellProps = {
  unreadCount: number;
  onClick: () => void;
  disabled?: boolean;
};

export function NotificationBell({ unreadCount, onClick, disabled = false }: NotificationBellProps) {
  const badge = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <button
      type="button"
      aria-label="Open notifications"
      onClick={onClick}
      disabled={disabled}
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-brand-700 disabled:opacity-50"
    >
      <Bell className="h-5 w-5" />
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-[1.15rem] rounded-full bg-brand-600 px-1.5 py-0.5 text-center text-[10px] font-black leading-none text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
