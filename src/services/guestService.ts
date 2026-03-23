import { supabase } from '../supabase';
import { Attendee } from '../types';

export interface AttendeeProfile {
  id: string;
  email: string;
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

  async createGuestSession(email: string, firstName: string, lastName: string, userId?: string): Promise<GuestSession> {
    // 1. Get or create profile
    let profile: AttendeeProfile;
    const { data: existingProfile } = await supabase
      .from('attendee_profiles')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existingProfile) {
      profile = existingProfile;
      // Update name if it changed, and user_id if provided
      await supabase
        .from('attendee_profiles')
        .update({ 
          first_name: firstName || profile.first_name, 
          last_name: lastName || profile.last_name,
          user_id: userId || profile.user_id 
        })
        .eq('id', profile.id);
    } else {
      const { data: newProfile, error: profileError } = await supabase
        .from('attendee_profiles')
        .insert([{ 
          email: email.toLowerCase(), 
          first_name: firstName, 
          last_name: lastName,
          user_id: userId || null
        }])
        .select()
        .single();
      
      if (profileError) throw profileError;
      profile = newProfile;
    }

    // 2. Create session
    const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
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

  async getMyBookings(token: string): Promise<any[]> {
    const profile = await this.validateSession(token);
    if (!profile) return [];

    const { data, error } = await supabase
      .from('event_attendees')
      .select(`
        *,
        events (*)
      `)
      .eq('attendee_profile_id', profile.id)
      .neq('status', 'cancelled')
      .order('joined_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  async sendRecoveryEmail(email: string): Promise<void> {
    const { data: profile } = await supabase
      .from('attendee_profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!profile) {
      // Don't reveal if email exists or not, but we won't send anything
      return;
    }

    const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour for recovery

    await supabase
      .from('attendee_sessions')
      .insert([{
        attendee_profile_id: profile.id,
        token,
        expires_at: expiresAt.toISOString()
      }]);

    const recoveryUrl = `${window.location.origin}/recover?token=${token}`;
    console.log('Recovery URL (Simulated Email):', recoveryUrl);
    // In a real app, you'd send this via an email service
    alert(`Recovery link sent to ${email} (Check console for link in this demo)`);
  },

  async getOrCreateProfileForUser(user: any, name?: string): Promise<AttendeeProfile> {
    const email = user.email!;
    const names = (name || user.user_metadata?.full_name || '').split(' ');
    const firstName = names[0] || '';
    const lastName = names.slice(1).join(' ') || '';

    let profile: AttendeeProfile;
    const { data: existingProfile } = await supabase
      .from('attendee_profiles')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existingProfile) {
      profile = existingProfile;
      // Update user_id if not set, and name if provided
      const updates: any = {};
      if (!profile.user_id) updates.user_id = user.id;
      if (firstName && !profile.first_name) updates.first_name = firstName;
      if (lastName && !profile.last_name) updates.last_name = lastName;

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
          email: email.toLowerCase(), 
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
