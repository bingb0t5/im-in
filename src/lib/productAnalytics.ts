import posthog from 'posthog-js';
import { getAnalyticsSessionId } from './analyticsSession';

export type ProductAnalyticsEvent =
  | 'event_viewed'
  | 'joined_event'
  | 'event_shared'
  | 'link_opened'
  | 'calendar_added'
  | 'map_opened';

export type ProductAnalyticsProperties = {
  activity_id?: string;
  link_id?: string;
  source?: string;
  share_channel?: string;
  visibility_type?: string;
  calendar_type?: 'google' | 'ics';
  page?: string;
};

const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY || '').trim();
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let initialized = false;

function buildProperties(properties: ProductAnalyticsProperties = {}) {
  const page =
    properties.page ||
    (typeof window !== 'undefined' ? window.location.pathname : undefined);

  return Object.fromEntries(
    Object.entries({
      app: 'im_in',
      app_session_id: getAnalyticsSessionId(),
      page,
      ...properties,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

export function initProductAnalytics() {
  if (initialized || typeof window === 'undefined' || !POSTHOG_KEY) {
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_persistence: true,
    bootstrap: {
      distinctID: getAnalyticsSessionId(),
    },
    loaded(instance) {
      instance.register({
        app: 'im_in',
        app_session_id: getAnalyticsSessionId(),
      });
    },
  });

  initialized = true;
}

export function captureProductEvent(
  eventName: ProductAnalyticsEvent,
  properties: ProductAnalyticsProperties = {},
) {
  if (!POSTHOG_KEY || typeof window === 'undefined') {
    return;
  }

  if (!initialized) {
    initProductAnalytics();
  }

  posthog.capture(eventName, buildProperties(properties));
}
