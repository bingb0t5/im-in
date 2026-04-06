/**
 * Host-app contract for Lalo Verify (WhatsApp) flows.
 * Maps to Lalo platform `/api/platform/auth/whatsapp/*` payloads.
 */

export type LaloVerifyFlowType = 'login' | 'link_existing';

export interface LaloVerifyStartInput {
  clientSessionId: string;
  flowType: LaloVerifyFlowType;
  /** Bearer token for `link_existing` flows */
  token?: string | null;
}

export interface LaloVerifyStartResult {
  attempt_id: string;
  attempt_public_id?: string;
  flow_type?: LaloVerifyFlowType;
  expires_at: string;
  whatsapp_login_message: string;
  whatsapp_deep_link: string | null;
}

export type LaloVerifyStatusResponse =
  | {
      status: 'pending';
      flowType?: LaloVerifyFlowType;
      canonicalUserId?: string | null;
      completedUserId?: string | null;
      waId?: string | null;
      expiresAt?: string | null;
      redeemedAt?: string | null;
      clerkSignInToken?: string | null;
      clerkUserId?: string | null;
    }
  | {
      status: 'completed';
      flowType?: LaloVerifyFlowType;
      canonicalUserId?: string | null;
      completedUserId?: string | null;
      waId?: string | null;
      expiresAt?: string | null;
      redeemedAt?: string | null;
      clerkSignInToken?: string | null;
      clerkUserId?: string | null;
    }
  | {
      status: 'expired' | 'cancelled' | 'not_found' | 'forbidden';
      flowType?: LaloVerifyFlowType;
      canonicalUserId?: string | null;
      completedUserId?: string | null;
      waId?: string | null;
      expiresAt?: string | null;
      redeemedAt?: string | null;
      clerkSignInToken?: string | null;
      clerkUserId?: string | null;
    };

/** Implemented by each host (Lalo web, I'm In, etc.). */
export interface LaloVerifyClient {
  start(input: LaloVerifyStartInput): Promise<LaloVerifyStartResult>;
  getStatus(input: { clientSessionId: string; attemptId: string }): Promise<LaloVerifyStatusResponse>;
}

export type LaloVerifyScreenPhase =
  | 'idle'
  | 'connecting'
  | 'generating'
  | 'handoff'
  | 'waiting'
  | 'verified';

export interface LaloVerifySessionState {
  clientSessionId: string;
  startData: LaloVerifyStartResult;
  status: LaloVerifyStatusResponse;
}
