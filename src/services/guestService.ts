import { supabase } from '../supabase';
import { Attendee } from '../types';
import { User } from '@supabase/supabase-js';
import { BookingRow } from '../lib/bookings';

export interface AttendeeProfile {
  id: string;
  email?: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  user_id?: string | null;
  lalo_user_id?: string | null;
  auth_provider?: 'email' | 'google' | 'lalo_whatsapp' | null;
  whatsapp_number?: string | null;
  whatsapp_verified_at?: string | null;
}

export interface GuestSession {
  token: string;
  profile: AttendeeProfile;
}

export interface SignedInProfileUpdateResult {
  profile: AttendeeProfile;
  emailChangeRequested: boolean;
  nameSyncComplete: boolean;
}

const GUEST_SESSION_KEY = 'im_in_guest_session';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getPreferredProfileEmailForUser(user: User) {
  const normalizedAuthEmail = normalizeEmail(user.email || '');
  return normalizedAuthEmail || buildSystemGuestEmail(user.id);
}

function buildSystemGuestEmail(seed: string) {
  return `guest+${seed}@guest.im-in.local`;
}

export function isSystemGuestEmail(email?: string | null) {
  const normalized = normalizeEmail(email || '');
  return (
    normalized.endsWith('@guest.im-in.local') ||
    normalized.endsWith('@proxy.im-in.local') ||
    normalized.endsWith('@auth.im-in.local')
  );
}

function pickFirstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function splitNameParts(fullName: string) {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

function normalizeLooseName(value?: string | null) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function getProfileDisplayName(profile?: Partial<AttendeeProfile> | null) {
  return pickFirstNonEmpty(
    `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim(),
    profile?.full_name || '',
  );
}

function getEmailHandle(email?: string | null) {
  return normalizeLooseName((email || '').split('@')[0] || '');
}

export function isPlaceholderAccountName(name?: string | null, email?: string | null) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) return true;

  const normalizedName = normalizeLooseName(trimmedName);
  if (!normalizedName) return true;
  if (/^whatsapp user \d{4,}$/.test(normalizedName)) return true;
  if (trimmedName.toLowerCase().startsWith('lalo+')) return true;

  if (isSystemGuestEmail(email)) {
    const emailHandle = getEmailHandle(email);
    if (emailHandle && normalizedName === emailHandle) {
      return true;
    }
  }

  return false;
}

export function hasRealAccountName(name?: string | null, email?: string | null) {
  return !isPlaceholderAccountName(name, email);
}

export function resolvePreferredAccountName(
  profile?: Partial<AttendeeProfile> | null,
  user?: User | null,
) {
  const profileName = getProfileDisplayName(profile);
  const profileEmail = pickFirstNonEmpty(profile?.email, user?.email || '');
  if (hasRealAccountName(profileName, profileEmail)) {
    return profileName.trim();
  }

  const metadataName = getAccountNameFromUser(user);
  const metadataEmail = pickFirstNonEmpty(user?.email || '', profile?.email || '');
  if (hasRealAccountName(metadataName, metadataEmail)) {
    return metadataName.trim();
  }

  return '';
}

export function profileNeedsRealName(
  profile?: Partial<AttendeeProfile> | null,
  user?: User | null,
) {
  return !resolvePreferredAccountName(profile, user);
}

function hasMeaningfulProfileName(profile?: Partial<AttendeeProfile> | null) {
  return hasRealAccountName(getProfileDisplayName(profile), profile?.email);
}

function hasVerifiedWhatsAppIdentity(profile?: Partial<AttendeeProfile> | null) {
  if (!profile) return false;
  return !!(
    (profile.lalo_user_id || '').trim()
    || profile.auth_provider === 'lalo_whatsapp'
    || profile.whatsapp_verified_at
  );
}

function scoreProfileCandidate(profile: any, user: User, normalizedEmail: string) {
  let score = 0;
  if (hasVerifiedWhatsAppIdentity(profile)) score += 140;
  if ((profile?.lalo_user_id || '').trim()) score += 40;
  if (profile?.whatsapp_verified_at) score += 20;
  if (profile?.auth_provider === 'lalo_whatsapp') score += 10;
  if (hasMeaningfulProfileName(profile)) score += 100;
  if ((profile?.user_id || '') === user.id) score += 60;
  if (normalizeEmail(profile?.email || '') === normalizedEmail) score += 30;
  if (!isSystemGuestEmail(profile?.email || '')) score += 10;
  return score;
}

function dedupeProfiles(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = row?.id || '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function shouldAdoptSignedInEmail(profile: Partial<AttendeeProfile> | null | undefined, normalizedAuthEmail: string) {
  if (!normalizedAuthEmail) return false;
  const currentEmail = normalizeEmail(profile?.email || '');
  return !currentEmail || isSystemGuestEmail(currentEmail);
}

export function getAccountNameFromUser(user?: User | null) {
  const metadata = (user?.user_metadata || {}) as Record<string, unknown>;

  return pickFirstNonEmpty(
    typeof metadata.full_name === 'string' ? metadata.full_name : '',
    typeof metadata.name === 'string' ? metadata.name : '',
    `${typeof metadata.first_name === 'string' ? metadata.first_name : ''} ${typeof metadata.last_name === 'string' ? metadata.last_name : ''}`.trim(),
    `${typeof metadata.given_name === 'string' ? metadata.given_name : ''} ${typeof metadata.family_name === 'string' ? metadata.family_name : ''}`.trim(),
  );
}

function generateSessionToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
}

export const guestService = {
  getStoredSession(): string | null {
    return localStorage.getItem(GUEST_SESSION_KEY);
  },

  setStoredSession(token: string) {
    localStorage.setItem(GUEST_SESSION_KEY, token);
  },

  clearStoredSession() {
    localStorage.removeItem(GUEST_SESSION_KEY);
  },

  async validateSession(token: string): Promise<AttendeeProfile | null> {
    const { data, error } = await supabase
      .from('attendee_sessions')
      .select('attendee_profiles(*)')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;
    return data.attendee_profiles as unknown as AttendeeProfile;
  },

  async getStoredGuestSession(): Promise<GuestSession | null> {
    const token = this.getStoredSession();
    if (!token) return null;

    const profile = await this.validateSession(token);
    if (!profile) {
      this.clearStoredSession();
      return null;
    }

    return { token, profile };
  },

  async createGuestSession(
    firstName: string,
    lastName: string,
    options?: { email?: string | null; userId?: string },
  ): Promise<GuestSession> {
    const normalizedEmail = normalizeEmail(options?.email || '');
    const userId = options?.userId || null;
    const hasRealEmail = !!normalizedEmail;

    // 1. Get or create profile.
    let profile: AttendeeProfile;
    let existingProfile: AttendeeProfile | null = null;
    if (hasRealEmail) {
      const { data } = await supabase
        .from('attendee_profiles')
        .select('*')
        .eq('email', normalizedEmail)
        .maybeSingle();
      existingProfile = data as AttendeeProfile | null;
    }

    if (existingProfile) {
      profile = existingProfile;
      // Update name if it changed, and user_id if provided.
      const nextFirstName = firstName || profile.first_name;
      const nextLastName = lastName || profile.last_name;
      await supabase
        .from('attendee_profiles')
        .update({
          first_name: nextFirstName,
          last_name: nextLastName,
          user_id: userId || profile.user_id,
        })
        .eq('id', profile.id);
    } else {
      const fallbackEmail = hasRealEmail
        ? normalizedEmail
        : buildSystemGuestEmail(
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : generateSessionToken().slice(0, 16),
          );
      const { data: newProfile, error: profileError } = await supabase
        .from('attendee_profiles')
        .insert([{
          email: fallbackEmail,
          first_name: firstName,
          last_name: lastName,
          user_id: userId,
        }])
        .select()
        .single();

      if (profileError) throw profileError;
      profile = newProfile;
    }

    // 2. Create session
    const token = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    const { error: sessionError } = await supabase
      .from('attendee_sessions')
      .insert([{
        attendee_profile_id: profile.id,
        token,
        expires_at: expiresAt.toISOString()
      }]);

    if (sessionError) throw sessionError;

    this.setStoredSession(token);
    return { token, profile };
  },

  async getMyBookings(token: string): Promise<BookingRow[]> {
    const profile = await this.validateSession(token);
    if (!profile) return [];

    const { data, error } = await supabase.rpc('get_guest_bookings', {
      p_session_token: token,
    });

    if (error) throw error;
    return (data || []) as BookingRow[];
  },

  async getMyInterests(token: string): Promise<BookingRow[]> {
    const profile = await this.validateSession(token);
    if (!profile) return [];

    const { data, error } = await supabase.rpc('get_guest_interests', {
      p_session_token: token,
    });

    if (error) throw error;
    return (data || []).map((row: any) => ({
      ...row,
      status: 'thinking',
      guest_name: row.guest_name,
      events: row.events,
    }));
  },

  async sendRecoveryEmail(email: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);

    const { data: profile } = await supabase
      .from('attendee_profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!profile) {
      // Don't reveal if email exists or not, but we won't send anything
      return;
    }

    const token = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour for recovery

    const { error: sessionError } = await supabase
      .from('attendee_sessions')
      .insert([{
        attendee_profile_id: profile.id,
        token,
        expires_at: expiresAt.toISOString()
      }]);
    if (sessionError) throw sessionError;

    // TODO: Integrate real email delivery service and send:
    // `${window.location.origin}/recover?token=${token}`
  },

  async addEmailToProfile(profileId: string, email: string): Promise<AttendeeProfile> {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Please provide a valid email.');

    const { data: existingByEmail, error: existingError } = await supabase
      .from('attendee_profiles')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existingByEmail && existingByEmail.id !== profileId) {
      const { data: mergedProfile, error: mergeError } = await supabase.rpc('merge_attendee_profiles', {
        p_source_profile_id: profileId,
        p_target_profile_id: existingByEmail.id,
        p_session_token: this.getStoredSession(),
      });
      if (mergeError) throw mergeError;
      return (mergedProfile as AttendeeProfile) || (existingByEmail as AttendeeProfile);
    }

    const { data: updated, error } = await supabase
      .from('attendee_profiles')
      .update({ email: normalizedEmail })
      .eq('id', profileId)
      .select('*')
      .single();
    if (error) throw error;
    return updated as AttendeeProfile;
  },

  async claimStoredGuestSessionForUser(user: User, targetProfile?: AttendeeProfile): Promise<AttendeeProfile> {
    const guestSession = await this.getStoredGuestSession();
    const signedInProfile = targetProfile || await this.getOrCreateProfileForUser(user);

    if (!guestSession) {
      return signedInProfile;
    }

    if (guestSession.profile.id === signedInProfile.id) {
      return signedInProfile;
    }

    if (guestSession.profile.user_id && guestSession.profile.user_id !== user.id) {
      return signedInProfile;
    }

    const guestEmail = normalizeEmail(guestSession.profile.email || '');
    const authEmail = normalizeEmail(user.email || '');
    const canAutoClaim = !guestSession.profile.user_id && (
      !guestEmail
      || isSystemGuestEmail(guestEmail)
      || guestEmail === authEmail
    );

    if (!canAutoClaim) {
      return signedInProfile;
    }

    const { data: mergedProfile, error } = await supabase.rpc('merge_attendee_profiles', {
      p_source_profile_id: guestSession.profile.id,
      p_target_profile_id: signedInProfile.id,
      p_session_token: guestSession.token,
    });

    if (error) throw error;
    return (mergedProfile as AttendeeProfile) || signedInProfile;
  },

  async getOrCreateProfileForUser(user: User, name?: string): Promise<AttendeeProfile> {
    const normalizedAuthEmail = normalizeEmail(user.email || '');
    const preferredEmail = getPreferredProfileEmailForUser(user);
    const normalizedProvidedName = (name || '').trim();
    const fallbackMetadataName = getAccountNameFromUser(user) || '';
    const names = (normalizedProvidedName || fallbackMetadataName).split(' ');
    const firstName = names[0] || '';
    const lastName = names.slice(1).join(' ') || '';
    const shouldUpdateNameFields = !!normalizedProvidedName;

    let profile: AttendeeProfile;
    const { data: existingByUserId } = await supabase
      .from('attendee_profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    const { data: existingByEmail } = await supabase
      .from('attendee_profiles')
      .select('*')
      .eq('email', normalizedAuthEmail || preferredEmail);

    const profileCandidates = dedupeProfiles([...(existingByUserId || []), ...(existingByEmail || [])]);
    const existingProfile = (profileCandidates.sort((a, b) => scoreProfileCandidate(b, user, normalizedAuthEmail) - scoreProfileCandidate(a, user, normalizedAuthEmail))[0] ||
      null) as AttendeeProfile | null;

    if (existingProfile) {
      profile = existingProfile;
      // Keep the signed-in profile aligned to the current account identity.
      const updates: Partial<Pick<AttendeeProfile, 'user_id' | 'first_name' | 'last_name' | 'email'>> = {};
      if (!profile.user_id) updates.user_id = user.id;
      if (shouldUpdateNameFields) {
        if (firstName !== (profile.first_name || '')) updates.first_name = firstName;
        if (lastName !== (profile.last_name || '')) updates.last_name = lastName;
      }
      if (!shouldUpdateNameFields && fallbackMetadataName) {
        const normalizedMetadataName = normalizeLooseName(fallbackMetadataName);
        const normalizedCurrentName = normalizeLooseName(
          `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.full_name || ''
        );
        const normalizedCurrentFirst = normalizeLooseName(profile.first_name || '');
        const metadataParts = fallbackMetadataName.trim().split(/\s+/).filter(Boolean);
        const metadataFirst = metadataParts[0] || '';
        const metadataLast = metadataParts.slice(1).join(' ');
        const looksTruncatedToFirstWord =
          !!metadataLast &&
          normalizedCurrentName === normalizedCurrentFirst &&
          normalizedCurrentFirst === normalizeLooseName(metadataFirst);

        if (looksTruncatedToFirstWord || !normalizedCurrentName) {
          if (metadataFirst !== (profile.first_name || '')) updates.first_name = metadataFirst;
          if (metadataLast !== (profile.last_name || '')) updates.last_name = metadataLast;
        } else if (normalizedCurrentName !== normalizedMetadataName) {
          // Leave deliberate profile names alone when they differ from auth metadata.
        }
      }
      if (
        shouldAdoptSignedInEmail(profile, normalizedAuthEmail) &&
        normalizeEmail(profile.email || '') !== normalizedAuthEmail
      ) {
        updates.email = normalizedAuthEmail;
      }

      if (Object.keys(updates).length > 0) {
        const { data: updated } = await supabase
          .from('attendee_profiles')
          .update(updates)
          .eq('id', profile.id)
          .select()
          .single();
        if (updated) profile = updated;
      }

      // Also link all existing attendee records for this profile if they don't have a user_id
      await supabase
        .from('event_attendees')
        .update({ user_id: user.id })
        .eq('attendee_profile_id', profile.id)
        .is('user_id', null);
    } else {
      const { data: newProfile, error: profileError } = await supabase
        .from('attendee_profiles')
        .insert([{ 
          email: preferredEmail, 
          first_name: firstName, 
          last_name: lastName,
          user_id: user.id
        }])
        .select()
        .single();
      
      if (profileError) throw profileError;
      profile = newProfile;
    }

    return profile;
  },

  async getProfileForUser(user: User): Promise<AttendeeProfile | null> {
    const normalizedEmail = normalizeEmail(user.email || '');

    const { data: byUserId } = await supabase
      .from('attendee_profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (!normalizedEmail && (!byUserId || byUserId.length === 0)) return null;
    const { data: byEmail } = normalizedEmail
      ? await supabase
          .from('attendee_profiles')
          .select('*')
          .eq('email', normalizedEmail)
      : { data: [] };

    const profileCandidates = dedupeProfiles([...(byUserId || []), ...(byEmail || [])]);
    if (profileCandidates.length === 0) return null;
    const selected = profileCandidates.sort(
      (a, b) => scoreProfileCandidate(b, user, normalizedEmail) - scoreProfileCandidate(a, user, normalizedEmail)
    )[0] as AttendeeProfile;

    if (!selected.user_id) {
      await supabase
        .from('attendee_profiles')
        .update({ user_id: user.id })
        .eq('id', selected.id);
      return { ...selected, user_id: user.id } as AttendeeProfile;
    }

    return selected;
  },

  async syncNameAcrossUserRecords(user: User, profileId: string, fullName: string): Promise<void> {
    const normalizedName = fullName.trim();
    if (!normalizedName) return;

    const results = await Promise.all([
      supabase
        .from('events')
        .update({ host_name: normalizedName })
        .eq('host_user_id', user.id),
      supabase
        .from('event_attendees')
        .update({ guest_name: normalizedName })
        .or(`user_id.eq.${user.id},attendee_profile_id.eq.${profileId}`)
        .eq('added_by_type', 'self'),
      supabase
        .from('event_attendees')
        .update({ guest_name: normalizedName })
        .or(`user_id.eq.${user.id},attendee_profile_id.eq.${profileId}`)
        .is('added_by_type', null),
      supabase
        .from('event_interests')
        .update({ guest_name: normalizedName })
        .or(`user_id.eq.${user.id},attendee_profile_id.eq.${profileId}`),
      supabase
        .from('event_join_requests')
        .update({ guest_name: normalizedName })
        .or(`user_id.eq.${user.id},attendee_profile_id.eq.${profileId}`),
    ]);

    const errors = results
      .map((result) => result.error)
      .filter((error): error is NonNullable<typeof results[number]['error']> => !!error);
    if (errors.length > 0) {
      throw new Error(errors[0].message);
    }
  },

  async updateSignedInProfileName(user: User, fullName: string): Promise<Pick<SignedInProfileUpdateResult, 'profile' | 'nameSyncComplete'>> {
    const normalizedName = fullName.trim();
    if (!normalizedName) throw new Error('Please provide your name.');

    const { firstName, lastName } = splitNameParts(normalizedName);
    let profile = await this.getProfileForUser(user);
    if (!profile) {
      profile = await this.getOrCreateProfileForUser(user, normalizedName);
    }

    const { data: updatedProfile, error: updateProfileError } = await supabase
      .from('attendee_profiles')
      .update({
        first_name: firstName,
        last_name: lastName,
        user_id: user.id,
      })
      .eq('id', profile.id)
      .select('*')
      .single();
    if (updateProfileError) throw updateProfileError;

    profile = updatedProfile as AttendeeProfile;
    let nameSyncComplete = true;
    try {
      await this.syncNameAcrossUserRecords(user, profile.id, normalizedName);
    } catch (syncError) {
      nameSyncComplete = false;
      console.warn('Could not fully sync profile name across records:', syncError);
    }

    return { profile, nameSyncComplete };
  },

  async updateSignedInProfile(user: User, options: { fullName: string; email: string }): Promise<SignedInProfileUpdateResult> {
    const normalizedName = options.fullName.trim();
    const normalizedEmail = normalizeEmail(options.email || '');
    if (!normalizedName) throw new Error('Please provide your name.');
    if (!normalizedEmail) throw new Error('Please provide your email.');

    let profile = await this.getProfileForUser(user);
    if (!profile) {
      profile = await this.getOrCreateProfileForUser(user, normalizedName);
    }
    let emailChangeRequested = false;
    let nameSyncComplete = true;

    const currentProfileEmail = normalizeEmail(profile.email || '');
    if (normalizedEmail !== currentProfileEmail) {
      if (normalizedEmail !== normalizeEmail(user.email || '')) {
        const { error: authUpdateError } = await supabase.auth.updateUser({ email: normalizedEmail });
        if (authUpdateError) throw authUpdateError;
        emailChangeRequested = true;
      }
      profile = await this.addEmailToProfile(profile.id, normalizedEmail);
    }

    const nameUpdate = await this.updateSignedInProfileName(user, normalizedName);
    profile = nameUpdate.profile;
    nameSyncComplete = nameUpdate.nameSyncComplete;
    return { profile, emailChangeRequested, nameSyncComplete };
  },
};
