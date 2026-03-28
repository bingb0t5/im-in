# SCHEMA_OR_DATA_MODEL

## Purpose

This document explains the data model the app **actually relies on**.

It is not a promise that a single SQL file in the repo fully matches production.

When working on schema-sensitive behavior, read this alongside:

- `supabase_schema.sql`
- `supabase_reconcile_live_schema.sql`
- `supabase_guest_identity_migration.sql`
- `SCHEMA_ALIGNMENT.md`

## Important Truth First

The app's real operational data model is spread across multiple SQL artifacts and frontend assumptions.

Do not assume `supabase_schema.sql` alone is the full production truth.

## Core Entities

### `events`

This is the main activity table.

Important fields the frontend uses:

- `id`
- `slug`
- `title`
- `description`
- `public_summary`
- `location_text`
- `public_location_text`
- `google_maps_url`
- `starts_at`
- `ends_at`
- `timezone`
- `duration_minutes`
- `capacity`
- `host_user_id`
- `host_name`
- `host_contact_text`
- `show_host_publicly`
- `access_code`
- `visibility`
- `allow_waitlist`
- `require_host_approval_for_join`
- `is_public`
- `public_discovery_enabled`
- `moderation_status`
- `moderation_risk_level`
- `moderation_action`
- `moderation_confidence`
- `moderation_reasons`
- `moderation_input_hash`
- `moderated_at`
- `moderation_archived_at`
- `moderation_override`
- `status`

Important behavioral meaning:

- `is_public` controls whether the activity can appear in public browse
- `visibility` controls whether it behaves as `public`, `semi_public`, or `private`
- `access_code` is used to construct the private semi-public link
- `public_discovery_enabled` is the additional gate for broader public discovery
- `require_host_approval_for_join` controls whether join attempts become pending host-reviewed requests
- `show_host_publicly` still exists in data, but the create/edit product flow now treats host names as always public for `public` and `semi_public` activities
- moderation fields store the latest public-moderation classification, any simple manual override state, and an optional reviewer archive timestamp for the admin queue
- platform moderation applies to public-facing activity content
- `semi_public` preview fields are in scope for platform moderation and transparency logging
- `semi_public` private-link-only fields and `private` activities stay outside that workflow

### `public_moderation_log_entries`

This table stores the public moderation transparency history.

Important fields:

- `id`
- `target_type`
- `target_id`
- `target_visibility_snapshot`
- `public_title_snapshot`
- `public_slug_snapshot`
- `action`
- `reason_code`
- `public_explanation`
- `moderator_public_handle`
- `moderator_internal_id`
- `created_at`

Important behavioral meaning:

- only public-facing moderation records should ever be written here
- `target_visibility_snapshot` records that the target was public at the time of moderation
- `moderator_internal_id` is internal traceability data
- public-facing reads should happen through a safe RPC, not by exposing raw moderation internals directly

### `moderator_public_identities`

This table stores stable public-facing pseudonyms for moderators.

Important fields:

- `user_id`
- `public_handle`
- `created_at`

Important behavioral meaning:

- lets the public see that moderation actions are traceable to a stable moderator identity
- avoids exposing full personal names in the transparency log

### `feedback_submissions`

This table stores public feedback intake records (bug reports, feature requests, and general feedback).

Important fields:

- `id`
- `submission_type`
- `title`
- `details`
- `reporter_name`
- `reporter_email`
- `auth_user_id`
- `page_url`
- `status`
- `abuse_risk_level`
- `abuse_confidence`
- `abuse_reasons`
- `abuse_blocked`
- `codex_prompt_draft`
- `codex_prompt_generated_at`
- `trello_card_id`
- `trello_card_url`
- `trello_list_id`
- `trello_sync_status`
- `screenshot_storage_path`
- `public_sanitized_summary`
- `raw_source`
- `created_at`
- `updated_at`

Important behavioral meaning:

- stores full internal feedback details and moderation metadata
- Trello-facing content should be sanitized/minimized before public board posting
- optional screenshots are referenced through storage paths and should remain private

### `trello_prompt_jobs`

This table stores idempotent job records for Trello list-triggered Codex prompt generation.

Important fields:

