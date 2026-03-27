# FEATURES

## Purpose

This document is a full feature reference for `I'm In`.

It is meant to answer:

- what features the app currently has
- how each feature works in practice
- who each feature is for
- what parts are solid vs partial

It reflects the app **as currently implemented**, not planned future behavior.

## Product Summary

`I'm In` is a lightweight community activity app for organizing, sharing, discovering, and joining real-world activities.

It is designed to work alongside the WhatsApp groups and community networks people already use. The app does not try to replace chat. Instead, it provides a clearer layer for:

- publishing an activity
- managing who is coming
- handling waitlists
- sharing the right link
- keeping host/admin tasks simple

Although the codebase still uses `event` language internally, the live product language is **activity / activities**.

## User Types

The app currently supports three practical user modes:

### 1. Signed-out visitor

Can:

- browse public activities
- open activity pages
- fill the create form before authenticating
- RSVP as a guest
- request access to semi-public activities

### 2. Signed-in user

Can:

- create and edit activities
- host or co-host activities
- RSVP using their signed-in identity
- manage hosted activities if authorized
- use the signed-in dashboard on `Home`

### 3. Guest-session user

This is a user who is not necessarily using a full signed-in auth session, but does have a guest profile/session token.

Can:

- RSVP and have that participation remembered
- view their guest bookings in `/bookings`
- restore the guest session through `/recover?token=...`

## Main Product Areas

### Landing page

Implemented in `src/pages/Home.tsx`.

Features:

- signed-out product landing page
- primary CTAs for:
  - `Create an Activity`
  - `What's On`
  - `Activities I'm In`
- "Why this exists" modal
- "Help build it" modal
- roadmap and email links

### Signed-in dashboard

Also implemented in `src/pages/Home.tsx`.

Features:

- hosting view
- attending view
- public search field that routes into `/calendar?q=...`
- list of hosted activities
- list of joined activities
- list of "thinking about it" activities merged into attending
- pending access-request panel for hosted semi-public activities

### Public browse / search

Implemented in `src/pages/Calendar.tsx`.

Features:

- shows future activities where `is_public = true`
- only lists activities where `public_discovery_enabled = true`
- search by query string
- public list styling for browse mode
- semi-public previews show reduced detail
- if a signed-in attendee already has access to a semi-public activity, the app prefers the private link path when they click it
- shows a subtle count of other upcoming activities in the next 7 days that are not currently visible in public discovery, excluding spam-marked items
- when the public list is empty, offers a `Create your own activity` CTA

### Activity detail page

Implemented in `src/pages/EventDetail.tsx`.

Features:

- read activity details
- view attendance state
- RSVP
- cancel RSVP
- join waitlist
- add another person
- mark "thinking about it"
- request access for semi-public activities
- host visibility/contact display when configured
- share actions
- Google Calendar action
- `.ics` download action

### Create / edit page

Implemented in `src/pages/CreateEvent.tsx`.

Features:

- create activity
- edit activity
- delayed-auth save flow
- host name hydration for signed-in hosts
- visibility controls
- timezone select
- duration select
- capacity and waitlist settings
- public vs private summary/location inputs
- optional Google Maps link

### Host dashboard

Implemented in `src/pages/HostDashboard.tsx`.

Features:

- manage one activity
- attendee and waitlist lists
- add attendee manually
- remove attendee
- share/copy links
- WhatsApp share actions
- access request review
- host/co-host management
- duplicate activity
- delete activity

### Guest bookings / recovery

Implemented in:

- `src/pages/Bookings.tsx`
- `src/pages/Recovery.tsx`
- partially through `src/pages/Login.tsx`

Features:

- guest bookings list
- guest interests list merged into bookings
- restore session by token URL

Important caveat:

- the guest recovery story is only partially implemented as a product flow

## Feature Reference

## 1. Activity Creation

### What it does

Lets a host create a new activity with scheduling, visibility, capacity, and host details.

### How it works

