import type { Page } from "playwright";

import type { WhatsAppHelperConfig } from "../config";
import { WhatsAppHelperError } from "../types/errors";
import { WHATSAPP_COMPOSER_SELECTORS } from "./selectors";
import { findVisibleLocator } from "./utils";

async function getComposer(page: Page) {
  const composer = await findVisibleLocator(page, WHATSAPP_COMPOSER_SELECTORS);
  if (!composer) {
    throw new WhatsAppHelperError(
      "MESSAGE_BOX_NOT_FOUND",
      "WhatsApp composer was not available when preparing the message.",
    );
  }

  return composer;
}

export async function composeMessage(
  page: Page,
  message: string,
  config: WhatsAppHelperConfig,
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new WhatsAppHelperError("SEND_FAILED", "Refusing to send an empty WhatsApp message.");
  }

  const composer = await getComposer(page);
  await composer.click({ timeout: config.navigationTimeoutMs });

  const lines = trimmed.replace(/\r\n/g, "\n").split("\n");
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      await page.keyboard.press("Shift+Enter");
    }

    if (line.length > 0) {
      await page.keyboard.type(line, { delay: config.typeDelayMs });
    }
  }
}
