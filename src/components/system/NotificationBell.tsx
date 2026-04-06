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
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-[1.15rem] border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-brand-700 disabled:opacity-50"
    >
      <Bell className="h-4.5 w-4.5" />
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-[1.05rem] rounded-full bg-brand-600 px-1.5 py-0.5 text-center text-[9px] font-black leading-none text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