- route: `/create-event`
- page: `CreateEvent.tsx`
- signed-out users can complete the form before auth
- on save, unsigned users are prompted for email and sent a magic link
- draft state is stored locally until the user comes back and completes save

### Current fields supported

- title
- public summary
- private/full description
- public location text
- private/full location text
- optional Google Maps link
- start date/time
- timezone
- duration
- capacity
- host name
- host contact text
- visibility
- allow waitlist
- show host publicly

### Notes

- newly created activities default to `semi_public`
- for signed-in users, host name is auto-hydrated and treated as account-backed

## 2. Activity Editing

### What it does

Lets the primary host or an authorized co-host update an existing activity.

### How it works

- route: `/host/events/:id/edit`
- page: `CreateEvent.tsx` in edit mode
- requires signed-in user
- checks both:
  - legacy primary host via `events.host_user_id`
  - co-host membership via `event_hosts`

### Notes

- edit flow also normalizes stale host names for the primary host when possible
- capacity increases can trigger waitlist promotion logic client-side

## 3. Delayed-Auth Create Flow

### What it does

Allows a signed-out visitor to start creating an activity without being forced to sign in first.

### How it works

- form is accessible without auth
- draft is stored in local storage
- save triggers magic-link email prompt
- after sign-in, the user returns and can finish saving the same activity

### Why it matters

This is one of the most distinctive UX features in the app and should be treated as deliberate product behavior.

## 4. Public Browse

### What it does

Lets users discover upcoming public-facing activities.

### How it works

- route: `/calendar`
- page: `Calendar.tsx`
- fetches only:
  - scheduled activities
  - future activities
  - `is_public = true`
- `public_discovery_enabled = true`

### Search behavior

- query string key: `q`
- search checks:
  - title
  - `location_text`
  - `public_location_text`

## 5. Visibility Modes

### `public`

How it works:

- appears in public browse when discovery is enabled
- public detail is fully visible
- exact time is shown publicly

### `semi_public`

How it works:

- appears in public browse when discovery is enabled
- public preview is intentionally limited
- full access comes from a private host-shared link using `?access=...`
- non-members can submit a request to view/join

### `private`

How it works:

- not shown in public browse
- intended as link-only / unlisted

### Important implementation nuance

The app uses both:

- `is_public`
- `visibility`

Current practical behavior:

- `public` and `semi_public` both end up with `is_public = true`
- `private` ends up with `is_public = false`

## 6. Semi-Public Access Requests

### What it does

Allows a user to request access to a semi-public activity when they do not yet have the private access link.

### How it works

User side:

- user opens semi-public activity without valid private access
- sees limited preview
- can open a request modal
- submits:
  - name
  - WhatsApp
  - optional note

Host side:

- request is stored in `event_access_requests`
- host sees requests in `HostDashboard.tsx`
- host can:
  - approve/share link
  - request more info
  - decline

### Current UX behavior

- pending requests show in the host UI
- approved and declined requests are archived into separate views/tallies

## 7. RSVP

### What it does

Lets a person join an activity.

### How it works

- page: `EventDetail.tsx`
- supports signed-in RSVP
- supports guest RSVP
- uses the `submit_rsvp(...)` RPC for the main flow

### Identity handling

The app may match the person through:

- `user_id`
- `attendee_profile_id`
- `guest_email`

### Notes

- this is a high-risk flow because identity and waitlist behavior overlap here

## 8. Waitlist

### What it does

Places additional RSVPs on a waitlist when the activity is full and waitlist is enabled.

### How it works

- attendee sees waitlist state through RSVP logic
- cancellation can promote the next person
- host dashboard shows waitlist attendees

### Important caveat

Waitlist behavior is not fully owned by one layer. It is split across:

- frontend helper logic
- current RPC behavior
- older starter-schema trigger/function logic

## 9. Cancellation

### What it does

Lets an attendee or host cancel/remove attendance.

### How it works

