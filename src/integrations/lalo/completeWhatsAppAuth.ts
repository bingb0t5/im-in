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
  console.info('[identity-debug] completeWhatsAppAuth:start', {
    attemptId: attempt.attemptId,
    mode: attempt.mode,
    attemptRedirectTo: attempt.redirectTo,
    suppressNameCaptureRedirect: !!options?.suppressNameCaptureRedirect,
  });
  const result = await finalizeLaloWhatsAppAuth(attempt);
  requestPostVerifyInstallPrompt(options?.userId);
  console.info('[identity-debug] completeWhatsAppAuth:finalized', {
    mode: result.mode,
    finalizedRedirectTo: result.redirectTo,
  });

  if (options?.suppressNameCaptureRedirect || result.mode === 'link_account') {
    console.info('[identity-debug] completeWhatsAppAuth:skip-name-capture', {
      reason: options?.suppressNameCaptureRedirect ? 'suppressed' : 'link_account_mode',
      redirectTo: result.redirectTo,
    });
    return result;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.warn('[identity-debug] completeWhatsAppAuth:no-auth-user', {
      redirectTo: result.redirectTo,
    });
    return result;
  }
  console.info('[identity-debug] completeWhatsAppAuth:auth-user', {
    userId: user.id,
  });

  let profile = null;
  try {
    // Keep auth completion side-effect free from merge/claim logic.
    // Guest claim + merge prompt handling runs centrally in App bootstrap.
    profile = await guestService.getOrCreateProfileForUser(user);
  } catch {
    profile = null;
  }
  console.info('[identity-debug] completeWhatsAppAuth:resolved-profile', {
    profileId: profile?.id || null,
    profileUserId: profile?.user_id || null,
    profileName: profile?.full_name || null,
  });

  const needsRealName = profileNeedsRealName(profile, user);
  console.info('[identity-debug] completeWhatsAppAuth:name-check', {
    needsRealName,
  });

  if (!needsRealName) {
    console.info('[identity-debug] completeWhatsAppAuth:return-finalized-redirect', {
      redirectTo: result.redirectTo,
    });
    return result;
  }

  const rememberedGuestSession = await guestService.getStoredGuestSession().catch(() => null);
  if (rememberedGuestSession) {
    // Let App bootstrap run guest->auth claim/merge-prompt flow first.
    // For remembered-guest sign-ins, avoid forcing /profile before merge eligibility is evaluated.
    console.info('[identity-debug] completeWhatsAppAuth:skip-name-capture-for-remembered-guest', {
      guestProfileId: rememberedGuestSession.profile.id,
      redirectTo: result.redirectTo,
    });
    return result;
  }

  const nextRedirect = buildNameCaptureRedirect(result.redirectTo || attempt.redirectTo || '/');
  console.info('[identity-debug] completeWhatsAppAuth:force-name-capture', {
    redirectTo: nextRedirect,
  });
  return {
    ...result,
    redirectTo: nextRedirect,
  };
}
