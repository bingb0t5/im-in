# I'm In

Lightweight community event app for creating, sharing, and joining events.

## What It Does

- Hosts create and manage events.
- Guests and signed-in users can RSVP.
- Full events can place attendees on a waitlist.
- Guests can recover bookings using a recovery link/session token flow.

## Stack

- Frontend: React + TypeScript + Vite + Tailwind
- Data/Auth: Supabase (Auth, Postgres, Realtime)
- Routing: `react-router-dom`

Note: This repository does not currently implement Airtable integration.

## Environment Variables

Required for the app to run:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional:

- `APP_URL` (only needed in some hosted setups)

## Local Development

Prerequisite: Node.js

1. Install dependencies:
   - `npm install`
2. Configure environment variables:
   - copy `.env.example` to `.env.local` (or `.env`)
   - set `VITE_SUPABASE_URL`
   - set `VITE_SUPABASE_ANON_KEY`
3. Run dev server:
   - `npm run dev`

## Build And Preview

- Build: `npm run build`
- Preview production build: `npm run preview`
- Type-check: `npm run lint`

## Deployment Notes (Render)

This app is suitable for static deployment.

- Build command: `npm run build`
- Publish directory: `dist`
- Set build-time env vars:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

Because this is a SPA with `BrowserRouter`, configure route rewrites/fallback to `index.html` so deep links work.

## Event Visibility Contract

- `is_public = true`: event appears in `/calendar` public browsing.
- `is_public = false`: event is hidden from public listings.
- Private events are currently treated as **unlisted** (accessible via direct `/events/:slug` link).

If strict private access is required (host/invitee-only at DB level), that should be implemented as a separate RLS/product-policy task.

## Important Caveat

The exported live Supabase schema includes guest identity/session tables (`attendee_profiles`, `attendee_sessions`, and `event_attendees.attendee_profile_id`), but `supabase_schema.sql` in this repo is still a stale snapshot.

See `SCHEMA_ALIGNMENT.md` for current alignment details, `supabase_reconcile_live_schema.sql` for safe live-db reconciliation, and `supabase_guest_identity_migration.sql` for bootstrapping non-production environments.

## RSVP/Cancellation RPCs

This app currently uses DB RPC helpers for reliability in key attendee actions:

- `cancel_attendee_with_promotion(...)`
- `add_proxy_attendee(...)`

These are defined in `supabase_reconcile_live_schema.sql`.
