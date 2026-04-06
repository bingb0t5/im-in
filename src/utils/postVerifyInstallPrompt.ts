import { detectRuntimeEnvironment } from './runtimeEnvironment';
import { markPostVerifySuccessPendingForUser } from './inAppBrowserPromptState';

/**
 * Request the one-time post-verify install follow-up only when it can actually be shown.
 */
export function requestPostVerifyInstallPrompt(userId?: string | null) {
  const env = detectRuntimeEnvironment();
  if (!env.isBrowser || !env.isMobile || !env.isInAppBrowser || env.isStandalone) {
    return;
  }
  markPostVerifySuccessPendingForUser(userId);
}
