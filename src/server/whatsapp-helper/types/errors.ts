import type { WhatsAppFailureCode, WhatsAppJoinResult, WhatsAppSendResult } from "./contracts";

export class WhatsAppHelperError extends Error {
  readonly code: WhatsAppFailureCode;

  constructor(code: WhatsAppFailureCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "WhatsAppHelperError";
    this.code = code;

    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: options.cause,
        writable: true,
      });
    }
  }
}

export function toFailureCode(error: unknown): WhatsAppFailureCode {
  if (error instanceof WhatsAppHelperError) {
    return error.code;
  }

  if (!(error instanceof Error)) {
    return "UNKNOWN";
  }

  const normalizedMessage = error.message.toUpperCase();

  if (normalizedMessage.includes("QR") || normalizedMessage.includes("SESSION_EXPIRED")) {
    return "SESSION_EXPIRED";
  }

  if (normalizedMessage.includes("INVITE")) {
    return "INVITE_LINK_INVALID";
  }

  if (normalizedMessage.includes("JOIN")) {
    return "JOIN_FAILED";
  }

  if (normalizedMessage.includes("RATE")) {
    return "RATE_LIMITED";
  }

  if (normalizedMessage.includes("OFFLINE") || normalizedMessage.includes("PLAYWRIGHT")) {
    return "HELPER_OFFLINE";
  }

  return "UNKNOWN";
}

export function failureResult(code: WhatsAppFailureCode): WhatsAppSendResult {
  return {
    ok: false,
    failureCode: code,
  };
}

export function joinFailureResult(code: WhatsAppFailureCode): WhatsAppJoinResult {
  return {
    ok: false,
    failureCode: code,
  };
}
