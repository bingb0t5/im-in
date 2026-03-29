export type WhatsAppHelperState = "online" | "connecting" | "offline" | "degraded";

export type WhatsAppFailureCode =
  | "GROUP_NOT_FOUND"
  | "GROUP_NAME_AMBIGUOUS"
  | "INVITE_LINK_INVALID"
  | "INVITE_LINK_UNSUPPORTED"
  | "JOIN_APPROVAL_REQUIRED"
  | "JOIN_BUTTON_NOT_FOUND"
  | "JOIN_FAILED"
  | "SESSION_EXPIRED"
  | "HELPER_OFFLINE"
  | "MESSAGE_BOX_NOT_FOUND"
  | "SEND_FAILED"
  | "RATE_LIMITED"
  | "UNKNOWN";

export interface WhatsAppHelperHealth {
  state: WhatsAppHelperState;
  lastCheckedAt: string;
  reason: string | null;
}

export interface WhatsAppSendInput {
  groupNameExact: string;
  message: string;
}

export interface WhatsAppJoinInput {
  inviteUrl: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  failureCode?: WhatsAppFailureCode;
}

export interface WhatsAppJoinResult {
  ok: boolean;
  groupNameExact?: string;
  failureCode?: WhatsAppFailureCode;
}

export interface WhatsAppHelperProvider {
  close(): Promise<void>;
  getHealth(): Promise<WhatsAppHelperHealth>;
  joinGroupByInviteLink(input: WhatsAppJoinInput): Promise<WhatsAppJoinResult>;
  sendMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}
