import type { Page } from "playwright";

import type { WhatsAppHelperConfig } from "../config";
import type { WhatsAppJoinInput, WhatsAppJoinResult } from "../types/contracts";
import { joinFailureResult, toFailureCode, WhatsAppHelperError } from "../types/errors";
import {
  WHATSAPP_CONTINUE_TO_WEB_SELECTORS,
  WHATSAPP_INVALID_INVITE_SELECTORS,
  WHATSAPP_JOIN_APPROVAL_SELECTORS,
  WHATSAPP_JOIN_GROUP_BUTTON_SELECTORS,
  WHATSAPP_OPEN_GROUP_BUTTON_SELECTORS,
  WHATSAPP_SESSION_EXPIRED_SELECTOR,
} from "./selectors";
import { readActiveChatTitle, waitForComposer } from "./navigation";
import { findVisibleLocator, hasVisibleSelector } from "./utils";

function normalizeInviteUrl(inviteUrl: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(inviteUrl);
  } catch {
    throw new WhatsAppHelperError("INVITE_LINK_INVALID", "Invite URL is not a valid URL.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname === "chat.whatsapp.com") {
    return parsedUrl.toString();
  }

  if (hostname === "www.whatsapp.com" || hostname === "whatsapp.com") {
    if (parsedUrl.pathname.toLowerCase().includes("accept")) {
      return parsedUrl.toString();
    }
  }

  throw new WhatsAppHelperError(
    "INVITE_LINK_UNSUPPORTED",
    "Invite URL is not a supported WhatsApp group invite link.",
  );
}

function getWebAcceptUrl(inviteUrl: string): string | null {
  try {
    const parsedUrl = new URL(inviteUrl);
    const inviteCode = parsedUrl.pathname.split("/").filter(Boolean).at(-1);
    if (!inviteCode) {
      return null;
    }

    return `https://web.whatsapp.com/accept?code=${encodeURIComponent(inviteCode)}`;
  } catch {
    return null;
  }
}

async function hasVisibleSelectorInList(
  page: Page,
  selectors: string[],
  timeoutMs: number,
): Promise<boolean> {
  for (const selector of selectors) {
    if (await hasVisibleSelector(page, selector, timeoutMs)) {
      return true;
    }
  }

  return false;
}

async function openJoinedGroupIfNeeded(page: Page, timeoutMs: number): Promise<void> {
  const openGroupButton = await findVisibleLocator(page, WHATSAPP_OPEN_GROUP_BUTTON_SELECTORS);
  if (openGroupButton) {
    await openGroupButton.click({ timeout: timeoutMs });
  }

  await waitForComposer(page, timeoutMs);
}

async function continueToWhatsAppWebIfNeeded(
  page: Page,
  inviteUrl: string,
  timeoutMs: number,
): Promise<void> {
  const continueButton = await findVisibleLocator(page, WHATSAPP_CONTINUE_TO_WEB_SELECTORS);
  if (!continueButton) {
    return;
  }

  const href = await continueButton.getAttribute("href").catch(() => null);
  if (href) {
    await page.goto(href, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    return;
  }

  const webAcceptUrl = getWebAcceptUrl(inviteUrl);
  if (webAcceptUrl) {
    await page.goto(webAcceptUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    return;
  }

  await continueButton.click({ timeout: timeoutMs });
  await page.waitForTimeout(1_000);
}

export async function joinGroupViaInviteLink(
  page: Page,
  config: WhatsAppHelperConfig,
  input: WhatsAppJoinInput,
): Promise<WhatsAppJoinResult> {
  try {
    const inviteUrl = normalizeInviteUrl(input.inviteUrl);
    await page.goto(inviteUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.launchTimeoutMs,
    });

    await continueToWhatsAppWebIfNeeded(page, inviteUrl, config.launchTimeoutMs);

    const sessionExpired = await hasVisibleSelector(
      page,
      WHATSAPP_SESSION_EXPIRED_SELECTOR,
      2_000,
    );
    if (sessionExpired) {
      throw new WhatsAppHelperError(
        "SESSION_EXPIRED",
        "WhatsApp helper session requires a new login.",
      );
    }

    const invalidInvite = await hasVisibleSelectorInList(
      page,
      WHATSAPP_INVALID_INVITE_SELECTORS,
      1_000,
    );
    if (invalidInvite) {
      throw new WhatsAppHelperError("INVITE_LINK_INVALID", "Invite link is invalid.");
    }

    const requiresApproval = await hasVisibleSelectorInList(
      page,
      WHATSAPP_JOIN_APPROVAL_SELECTORS,
      1_000,
    );
    if (requiresApproval) {
      throw new WhatsAppHelperError(
        "JOIN_APPROVAL_REQUIRED",
        "This group requires admin approval to join.",
      );
    }

    const openExistingGroupButton = await findVisibleLocator(
      page,
      WHATSAPP_OPEN_GROUP_BUTTON_SELECTORS,
    );
    if (openExistingGroupButton) {
      await openExistingGroupButton.click({ timeout: config.joinTimeoutMs });
      await waitForComposer(page, config.joinTimeoutMs);

      const groupNameExact = await readActiveChatTitle(page);
      if (!groupNameExact) {
        throw new WhatsAppHelperError("JOIN_FAILED", "Joined group title could not be determined.");
      }

      return {
        ok: true,
        groupNameExact,
      };
    }

    const joinButton = await findVisibleLocator(page, WHATSAPP_JOIN_GROUP_BUTTON_SELECTORS);
    if (!joinButton) {
      throw new WhatsAppHelperError(
        "JOIN_BUTTON_NOT_FOUND",
        "WhatsApp join action was not available for this invite.",
      );
    }

    await joinButton.click({ timeout: config.joinTimeoutMs });
    await page.waitForTimeout(750);
    await openJoinedGroupIfNeeded(page, config.joinTimeoutMs);

    const groupNameExact = await readActiveChatTitle(page);
    if (!groupNameExact) {
      throw new WhatsAppHelperError("JOIN_FAILED", "Joined group title could not be determined.");
    }

    return {
      ok: true,
      groupNameExact,
    };
  } catch (error) {
    if (error instanceof WhatsAppHelperError) {
      return joinFailureResult(error.code);
    }

    return joinFailureResult(toFailureCode(error));
  }
}
