# RELEASE_CHECKLIST

Use this before shipping a new build of `I'm In`.

## 1) Environment And Build

- Confirm `.env` (or Render build env) has:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- If deploying `resolve-google-maps-link`, confirm `supabase/config.toml` includes:
  - `[functions.resolve-google-maps-link]`
  - `verify_jwt = false`
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
  - `host_send_activity_notification(...)`
  - `reply_to_event_hosts(...)`
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
- **Explore visibility:** private activities are hidden from `/explore` (and therefore also absent via the legacy `/calendar` redirect).
- **RSVP:** signed-in and guest RSVP both work.
- **Guest email setting:** `require_guest_email_for_join` behaves correctly in both modes.
- **Name-first guest flow:** when optional mode is on, guests can join with name only and then add email from success UI.
- **Waitlist:** full event correctly places new RSVP on waitlist.
- **Cancellation:** "Yes, can't make it" cancels RSVP and promotes next waitlisted attendee.
- **Proxy add:** "Add someone else" works in both guest-email-required and optional-email modes, including re-adding a previously cancelled name.
- **Thinking about it:** public and non-public activity interest flows still work.
- **Semi-public:** request-to-view, private link access, and host request actions still work.
- **Feedback button placement:** on `/events/:slug`, floating feedback button appears top-right below the nav; on other routes it keeps bottom-floating placement.
- **Hamburger menu consistency:** menu styling/items match across top-bar pages and `/events/:slug`, with `Create Activity` and `Explore Activities` icon links at the top.
- **Activity header actions:** `/events/:slug` header shows icon-only share next to the hamburger menu, and both actions remain tappable on mobile.
- **Host dashboard:** co-host access still works and host list loads correctly.
- **WhatsApp verify/link:** the Lalo verification/link flow completes successfully and persists the verified WhatsApp number when one is returned.
- **Profile:** `/profile` shows the linked WhatsApp state and verified WhatsApp number correctly after verification.
- **Host contacts:** host dashboard people/lookup/recipient surfaces show WhatsApp numbers correctly where profile data exists.
- **Host notifications:** manual host notification send still works from `HostDashboard`.
- **Guest reply:** replying to a host-sent activity message creates a `guest_reply` notification for the host and opens the expected host-side follow-up path.
- **Account merge:** merge completion preserves linked WhatsApp identity data, including the verified number when present.
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
  - `/explore`
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
