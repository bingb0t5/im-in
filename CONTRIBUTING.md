# CONTRIBUTING

## Purpose

This document helps new contributors understand how to work on the app safely.

The codebase is still lightweight, but several flows are tightly coupled to Supabase schema, RLS assumptions, and guest identity behavior. Small changes can have surprisingly large side effects if you do not read the right files first.

## Read This First

Start here:

- `README.md`
- `PROJECT_ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `SCHEMA_OR_DATA_MODEL.md`
- `AI_DEV_RULES.md`

Then read these implementation hotspots before editing risky flows:

- `src/App.tsx`
- `src/services/guestService.ts`
- `src/pages/CreateEvent.tsx`
- `src/pages/EventDetail.tsx`
- `src/pages/HostDashboard.tsx`
- `src/pages/Login.tsx`
- `supabase_reconcile_live_schema.sql`
- `SCHEMA_ALIGNMENT.md`

## Local Setup

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env.local` or `.env`
3. Set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - optionally `VITE_APP_URL`
4. Run `npm run dev`

Useful commands:

- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run lint`
- `npm run clean`

## How To Think About The App

### Product language vs code language

- UI/product language: activity / activities
- code/database/route language: event / events

Do not try to rename the internal `event*` model casually. It is deeply wired into routes, SQL, and types.

### There are two identity systems

The app currently supports:

- signed-in users through Supabase Auth
- guest identity through `attendee_profiles` and `attendee_sessions`

Signed-in users are also synchronized into the guest/profile model.

Do not assume that "user = auth user only" is a safe model inside this codebase.

### The backend is mostly Supabase policy + RPC behavior

There is no hidden server layer in this repo.

If you change:

- RSVP
- waitlist behavior
- guest recovery
- visibility/share behavior
- host permissions

you should inspect both:

- frontend code
- relevant SQL and schema docs

## Where Key Logic Lives

### Routing and bootstrap

- `src/App.tsx`

### Guest identity and profile sync

- `src/services/guestService.ts`

### Create/edit activity

- `src/pages/CreateEvent.tsx`

### RSVP, proxy RSVP, thinking, semi-public request flow

- `src/pages/EventDetail.tsx`
- `src/lib/rsvp.ts`
- `src/lib/interests.ts`
- `src/lib/attendees.ts`

### Host manage flow

- `src/pages/HostDashboard.tsx`

### Public browse/search

- `src/pages/Calendar.tsx`

### Guest bookings and recovery

- `src/pages/Bookings.tsx`
- `src/pages/Recovery.tsx`
- `src/pages/Login.tsx`

### Navigation/link logic

- `src/lib/events.ts`
- `src/lib/navigation.ts`
- `src/lib/authRedirect.ts`

### Schema and RPC expectations

- `supabase_schema.sql`
- `supabase_reconcile_live_schema.sql`
- `supabase_guest_identity_migration.sql`
- `SCHEMA_ALIGNMENT.md`

## High-Risk Areas

These are the easiest places to break unintentionally:

- delayed-auth create flow
- guest bookings and recovery
- signed-in / guest identity overlap
- RSVP, cancellation, and waitlist promotion
- semi-public access and private-link behavior
- co-host behavior
- timezone/duration save/display logic

## Safe Change Guidelines

### Before changing auth or identity behavior

Read:

- `src/App.tsx`
- `src/services/guestService.ts`
- `src/pages/Login.tsx`
- `src/pages/CreateEvent.tsx`
- `src/pages/Recovery.tsx`

Check whether the change affects:

- Supabase Auth
- `attendee_profiles`
- `attendee_sessions`
- local storage keys

### Before changing RSVP or waitlist behavior

Read:

- `src/pages/EventDetail.tsx`
- `src/pages/HostDashboard.tsx`
- `src/lib/rsvp.ts`
- `supabase_reconcile_live_schema.sql`
- `SCHEMA_ALIGNMENT.md`

Be aware that waitlist ownership is currently split across frontend logic, RPCs, and older starter-schema trigger/function logic.

### Before changing visibility or share behavior

Read:

- `src/pages/Calendar.tsx`
- `src/pages/EventDetail.tsx`
- `src/pages/HostDashboard.tsx`
- `src/lib/events.ts`

Remember:

- `is_public` controls broad public listing
- `visibility` controls the product-level mode
- `semi_public` relies heavily on `access_code` and route construction

## Verification Expectations

There is no automated test suite right now.

After meaningful changes, manually verify the relevant flows where possible.

Minimum high-value smoke checks:

1. App boots with valid env vars
2. Magic-link login still works
3. Create activity still works for:
   - signed-in user
   - signed-out delayed-auth user
   - edit mode
4. Public calendar still loads and filters correctly
5. Event detail still loads
6. RSVP still works for:
   - signed-in user
   - guest user
   - waitlist case
   - proxy/add-another-person case
7. Cancellation still works
8. Host dashboard still loads for primary host and co-host
9. Semi-public request/share/private-link behavior still works
10. Guest bookings and `/recover` still work if your change touched those flows

If you cannot verify a flow, say so explicitly.

## Documentation Expectations

If you change:

- routes
- auth behavior
- visibility/share behavior
- create/edit fields
- guest recovery behavior
- schema expectations
- important env vars

update the docs in the same task when practical.

At minimum, check:

- `README.md`
- `PROJECT_ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `SCHEMA_OR_DATA_MODEL.md`
- `AI_DEV_RULES.md`

## Contributions Most Needed

Good contribution areas right now:

- regression hardening of auth/guest/RSVP flows
- waitlist and RSVP consistency cleanup
- guest recovery clarity or implementation
- contributor/process improvements
- targeted UI simplification that does not disturb behavior
- documentation maintenance

## Things To Avoid

- broad route/table renames
- large refactors bundled with bug fixes
- assuming the checked-in SQL is the full live truth
- changing guest-session semantics without backward-compat thought
- introducing new dependencies for small problems

## Final Advice

Treat the repo as small but not simple.

The safest mental model is:

- product flows first
- schema/RPC assumptions second
- page-level UI last

That order will help you avoid breaking the parts of the app that look simple on the surface but carry most of the real business logic.
