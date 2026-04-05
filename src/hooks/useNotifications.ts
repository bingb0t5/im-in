import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RealtimePostgresChangesPayload, User } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { NotificationItem } from '../types';

const DEFAULT_PAGE_SIZE = 60;

function byCreatedAtDesc(a: NotificationItem, b: NotificationItem) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function useNotifications(user: User | null) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setNotifications([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(DEFAULT_PAGE_SIZE);

      if (queryError) throw queryError;
      if (!mountedRef.current) return;
      setNotifications((data || []) as NotificationItem[]);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'Could not load notifications.');
      setNotifications([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<NotificationItem>) => {
          setNotifications((prev) => {
            if (payload.eventType === 'INSERT') {
              const next = [payload.new as NotificationItem, ...prev];
              const deduped = Array.from(new Map(next.map((n) => [n.id, n])).values());
              return deduped.sort(byCreatedAtDesc);
            }

            if (payload.eventType === 'UPDATE') {
              return prev.map((n) => (n.id === payload.new.id ? (payload.new as NotificationItem) : n));
            }

            if (payload.eventType === 'DELETE') {
              return prev.filter((n) => n.id !== payload.old.id);
            }

            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const markRead = useCallback(async (notificationId: string) => {
    const nowIso = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId
          ? { ...n, read_at: n.read_at || nowIso }
          : n,
      ),
    );

    const { error: rpcError } = await supabase.rpc('mark_my_notification_read', {
      p_notification_id: notificationId,
    });

    if (rpcError) {
      setError(rpcError.message || 'Could not mark notification as read.');
      void refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    const nowIso = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || nowIso })));
    const { error: rpcError } = await supabase.rpc('mark_all_my_notifications_read');
    if (rpcError) {
      setError(rpcError.message || 'Could not mark all notifications as read.');
      void refresh();
    }
  }, [refresh]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read_at).length,
    [notifications],
  );

  return {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
  };
}
