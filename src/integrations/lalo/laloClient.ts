import { invokeAuthedFunction, invokePublicFunction } from '../../lib/functions';

export type LaloStartResponse = {
  attempt_id: string;
  whatsapp_url: string;
  expires_at: string;
};

export type LaloStatusResponse =
  | {
      status: 'pending';
    }
  | {
      status: 'completed';
      lalo_user_id: string;
      is_new_user: boolean;
    }
  | {
      status: 'expired' | 'cancelled';
    };

export type LaloCompleteResponse = {
  trusted: true;
  lalo_user_id: string;
  is_new_user: boolean;
  sign_in_email: string;
  sign_in_password: string;
};

export type LaloLinkResponse = {
  trusted: true;
  linked: true;
  lalo_user_id: string;
  whatsapp_number: string | null;
};

export const laloClient = {
  startWhatsAppAuth() {
    return invokePublicFunction<LaloStartResponse>('lalo-auth-start', {});
  },

  getWhatsAppAuthStatus(attemptId: string) {
    return invokePublicFunction<LaloStatusResponse>('lalo-auth-status', {
      attempt_id: attemptId,
    });
  },

  completeWhatsAppAuth(attemptId: string) {
    return invokePublicFunction<LaloCompleteResponse>('lalo-auth-complete', {
      attempt_id: attemptId,
    });
  },

  linkWhatsAppToCurrentAccount(attemptId: string, whatsappNumber?: string | null) {
    return invokeAuthedFunction<LaloLinkResponse>('lalo-auth-link-account', {
      attempt_id: attemptId,
      whatsapp_number: whatsappNumber || null,
    });
  },
};
