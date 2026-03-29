import { invokeAuthedFunction } from './functions';
import type {
  WhatsAppEnqueueJoinResponse,
  WhatsAppEnqueueSendResponse,
  WhatsAppHelperAdminResponse,
  WhatsAppSendJobType,
} from '../types';

export async function enqueueWhatsAppJoin(input: {
  eventId: string;
  inviteUrl: string;
}) {
  return invokeAuthedFunction<WhatsAppEnqueueJoinResponse>('whatsapp-enqueue-join', input);
}

export async function enqueueWhatsAppSend(input: {
  eventId?: string;
  eventWhatsAppGroupId?: string;
  jobType: WhatsAppSendJobType;
  payload?: Record<string, unknown>;
}) {
  return invokeAuthedFunction<WhatsAppEnqueueSendResponse>('whatsapp-enqueue-send', input);
}

export async function getWhatsAppHelperAdminStatus() {
  return invokeAuthedFunction<WhatsAppHelperAdminResponse>('whatsapp-helper-admin', {
    action: 'status',
  });
}

export async function markWhatsAppHelperReauthRequired() {
  return invokeAuthedFunction<{ ok: boolean }>('whatsapp-helper-admin', {
    action: 'mark_reauth_required',
  });
}

export async function clearWhatsAppHelperReauthRequired() {
  return invokeAuthedFunction<{ ok: boolean }>('whatsapp-helper-admin', {
    action: 'clear_reauth_required',
  });
}
