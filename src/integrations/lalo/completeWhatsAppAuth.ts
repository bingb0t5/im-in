import { finalizeLaloWhatsAppAuth, type StoredLaloAuthAttempt } from './laloAuth';
import { requestPostVerifyInstallPrompt } from '../../utils/postVerifyInstallPrompt';
import { supabase } from '../../supabase';
import { guestService, profileNeedsRealName } from '../../services/guestService';

type CompleteWhatsAppAuthOptions = {
  userId?: string | null;
  suppressNameCaptureRedirect?: boolean;
};

function buildNameCaptureRedirect(nextPath: string) {
  const params = new URLSearchParams();
  params.set('completeName', '1');
  params.set('returnTo', nextPath || '/');
  return `/profile?${params.toString()}`;
}

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

  if (options?.suppressNameCaptureRedirect || result.mode === 'link_account') {
    return result;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return result;
  }

  let profile = null;
  try {
    profile = await guestService.getProfileForUser(user);
  } catch {
    profile = null;
  }

  if (!profileNeedsRealName(profile, user)) {
    return result;
  }

  return {
    ...result,
    redirectTo: buildNameCaptureRedirect(result.redirectTo || attempt.redirectTo || '/'),
  };
}
