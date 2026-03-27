# PROJECT_ARCHITECTURE

## Purpose Of This Document

This document describes the **current implemented architecture** of the app as it exists in the repository now.

It is intentionally descriptive, not aspirational.

Where something is incomplete, partial, or historically layered, this document says so explicitly.

## System Overview

`I'm In` is a frontend-first React SPA backed directly by Supabase.

At a practical level, the system is built around:

- public, semi-public, and private activity pages
- a lightweight create/edit flow for hosts
- a host management page
- a public browse/search page
- a dual identity model that supports both signed-in users and guest-session-based attendees

The app still uses `event` naming internally in code, routes, and database tables. The live product language is **activity / activities**.

## Product Reality

### What the app currently does

- lets hosts create and manage activities
- lets guests and signed-in users RSVP
- supports waitlists
- supports proxy RSVP / adding another person
- supports "thinking about it" interests
- supports semi-public access requests
- supports co-hosts
- supports Google Calendar links and `.ics` downloads
- supports guest-session bookings and token-based recovery route handling
- supports hidden moderation review tooling for allowlisted admins for public-facing activity moderation
- supports a public moderation transparency page for public-facing moderation history

### What it does not currently do well

- it does not have a fully coherent guest-recovery product flow end to end
- it does not have an automated test suite
- it does not have a single definitive schema artifact
- it does not have a unified user identity model yet

## Runtime Architecture

### Deployment model

- static browser SPA
- no first-party backend server in this repository
- direct browser access to Supabase using the anon key

### Main runtime dependencies

- React 19
- TypeScript
- Vite 6
- Tailwind CSS v4
- `react-router-dom`
- `motion`
- `@supabase/supabase-js`

### Security model

There is no hidden application server protecting business rules.

The real enforcement model is:

- Supabase Auth
- Supabase RLS
- SECURITY DEFINER RPCs in SQL
- client behavior staying aligned with those assumptions

That means frontend changes, SQL changes, and documentation changes should be treated as one unit for high-risk flows.

## Route And Page Structure

The route table lives in `src/App.tsx`.

### Current routes

| Route | Page | Current behavior |
|---|---|---|
| `/` | `src/pages/Home.tsx` | Public home page for everyone |
| `/my-activities` | `src/pages/MyActivities.tsx` | Signed-in hosting/attending dashboard |
| `/login` | `src/pages/Login.tsx` | Magic-link sign-in; also hosts the "Find my bookings" recovery entry UI |
| `/create-event` | `src/pages/CreateEvent.tsx` | Create flow; signed-out users can still fill the form before auth |
| `/host/events/:id/edit` | `src/pages/CreateEvent.tsx` | Edit mode; requires signed-in user |
| `/events/:slug` | `src/pages/EventDetail.tsx` | Attendee-facing activity detail page |
| `/host/events/:id` | `src/pages/HostDashboard.tsx` | Host/co-host management page |
| `/calendar` | `src/pages/Calendar.tsx` | Public browse/search page |
| `/moderation` | `src/pages/ModerationTransparency.tsx` | Public-facing moderation transparency log for public activity moderation and semi-public preview moderation |
| `/admin/moderation` | `src/pages/AdminModeration.tsx` | Hidden allowlist-gated moderation queue and override tooling |
| `/bookings` | `src/pages/Bookings.tsx` | Guest-session bookings page |
| `/recover` | `src/pages/Recovery.tsx` | Token-based guest-session restore |
| `*` | redirect | Redirects to `/` |

### Important routing nuances

- `/` stays public even when a user is signed in
- `/my-activities` is the main signed-in personal area for hosting and attending
- `/host/events/:id` and `/host/events/:id/edit` are auth-gated in `App.tsx`
- `/create-event` is not route-gated because the delayed-auth create flow is intentional
- `/moderation` is public and only surfaces public-facing moderation records
- `/admin/moderation` requires both a signed-in user and an allowlisted admin email
- `/bookings` is not the general signed-in attendee dashboard; it is guest-session driven
- `/login` redirects authenticated users to `/create-event`, not `/`
- unknown routes redirect to `/`

## Page Responsibilities

### `Home.tsx`

- landing page
- primary CTAs: create activity, browse public activities, activities I'm in
- "Why this exists" and "Help build it" modal content
- stays the public home page even for signed-in users
- signed-in users get a CTA into `/my-activities` instead of replacing the page with a dashboard