- `id`
- `feedback_submission_id`
- `trello_card_id`
- `trello_action_id`
- `trigger_list_id`
- `trigger_snapshot`
- `status`
- `error_message`
- `generated_prompt`
- `card_name_snapshot`
- `processed_at`
- `created_at`
- `updated_at`

Important behavioral meaning:

- `trello_action_id` and `trigger_snapshot` are used to avoid duplicate prompt generation
- keeps a persistent audit trail of prompt-generation attempts and failures
- allows prompts to be generated for cards created inside Trello as well as cards originating from in-app feedback

### `event_attendees`

This is the main RSVP table.

Important fields:

- `id`
- `event_id`
- `user_id`
- `attendee_profile_id`
- `guest_name`
- `guest_email`
- `status`
- `joined_at`
- `promoted_at`
- `cancelled_at`
- `added_by_type`
- `added_by_attendee_profile_id`

Important behavioral meaning:

- `status` is currently `confirmed`, `waitlist`, `pending_approval`, or `cancelled`
- one activity can have both signed-in and guest-backed attendees
- proxy and host-added attendees are distinguished through `added_by_type`
- `pending_approval` rows are used so hosts and attendees can still see pending join requests directly in `Going`

### `event_hosts`

This table backs co-host support.

Important fields:

- `id`
- `event_id`
- `user_id`
- `added_by_user_id`
- `created_at`

Important behavioral meaning:

- a host can be the legacy primary host through `events.host_user_id`
- additional hosts live in `event_hosts`
- frontend host access checks usually consider both

### `event_interests`

This table backs the "thinking about it" feature.

Important fields:

- `id`
- `event_id`
- `user_id`
- `attendee_profile_id`
- `guest_name`
- `guest_email`
- `visibility_mode`
- `created_at`
- `updated_at`

Important behavioral meaning:

- `visibility_mode = count_only` is used for public activities
- `visibility_mode = named` is used for semi-public/private activities
- this is distinct from RSVP status

### `event_access_requests`

This table backs semi-public request-to-view behavior.

Important fields:

- `id`
- `event_id`
- `requester_name`
- `requester_whatsapp`
- `requester_note`
- `status`
- `created_at`
- `updated_at`

Current statuses visible in code:

- `pending`
- `approved`
- `declined`
- `contacted`

Important behavioral note:

- the current host UI mainly operates around `pending`, `approved`, and `declined`

### `event_join_requests`

This table backs host-reviewed join requests for activities where approval is required.

Important fields:

- `id`
- `event_id`
- `user_id`
- `attendee_profile_id`
- `guest_name`
- `guest_email`
- `request_note`
- `status`
- `reviewed_by_user_id`
- `reviewed_at`
- `created_at`
- `updated_at`

Current statuses visible in code:

- `pending`
- `approved`
- `rejected`
- `cancelled`

Important behavioral note:

- this queue is about membership approval, separate from semi-public request-to-view access
- join requests now create visible attendee rows in `event_attendees` as `pending_approval`
- host approval promotes those rows to `confirmed` or `waitlist` depending on current capacity and waitlist settings

### `attendee_profiles`

This is the shared identity bridge between guests and signed-in users.

Important fields:

- `id`
- `email`
- `first_name`
- `last_name`
- `full_name`
- `user_id`
- `created_at`
- `updated_at`

Important behavioral meaning:

- guests and signed-in users both end up represented here
- the app uses this table for names, session ownership, and attendee linkage
- signed-in users are synchronized into this table through `guestService.getOrCreateProfileForUser(...)`

### `attendee_sessions`

This table backs guest-session persistence.

Important fields:

- `id`
- `attendee_profile_id`
- `token`
- `expires_at`
- `created_at`
- `updated_at`

Important behavioral meaning:

- token is stored in local storage
- token can be restored via `/recover?token=...`
- guest bookings depend on this table

## Relationships

High-level relationships:

- one `events` row has many `event_attendees`
- one `events` row has many `event_hosts`
- one `events` row has many `event_interests`
- one `events` row has many `event_access_requests`
- one `events` row has many `event_join_requests`
- one `attendee_profiles` row can link to many `event_attendees`
- one `attendee_profiles` row can link to many `event_interests`
- one `attendee_profiles` row can have many `attendee_sessions`
- one `feedback_submissions` row can link to many `trello_prompt_jobs`
- one `feedback_submissions` row can optionally map to one `auth.users` row via `auth_user_id`
- one `auth.users` row can map to:
  - `events.host_user_id`
  - `event_hosts.user_id`
  - `event_attendees.user_id`
  - `attendee_profiles.user_id`