- attendee-side cancellation runs through `cancel_attendee_with_promotion(...)`
- host-side attendee removal also uses the same RPC path

### Why it matters

This central RPC path is important because it avoids more fragile direct mutation behavior for cancellation and promotion.

## 10. Proxy RSVP / Add Another Person

### What it does

Lets a person add someone else to the activity without making that second person sign in themselves.

### How it works

- page: `EventDetail.tsx`
- host dashboard also has host-side attendee add flow
- attendee-facing proxy add uses `add_proxy_attendee(...)`

### Current behavior

- supports adding another person after joining
- supports host-added and proxy-added labeling in attendee lists
- proxy-added rows track provenance through:
  - `added_by_type`
  - `added_by_attendee_profile_id`

## 11. Thinking About It

### What it does

Lets a user save an activity as a possible interest without formally joining.

### How it works

- backed by `event_interests`
- toggled via `toggle_event_interest(...)`
- shown in:
  - `Home`
  - `Bookings`
  - `Calendar`
  - `EventDetail`
  - `HostDashboard`

### Visibility behavior

- public activities use `count_only`
- semi-public/private activities can use `named`

### UX behavior

- appears as a distinct state from RSVP
- on some screens it is merged into attendance-style lists for convenience

## 12. Guest Session Persistence

### What it does

Lets guests continue to access their activity participation without a full signed-in auth account.

### How it works

- profile stored in `attendee_profiles`
- session token stored in `attendee_sessions`
- token persisted in browser local storage
- bookings loaded through `guestService`

## 13. Guest Bookings

### What it does

Shows a guest-session user the activities they are in.

### How it works

- route: `/bookings`
- page: `Bookings.tsx`
- reads bookings from guest session token
- also includes “thinking about it” rows

### Important caveat

This is not the main signed-in attendee dashboard. Signed-in users mainly use `Home` for their attending view.

## 14. Recovery

### What it does

Provides a way to restore a guest session.

### What is implemented

- `/recover?token=...` validates and restores a guest session token

### What is partial

- `/login?recovery=true` uses a “Find my bookings” UI, but currently sends a normal Supabase OTP email
- `guestService.sendRecoveryEmail()` exists but is not currently the active UI path and still has TODO-level email delivery scaffolding

## 15. Host Dashboard

### What it does

Gives a host a management interface for one activity.

### Current capabilities

- view date/time and stats
- manage attendees
- manage waitlist
- manage interests
- review access requests
- share/copy public and private links
- open WhatsApp sharing actions
- view and manage hosts
- duplicate the activity
- delete the activity

## 16. Co-Hosts

### What it does

Lets a host add additional hosts with equal practical management rights.

### How it works

- backed by `event_hosts`
- create/edit/manage checks consider:
  - primary host through `events.host_user_id`
  - co-hosts through `event_hosts`

### Current capabilities

- add co-host by email
- view host list
- leave as host if not the last host
- duplicate activity with hosts carried forward

### Current constraint

- host UI currently enforces a 10-host cap

## 17. Sharing

### What it does

Lets hosts and attendees share the right activity link for the situation.

### How it works

- public link: `/events/:slug`
- semi-public private link: `/events/:slug?access=...`
- host dashboard offers explicit public/private link handling for semi-public activities
- `buildEventPath(...)` is used in shared navigation logic to prefer private access paths when appropriate

## 18. WhatsApp-Oriented Flows

### What exists

- activity pages and host flows are clearly designed around WhatsApp usage patterns
- host dashboard supports WhatsApp share behavior
- semi-public request handling is WhatsApp-oriented
- host contact text can be used for direct messaging

### What does not exist

- there is no full WhatsApp platform integration or bot/backend in this repo
- it is mostly link generation and message-launch behavior

## 19. Calendar Export

### Google Calendar

- available after self-RSVP
- uses URL-based Google Calendar template generation

### `.ics` export

- available after self-RSVP
- generated client-side through helper logic in `utils.ts`

