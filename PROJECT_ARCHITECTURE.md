# PROJECT_ARCHITECTURE

## Overview

`I'm In` is a lightweight community activity app built as a frontend-first React SPA on top of Supabase.

At a product level, it supports three main jobs:

- hosts can create, edit, share, and manage activities
- guests and signed-in users can join activities, join waitlists, and add other people
- communities can browse public activities while semi-public/private activities stay partially or fully restricted

The codebase still uses `event` terminology in routes, tables, and many symbols, but the current user-facing product language is **activity / activities**.

## What The App Does

The app centers around simple, shareable activity pages and a lightweight host-management workflow.

Hosts can:

- create activities with title, descriptions, location, visibility, timezone, duration, capacity, and host details
- create while signed out, then complete sign-in only at save time through a magic-link flow
- choose activity visibility:
  - `public`: discoverable with full public details
  - `semi_public`: discoverable with limited public details, full details available through host-shared private access link
  - `private`: unlisted, link-only
- manage attendees and waitlist state
- add attendees manually
- duplicate activities
- handle semi-public access requests
- share public and/or private links

Attendees can:

- browse public activities on the calendar
- open activity detail pages without logging in
- RSVP as a signed-in user or as a remembered guest
- join a waitlist when full
- add another person to an activity
- cancel their own RSVP
- recover bookings later using the guest recovery flow

## Frontend Stack

- Framework: `React 19`
- Language: `TypeScript`
- Bundler/dev server: `Vite 6`
- Routing: `react-router-dom`
- Styling: `Tailwind CSS v4` via `@tailwindcss/vite`
- Motion/animation: `motion`
- Icons: `lucide-react`
- Utility helpers: `clsx`, `tailwind-merge`

Important frontend entry files:

- `src/main.tsx`: app bootstrap
- `src/App.tsx`: auth bootstrap, route table, protected routes
- `src/index.css`: Tailwind/base styling
- `src/types.ts`: shared domain types
- `src/utils.ts`: class merging, slug generation, timezone/duration/date helpers

Notes:

- The app uses `BrowserRouter`, so deployment requires SPA route fallback to `index.html`.
- UI is still page-centric; there is no large shared component system yet.

## Backend / Server Stack

There is no first-party backend server in this repository.

Runtime model:

- static/browser SPA
- direct client access to Supabase via `@supabase/supabase-js`
- Supabase Auth for magic-link sign-in
- Supabase Postgres for activities, attendees, guest identity, access requests, and related data
- Supabase Realtime for live attendee/access-request refreshes

Important backend-related files:

- `src/supabase.ts`: lazy Supabase client initialization
- `supabase_schema.sql`: baseline schema snapshot for fresh/non-production environments
- `supabase_reconcile_live_schema.sql`: safer live-schema reconciliation and RPC definitions
- `SCHEMA_ALIGNMENT.md`: notes about drift between the repository snapshot and the live database

Important nuance:

- This app is frontend-only and security depends heavily on Supabase RLS plus RPCs, not hidden server logic.

## Folder-By-Folder Explanation

### Root

- `package.json`: scripts and dependencies
- `package-lock.json`: npm lockfile
- `vite.config.ts`: Vite config and env wiring
- `tsconfig.json`: TypeScript config
- `index.html`: SPA HTML shell
- `.env.example`: documented environment variables
- `README.md`: setup/deployment guide
- `PROJECT_ARCHITECTURE.md`: architecture documentation
- `AI_DEV_RULES.md`: coding and safety guidance for contributors/agents
- `AUTH_UNIFICATION_PLAN.md`: review and phased plan for potentially unifying guest/auth identity
- `IMPLEMENTATION_CHECKLIST.md`: implementation roadmap/history
- `SCHEMA_ALIGNMENT.md`: schema drift notes
- `supabase_schema.sql`: repo snapshot schema
- `supabase_reconcile_live_schema.sql`: live-db reconciliation/RPC script
- `seed_data.sql`: sample seed data

### `src/`

- `main.tsx`: mounts the app
- `App.tsx`: initializes auth, handles config errors, defines routes
- `supabase.ts`: exports the Supabase client
- `index.css`: theme/base styles
- `types.ts`: shared `Event`, `Attendee`, `EventAccessRequest`, and related types
- `utils.ts`: formatting, timezone conversion, duration helpers, slugs

### `src/pages/`

- `Home.tsx`: signed-out landing page and signed-in host/attending dashboard
- `Login.tsx`: magic-link sign-in and guest booking recovery entry
- `CreateEvent.tsx`: create/edit activity form with delayed-auth save flow
- `EventDetail.tsx`: attendee-facing activity page, RSVP, proxy RSVP, cancellation, semi-public request flow
- `HostDashboard.tsx`: host management page for one activity
- `Calendar.tsx`: public browse/search page
- `Bookings.tsx`: guest/session booking history
- `Recovery.tsx`: restores a guest session from recovery token

### `src/services/`

- `guestService.ts`: guest identity, session storage, booking recovery, profile syncing

### `src/lib/`

Important shared logic now lives here:

