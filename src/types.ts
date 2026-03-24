export interface Event {
  id: string;
  slug: string;
  title: string;
  description?: string;
  public_summary?: string;
  location_text?: string;
  public_location_text?: string;
  google_maps_url?: string;
  starts_at: string;
  timezone?: string;
  duration_minutes?: number;
  ends_at?: string;
  capacity: number;
  host_user_id: string;
  host_name?: string;
  host_contact_text?: string;
  show_host_publicly?: boolean;
  access_code?: string;
  visibility?: 'public' | 'semi_public' | 'private';
  allow_waitlist: boolean;
  is_public: boolean;
  status: 'scheduled' | 'cancelled' | 'completed';
  created_at: string;
  updated_at: string;
  confirmed_count?: number;
}

export interface EventAccessRequest {
  id: string;
  event_id: string;
  requester_name: string;
  requester_whatsapp: string;
  requester_note?: string | null;
  status: 'pending' | 'approved' | 'declined' | 'contacted';
  created_at: string;
  updated_at: string;
}

export interface Attendee {
  id: string;
  event_id: string;
  user_id?: string;
  attendee_profile_id?: string;
  added_by_type?: 'self' | 'proxy' | 'host' | null;
  added_by_attendee_profile_id?: string | null;
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
