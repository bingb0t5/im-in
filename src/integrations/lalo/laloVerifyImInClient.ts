import type { LaloVerifyClient, LaloVerifyStartInput, LaloVerifyStartResult, LaloVerifyStatusResponse } from '../../vendor/lalo-verify';
import { getLaloWhatsAppStatus, getStoredLaloAuthAttempt, startLaloWhatsAppAuth } from './laloAuth';
import type { LaloAuthMode } from './laloAuth';

function mapImInStatusToVerify(status: Awaited<ReturnType<typeof getLaloWhatsAppStatus>>): LaloVerifyStatusResponse {
  if (status.status === 'pending') {
    const attempt = getStoredLaloAuthAttempt();
    return {
      status: 'pending',
      expiresAt: attempt?.expiresAt ?? null,
    };
  }
  if (status.status === 'completed') {
    return {
      status: 'completed',
      waId: null,
    };
  }
  if (status.status === 'expired') {
    return { status: 'expired' };
  }
  return { status: 'cancelled' };
}

export type CreateImInLaloVerifyClientParams = {
  redirectTo: string;
  imInMode: LaloAuthMode;
  whatsappNumber?: string | null;
  /** Runs immediately before `startLaloWhatsAppAuth` (e.g. persist a local draft). */
  beforeStart?: () => void | Promise<void>;
};

/**
 * Bridges I'm In edge functions (`lalo-auth-*`) to the shared `lalo-verify` panel contract.
 * Persists attempts via `startLaloWhatsAppAuth` so `finalizeLaloWhatsAppAuth` keeps working.
 */
export function createImInLaloVerifyClient(params: CreateImInLaloVerifyClientParams): LaloVerifyClient {
  return {
    async start(input: LaloVerifyStartInput): Promise<LaloVerifyStartResult> {
      await params.beforeStart?.();
      const mode: LaloAuthMode = input.flowType === 'link_existing' ? 'link_account' : 'sign_in';
      const attempt = await startLaloWhatsAppAuth(params.redirectTo, {
        mode,
        whatsappNumber: params.whatsappNumber ?? null,
      });

      return {
        attempt_id: attempt.attemptId,
        expires_at: attempt.expiresAt,
        whatsapp_login_message: '',
        whatsapp_deep_link: attempt.whatsappUrl,
      };
    },

    async getStatus(payload: { clientSessionId: string; attemptId: string }): Promise<LaloVerifyStatusResponse> {
      void payload.clientSessionId;
      const raw = await getLaloWhatsAppStatus(payload.attemptId);
      return mapImInStatusToVerify(raw);
    },
  };
}
