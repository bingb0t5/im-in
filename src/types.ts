export interface Event {
  id: string;
  slug: string;
  title: string;
  description?: string;
  location_text?: string;
  starts_at: string;
  ends_at?: string;
  capacity: number;
  host_user_id: string;
  host_name?: string;
  host_contact_text?: string;
  allow_waitlist: boolean;
  is_public: boolean;
  status: 'scheduled' | 'cancelled' | 'completed';
  created_at: string;
  updated_at: string;
  confirmed_count?: number;
}

export interface Attendee {
  id: string;
  event_id: string;
  user_id?: string;
  attendee_profile_id?: string;
  guest_name: string;
  guest_email: string;
  status: 'confirmed' | 'waitlist' | 'cancelled';
  joined_at: string;
  promoted_at?: string;
  cancelled_at?: string;
}

export interface WaitlistPosition {
  id: string;
  event_id: string;
  attendee_id: string;
  position: number;
  created_at: string;
}
