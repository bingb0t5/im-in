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
  participation_mode?: 'rsvp' | 'interest_only' | 'external_contact' | 'view_only';
  interest_visibility?: 'count_only' | 'named' | 'hidden';
  origin_type?: 'host_created' | 'imported_community_source' | 'imported_verified_partner' | 'curated_manual';
  event_source_id?: string | null;
  external_event_draft_id?: string | null;
  source_attribution_label?: string | null;
  source_url?: string | null;
  source_last_checked_at?: string | null;
  trust_badge?: 'hosted_in_im_in' | 'community_listing' | 'verified_partner' | 'curated' | null;
  is_claimable?: boolean;
  claimed_by_host_id?: string | null;
  external_contact_mode?: 'none' | 'whatsapp' | 'website' | 'email' | 'manual' | null;
  external_contact_value?: string | null;
  custom_join_field_config?: EventCustomJoinFieldConfig | null;
  is_public: boolean;
  gallery_visibility?: EventGalleryVisibility;
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

export type EventCustomJoinFieldType = 'text' | 'number' | 'select';

export interface EventCustomJoinFieldConfig {
  enabled: boolean;
  type: EventCustomJoinFieldType;
  label: string;
  required: boolean;
  options?: string[] | null;
}

export type EventGalleryVisibility = 'private_only' | 'public_preview';
export type EventGalleryPublicVisibilityStatus =
  | 'private_only'
  | 'pending'
  | 'approved'
  | 'blocked'
  | 'error'
  | 'report_hidden';

