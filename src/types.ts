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
  public_discovery_enabled?: boolean;
  moderation_status?: 'not_required' | 'pending' | 'approved' | 'limited' | 'review' | 'blocked' | 'error';
  moderation_risk_level?: 'low' | 'medium' | 'high';
  moderation_action?: 'allow' | 'limit_visibility' | 'require_review' | 'block';
  moderation_confidence?: number;
  moderation_reasons?: string[];
  moderation_input_hash?: string;
  moderated_at?: string;
  moderation_archived_at?: string | null;
  moderation_override?: 'force_visible' | 'force_limited' | 'hide' | 'mark_safe' | 'mark_spam' | null;
  status: 'scheduled' | 'cancelled' | 'completed';
  created_at: string;
  updated_at: string;
  confirmed_count?: number;
  thinking_count?: number;
}

export interface PublicModerationLogEntry {
  id: string;
  target_type: 'activity';
  target_id: string;
  target_visibility_snapshot: 'public' | 'semi_public';
  public_title_snapshot: string | null;
  public_slug_snapshot?: string | null;
  action: 'approved' | 'denied' | 'flagged' | 'marked_spam' | 'restored' | 'removed';
  reason_code: string | null;
  public_explanation: string | null;
  moderator_public_handle: string;
  created_at: string;
}

export type FeedbackSubmissionType = 'bug' | 'feature' | 'feedback';

export interface FeedbackSubmissionPayload {
  submissionType: FeedbackSubmissionType;
  title: string;
  details: string;
  reporterName?: string;
  reporterEmail?: string;
  pageUrl?: string;
  screenshotDataUrl?: string;
  source?: string;
}

export interface FeedbackSubmissionResult {
  ok: boolean;
  submissionId: string;
  blockedByAbuse: boolean;
  queuedToTrello: boolean;
  screenshotStored: boolean;
  trelloCardId?: string | null;
  trelloCardUrl?: string | null;
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

export interface EventInterest {
  id: string;
  event_id: string;
  user_id?: string | null;
  attendee_profile_id?: string | null;
  guest_name: string;
  guest_email: string;
  visibility_mode: 'count_only' | 'named';
  created_at: string;
  updated_at: string;
}

export interface WaitlistPosition {
  id: string;
  event_id: string;
  attendee_id: string;
  position: number;
  created_at: string;
}
