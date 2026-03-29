import type { BrowserContext, Page } from "playwright";

import type { WhatsAppHelperConfig } from "../config";
import { ensureWhatsAppHelperDirs } from "../config";
import { WhatsAppHelperError } from "../types/errors";
import { WHATSAPP_READY_SELECTOR, WHATSAPP_SESSION_EXPIRED_SELECTOR } from "./selectors";
import { hasVisibleSelector } from "./utils";

export interface WhatsAppSessionHandle {
  context: BrowserContext;
  page: Page;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new WhatsAppHelperError(
      "HELPER_OFFLINE",
      "Playwright is not installed for the WhatsApp helper.",
      { cause: error },
    );
  }
}

async function getPrimaryPage(context: BrowserContext): Promise<Page> {
  const [existingPage] = context.pages();
  return existingPage ?? context.newPage();
}

export async function launchWhatsAppSession(
  config: WhatsAppHelperConfig,
): Promise<WhatsAppSessionHandle> {
  await ensureWhatsAppHelperDirs(config);

  const { chromium } = await loadPlaywright();
  const context = await chromium.launchPersistentContext(config.sessionDir, {
    headless: config.headless,
    viewport: { width: 1400, height: 900 },
  });

  try {
    const page = await getPrimaryPage(context);
    await page.goto(config.whatsappUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.launchTimeoutMs,
    });

    const ready = await hasVisibleSelector(page, WHATSAPP_READY_SELECTOR, config.loginTimeoutMs);
    if (!ready) {
      const sessionExpired = await hasVisibleSelector(
        page,
        WHATSAPP_SESSION_EXPIRED_SELECTOR,
        1_000,
      );

      if (sessionExpired) {
        throw new WhatsAppHelperError(
          "SESSION_EXPIRED",
          "WhatsApp helper session requires a new login.",
        );
      }

      throw new WhatsAppHelperError(
        "HELPER_OFFLINE",
        "WhatsApp Web did not reach a ready state.",
      );
    }

    return { context, page };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}
