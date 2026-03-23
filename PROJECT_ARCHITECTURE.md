# PROJECT_ARCHITECTURE

## Overview

`I'm In` is a lightweight event coordination app for community organizers and attendees.

At a high level, the app lets a host:
- sign in with Supabase Auth
- create and edit events
- share a public event link
- manage attendees and waitlist state

It also lets an attendee:
- browse upcoming events
- RSVP to an event
- join a waitlist when an event is full
- recover bookings later through a guest-session flow

Despite some leftover AI Studio/Gemini scaffolding in the repo, the actual app is an events product built around `React + Vite + Supabase`.

## What The App Does

The app is centered around simple, shareable event pages:

- Hosts create events with title, description, time, capacity, host details, waitlist settings, and public/private visibility.
- Public visitors can browse the calendar and open individual event pages.
- Users can RSVP either as signed-in users or as guests remembered on the current device.
- Hosts can manage an event from a dashboard, add attendees manually, duplicate events, and delete attendees/events.
- Guests can recover access to their bookings using a tokenized recovery link.

The main product framing appears in `metadata.json`:

- "See what's on. Say I'm in."
- "A lightweight, community-driven event app."

## Frontend Stack

- Framework: `React 19`
- Language: `TypeScript`
- Bundler/dev server: `Vite 6`
- Routing: `react-router-dom`
- Styling: `Tailwind CSS v4` via `@tailwindcss/vite`
- Motion/animation: `motion`
- Icons: `lucide-react`
- Class merging helpers: `clsx` + `tailwind-merge`

Important frontend files:

- `src/main.tsx`: app entry point
- `src/App.tsx`: router, auth bootstrap, protected routes
- `src/index.css`: Tailwind import, theme tokens, base styles
- `src/utils.ts`: shared formatting and slug helpers
- `src/types.ts`: shared TypeScript models

Notes:

- The app uses a single-page app routing model with `BrowserRouter`.
- Styling is mostly page-local; there is no dedicated `components/` folder yet.

## Backend / Server Stack

There is no first-party backend server in this repository.

Actual runtime model:

- browser SPA served by Vite/static hosting
- client-side data access through `@supabase/supabase-js`
- Supabase Auth for sign-in
- Supabase Postgres tables for events/attendees
- Supabase Realtime subscriptions for attendee list refreshes

Important backend-related files:

- `src/supabase.ts`: lazy-initialized Supabase client
- `supabase_schema.sql`: schema, RLS, triggers, and stored function
- `seed_data.sql`: sample seed data

Important nuance:

- `package.json` includes `express`, `dotenv`, and `@google/genai`, but there is no Express app, no server route code, and no Gemini usage in `src/`.
- The app behaves as a frontend-only client that talks directly to Supabase.

## Folder-By-Folder Explanation

### Root

- `package.json`: scripts, dependencies, and project metadata
- `package-lock.json`: npm lockfile
- `vite.config.ts`: Vite config, Tailwind plugin, env injection, HMR toggle
- `tsconfig.json`: TypeScript compiler settings
- `index.html`: HTML shell for the SPA
- `.env.example`: example environment variables
- `.gitignore`: ignored files and env patterns
- `README.md`: current setup and deployment notes
- `metadata.json`: app name and short description
- `supabase_schema.sql`: core database schema and policies
- `seed_data.sql`: example event seed data

### `src/`

The app source lives entirely under `src/`.

- `main.tsx`: mounts the React app
- `App.tsx`: initializes auth state, handles setup errors, and defines routes
- `supabase.ts`: exports the Supabase client proxy
- `index.css`: theme tokens and base styling
- `types.ts`: shared event/attendee types
- `utils.ts`: shared utility helpers

### `src/pages/`

Each major screen is implemented as a page component.

- `Home.tsx`: landing page for signed-out users and dashboard for signed-in users
- `Login.tsx`: magic-link login, Google OAuth login, and guest recovery entry
- `CreateEvent.tsx`: create/edit event form
- `EventDetail.tsx`: public event page, RSVP flow, cancellation, guest handling
- `HostDashboard.tsx`: host management page for a single event
- `Calendar.tsx`: browse/search upcoming scheduled events
- `Bookings.tsx`: guest booking history using stored guest session token
- `Recovery.tsx`: restores guest access from recovery token

### `src/services/`

- `guestService.ts`: guest profile/session lifecycle, booking lookup, recovery flow, profile syncing for authenticated users

## Auth Flow

The app has two overlapping identity systems:

1. Supabase Auth for actual signed-in users
2. guest-session tokens for non-authenticated attendees

### Signed-In Flow

