import { finalizeLaloWhatsAppAuth, type StoredLaloAuthAttempt } from './laloAuth';
import { requestPostVerifyInstallPrompt } from '../../utils/postVerifyInstallPrompt';

type CompleteWhatsAppAuthOptions = {
  userId?: string | null;
};

/**
 * Shared completion handoff for WhatsApp auth/link flows.
 * Keeps post-verify install prompting logic in one place.
 */
export async function completeWhatsAppAuth(
  attempt: StoredLaloAuthAttempt,
  options?: CompleteWhatsAppAuthOptions,
) {
  const result = await finalizeLaloWhatsAppAuth(attempt);
  requestPostVerifyInstallPrompt(options?.userId);
  return result;
}