### `MyActivities.tsx`

- signed-in hosting vs attending dashboard
- hosted activities from both `events.host_user_id` and `event_hosts`
- joined activities plus "thinking about it" merged together
- pending semi-public access requests for hosted activities
- public search box that navigates to `/calendar?q=...`

### `Login.tsx`

- magic-link-only sign-in through `signInWithOtp`
- optional recovery-mode UI when `?recovery=true`
- recovery mode currently also sends `signInWithOtp`, not a guest-session recovery token

### `CreateEvent.tsx`

- create and edit form
- delayed-auth create flow
- local draft persistence
- timezone-aware scheduling
- duration-based scheduling instead of direct end-time authoring
- signed-in host-name hydration and normalization
- co-host access check for edit mode

### `EventDetail.tsx`

- activity read page
- attendee list rendering
- signed-in and guest RSVP
- cancellation
- waitlist messaging
- proxy RSVP / add another person
- "thinking about it"
- semi-public request-to-view flow
- Google Calendar + `.ics` actions
- share-link choices
- host-view detection for semi-public/private access

### `HostDashboard.tsx`

- host/co-host management page
- attendee and waitlist views
- add/remove attendee actions
- copy/share public and private links
- access-request review
- host list and add-host flow
- duplicate activity
- delete activity

### `Calendar.tsx`

- fetches future `events` where `is_public = true`
- only shows items where `public_discovery_enabled = true`
- supports search via query param
- hides exact time for semi-public previews
- prefers private access links for already-joined semi-public attendees when available
- shows a subtle count of other upcoming activities in the next 7 days that are not publicly visible, excluding spam-marked items
- shows a create-activity CTA in the empty state
- links to the public moderation transparency page

### `AdminModeration.tsx`

- hidden moderation operations page
- fetches public activities plus semi-public preview moderation state
- groups items into review, archived, spam, and all buckets
- supports manual archive separate from discovery override
- calls the moderation Edge Function for manual overrides and AI re-runs
- now requires a moderator-written public explanation for manual public-facing moderation decisions

### `ModerationTransparency.tsx`

- public-facing moderation transparency page
- reads a public-safe moderation log through a dedicated RPC
- only shows moderation history for public content and semi-public previews
- supports action filters and per-activity filtering
- uses stable pseudonymous moderator handles rather than full personal names
- can open the current public-facing activity page in a modal preview using a safe read path

### `Bookings.tsx`

- guest-session booking history
- merges bookings and interests
- not driven by Supabase auth user state

### `Recovery.tsx`

- validates a guest-session token from the URL
- stores it back into local storage
- routes to `/bookings`

## Frontend Structure

### Core top-level files

- `src/main.tsx`: mount/bootstrap
- `src/App.tsx`: session bootstrap, auth listener, route table
- `src/supabase.ts`: Supabase client creation
- `src/types.ts`: shared data types
- `src/utils.ts`: general-purpose formatting/time/calendar helpers

### Shared helpers

`src/lib/` is the main shared logic layer.

Important files:

- `authRedirect.ts`: deployment-aware auth redirect URL building
- `admin.ts`: frontend admin-email allowlist helpers
- `navigation.ts`: `goBackOr(...)`
- `events.ts`: event-path building and count hydration
- `functions.ts`: authenticated Supabase Edge Function invocation helper
- `moderation.ts`: shared moderation types, hash logic, and UI messaging helpers
- `attendees.ts`: attendee ownership and summary helpers
- `bookings.ts`: booking grouping
- `interests.ts`: "thinking about it" helpers
- `rsvp.ts`: shared RSVP decision helpers

### Services

- `src/services/guestService.ts`: guest session storage, validation, profile creation/sync, guest bookings/interests lookup, and signed-in profile normalization helpers

### Current frontend boundary quality

What is good:

- key navigation, event path, booking grouping, and RSVP helper logic has been extracted from pages
- page responsibilities are readable once you understand the product

What is still weak:

- several pages still own too much business logic
- display-name resolution logic is duplicated in multiple places
- host and attendee flows still mix UI concerns with data integrity decisions
- some write paths are RPC-based while others are still direct table mutations

## Auth And Identity Architecture

## Current truth

The app currently has **two linked identity systems**:

