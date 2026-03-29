import type { Page } from "playwright";

import type { WhatsAppHelperConfig } from "../config";
import { WhatsAppHelperError } from "../types/errors";
import { WHATSAPP_COMPOSER_SELECTORS, WHATSAPP_SEARCH_BOX_SELECTORS } from "./selectors";
import { escapeForAttributeSelector, findVisibleLocator } from "./utils";

export async function waitForComposer(page: Page, timeoutMs: number): Promise<void> {
  const composer = await findVisibleLocator(page, WHATSAPP_COMPOSER_SELECTORS);
  if (composer) {
    return;
  }

  for (const selector of WHATSAPP_COMPOSER_SELECTORS) {
    try {
      await page.waitForSelector(selector, { timeout: timeoutMs, state: "visible" });
      return;
    } catch {
      continue;
    }
  }

  throw new WhatsAppHelperError(
    "MESSAGE_BOX_NOT_FOUND",
    "Could not find the WhatsApp message composer.",
  );
}

async function clearSearchBox(page: Page): Promise<void> {
  await page.keyboard.press("Control+A").catch(() => undefined);
  await page.keyboard.press("Backspace").catch(() => undefined);
}

export async function readActiveChatTitle(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const header = document.querySelector("#main header");
    if (!header) {
      return null;
    }

    const invalidValues = new Set([
      "click here for group info",
      "click here for contact info",
      "search",
      "group info",
      "contact info",
    ]);

    const selectors = [
      '[data-testid="conversation-info-header-chat-title"]',
      '[data-testid="conversation-info-header-chat-title"] span',
      "h1",
      "span[title]",
      '[dir="auto"]',
    ];

    const candidates = selectors.flatMap((selector) => {
      return Array.from(header.querySelectorAll(selector))
        .map((element) => {
          const attrTitle = element.getAttribute("title")?.trim() ?? "";
          const text = element.textContent?.trim() ?? "";
          return [attrTitle, text];
        })
        .flat()
        .map((value) => value.trim())
        .filter(Boolean);
    });

    for (const candidate of candidates) {
      const normalized = candidate.toLowerCase();
      if (!invalidValues.has(normalized) && !normalized.startsWith("click here")) {
        return candidate;
      }
    }

    return null;
  });
}

export async function openGroupByExactTitle(
  page: Page,
  groupNameExact: string,
  config: WhatsAppHelperConfig,
): Promise<void> {
  const activeChatTitle = await readActiveChatTitle(page);
  if (activeChatTitle === groupNameExact) {
    await waitForComposer(page, config.navigationTimeoutMs);
    return;
  }

  const safeTitle = escapeForAttributeSelector(groupNameExact);
  const directMatchSelector = `#pane-side span[title="${safeTitle}"]`;
  const directMatches = page.locator(directMatchSelector);
  const directMatchCount = await directMatches.count().catch(() => 0);

  if (directMatchCount > 1) {
    throw new WhatsAppHelperError(
      "GROUP_NAME_AMBIGUOUS",
      "Multiple WhatsApp chats matched the same exact title.",
    );
  }

  if (directMatchCount === 1) {
    await directMatches.first().click({ timeout: config.navigationTimeoutMs });
    await waitForComposer(page, config.navigationTimeoutMs);
    return;
  }

  const searchBox = await findVisibleLocator(page, WHATSAPP_SEARCH_BOX_SELECTORS);
  if (!searchBox) {
    throw new WhatsAppHelperError(
      "HELPER_OFFLINE",
      "WhatsApp search box was not available.",
    );
  }

  await searchBox.click({ timeout: config.navigationTimeoutMs });
  await clearSearchBox(page);
  await page.keyboard.type(groupNameExact, { delay: config.typeDelayMs });
  await page.waitForTimeout(config.searchSettledDelayMs);

  const exactMatches = page.locator(directMatchSelector);
  const count = await exactMatches.count().catch(() => 0);

  if (count === 0) {
    throw new WhatsAppHelperError("GROUP_NOT_FOUND", "No WhatsApp group matched the exact title.");
  }

  if (count > 1) {
    throw new WhatsAppHelperError(
      "GROUP_NAME_AMBIGUOUS",
      "Multiple WhatsApp chats matched the same exact title.",
    );
  }

  await exactMatches.first().click({ timeout: config.navigationTimeoutMs });
  await waitForComposer(page, config.navigationTimeoutMs);
}
