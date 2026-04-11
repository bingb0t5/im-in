# CURRENT_STATE

## Purpose

This document is the practical "truth on the ground" summary for the repo.

It is intended to help contributors understand:

- what is implemented now
- what is partial or awkward
- what is planned but not real yet
- what the biggest review findings were

## High-Level Summary

`I'm In` is currently a usable community activity app with a meaningful amount of implemented product behavior.

The strongest implemented areas are:

- activity creation and editing
- public browsing
- semi-public/private link behavior
- RSVP, waitlist, cancellation, and proxy RSVP
- host dashboard and co-host management
- guest-session bookings
- "thinking about it" interest tracking

The weakest / least finished areas are:

- guest recovery as a polished product flow
- schema/documentation coherence
- broad automated verification

## Implemented Today

### Product features

- signed-out landing page
- public home page for everyone
- signed-in dashboard at `/my-activities`
- `/my-activities` now defaults to `Attending` when the user has no upcoming hosted activities, reducing empty-state dead-ends for attendees
- public search and browse
- public browse grouped into `Today`, `Tomorrow`, weekday sections for the next 7 days, and `Later` beyond that
- public / semi-public / private visibility modes
- delayed-auth create flow
- create and edit activity forms with a multi-step visibility-first flow
- create/edit location flow can resolve shared Google Maps short links and prefill exact location details while the public-location filter is currently locked to `Hoi An, Vietnam`
- compact share shortcuts for private activity flows via `/loc/:code`, `/gcal/:code`, and `/ical/:code`
- host dashboard
- post-create success modal on the host dashboard with share / return actions that now persist correctly after the dashboard finishes loading
- access requests for semi-public activities
- attendee list and waitlist
- optional host-approval join flow before membership is granted
- optional host-controlled guest-email requirement for join flows
- proxy RSVP / "add another person" with host-approval-aware pending request behavior
- "thinking about it"
- post-signup email-upgrade prompt for no-email guest signups
- signed-in `/profile` account details now use compact inline per-field edit/save controls (`Name` and `Email`) with read-only defaults and no-op unchanged saves
- lightweight AI moderation for broader public discovery on public activities and semi-public public previews
- hidden moderation admin queue with review, archived, and spam buckets for allowlisted admins, scoped to public-facing activity moderation
- hidden admin hub at `/admin` that links to the current internal admin tools
- allowlisted admins can now reach the hidden admin tools from the main top-bar account menu
- public moderation transparency page for public-facing moderation history
- moderation transparency now prefers moderator profile display names when available instead of only pseudonymous handles
- home-page explainer content simplified into two modals: `Why this exists` and `Help build it`
- public feedback/report modal on home page with optional screenshot upload
- feedback ingestion pipeline with abuse filtering, sanitized Trello intake cards, and Trello list-triggered Codex prompt drafting
- Trello board webhook path for automatic prompt generation when cards enter the configured trigger list
- hidden `/admin/feedback` page for blocked abuse items, failed Trello syncs, unsent submissions, retry-to-board actions, and archive/restore
- hidden `/admin/feedback` page now also includes a passed-to-Trello bucket and permanent delete actions with typed confirmation
- feedback submission success now includes a direct link to the public dev board
- long and form-heavy modals now use cleaner mobile behavior, including sticky headers, internal sheet scrolling, background-page scroll lock, and no forced keyboard pop on open
- WhatsApp verification now persists the verified WhatsApp number on linked attendee profiles when returned by Lalo
- host dashboard contact and notification-recipient surfaces now show WhatsApp numbers more broadly when available
- host-sent in-app activity messages now support guest replies back to hosts through `guest_reply` notifications
- Google Calendar link
- `.ics` download
- co-host support

### Identity / auth behavior