- Supabase Auth users
- guest-session identity built on `attendee_profiles` and `attendee_sessions`

They are not yet unified.

### Signed-in path

`App.tsx`:

- calls `supabase.auth.getSession()`
- subscribes to `onAuthStateChange`
- on user availability, calls `guestService.getOrCreateProfileForUser(user)`

This means signed-in users are also projected into the guest/profile-backed identity layer.

### Guest path

Guest attendees use:

- `attendee_profiles`
- `attendee_sessions`
- local storage token persistence

This guest session is then used by:

- `/bookings`
- guest RSVP/proxy flows
- token restore via `/recover`

### Delayed-auth create path

This is a deliberate UX design:

- anonymous user can fill the create form
- save triggers email capture + magic link
- draft persists locally
- after sign-in, the user finishes saving

This is important current product behavior and should not be accidentally removed.

### Recovery reality

There are two related but not fully aligned recovery concepts:

- `/recover?token=...` correctly restores a guest session if a valid token exists
- `/login?recovery=true` presents a recovery UI, but currently sends a Supabase OTP email rather than a guest-session recovery email

Also:

- `guestService.sendRecoveryEmail()` exists but still contains TODO-level email delivery scaffolding and is not wired into the login flow

This is one of the clearest code/product/docs mismatches in the current repo.

## Activity Lifecycle

### Host lifecycle

1. Open `/create-event`
2. Fill in form fields including visibility, schedule, capacity, and host details
3. If signed out, authenticate at save time
4. Save to `events`
5. Upsert creator into `event_hosts`
6. Manage activity through `/host/events/:id`
7. Edit, duplicate, share, manage attendees, add co-hosts, or delete

### Attendee lifecycle

1. Discover activity via direct link or `/calendar`
2. Open `/events/:slug`
3. RSVP, join waitlist, think about it, or request view access
4. For guests, create/restore guest session
5. Return later through `/bookings` or direct link

### Semi-public access lifecycle

1. Activity appears in public browse because `is_public = true`
2. Public preview hides some details
3. User without access token can submit an access request
4. Host acts from `HostDashboard.tsx`
5. Host shares private link containing `?access=...`
6. Joined users may later navigate via a private path when the app knows their access code

## Visibility And Share Model

### Current practical contract

- `is_public = true` means the activity may appear in browse/search
- `is_public = false` means it should not appear in public browse
- `public_discovery_enabled = true` is the extra gate that allows broader public discovery
- `visibility = public` means public details are intended to be fully visible
- `visibility = semi_public` means public preview plus host-shared private access
- `visibility = private` means unlisted/link-only behavior
- platform moderation and public transparency apply to public-facing content
- for `semi_public`, only the preview surface is in scope; private-link-only details stay outside platform moderation privacy boundaries

### Important nuance

`is_public` and `visibility` are related but not identical.

In the current code:

- both `public` and `semi_public` resolve to `is_public = true`
- `private` resolves to `is_public = false`

So contributors should think of:

- `is_public` as the broad browse flag
- `visibility` as the product-level visibility mode
- `public_discovery_enabled` as the moderation/trust gate for whether a public-capable item is actually shown in `/calendar`

### Share behavior

- public link: `/events/:slug`
- semi-public private link: `/events/:slug?access=...`
- host dashboard offers both public and private link copy/share options for semi-public activities
- attendee navigation uses `buildEventPath(...)` to prefer private link when known

## Data Flow And Supabase Usage

### Tables the app actually relies on

- `events`
- `event_attendees`
- `event_hosts`
- `event_interests`
- `event_access_requests`
- `attendee_profiles`
- `attendee_sessions`

### Tables defined but not central to current frontend logic

- `event_waitlist_positions` exists in SQL but is not queried directly by the frontend

### Common page-level queries

- `Home.tsx`: public landing, community messaging, public CTAs
- `MyActivities.tsx`: hosted events, joined events, interests, pending access requests
- `Calendar.tsx`: future public/discoverable events, hidden upcoming count, and joined private-access map
- `CreateEvent.tsx`: create/edit event reads and writes
- `EventDetail.tsx`: activity, attendees, interests, access requests, RSVP and proxy flows
- `HostDashboard.tsx`: event, attendees, interests, access requests, co-hosts
- `AdminModeration.tsx`: moderation queue and override operations
- `ModerationTransparency.tsx`: public-safe moderation history feed
- `guestService.ts`: profile/session reads and writes

