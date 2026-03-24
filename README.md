# I'm In

Lightweight community activity app for creating, sharing, discovering, and joining activities.

## What It Does

- Hosts can create and manage activities.
- Signed-in users and guests can join activities.
- Full activities can place attendees on a waitlist.
- Users can add another person to an activity.
- Semi-public activities can appear in public browse with limited details and host-managed access requests.
- Guests can recover bookings using the guest recovery flow.

## Current Product Model

Although the codebase still uses many `event` names internally, the live product language is **activity / activities**.

Current visibility modes:

- `public`: activity is discoverable publicly with full public details
- `semi_public`: activity appears in public browse with limited details; full details are shared by the host via private link
- `private`: activity is link-only / unlisted

Current sign-in model:

- **magic-link only**
- Google sign-in is not part of the current app

Current scheduling model:

- activities store `starts_at` in UTC
- each activity also stores a `timezone`
- duration is stored as `duration_minutes`

## Stack

- Frontend: React + TypeScript + Vite + Tailwind CSS
- Data/Auth: Supabase (Auth, Postgres, Realtime)
- Routing: `react-router-dom`
- Motion: `motion`

There is no Airtable integration in this repository.

## Environment Variables

Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Recommended:

- `VITE_APP_URL`
  - used as an auth redirect override for hosted/proxied environments
  - important for reliable magic-link redirects outside localhost

Legacy optional:

- `APP_URL`

## Local Development

Prerequisite: Node.js

1. Install dependencies:
   - `npm install`
2. Configure environment variables:
   - copy `.env.example` to `.env.local` or `.env`
   - set `VITE_SUPABASE_URL`
   - set `VITE_SUPABASE_ANON_KEY`
   - set `VITE_APP_URL` if you want explicit hosted redirect behavior
3. Run the dev server:
   - `npm run dev`

Default local URL:

- `http://localhost:3000`

## Build, Preview, And Cleanup

- Build: `npm run build`
- Preview production build: `npm run preview`
- Type-check: `npm run lint`
- Clean build output: `npm run clean`

## Core Flows

### Create Activity

The create flow is intentionally lightweight:

- signed-out users can fill the form first
- on save, the app prompts for email and sends a magic link
- the draft is stored locally
- after sign-in, the user returns and completes save

### RSVP / Attendance

The app supports:

- signed-in RSVP
- guest RSVP
- waitlist handling
- proxy RSVP / add another person
- cancellation with promotion logic

Important reliability RPCs defined in `supabase_reconcile_live_schema.sql`:

- `submit_rsvp(...)`
- `cancel_attendee_with_promotion(...)`
- `add_proxy_attendee(...)`

## Routing

Important app routes:

- `/`
- `/calendar`
- `/events/:slug`
- `/create-event`
- `/host/events/:id`
- `/host/events/:id/edit`
- `/bookings`
- `/recover`
- `/login`

## Deployment Notes

This app is suitable for static deployment on platforms like Render, Cloudflare Pages, or similar static hosts.

Build settings:

- Build command: `npm run build`
- Publish directory: `dist`

Required build-time env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL` is recommended on hosted deployments

Because this is a SPA using `BrowserRouter`, configure route rewrites/fallback to `index.html` so deep links continue to work.

Deep links that need rewrite support:

- `/events/:slug`
- `/host/events/:id`
- `/host/events/:id/edit`
- `/calendar`
- `/bookings`
- `/recover`

## Visibility Contract

- `is_public = true`: activity can appear in public browse
- `is_public = false`: activity is hidden from public browse
- `visibility = semi_public`: public browse shows limited details; host shares full private link manually
- `visibility = private`: treated as unlisted/link-only

If strict host/invitee-only access is needed at the database level, that should be treated as a separate RLS/product-policy task.

## Important Caveat

The checked-in `supabase_schema.sql` is helpful, but it is not a guaranteed full production snapshot.

The current live app behavior also depends on:

- `supabase_reconcile_live_schema.sql`
- `SCHEMA_ALIGNMENT.md`

In particular, the live app expects guest identity/session structures and semi-public/access-request behavior that may drift from the older schema snapshot.
