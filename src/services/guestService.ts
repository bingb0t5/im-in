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
}

export interface GuestSession {
  token: string;
  profile: AttendeeProfile;
}

const GUEST_SESSION_KEY = 'im_in_guest_session';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function buildSystemGuestEmail(seed: string) {
  return `guest+${seed}@guest.im-in.local`;
}

export function isSystemGuestEmail(email?: string | null) {
  const normalized = normalizeEmail(email || '');
  return normalized.endsWith('@guest.im-in.local') || normalized.endsWith('@proxy.im-in.local');
}

function pickFirstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
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
      await supabase
        .from('attendee_profiles')
        .update({
          first_name: firstName || profile.first_name,
          last_name: lastName || profile.last_name,
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
      // Merge identity references so the existing email-backed profile becomes canonical.
      await Promise.all([
        supabase
          .from('event_attendees')
          .update({ attendee_profile_id: existingByEmail.id })
          .eq('attendee_profile_id', profileId),
        supabase
          .from('event_interests')
          .update({ attendee_profile_id: existingByEmail.id })
          .eq('attendee_profile_id', profileId),
        supabase
          .from('event_join_requests')
          .update({ attendee_profile_id: existingByEmail.id })
          .eq('attendee_profile_id', profileId),
        supabase
          .from('attendee_sessions')
          .update({ attendee_profile_id: existingByEmail.id })
          .eq('attendee_profile_id', profileId),
      ]);

      await supabase
        .from('attendee_profiles')
        .delete()
        .eq('id', profileId);

      return existingByEmail as AttendeeProfile;
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

  async getOrCreateProfileForUser(user: User, name?: string): Promise<AttendeeProfile> {
    const email = normalizeEmail(user.email!);
    const names = (name || getAccountNameFromUser(user) || '').split(' ');
    const firstName = names[0] || '';
    const lastName = names.slice(1).join(' ') || '';

    let profile: AttendeeProfile;
    const { data: existingProfile } = await supabase
      .from('attendee_profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      profile = existingProfile;
      // Keep the signed-in profile aligned to the current account identity.
      const updates: Partial<Pick<AttendeeProfile, 'user_id' | 'first_name' | 'last_name'>> = {};
      if (!profile.user_id) updates.user_id = user.id;
      if (firstName && firstName !== (profile.first_name || '')) updates.first_name = firstName;
      if (lastName !== (profile.last_name || '')) updates.last_name = lastName;

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
          email, 
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
  }
};