- `authRedirect.ts`: builds auth redirect URLs using deployment-aware origin logic
- `navigation.ts`: back-button helper (`goBackOr`)
- `events.ts`: event path building and confirmed-count helpers
- `rsvp.ts`: shared RSVP decision helpers
- `attendees.ts`: shared attendee ownership/matching helpers
- `bookings.ts`: booking grouping helpers

## Auth Flow

The app has two linked identity systems:

1. Supabase Auth for signed-in users
2. guest profile/session identity for device-based attendees

### Signed-In Flow

1. `src/App.tsx` calls `supabase.auth.getSession()` on load.
2. `src/App.tsx` subscribes to `supabase.auth.onAuthStateChange(...)`.
3. Host routes such as `/host/events/:id` and `/host/events/:id/edit` require a signed-in `user`.
4. `src/Login.tsx` supports **magic-link only** via `signInWithOtp`.
5. `src/App.tsx` calls `guestService.getOrCreateProfileForUser(user)` so the signed-in user also maps into attendee/guest profile structures.

### Delayed-Auth Create Flow

`CreateEvent.tsx` intentionally allows a signed-out user to fill out the activity form before authentication.

Current flow:

1. signed-out user enters activity details
2. on save, the app prompts for email
3. `signInWithOtp` sends a magic link
4. form draft is persisted locally
5. after sign-in, the user returns to the create flow and completes save

This is an important product behavior and should be preserved unless intentionally redesigned.

### Guest Flow

1. A guest opens an activity page and RSVPs without traditional sign-in.
2. `EventDetail.tsx` uses `guestService` to create or restore a guest session.
3. `guestService` creates/reuses `attendee_profiles`, creates `attendee_sessions`, and stores the token in `localStorage`.
4. `Bookings.tsx` reads the stored session to show activity history.
5. `Recovery.tsx` restores the local guest session from a recovery link.

### Important Auth Constraints

- authenticated users still map to attendee/guest profile records
- guest identity is real application state, not disposable UI state
- guest recovery exists, but the recovery email sending path is still lightweight/demo-grade

### Auth Migration Note

There is now a dedicated planning document for the question of whether the app should collapse guest users and signed-in users into a single model:

- `AUTH_UNIFICATION_PLAN.md`

That document recommends treating this as a deliberate auth migration project, not a small cleanup task. The current recommended direction is:

- preserve low-friction first use
- avoid forcing magic-link auth at first touch
- prefer an anonymous-first unified session model if auth unification is pursued later

## Airtable Integration

There is no Airtable integration in this repository.

The actual backend integration is Supabase:

- `src/supabase.ts`
- `src/services/guestService.ts`
- page-level Supabase access
- `supabase_schema.sql`
- `supabase_reconcile_live_schema.sql`

If older planning docs mention Airtable, that does not reflect the current codebase.

## Supabase Data Model And Integration

### Core Tables / Concepts

The current app expects these major concepts in the live schema:

- `events`
- `event_attendees`
- `event_waitlist_positions`
- `attendee_profiles`
- `attendee_sessions`
- `event_access_requests`

Important `events` capabilities currently reflected in the frontend:

- `visibility`: `public | semi_public | private`
- `public_summary`
- `public_location_text`
- `show_host_publicly`
- `access_code`
- `google_maps_url`
- `timezone`
- `duration_minutes`

### Live Schema vs Repository Snapshot

`supabase_schema.sql` is useful, but it is not the guaranteed full production truth.

The live app behavior depends on schema/RPC details that are better represented in:

- `supabase_reconcile_live_schema.sql`
- `SCHEMA_ALIGNMENT.md`

Treat those docs/scripts as especially important when working on data flows.

### Current Reliability RPCs

The frontend relies on RPC helpers for some fragile attendee operations:

- `submit_rsvp(...)`
- `cancel_attendee_with_promotion(...)`
- `add_proxy_attendee(...)`

These are important because they encapsulate data integrity / RLS-sensitive flows.

### How Supabase Is Used In The App

- `Home.tsx`: fetches hosted/joined activities
- `Calendar.tsx`: fetches future public activities and private-access map for joined users
- `CreateEvent.tsx`: inserts/updates `events`
- `EventDetail.tsx`: reads activity/attendee/access-request records and performs RSVP flows
- `HostDashboard.tsx`: reads and manages attendees, access requests, duplication, share flows
- `guestService.ts`: guest profile/session lifecycle and booking recovery

### Realtime Usage

- `EventDetail.tsx` subscribes to `event_attendees`
- `HostDashboard.tsx` subscribes to `event_attendees`
- `HostDashboard.tsx` also subscribes to `event_access_requests`

## Important Routes / Pages

- `/`: `Home.tsx`
- `/login`: `Login.tsx`
- `/create-event`: `CreateEvent.tsx`
- `/host/events/:id/edit`: `CreateEvent.tsx` in edit mode
- `/events/:slug`: `EventDetail.tsx`
- `/host/events/:id`: `HostDashboard.tsx`
- `/calendar`: `Calendar.tsx`
- `/bookings`: `Bookings.tsx`
- `/recover`: `Recovery.tsx`