- Supabase magic-link sign-in
- guest session persistence via `attendee_sessions`
- `attendee_profiles` used for both guests and signed-in users
- signed-in users synchronized into the guest/profile-backed identity model
- guests can join without email when host settings allow it, then add email later for recovery
- email upgrades now use a dedicated merge RPC so profile/session references move together instead of relying on fragile client-side multi-table updates
- linked profiles can now carry both a `lalo_user_id` and a verified `whatsapp_number` from the Lalo verification flow
- auth bootstrap now uses a shared session hook that retries reads, refreshes on focus/visibility, and clears stale invalid refresh tokens locally instead of leaving the UI stuck on a dead session
- WhatsApp auth completion now prefers server-minted Supabase session handoff (`setSession`) so returning users avoid unnecessary password rotation during verify/login completion

### Backend/data behavior

- direct Supabase client access from the SPA
- RLS-sensitive flows routed through RPCs for RSVP/cancel/proxy/interest where needed
- route-aware private link building for semi-public activities
- dedicated join-request queue (`event_join_requests`) plus host approve/reject RPCs for approval-required activities
- approval-required joins now create visible `event_attendees` rows in `pending_approval` state so pending people show in `Going`
- public and semi-public activities now always expose host names from the create/edit flow
- share helpers now generate richer private WhatsApp share payloads with direct map and calendar shortcut links
- hosts can now use calendar export actions even when they are not personally attending
- calendar exports now use Google Maps share URLs as the calendar location when available
- new-activity success state is carried into the host dashboard so the one-time modal can survive the initial dashboard load
- `list_my_hosted_events()`, `list_my_shared_activities()`, and `list_my_joined_activities()` now return `confirmed_count` and `thinking_count` directly so dashboard counts come from the RPC layer instead of per-row client fan-out
- filtered realtime on the host dashboard
- Supabase Edge Function moderation with content-hash reuse and stored discovery state
- separate reviewer archive state for the moderation queue via `events.moderation_archived_at`
- moderation defaults now clear stale manual overrides when relevant public-facing content changes and requires fresh review
- public moderation audit records stored separately from activity rows
- separate feedback-domain tables for feedback submissions and Trello prompt-generation jobs
- webhook-compatible Trello prompt generation with manual admin fallback support
- feedback screenshots reviewed privately through signed URLs in admin tooling
- feedback-item deletion removes the internal row, related prompt-job rows, and stored screenshot object
- in-app host messaging now includes a guest reply path via `reply_to_event_hosts(...)`

## Partial Or Awkward

### Guest recovery

This is the biggest product/docs mismatch.

What is real:

- `/recover?token=...` can restore a guest session

What is not fully realized:

- the "Find my bookings" UI in `/login?recovery=true` currently sends a normal Supabase OTP email
- `guestService.sendRecoveryEmail()` exists but is not wired into the UI and still contains TODO-level email sending scaffolding

### Identity hardening progress

Recent account work improved several previously fragile areas:

- signed-in profile hydration no longer pushes stale auth emails back over canonical profile emails during pending email-confirmation windows
- signed-in RSVP now creates/loads a profile before submit, aligning with the safer signed-in interest flow
- post-magic-link create return now only forces `One Last Step` when profile details are genuinely missing
- profile merges now happen through `merge_attendee_profiles(...)` in SQL so attendee ownership, inviter attribution, sessions, interests, and join requests are moved together

What is still not fully solved:

- `attendee_profiles` policies are still permissive in the guest bootstrap SQL and have not yet been fully tightened around `auth.uid()` ownership
- the app still uses a dual identity model rather than a fully unified auth/profile model

### Bookings split

`/bookings` is still a guest-session-first page.

That means:

- guest users use it as designed
- signed-in users mainly use Home for their attending view
- some product wording can make this distinction easy to miss

### Waitlist authority

Waitlist behavior is not fully owned by one layer.

There is still a split between:

- frontend helper logic
- current RPCs
- older trigger/function logic in the starter schema file

### Schema source of truth

There is no single definitive schema artifact in the repo today.

You need to read multiple files together:

- `supabase_schema.sql`
- `supabase_reconcile_live_schema.sql`
- `supabase_guest_identity_migration.sql`
- `SCHEMA_ALIGNMENT.md`

### Moderation operations

Platform moderation now exists for public discovery, but the operational tooling is still intentionally light and scoped to public-facing activity content only.

What is real:

