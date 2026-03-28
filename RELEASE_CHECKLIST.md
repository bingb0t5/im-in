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
  - `submit_rsvp(...)`
  - `cancel_attendee_with_promotion(...)`
  - `add_proxy_attendee(...)`
  - `toggle_event_interest(...)`
- Verify expected core tables/columns exist:
  - `events`
  - `event_attendees`
  - `event_hosts`
  - `event_interests`
  - `event_access_requests`
  - `attendee_profiles`
  - `attendee_sessions`
  - `event_attendees.attendee_profile_id`

## 3) Critical Flow Smoke Tests

- **Auth:** magic link login still works.
- **Event create/edit:** host can create and edit an activity, including delayed-auth create save flow.
- **Calendar visibility:** private activities are hidden from `/calendar`.
- **RSVP:** signed-in and guest RSVP both work.
- **Waitlist:** full event correctly places new RSVP on waitlist.
- **Cancellation:** "Yes, can't make it" cancels RSVP and promotes next waitlisted attendee.
- **Proxy add:** "Add someone else" works, including re-adding a previously cancelled name.
- **Thinking about it:** public and non-public activity interest flows still work.
- **Semi-public:** request-to-view, private link access, and host request actions still work.
- **Host dashboard:** co-host access still works and host list loads correctly.
- **Bookings:** guest bookings page loads with active guest session.
- **Recovery:** recovery link restores a guest session.

## Known hotfixes

- If join requests or proxy add fail with `event_attendees_status_check` / `pending_approval`, run this SQL in Supabase:

```sql
DO $$
DECLARE
  c RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_attendees'::regclass
      AND conname = 'event_attendees_status_check'
  ) THEN
    ALTER TABLE public.event_attendees
      DROP CONSTRAINT event_attendees_status_check;
  END IF;

  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.event_attendees'::regclass
      AND contype = 'c'
      AND conname <> 'event_attendees_status_check'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.event_attendees DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.event_attendees
    ADD CONSTRAINT event_attendees_status_check
    CHECK (status IN ('confirmed', 'waitlist', 'pending_approval', 'cancelled'));
END $$;
```

- This is idempotent and already included in `supabase_reconcile_live_schema.sql`.

## 4) Deploy On Render

- Static site build command: `npm run build`
- Publish directory: `dist`
- Configure SPA rewrite/fallback to `index.html`
- Re-verify deep links after deploy:
  - `/events/:slug`
  - `/host/events/:id`
  - `/host/events/:id/edit`
  - `/calendar`
  - `/bookings`
  - `/recover`

## 5) Post-Deploy Quick Checks

- Open home page and calendar on production URL.
- Open one public activity and verify attendee list loads.
- Perform one real RSVP/cancel cycle on a test activity.
- Open one semi-public activity and verify the intended public/private link behavior.
- Confirm browser console has no blocking runtime errors.