Routing behavior:

- unknown routes redirect to `/`
- host manage/edit routes require Supabase auth
- public activity pages are accessible without login
- semi-public/private access behavior depends on activity visibility and optional `?access=` token

## Shared Utilities / Services

### `src/utils.ts`

Important helpers now include:

- `cn(...)`
- `formatDate(...)`
- `formatDay(...)`
- `formatTime(...)`
- `formatDateWithTimeZone(...)`
- `formatDurationMinutes(...)`
- `buildDurationOptions(...)`
- `eventLocalToUtcIso(...)`
- `utcIsoToEventLocalInput(...)`
- `toUtcIsoFromStartAndDuration(...)`
- `deriveDurationMinutes(...)`
- `generateSlug(...)`

### `src/services/guestService.ts`

Main guest/session identity service:

- stored session helpers
- guest session creation/validation
- booking lookup
- recovery email/token flow
- signed-in user profile sync

### `src/lib/`

Shared domain helpers worth knowing:

- event path generation for public/private access
- RSVP decision logic
- attendee ownership matching
- back-navigation logic
- auth redirect URL handling

## Key Environment Variables

### Required

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Optional But Meaningful

- `VITE_APP_URL`
  - used as an auth redirect override for hosted/proxied setups
  - important for magic-link correctness outside localhost/default origin assumptions

### Legacy / Optional

- `APP_URL`
  - documented as legacy optional

## Build / Run Commands

From `package.json`:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run lint`
- `npm run clean`

Notes:

- `npm run dev` starts Vite on port `3000`
- there is currently no automated test suite
- `npm run clean` is now implemented via Node and is cross-platform

## Deployment Notes For Render

### Deployment Model

This app should be deployed as a static site:

- build command: `npm run build`
- publish directory: `dist`

### Required Build-Time Env Vars

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL` is recommended for reliable magic-link redirects on hosted domains

### SPA Routing Requirement

Because the app uses `BrowserRouter`, unknown routes must rewrite to `index.html`.

Important deep links that need rewrite support:

- `/events/:slug`
- `/host/events/:id`
- `/host/events/:id/edit`
- `/calendar`
- `/bookings`
- `/recover`

### Deployment Caveats

- magic-link redirect behavior is sensitive to deployment URL configuration
- `supabase_schema.sql` is not a perfect production snapshot
- there is no CI/deployment validation in the repo yet

## Known Risks / Technical Debt

### 1. Schema Drift Between Repository SQL And Live Supabase

This remains the biggest maintenance risk. The frontend depends on live-schema details and RPC behavior that can drift from the checked-in SQL snapshot.

### 2. RSVP / Waitlist Integrity Still Needs Care

The app now uses a mix of shared frontend decision helpers and database RPCs. That is safer than naive direct writes, but still easy to regress if only one side is updated.

### 3. Guest Recovery Is Still Lightweight

Recovery exists, but the email/recovery flow is not yet a full production-grade account-recovery system.

### 4. Visibility Rules Are More Complex Now

The app now supports `public`, `semi_public`, and `private`. That improves flexibility but makes route generation, access checks, and share-link behavior more fragile.

### 5. Timezone / Duration Behavior Must Stay Consistent

The app now treats:

- `starts_at` as UTC storage
- `timezone` as display/authoring context
- `duration_minutes` as the main end-time model

Changes here can easily reintroduce confusing schedule bugs.

### 6. No Automated Tests

There is still no automated test suite, so regressions are easy to introduce in:

- auth/bootstrap
- delayed-auth create flow
- RSVP/proxy RSVP/cancellation
- waitlist promotion
- bookings/recovery
- visibility/share-link behavior

## Suggestions For Safe Future Development

### Highest Priority

- keep `supabase_reconcile_live_schema.sql`, `SCHEMA_ALIGNMENT.md`, and frontend expectations aligned
- preserve the delayed-auth create flow unless intentionally redesigning it
- keep visibility/share-link behavior documented whenever product rules change
- add smoke coverage for RSVP, cancellation, waitlist, create/edit, and semi-public flows

### Good Cleanup Work

- gradually extract reusable UI primitives if the page-local styling keeps growing
- address bundle-size warnings with code splitting if needed
- keep docs synced whenever routes, env vars, auth flows, or schema expectations change

### Safer Engineering Practices Going Forward

- treat frontend code + Supabase schema/RLS/RPCs as one unit of change
- prefer explicit shared helpers or RPCs over duplicate business rules
- smoke test main routes after broad UI refactors
- keep user-facing copy as “activity/activities” while avoiding unnecessary route/table renames

## Quick Summary

This repository is a lightweight community activity app built with `React + Vite + Tailwind + Supabase`.

Its strengths are simplicity, directness, and small-page architecture.

Its biggest risks are schema drift, identity complexity, and regressions around RSVP/visibility flows. Any future work should preserve the current delayed-auth create flow, magic-link deployment correctness, and the public/semi-public/private visibility contract.