- public browse is gated by `events.public_discovery_enabled`
- public activities are marked `pending` again when meaningful public-facing content changes
- semi-public activities are marked `pending` again only when public-preview fields change
- a Supabase Edge Function writes structured moderation results back onto `events`
- a hidden admin page at `/admin/moderation` allows allowlisted admins to review items, archive queue entries, mark spam, and apply manual overrides
- archive is separate from hide/review, so queue housekeeping does not change the effective moderation decision by itself
- a public moderation transparency page at `/moderation` exposes public-facing moderation history with neutral language
- manual moderator decisions can now include a required public explanation that is shown in the transparency log
- transparency log entries can open the current public-facing activity page in a modal preview
- semi-public private-link-only content stays outside platform moderation review and outside the public moderation log
- private activities are excluded from platform moderation review and from the public moderation log

What is still minimal:

- the reviewer UI is intentionally lightweight and hidden, not a full operations console
- trust scoring is intentionally simple and based on prior hosted-activity count, not a richer reputation system

### Modal / mobile UX

Recent modal cleanup improved a few previously annoying interaction issues:

- long home-page modals now keep their own scroll instead of asking the browser page behind them to do part of the work
- the main user-facing modal flows now lock body scroll so closing a modal returns people to the same page position they started from
- form modals no longer auto-focus the first input on open, which avoids mobile keyboards immediately pushing the sheet upward before the user is ready

## Not Implemented / Not Production-Ready

These things are either planned, partial, or explicitly not complete:

- Google OAuth
- a polished guest recovery email delivery system
- a unified guest/auth identity model
- broad automated test coverage
- a clean contributor process backed by migrations/CI
- a richer moderation operations console

Note:

- feedback reporting exists now, but deeper workflow automation from Trello to external coding agents is still future work
- prompt generation is currently written back into Trello card descriptions, not pushed directly into Cursor/Codex
- internal feedback review exists now, but it is still a lightweight hidden tool rather than a full operations console

## Important Review Findings

### Product / UX findings

- the app has a clear real product now, not just scaffolding
- the visibility/share model is richer than older docs/checklists suggested
- the host/co-host flow is materially implemented
- the "thinking about it" flow is real and spans Home, Bookings, Calendar, EventDetail, HostDashboard, and SQL

### Architecture findings

- page responsibilities are understandable, but some pages still own too much logic
- the app has improved shared helper structure in `src/lib/` and `src/services/`
- some logic is still duplicated across pages, especially around display-name resolution and attendee/host labeling

### Auth / identity findings

- the app truly uses a dual identity model
- signed-in users are not the only "real" users in the data model
- guest sessions are important real application state
- recovery messaging currently overstates the strength of the implemented recovery experience

### Schema findings

- current frontend behavior expects `event_hosts` and `event_interests`, but older docs under-described them
- the repo relies on RPCs that are not the same as the older starter-schema RSVP function story
- `event_waitlist_positions` exists in SQL but is not directly queried by the frontend

### Documentation findings

Before this review, the core docs were directionally good but incomplete.

The biggest gaps were:

- under-documenting `event_interests`
- under-documenting co-host behavior
- not clearly enough separating guest bookings from signed-in dashboard behavior
- not clearly enough separating the public home page from the signed-in dashboard
- stale release checklist references to Google login
- not having a practical contributor/current-state doc set

## What Contributors Should Assume

- product language is "activity", even though code/database say `event`
- guest identity is first-class in practice
- schema and frontend are tightly coupled
- changing RSVP/waitlist/visibility/auth without reading both code and SQL is risky
- docs are now more accurate, but live Supabase still matters more than historical snapshots

## Recommended Follow-Up Areas

### Highest-value follow-up

- decide whether guest recovery should become a real productized flow or be reframed more honestly
- reduce mixed client/RPC/trigger ownership around waitlist behavior
- add smoke-test coverage for the highest-risk flows

### Good cleanup work

- centralize display-name resolution and identity formatting
- reduce direct host-side attendee writes where RPCs would be safer
- keep release and historical checklist docs from drifting again
