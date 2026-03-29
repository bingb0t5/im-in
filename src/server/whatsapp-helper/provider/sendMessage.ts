import type { Page } from "playwright";

import type { WhatsAppHelperConfig } from "../config";
import type { WhatsAppSendInput, WhatsAppSendResult } from "../types/contracts";
import { failureResult, toFailureCode, WhatsAppHelperError } from "../types/errors";
import { composeMessage } from "./composer";
import { openGroupByExactTitle } from "./navigation";

export async function sendMessageViaPage(
  page: Page,
  config: WhatsAppHelperConfig,
  input: WhatsAppSendInput,
): Promise<WhatsAppSendResult> {
  try {
    await openGroupByExactTitle(page, input.groupNameExact, config);
    await composeMessage(page, input.message, config);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(Math.min(config.sendTimeoutMs, 750));

    return { ok: true };
  } catch (error) {
    if (error instanceof WhatsAppHelperError) {
      return failureResult(error.code);
    }

    return failureResult(toFailureCode(error));
  }
}
