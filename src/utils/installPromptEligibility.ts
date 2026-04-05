import { User } from '@supabase/supabase-js';
import { AttendeeProfile } from '../services/guestService';
import { RuntimeEnvironment } from './runtimeEnvironment';

export type PromptDecision = 'none' | 'verify_whatsapp' | 'add_to_home_screen';

type PromptEligibilityInput = {
  env: RuntimeEnvironment;
  user: User | null;
  profile: AttendeeProfile | null;
  verifyDismissed: boolean;
  addToHomeDismissed: boolean;
};

export function isWhatsAppVerifiedProfile(profile: AttendeeProfile | null) {
  if (!profile) return false;
  return !!(
    profile.lalo_user_id
    || profile.auth_provider === 'lalo_whatsapp'
    || profile.whatsapp_verified_at
  );
}

export function getPromptDecision(input: PromptEligibilityInput): PromptDecision {
  const { env, user, profile, verifyDismissed, addToHomeDismissed } = input;

  if (!env.isBrowser || !env.isMobile) return 'none';
  if (!env.isInAppBrowser) return 'none';
  if (env.isStandalone) return 'none';

  const isVerified = isWhatsAppVerifiedProfile(profile);
  if (!isVerified) {
    return verifyDismissed ? 'none' : 'verify_whatsapp';
  }

  if (!user) return 'none';
  return addToHomeDismissed ? 'none' : 'add_to_home_screen';
}
