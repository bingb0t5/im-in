import type { Locator, Page } from "playwright";

export function escapeForAttributeSelector(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function findVisibleLocator(
  page: Page,
  selectors: string[],
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

export async function hasVisibleSelector(
  page: Page,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: timeoutMs, state: "visible" });
    return true;
  } catch {
    return false;
  }
}