### Limitation

- this is not two-way synced calendar integration

## 20. Timezone And Duration

### What it does

Makes activity scheduling less dependent on device-local assumptions.

### How it works

- UTC storage
- explicit activity timezone
- duration-based end time
- 15-minute increments

### Current default

- default timezone: `Asia/Ho_Chi_Minh`

## 21. Host Name And Identity Normalization

### What it does

Attempts to keep host names and attendee display names aligned with the best available identity source.

### How it works

- signed-in users are synchronized into `attendee_profiles`
- create/edit/manage flows try to normalize stale host names
- profile/account name data can win over older saved host-name strings

### Why it exists

- the app has legacy overlap between:
  - email-handle-derived names
  - profile names
  - stored host names

## 22. Realtime Updates

### What it does

Keeps some host and attendee views refreshed when data changes.

### Current use

`EventDetail.tsx`:

- attendee updates
- interest updates

`HostDashboard.tsx`:

- attendee updates
- access request updates
- interest updates

### Caveat

- detail-page subscriptions are broader/chattier than ideal

## 23. Landing-Page Messaging / Community Positioning

### What exists

The app currently includes:

- "Why this exists" messaging
- "Help build it" messaging
- roadmap link
- contact email

### Current positioning

- community-oriented
- open-build / open-roadmap tone
- framed as useful alongside existing groups rather than a replacement for them

## 24. Current Feature Gaps / Partial Areas

These are important because they affect how confidently someone should describe the product.

### Partially implemented or rough

- guest recovery product flow
- schema as a single-source artifact
- waitlist authority consistency
- automated test coverage

### Explicitly not current features

- Google OAuth
- a unified single user model
- a dedicated backend server in this repo
- full sync calendar integration
- production-grade guest recovery email delivery

## 25. AI Moderation And Review Queue

### What it does

Adds a lightweight discovery gate for public and semi-public activities so broader public browse can stay open without exposing every listing immediately.

### How it works

- public and semi-public activities are reset to `pending` when meaningful public-facing fields change
- the moderation Edge Function classifies the saved activity and writes structured fields back to `events`
- trusted hosts may get slightly softer outcomes for some medium-risk low-detail cases
- the public browse page only shows activities where `public_discovery_enabled = true`

### Review tooling

- hidden page: `/admin/moderation`
- frontend access is controlled by `VITE_MODERATION_ADMIN_EMAILS`
- server-authorized override actions are controlled by `MODERATION_ADMIN_EMAILS`
- queue buckets include `review`, `archived`, and `spam`
- archive is a reviewer housekeeping action and is separate from hide/review

### Manual actions

- force visible
- force limited
- hide / review
- mark safe
- mark spam
- archive / return to review
- re-run AI moderation

## 26. Most Important Behavioral Caveats

### `/bookings` is guest-session driven

It is easy to assume this is the general attendee dashboard. It is not.

### Recovery is split

Token restore exists. Email-driven guest recovery is not fully productized.

### Visibility depends on both `is_public` and `visibility`

Contributors need to understand both fields, not just one.

### Waitlist logic is not fully single-sourced

Changes in this area need extra care.

### Schema truth is distributed

There is no single perfect schema file.

## Related Docs

For more detail, read:

- `README.md`
- `PROJECT_ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `CONTRIBUTING.md`
- `SCHEMA_OR_DATA_MODEL.md`
- `AI_DEV_RULES.md`
- `AUTH_UNIFICATION_PLAN.md`
- `SCHEMA_ALIGNMENT.md`

## Short Summary

The app currently has a broad, real feature set:

- create/edit
- browse/search
- RSVP/waitlist/cancel
- proxy attendance
- interests
- semi-public access requests
- co-hosts
- guest bookings
- calendar export

Its strongest features are around real community use and host workflow.

Its biggest remaining rough edges are around recovery, identity complexity, schema clarity, and waitlist/RPC/source-of-truth consistency.
