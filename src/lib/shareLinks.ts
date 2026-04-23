import { supabase } from '../supabase';
import { getAnalyticsSessionId } from './analyticsSession';

export type ShareLinkAccessType = 'public' | 'private';
export type ShareLinkChannel = 'native' | 'copy' | 'whatsapp' | 'sms' | 'email';

export type ShareLinkRecord = {
  link_id: string;
  token: string;
  event_id: string;
  target_slug: string;
  access_type: ShareLinkAccessType;
  source: string | null;
  share_channel: string | null;
};

function getReferrerDomain() {
  if (typeof document === 'undefined' || !document.referrer) {
    return null;
  }

  try {
    return new URL(document.referrer).hostname || null;
  } catch {
    return null;
  }
}

export async function createShareLink(params: {
  eventId: string;
  targetSlug: string;
  accessType: ShareLinkAccessType;
  source: string;
  shareChannel: ShareLinkChannel;
}) {
  const { data, error } = await supabase.rpc('create_share_link', {
    p_event_id: params.eventId,
    p_target_slug: params.targetSlug,
    p_access_type: params.accessType,
    p_source: params.source,
    p_share_channel: params.shareChannel,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token) {
    throw new Error('Could not create share link.');
  }

  return row as ShareLinkRecord;
}

export async function openShareLink(token: string) {
  const { data, error } = await supabase.rpc('open_share_link', {
    p_token: token,
    p_session_id: getAnalyticsSessionId(),
    p_referrer_domain: getReferrerDomain(),
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.target_slug) {
    return null;
  }

  return row as ShareLinkRecord;
}

export function buildShareLinkUrl(origin: string, token: string) {
  const normalizedOrigin = origin.replace(/\/+$/, '');
  return `${normalizedOrigin}/s/${token}`;
}