1. `src/App.tsx` calls `supabase.auth.getSession()` on load.
2. `src/App.tsx` subscribes to `supabase.auth.onAuthStateChange(...)`.
3. Protected routes such as `/create-event`, `/host/events/:id`, and `/host/events/:id/edit` require a `user`.
4. `src/Login.tsx` supports:
   - email magic link via `signInWithOtp`
   - Google OAuth via `signInWithOAuth`
5. After login, `src/App.tsx` calls `guestService.getOrCreateProfileForUser(user)` to connect the auth user to an attendee profile record.

### Guest Flow

1. A guest opens an event page and RSVPs without signing in.
2. `src/pages/EventDetail.tsx` calls `guestService.createGuestSession(...)`.
3. `guestService` creates or reuses an `attendee_profiles` row, creates an `attendee_sessions` row, and stores the token in `localStorage`.
4. Future pages can read the token through `guestService.getStoredSession()`.
5. `src/pages/Bookings.tsx` uses the token to show bookings tied to the guest profile.
6. `src/pages/Recovery.tsx` restores the local session token from a recovery link.

### Important Auth Constraints

- Authenticated users are still linked to attendee data through `attendee_profiles`, not only `auth.users`.
- Guest identity is device/browser dependent unless recovered by token link.
- The booking recovery flow is demo-grade rather than production-grade.

## Airtable Integration

There is no Airtable integration in this repository.

Searches for `airtable` / `AIRTABLE` return no results. The real data/backend integration is Supabase:

- `src/supabase.ts` for the client
- `supabase_schema.sql` for schema and database logic
- page components and `guestService.ts` for direct data access

If someone expects Airtable from product docs or older plans, that does not match the current codebase. The architecture document should treat Supabase as the authoritative backend integration.

## Supabase Data Model And Integration

### Core Tables In `supabase_schema.sql`

- `events`
- `event_attendees`
- `event_waitlist_positions`

These support:

- event creation and editing
- attendee RSVP state
- waitlist ordering
- automatic promotion triggers

### Live Schema vs Repository Snapshot

The live Supabase schema includes guest identity/session structures used by the frontend:

- `attendee_profiles`
- `attendee_sessions`
- `event_attendees.attendee_profile_id`

However, `supabase_schema.sql` in this repository is a stale snapshot and does not fully reflect current production schema details. See `SCHEMA_ALIGNMENT.md` for the latest reconciliation notes.

### How Supabase Is Used In The App

- `Home.tsx`: fetches hosted and joined events
- `CreateEvent.tsx`: inserts/updates `events`
- `Calendar.tsx`: fetches scheduled future events
- `EventDetail.tsx`: reads event/attendee records and performs RSVP/cancel flows
- `HostDashboard.tsx`: fetches event attendees, deletes attendees, duplicates events
- `guestService.ts`: manages attendee profiles, sessions, and guest bookings

### Realtime Usage

- `EventDetail.tsx` subscribes to `event_attendees` changes to refresh attendee lists
- `HostDashboard.tsx` subscribes to attendee changes for the host view

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

- unknown routes redirect back to `/`
- host-create/edit/manage routes are guarded by Supabase auth
- public event detail pages are accessible without login

## Shared Utilities / Services

### `src/utils.ts`

- `cn(...)`: merges class names with Tailwind-friendly de-duplication
- `formatDate(...)`: human-readable date formatting
- `generateSlug(...)`: slug creation from event title

### `src/types.ts`

Shared domain types for:

- `Event`
- `Attendee`
- `WaitlistPosition`

### `src/services/guestService.ts`

Main shared service for guest/session identity:

- `getStoredSession`
- `setStoredSession`
- `clearStoredSession`
- `validateSession`
- `createGuestSession`
- `getMyBookings`
- `sendRecoveryEmail`
- `getOrCreateProfileForUser`

### `src/supabase.ts`

- lazy client initialization
- throws a descriptive config error when required env vars are missing

## Key Environment Variables

### Required For Actual App Functionality

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Used by:

- `src/supabase.ts`
- injected in `vite.config.ts`

### Present But Not Meaningfully Used By Current App

- `GEMINI_API_KEY`
  - documented in `README.md`
  - injected in `vite.config.ts`
  - not used anywhere in `src/`

- `APP_URL`
  - documented in `.env.example`
  - not referenced in app code

- `DISABLE_HMR`
  - used in `vite.config.ts`
  - only affects local dev server HMR behavior

## Build / Run Commands

From `package.json`:

- `npm install`: install dependencies
- `npm run dev`: start Vite dev server on port `3000`
- `npm run build`: production build to `dist/`
- `npm run preview`: preview built app
- `npm run lint`: TypeScript type-check via `tsc --noEmit`
- `npm run clean`: removes `dist/`

