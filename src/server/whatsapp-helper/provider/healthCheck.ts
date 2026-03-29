import type { Page } from "playwright";

import type { WhatsAppHelperConfig } from "../config";
import type { WhatsAppHelperHealth } from "../types/contracts";
import { WHATSAPP_READY_SELECTOR, WHATSAPP_SESSION_EXPIRED_SELECTOR } from "./selectors";
import { hasVisibleSelector } from "./utils";

function buildHealth(
  state: WhatsAppHelperHealth["state"],
  reason: string | null,
): WhatsAppHelperHealth {
  return {
    state,
    reason,
    lastCheckedAt: new Date().toISOString(),
  };
}

export async function checkWhatsAppHealth(
  page: Page,
  config: WhatsAppHelperConfig,
): Promise<WhatsAppHelperHealth> {
  if (page.isClosed()) {
    return buildHealth("offline", "PAGE_CLOSED");
  }

  try {
    if (!page.url().startsWith(config.whatsappUrl)) {
      await page.goto(config.whatsappUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.launchTimeoutMs,
      });
    }

    const ready = await hasVisibleSelector(page, WHATSAPP_READY_SELECTOR, 3_000);
    if (ready) {
      return buildHealth("online", null);
    }

    const sessionExpired = await hasVisibleSelector(
      page,
      WHATSAPP_SESSION_EXPIRED_SELECTOR,
      1_000,
    );
    if (sessionExpired) {
      return buildHealth("offline", "SESSION_EXPIRED");
    }

    return buildHealth("degraded", "WHATSAPP_NOT_READY");
  } catch {
    return buildHealth("degraded", "WHATSAPP_UNREACHABLE");
  }
}

export function connectingHealth(): WhatsAppHelperHealth {
  return buildHealth("connecting", "LAUNCHING_SESSION");
}

export function offlineHealth(reason: string): WhatsAppHelperHealth {
  return buildHealth("offline", reason);
}
