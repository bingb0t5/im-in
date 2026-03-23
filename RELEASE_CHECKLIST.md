# RELEASE_CHECKLIST

Use this before shipping a new build of `I'm In`.

## 1) Environment And Build

- Confirm `.env` (or Render build env) has:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Run `npm install`.
- Run `npm run lint`.
- Run `npm run build`.
- Run `npm run preview` and smoke-check the production build.

## 2) Database And Policy

- Confirm `supabase_reconcile_live_schema.sql` has been applied in the target environment.
- Verify RPCs exist and are executable by `anon`/`authenticated`:
  - `cancel_attendee_with_promotion(...)`
  - `add_proxy_attendee(...)`
- Verify expected core tables/columns exist:
  - `events`
  - `event_attendees`
  - `attendee_profiles`
  - `attendee_sessions`
  - `event_attendees.attendee_profile_id`

## 3) Critical Flow Smoke Tests

- **Auth:** magic link login and Google login still work.
- **Event create/edit:** host can create and edit an event.
- **Calendar visibility:** private events are hidden from `/calendar`.
- **RSVP:** signed-in and guest RSVP both work.
- **Waitlist:** full event correctly places new RSVP on waitlist.
- **Cancellation:** "Yes, can't make it" cancels RSVP and promotes next waitlisted attendee.
- **Proxy add:** "Add someone else" works, including re-adding a previously cancelled name.
- **Bookings:** guest bookings page loads with active guest session.
- **Recovery:** recovery link restores a guest session.

## 4) Deploy On Render

- Static site build command: `npm run build`
- Publish directory: `dist`
- Configure SPA rewrite/fallback to `index.html`
- Re-verify deep links after deploy:
  - `/events/:slug`
  - `/host/events/:id`
  - `/bookings`
  - `/recover`

## 5) Post-Deploy Quick Checks

- Open home page and calendar on production URL.
- Open one public event and verify attendee list loads.
- Perform one real RSVP/cancel cycle on a test event.
- Confirm browser console has no blocking runtime errors.