Notes:

- There is no `test` script.
- `npm run clean` uses `rm -rf dist`, which is Unix-style and may not work cleanly in plain Windows shell environments.

## Deployment Notes For Render

There is no `render.yaml` or Render-specific documentation in the repo, so these notes are inferred from the app architecture.

### Likely Deployment Model

This app should be deployed on Render as a static site:

- build command: `npm run build`
- publish directory: `dist`

### Required Render Settings

- provide `VITE_SUPABASE_URL`
- provide `VITE_SUPABASE_ANON_KEY`

Because Vite injects env values into the client bundle at build time, these variables must be available during the Render build.

### SPA Routing Requirement

Because the app uses `BrowserRouter`, Render must rewrite unknown routes to `index.html`.

Without a rewrite/fallback rule:

- `/events/:slug`
- `/host/events/:id`
- `/bookings`
- `/recover`

can fail when loaded directly in the browser.

### Deployment Caveats

- `supabase_schema.sql` is not a guaranteed source-of-truth snapshot for production.
- There is no CI or deployment validation in the repo.

## Known Risks / Technical Debt

### 1. Schema Drift Between Snapshot SQL And Live Database

The biggest schema risk is now drift between:

- checked-in `supabase_schema.sql`
- live Supabase production schema

The live schema appears to include guest identity/session tables used by the app, but repo SQL defaults/constraints still differ. This remains a maintenance and onboarding risk.

### 2. RSVP Logic Is Split Between Client And SQL

`supabase_schema.sql` contains an atomic `rsvp_to_event(...)` function plus waitlist-position logic, but the React app mostly performs direct table inserts/updates from the client.

Current implementation decision (Phase 3): keep client-side RSVP flow as the active source of truth for now, and centralize status/promotion decisions in shared frontend helpers to reduce drift across pages.

That creates risk around:

- race conditions
- inconsistent waitlist ordering
- promotion behavior drift
- partial mismatch between UI behavior and stored procedures

### 3. Guest Recovery Is Demo-Grade

`guestService.sendRecoveryEmail(...)`:

- generates tokens with `Math.random()`
- logs the recovery URL to the console
- uses `alert(...)` instead of a real mailer

This is not production-grade account recovery.

### 4. Public/Private Contract Still Needs Policy Clarity

`Calendar.tsx` now filters on `is_public = true`, which protects the public listing flow.

Current explicit contract:

- `is_public = true`: discoverable in public calendar.
- `is_public = false`: hidden from public listing.
- private events remain accessible via direct `/events/:slug` link (unlisted model).

If stricter privacy is needed, implement host/invitee access controls via RLS and route-level policy decisions.

### 5. Stale AI Studio / Gemini Scaffolding

There is leftover scaffolding that can confuse future contributors:

- `README.md` instructions centered on `GEMINI_API_KEY`
- `.env.example` includes `APP_URL`
- `vite.config.ts` injects `GEMINI_API_KEY`
- `index.html` title still references AI Studio
- unused packages in `package.json`

### 6. No Tests

There are no automated tests, no test script, and no evident CI workflow. Regression risk is therefore high for:

- auth flow
- RSVP flow
- waitlist promotion
- guest recovery

## Suggestions For Safe Future Development

### Highest Priority

- Keep `supabase_schema.sql` and live schema expectations synchronized (or clearly mark snapshot limitations in docs).
- Keep the current RSVP source-of-truth decision explicit in docs: client-side authority for now, with shared helper-based logic.
- Decide if/when to move RSVP authority to a server-side/RPC flow.
- Decide if/when to move from "unlisted private events" to strict private access controls for `/events/:slug`.
- Replace guest recovery demo behavior with real token generation and email delivery.

### Good Cleanup Work

- remove unused dependencies if they are truly not needed
- make `clean` cross-platform

### Safer Engineering Practices Going Forward

- Treat Supabase schema and frontend data access as one unit of change.
- Prefer one source of truth for RSVP/waitlist transitions.
- Avoid introducing new direct table writes without checking existing RLS/promotion logic.
- Add smoke tests around login, RSVP, cancellation, waitlist, and recovery before major refactors.
- Keep docs updated whenever schema, env vars, or deployment assumptions change.

## Quick Summary

This repository is a frontend-first community events app built with `React + Vite + Tailwind + Supabase`.

The main architectural strength is its simplicity: a small page-based SPA with direct Supabase integration.

The main architectural risk is still consistency: schema snapshot drift, guest-session complexity, and long-term RSVP authority split between client flows and SQL functions. Future work should continue reducing this drift before major new features.
