declare module "playwright" {
  export interface LaunchPersistentContextOptions {
    headless?: boolean;
    viewport?: { width: number; height: number };
  }

  export interface Keyboard {
    press(key: string): Promise<void>;
    type(text: string, options?: { delay?: number }): Promise<void>;
  }

  export interface Locator {
    first(): Locator;
    count(): Promise<number>;
    click(options?: { timeout?: number }): Promise<void>;
    getAttribute(name: string): Promise<string | null>;
    isVisible(options?: { timeout?: number }): Promise<boolean>;
    textContent(): Promise<string | null>;
    waitFor(options?: { state?: "visible" | "hidden" | "attached" | "detached"; timeout?: number }): Promise<void>;
  }

  export interface Page {
    evaluate<R>(pageFunction: () => R | Promise<R>): Promise<R>;
    goto(url: string, options?: { waitUntil?: "domcontentloaded" | "load"; timeout?: number }): Promise<void>;
    locator(selector: string): Locator;
    waitForSelector(selector: string, options?: { timeout?: number; state?: "visible" | "hidden" | "attached" | "detached" }): Promise<void>;
    waitForTimeout(timeout: number): Promise<void>;
    url(): string;
    isClosed(): boolean;
    keyboard: Keyboard;
    screenshot(options?: { path?: string; fullPage?: boolean }): Promise<void>;
  }

  export interface BrowserContext {
    pages(): Page[];
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  export const chromium: {
    launchPersistentContext(
      userDataDir: string,
      options?: LaunchPersistentContextOptions,
    ): Promise<BrowserContext>;
  };
}
