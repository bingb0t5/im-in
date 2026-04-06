export interface Event {
  id: string;
  slug: string;
  public_slug?: string;
  private_slug?: string;
  copied_from_event_id?: string | null;
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
  join_code?: string;
  visibility?: 'public' | 'semi_public' | 'private';
  allow_waitlist: boolean;
  require_host_approval_for_join?: boolean;
  require_guest_email_for_join?: boolean;
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

export type ActivityRelationshipState =
  | 'SHARED_WITH_USER'
  | 'REQUESTED'
  | 'ATTENDING'
  | 'HOSTING';

export interface ActivityWithRelationship extends Event {
  relationship_state: ActivityRelationshipState;
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
export type FeedbackSubmissionStatus =
  | 'pending_review'
  | 'queued_to_trello'
  | 'blocked_abuse'
  | 'approved'
  | 'rejected'
  | 'archived';
export type FeedbackTrelloSyncStatus = 'not_sent' | 'queued' | 'synced' | 'skipped' | 'failed';

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

export interface FeedbackAdminItem {
  id: string;
  submission_type: FeedbackSubmissionType;
  title: string;
  details: string;
  reporter_name?: string | null;
  reporter_email?: string | null;
  auth_user_id?: string | null;
  page_url?: string | null;
  status: FeedbackSubmissionStatus;
  abuse_risk_level?: 'low' | 'medium' | 'high' | null;
  abuse_confidence?: number | null;
  abuse_reasons: string[];
  abuse_blocked: boolean;
  codex_prompt_draft?: string | null;
  codex_prompt_generated_at?: string | null;
  trello_card_id?: string | null;
  trello_card_url?: string | null;
  trello_list_id?: string | null;
  trello_sync_status: FeedbackTrelloSyncStatus;
  screenshot_storage_path?: string | null;
  screenshot_signed_url?: string | null;
  public_sanitized_summary?: string | null;
  raw_source?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventAccessRequest {
  id: string;
  event_id: string;
  requester_user_id?: string | null;
  requester_name: string;
  requester_whatsapp: string;
  requester_note?: string | null;
  status: 'pending' | 'approved' | 'declined' | 'contacted';
  created_at: string;
  updated_at: string;
}

export interface EventJoinRequest {
  id: string;
  event_id: string;
  user_id?: string | null;
  attendee_profile_id?: string | null;
  guest_name: string;
  guest_email?: string | null;
  request_note?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewed_by_user_id?: string | null;
  reviewed_at?: string | null;
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
  guest_email?: string | null;
  status: 'confirmed' | 'waitlist' | 'pending_approval' | 'cancelled';
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
  guest_email?: string | null;
  visibility_mode: 'count_only' | 'named';
  created_at: string;
  updated_at: string;
}

export type NotificationType =
  | 'activity_shared'
  | 'activity_updated'
  | 'waitlist_added'
  | 'waitlist_promoted'
  | 'attendance_changed'
  | 'host_message'
  | 'system';

export interface NotificationItem {
  id: string;
  recipient_user_id: string;
  actor_user_id?: string | null;
  event_id?: string | null;
  type: NotificationType | string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  action_url?: string | null;
  action_label?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface WaitlistPosition {
  id: string;
  event_id: string;
  attendee_id: string;
  position: number;
  created_at: string;
}