## Identity Model In Practice

## Signed-in users

Signed-in users come from Supabase Auth.

Important implementation fact:

- signed-in users are also synchronized into `attendee_profiles`

That means contributor code should often think in terms of:

- auth user identity
- profile identity

not just one or the other.

## Guests

Guests are tracked through:

- `attendee_profiles`
- `attendee_sessions`
- local storage token persistence

Guest bookings do not require a full signed-in auth user.

## Mixed identity matching

The app often matches a person through a combination of:

- `user_id`
- `attendee_profile_id`
- `guest_email`

This is why attendee matching and name resolution are more complex than a typical auth-only app.

## Visibility Model In Data Terms

### `public`

- `visibility = public`
- `is_public = true`
- browseable in `/calendar` when `public_discovery_enabled = true`
- public details shown
- eligible for platform moderation and public moderation transparency logging

### `semi_public`

- `visibility = semi_public`
- `is_public = true`
- browseable in `/calendar`
- public preview uses limited details
- full detail access depends on `access_code` or host/co-host context
- access requests live in `event_access_requests`
- public-preview fields are eligible for platform moderation and public moderation transparency logging
- private-link-only fields remain outside platform moderation and outside the public moderation transparency log

### `private`

- `visibility = private`
- `is_public = false`
- should not appear in public browse
- intended as unlisted/link-only
- not eligible for platform moderation review or the public moderation transparency log

## Waitlist And Attendance Behavior

Important reality:

- the frontend uses `event_attendees.status`
- the main operational RPCs use `event_attendees` as the basis for RSVP/cancel/promotion
- `event_waitlist_positions` exists in SQL but is not queried directly by the frontend

This means contributors should treat `event_waitlist_positions` as a historical or lower-level implementation detail unless they have confirmed its current production role.

## RPCs The Frontend Depends On

These RPCs are important to the current app:

- `submit_rsvp(...)`
- `cancel_attendee_with_promotion(...)`
- `add_proxy_attendee(...)`
- `toggle_event_interest(...)`
- `get_event_for_view(...)`
- `list_public_calendar_events(...)`
- `count_hidden_upcoming_activities(...)`
- `list_event_attendees_for_view(...)`
- `list_event_interests_for_view(...)`
- `get_guest_bookings(...)`
- `get_guest_interests(...)`

These are the safer paths for fragile operations.

The newer read-side RPCs matter for privacy as much as convenience:

- they let the app return semi-public preview fields without exposing private-link-only fields through raw table reads
- they keep guest booking restore working after tightening `events` read access
- they reduce reliance on broad `SELECT * FROM events` patterns for public-facing pages

The repo also contains older SQL functions and trigger-based behavior in the starter schema. Do not assume the frontend still uses those directly.

## Data Model Risks

### Schema drift

The repo has multiple schema-related files and live production may not exactly match all of them.

### Identity ambiguity

Many flows can identify a person through multiple fields. That is functional, but fragile.

### Mixed business-rule authority

Waitlist, RSVP, and cancellation behavior are split across frontend code, RPCs, and older SQL artifacts.

### Recovery mismatch

The guest-session restore route exists, but the login-side recovery messaging and implementation are not fully aligned with a true guest recovery system.

## What Contributors Should Check Before Schema-Sensitive Changes

Before changing auth, RSVP, recovery, visibility, or host logic:

1. read the relevant page files
2. read `guestService.ts`
3. check `supabase_reconcile_live_schema.sql`
4. check `SCHEMA_ALIGNMENT.md`
5. confirm whether the live database has already diverged from the repo snapshot

## Summary

The app's current data model is centered on:

- `events`
- `event_attendees`
- `event_hosts`
- `event_interests`
- `event_access_requests`
- `attendee_profiles`
- `attendee_sessions`

The hardest part to understand is not the table list, but the fact that:

- signed-in and guest users coexist
- profile-backed identity matters everywhere
- visibility is controlled by both `is_public` and `visibility`
- the operational truth depends on both code and SQL