## RPC And Trigger Architecture

### RPCs the app actively depends on

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

### RLS helper functions used in SQL

- `is_event_host(...)`
- `event_host_count(...)`
- `can_read_event_row(...)`

### Read-boundary note

Public and semi-public discovery should not rely on direct broad `events` table reads anymore.

Current intended model:

- public browse uses safe RPCs that return preview-safe fields
- activity detail uses `get_event_for_view(...)` so semi-public pages can expose only their public preview unless the private access token is present
- guest-session restore uses dedicated RPCs instead of nested raw `events (*)` reads
- the base `events` table policy should be treated as a narrower membership/host read layer, not the public product API

### Important architectural caveat

The waitlist / RSVP model is not fully single-sourced.

Current behavior is split across:

- frontend helper logic
- RPCs in `supabase_reconcile_live_schema.sql`
- older trigger/function logic in `supabase_schema.sql`

This is one of the highest-risk architecture areas because changes can drift between layers.

## Realtime Usage

### `EventDetail.tsx`

- subscribes to `event_attendees`
- subscribes to `event_interests`
- currently subscribes broadly, not event-filtered

### `HostDashboard.tsx`

- subscribes to `event_attendees` filtered by `event_id`
- subscribes to `event_access_requests` filtered by `event_id`
- subscribes to `event_interests` filtered by `event_id`

## SQL / Schema Architecture

### Important SQL files

- `supabase_schema.sql`
- `supabase_reconcile_live_schema.sql`
- `supabase_guest_identity_migration.sql`
- `SCHEMA_ALIGNMENT.md`

### Current schema truth

There is no single perfect schema artifact in the repo.

In practice:

- `supabase_schema.sql` is a starter snapshot
- `supabase_reconcile_live_schema.sql` contains many of the current reliability/RPC expectations
- `supabase_guest_identity_migration.sql` bootstraps guest/profile/session structures
- `SCHEMA_ALIGNMENT.md` documents some known drift and historical caveats

Contributors should not assume `supabase_schema.sql` alone fully represents the live database.

## Configuration And Deployment Assumptions

### Environment variables

Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Recommended:

- `VITE_APP_URL`

Legacy optional:

- `APP_URL`

### Build/runtime assumptions

- Vite dev server runs on port `3000`
- build output is `dist`
- `BrowserRouter` requires SPA rewrites to `index.html`
- deployment URL correctness matters for auth redirect behavior

### Vite notes

`vite.config.ts`:

- injects Supabase env vars with `define`
- includes React and Tailwind plugins
- allows disabling HMR through `DISABLE_HMR=true`

## Known Tradeoffs And Risks

### 1. Identity complexity

The dual signed-in / guest-session model is functional but harder to reason about than a unified identity system.

### 2. Guest recovery mismatch

Product messaging suggests a stronger recovery story than the wired implementation currently delivers.

### 3. Schema drift

Current functionality depends on a combination of starter schema, reconcile SQL, and live-database reality.

### 4. Mixed write patterns

Some high-risk flows use RPCs, while some host-side actions still write directly to tables.

### 5. Waitlist authority is split

Triggers, helper logic, and RPC paths all participate in waitlist behavior.

### 6. No automated tests

There is currently no automated protection for:

- auth/bootstrap
- delayed-auth create flow
- guest bookings and recovery
- RSVP/proxy/cancel flows
- semi-public request/share flows
- co-host behavior

## Files New Contributors Should Read First

- `README.md`
- `FEATURES.md`
- `CURRENT_STATE.md`
- `SCHEMA_OR_DATA_MODEL.md`
- `src/App.tsx`
- `src/pages/CreateEvent.tsx`
- `src/pages/EventDetail.tsx`
- `src/pages/HostDashboard.tsx`
- `src/services/guestService.ts`
- `supabase_reconcile_live_schema.sql`
- `SCHEMA_ALIGNMENT.md`

## Summary

The current architecture is intentionally lightweight, but it is no longer trivial.

Its strengths are:

- directness
- clear page-level ownership
- useful shared helpers
- strong product flexibility around visibility, guest use, and host workflows

Its biggest maintenance risks are:

- identity complexity
- schema drift
- mixed business-rule authority between frontend helpers and SQL
- incomplete recovery-product alignment