export interface EventGalleryImage {
  id: string;
  event_id?: string;
  storage_bucket?: string;
  storage_path?: string;
  original_file_name?: string | null;
  content_type?: string | null;
  file_size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  sort_order: number;
  public_visibility_status: EventGalleryPublicVisibilityStatus;
  public_moderation_reasons?: string[] | null;
  public_moderation_confidence?: number | null;
  public_moderated_at?: string | null;
  public_hidden_at?: string | null;
  public_hidden_reason?: string | null;
  review_requested_at?: string | null;
  report_count?: number;
  signed_url?: string | null;
  is_public_preview_visible?: boolean;
  can_report?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface GalleryAdminItem extends EventGalleryImage {
  event_id: string;
  event?: {
    id: string;
    slug: string;
    title: string;
    host_name?: string | null;
    visibility?: 'public' | 'semi_public' | 'private' | null;
    is_public?: boolean | null;
    gallery_visibility?: EventGalleryVisibility | null;
  } | null;
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
  moderator_display_name: string;
  target_created_at?: string | null;
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
  requester_attendee_profile_id?: string | null;
  requester_name: string;
  requester_whatsapp: string;
  requester_note?: string | null;
  grant_source?: 'request' | 'copy_inheritance' | string | null;
  status: 'pending' | 'approved' | 'declined' | 'contacted';
  created_at: string;
  updated_at: string;
}

export interface EventJoinRequest {
  id: string;
  event_id: string;
  user_id?: string | null;
  resolved_user_id?: string | null;
  attendee_profile_id?: string | null;
  guest_name: string;
  resolved_display_name?: string | null;
  guest_email?: string | null;
  whatsapp_number?: string | null;
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
  resolved_user_id?: string | null;
  attendee_profile_id?: string;
  added_by_type?: 'self' | 'proxy' | 'host' | null;
  added_by_attendee_profile_id?: string | null;
  guest_name: string;
  resolved_display_name?: string | null;
  guest_email?: string | null;
  whatsapp_number?: string | null;
  status: 'confirmed' | 'waitlist' | 'pending_approval' | 'cancelled';
  joined_at: string;
  promoted_at?: string;
  cancelled_at?: string;
}

export interface EventSignupFieldAnswer {
  id: string;
  event_id: string;
  event_attendee_id?: string | null;
  event_join_request_id?: string | null;
  answer_value: string;
  field_label_snapshot?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventInterest {
  id: string;
  event_id: string;
  user_id?: string | null;
  resolved_user_id?: string | null;
  attendee_profile_id?: string | null;
  guest_name: string;
  resolved_display_name?: string | null;
  guest_email?: string | null;
  whatsapp_number?: string | null;
  visibility_mode: 'count_only' | 'named';
  created_at: string;
  updated_at: string;
}

export interface EventSource {
  id: string;
  name: string;
  source_type: 'google_doc' | 'google_sheet' | 'pdf' | 'web_page' | 'manual_text';
  source_url?: string | null;
  community_name?: string | null;
  description?: string | null;
  default_location_area?: string | null;
  default_community_tags?: string[];
  default_age_tags?: string[];
  owner_name?: string | null;
  owner_contact?: string | null;
  trust_level: 'community_source' | 'known_organiser' | 'verified_partner' | 'internal_curated';
  is_active: boolean;
  last_imported_at?: string | null;
  last_fetch_status?: 'idle' | 'queued' | 'fetching' | 'extracting' | 'submitting' | 'succeeded' | 'failed' | 'retryable';
  last_fetch_error?: string | null;
  last_fetch_job_id?: string | null;
  last_fetched_at?: string | null;
  last_snapshot_id?: string | null;
  last_reviewed_at?: string | null;
  last_published_at?: string | null;
  sync_mode: 'manual' | 'semi_manual' | 'automatic';
  notes?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceSnapshot {
  id: string;
  event_source_id: string;
  raw_content_text: string;
  raw_content_hash: string;
  raw_metadata_json?: Record<string, unknown>;
  captured_at: string;
  capture_method: 'manual_paste' | 'fetched' | 'uploaded_file';
  ingestion_job_id?: string | null;
  ingestion_status_message?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface ExternalEventDraft {
  id: string;
  event_source_id: string;
  source_snapshot_id: string;
  review_status: 'new' | 'needs_review' | 'approved' | 'rejected' | 'published' | 'superseded';
  raw_title?: string | null;
  raw_text_block?: string | null;
  parsed_title?: string | null;
  parsed_summary?: string | null;
  parsed_description?: string | null;
  parsed_location_name?: string | null;
  parsed_location_area?: string | null;
  parsed_google_maps_url?: string | null;
  parsed_contact_name?: string | null;
  parsed_contact_method?: string | null;
  parsed_contact_value?: string | null;
  parsed_activity_type?: string | null;
  parsed_community_tags?: string[];
  parsed_age_min?: number | null;
  parsed_age_max?: number | null;
  parsed_age_band_labels?: string[];
  parsed_visibility?: 'public' | 'semi_public' | 'private';
  parsed_is_recurring?: boolean;
  parsed_recurrence_text?: string | null;
  parsed_rrule?: string | null;
  parsed_start_datetime?: string | null;
  parsed_end_datetime?: string | null;
  parsed_timezone?: string | null;
  parsed_day_of_week?: string | null;
  parsed_confidence_score?: number | null;
  normalization_warnings?: string[];
  duplicate_candidate_event_ids?: string[];
  linked_published_event_id?: string | null;
  import_notes?: string | null;
  review_notes?: string | null;
  status_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportWorkerJob {
  id: string;
  source_id: string;
  source_url: string;
  source_type_hint?: string | null;
  status: 'queued' | 'fetching' | 'extracting' | 'submitting' | 'succeeded' | 'failed' | 'retryable' | 'cancelled';
  attempt_count: number;
  max_attempts: number;
  response_url?: string | null;
  http_status?: number | null;
  content_hash?: string | null;
  requested_by?: string | null;
  worker_label?: string | null;
  retried_from_job_id?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  result_json?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
  fetched_at?: string | null;
}

export type NotificationType =
  | 'activity_shared'
  | 'activity_updated'
  | 'waitlist_added'
  | 'waitlist_promoted'
  | 'attendance_changed'
  | 'host_join'
  | 'host_message'
  | 'guest_reply'
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

export type PushNotificationCategory = NotificationType;

export interface NotificationPreferenceItem {
  category: PushNotificationCategory | string;
  push_enabled: boolean;
}

export interface PushSubscriptionItem {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  platform?: string | null;
  is_standalone: boolean;
  last_seen_at: string;
  revoked_at?: string | null;
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
