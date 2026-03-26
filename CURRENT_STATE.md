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
- automated verification

## Implemented Today

### Product features

- signed-out landing page
- signed-in dashboard
- public search and browse
- public / semi-public / private visibility modes
- delayed-auth create flow
- create and edit activity forms
- host dashboard
- access requests for semi-public activities
- attendee list and waitlist
- proxy RSVP / "add another person"
- "thinking about it"
- lightweight AI moderation for broader public discovery on public/semi-public activities
- Google Calendar link
- `.ics` download
- co-host support

### Identity / auth behavior

- Supabase magic-link sign-in
- guest session persistence via `attendee_sessions`
- `attendee_profiles` used for both guests and signed-in users
- signed-in users synchronized into the guest/profile-backed identity model

### Backend/data behavior

- direct Supabase client access from the SPA
- RLS-sensitive flows routed through RPCs for RSVP/cancel/proxy/interest where needed
- route-aware private link building for semi-public activities
- filtered realtime on the host dashboard
- Supabase Edge Function moderation with content-hash reuse and stored discovery state

## Partial Or Awkward

### Guest recovery

This is the biggest product/docs mismatch.

What is real:

- `/recover?token=...` can restore a guest session

What is not fully realized:

- the "Find my bookings" UI in `/login?recovery=true` currently sends a normal Supabase OTP email
- `guestService.sendRecoveryEmail()` exists but is not wired into the UI and still contains TODO-level email sending scaffolding

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

AI moderation now exists for public/semi-public discovery, but the operational tooling is still intentionally light.

What is real:

- public browse is gated by `events.public_discovery_enabled`
- public/semi-public activities are marked `pending` again when meaningful public-facing content changes
- a Supabase Edge Function writes structured moderation results back onto `events`

What is still minimal:

- there is no dedicated reviewer dashboard
- manual overrides currently mean editing moderation fields in Supabase Studio / admin tooling
- trust scoring is intentionally simple and based on prior hosted-activity count, not a richer reputation system

## Not Implemented / Not Production-Ready

These things are either planned, partial, or explicitly not complete:

- Google OAuth
- a polished guest recovery email delivery system
- a unified guest/auth identity model
- automated tests
- a clean contributor process backed by migrations/CI
- a full moderation review queue / operator UI

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
