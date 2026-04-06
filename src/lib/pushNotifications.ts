import { User } from '@supabase/supabase-js';
import { detectRuntimeEnvironment } from '../utils/runtimeEnvironment';
import { AttendeeProfile } from '../services/guestService';
import { supabase } from '../supabase';
import { NotificationPreferenceItem, PushNotificationCategory, PushSubscriptionItem } from '../types';

export const PUSH_NOTIFICATION_CATEGORIES: PushNotificationCategory[] = [
  'activity_shared',
  'activity_updated',
  'waitlist_added',
  'waitlist_promoted',
  'attendance_changed',
  'host_message',
  'guest_reply',
  'system',
];

type PushAvailability = {
  supported: boolean;
  isStandalone: boolean;
  hasWhatsAppLink: boolean;
  reason?: string;
};

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function getPushAvailability(profile: AttendeeProfile | null): PushAvailability {
  const env = detectRuntimeEnvironment();
  const hasWhatsAppLink = Boolean(profile?.lalo_user_id?.trim());
  const isStandalone = env.isStandalone;

  if (typeof window === 'undefined') {
    return {
      supported: false,
      hasWhatsAppLink,
      isStandalone,
      reason: 'Push notifications are only available in the browser.',
    };
  }

  if (!window.isSecureContext) {
    return {
      supported: false,
      hasWhatsAppLink,
      isStandalone,
      reason: 'Push notifications require a secure context (HTTPS or localhost).',
    };
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return {
      supported: false,
      hasWhatsAppLink,
      isStandalone,
      reason: 'This browser does not support web push notifications.',
    };
  }

  return {
    supported: true,
    hasWhatsAppLink,
    isStandalone,
  };
}

export async function ensurePushServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function getExistingPushSubscription() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeCurrentDeviceToPush(vapidPublicKey: string) {
  if (!vapidPublicKey?.trim()) {
    throw new Error('Push is not configured. Missing VAPID public key.');
  }

  const registration = await ensurePushServiceWorker();
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    throw new Error('Notifications permission was not granted.');
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(vapidPublicKey),
  });

  return subscription;
}

export async function syncPushSubscriptionToServer({
  subscription,
  userAgent,
  platform,
  isStandalone,
}: {
  subscription: PushSubscription;
  userAgent: string;
  platform: string;
  isStandalone: boolean;
}) {
  const payload = subscription.toJSON();
  const keys = payload.keys || {};

  const { data, error } = await supabase.rpc('upsert_my_push_subscription', {
    p_endpoint: payload.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_user_agent: userAgent,
    p_platform: platform,
    p_is_standalone: isStandalone,
  });

  if (error) throw error;
  return data as PushSubscriptionItem;
}

export async function unsubscribeCurrentDeviceFromPush(endpoint?: string) {
  const existing = await getExistingPushSubscription();
  if (existing) {
    await existing.unsubscribe();
  }

  const { error } = await supabase.rpc('revoke_my_push_subscription', {
    p_endpoint: endpoint || existing?.endpoint || null,
  });
  if (error) throw error;
}

export async function fetchMyPushSubscriptions() {
  const { data, error } = await supabase.rpc('list_my_push_subscriptions');
  if (error) throw error;
  return (data || []) as PushSubscriptionItem[];
}

export async function fetchMyNotificationPreferences() {
  const { data, error } = await supabase.rpc('list_my_notification_preferences');
  if (error) throw error;
  return (data || []) as NotificationPreferenceItem[];
}

export async function saveMyNotificationPreference(category: PushNotificationCategory | string, pushEnabled: boolean) {
  const { data, error } = await supabase.rpc('set_my_notification_preference', {
    p_category: category,
    p_push_enabled: pushEnabled,
  });

  if (error) throw error;
  return data as NotificationPreferenceItem;
}

export function canManagePushNotifications(user: User | null, profile: AttendeeProfile | null) {
  if (!user) return false;
  const availability = getPushAvailability(profile);
  return availability.supported && availability.isStandalone && availability.hasWhatsAppLink;
}
