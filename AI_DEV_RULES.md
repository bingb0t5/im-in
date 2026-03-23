# AI_DEV_RULES

## Purpose

These rules are for any AI assistant or developer working in this codebase.

The goal is to keep changes safe in a frontend-first React/Supabase app where small UI edits can still affect auth, RSVP state, guest identity, and production data behavior.

## Core Principles

1. Treat this as a `React + Vite + Supabase` app, not an AI Studio or Airtable app.
2. Assume Supabase schema, RLS, and client writes are tightly coupled.
3. Prefer small, verifiable changes over broad refactors.
4. Do not assume the checked-in SQL schema fully matches production.
5. Preserve existing user flows unless the task explicitly changes product behavior.

## Architectural Truths

Always work from these assumptions unless the repository is updated:

- The app is a browser SPA with no first-party backend server in this repo.
- Supabase is the real backend integration.
- There is no Airtable integration in this codebase.
- Signed-in users use Supabase Auth.
- Guests use `attendee_profiles` + `attendee_sessions` + local token storage.
- RSVP and waitlist behavior currently exist partly in client code and partly in SQL logic.

## Files That Matter Most

Be especially careful when editing these:

- `src/App.tsx`
- `src/supabase.ts`
- `src/services/guestService.ts`
- `src/pages/EventDetail.tsx`
- `src/pages/HostDashboard.tsx`
- `src/pages/CreateEvent.tsx`
- `src/pages/Login.tsx`
- `src/pages/Bookings.tsx`
- `src/pages/Recovery.tsx`
- `supabase_schema.sql`

## Mandatory Safety Checks Before Changing Data Flows

Before changing RSVP, waitlist, bookings, auth, or guest recovery logic:

1. Read the relevant page or service file completely.
2. Check `supabase_schema.sql` for related tables, triggers, functions, and RLS.
3. Compare the app code against the SQL schema for drift.
4. Confirm whether the flow depends on:
   - `auth.users`
   - `attendee_profiles`
   - `attendee_sessions`
   - `event_attendees`
   - `event_waitlist_positions`
5. Document any mismatch you discover instead of silently coding past it.

## Do Not Assume The Schema Is Complete

The app code expects database structures not present in `supabase_schema.sql`, including:

- `attendee_profiles`
- `attendee_sessions`
- `event_attendees.attendee_profile_id`

Rules:

- Do not state that the checked-in SQL is the full production schema unless you verify it elsewhere.
- If you add code that touches guest identity, call out schema dependencies explicitly.
- If a task requires reliable schema documentation, update docs and migrations together.

## Auth And Identity Rules

### Signed-In Users

- Protected host routes depend on Supabase `user`.
- Login supports both magic link and Google OAuth.
- `App.tsx` syncs the signed-in user into the guest-profile system.

Rules:

- Do not break `supabase.auth.getSession()` bootstrap behavior.
- Do not remove `onAuthStateChange` syncing without replacing it with equivalent behavior.
- Do not add host-only UI without protecting the route or action.

### Guest Users

Guest identity is not just anonymous UI state. It is persisted through:

- `localStorage`
- `attendee_profiles`
- `attendee_sessions`

Rules:

- Do not clear or overwrite guest session tokens casually.
- Do not change token storage keys without migration/backward-compat handling.
- Do not assume guest bookings can be derived from email alone.
- Preserve recovery-link behavior unless explicitly redesigning it.

## RSVP And Waitlist Rules

This is the most fragile part of the codebase.

Rules:

- Do not introduce new RSVP paths without checking existing insert/update logic in:
  - `src/pages/EventDetail.tsx`
  - `src/pages/HostDashboard.tsx`
  - `src/pages/CreateEvent.tsx`
  - `supabase_schema.sql`
- Do not change waitlist behavior in only one place if the same concept exists in both SQL and client code.
- Current project decision: treat the frontend RSVP flow as authoritative for now, and keep RSVP status/promotion logic centralized in shared frontend helpers.
- If you touch attendee status transitions, inspect:
  - `confirmed`
  - `waitlist`
  - `cancelled`
  - `promoted_at`
  - `cancelled_at`
- Prefer a single source of truth when possible, but do not force that refactor unless requested.

When editing RSVP logic, explicitly think through:

- duplicate RSVP prevention
- full-capacity handling
- waitlist ordering
- cancellation promotion
- guest vs authenticated attendee matching
- proxy RSVP behavior

## Supabase Access Rules

- Keep database access patterns readable and localized.
- Use existing table names and field names exactly.
- Do not invent schema fields without also updating docs/migrations.
- Be careful with client-side writes because security depends on RLS, not hidden server code.
- If a change needs stronger guarantees, recommend moving logic to a stored procedure or server-side path.

## Environment Variable Rules

Current meaningful env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Legacy/scaffolding env vars still present:

- `GEMINI_API_KEY`
- `APP_URL`
- `DISABLE_HMR`

Rules:

- Do not add new env vars unless they are truly needed.
- If you add a new env var, update:
  - `.env.example`
  - relevant docs
  - deployment notes
- Do not claim `GEMINI_API_KEY` is required for current app functionality.
- Remember that `VITE_*` vars are exposed to the client bundle.

## UI / Routing Rules

- Maintain compatibility with `BrowserRouter`.
- Preserve deep-link behavior for `/events/:slug`, `/host/events/:id`, `/bookings`, and `/recover`.
- When adding routes, ensure they make sense for static hosting with SPA rewrites.
- Visibility contract (current):
  - `is_public = true` => show in public calendar discovery.
  - `is_public = false` => hide from public listings.
  - private events are currently unlisted, not access-restricted, on `/events/:slug`.
- Keep this contract consistent unless product/RLS policy is intentionally changed.

## Documentation Rules

When architecture changes, update docs in the same task when practical.

At minimum, update docs if you change:

- routes/pages
- auth flow
- env vars
- deployment assumptions
- schema expectations
- guest recovery behavior

Docs should prefer the current real architecture:

- Supabase, not Airtable
- events app, not Gemini app

## Dependency Rules

There are likely unused dependencies in this repo.

Rules:

- Do not add packages casually for small problems.
- Before adding a dependency, check whether existing utilities already solve it.
- If removing a dependency, confirm it is unused first.
- If touching setup docs, avoid reinforcing stale AI Studio/Gemini assumptions unless the code is restored to use them.

## Testing Expectations

There is no automated test suite right now, so manual verification matters.

After any meaningful change, verify the relevant flows manually when possible:

1. App boots with valid Supabase env vars.
2. Login page still works.
3. Protected routes still redirect correctly.
4. Event creation/edit flow still saves.
5. Public calendar still loads.
6. Event detail page still fetches attendees.
7. RSVP still works for:
   - signed-in user
   - guest user
   - waitlist case
8. Cancellation still works.
9. Guest bookings still load.
10. Recovery link flow still restores session.

If you cannot run verification, say so clearly.

## Deployment Rules

Assume static deployment unless the repo changes significantly.

For Render:

- build output is `dist`
- SPA rewrites are required
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be available at build time

If changing deployment behavior:

- update `PROJECT_ARCHITECTURE.md`
- update setup/deployment docs
- call out any required Render setting changes

## Good Change Patterns

Preferred patterns:

- small focused edits
- explicit comments only where logic is non-obvious
- updates that keep schema/docs/code aligned
- preserving existing UI behavior unless product changes are requested

Avoid:

- broad stylistic rewrites
- renaming core fields without migrations
- mixing unrelated refactors into behavior fixes
- silently changing auth or guest-session semantics

## Known Hotspots

Watch for these known risks:

- schema drift between frontend and SQL
- stale README/setup instructions
- stale AI Studio/Gemini references
- missing `is_public` filtering in public event browsing
- duplicated waitlist/business logic across client and SQL
- demo-grade recovery token/email flow

## If Unsure

When a task touches data integrity, auth, or deployment and the safest behavior is unclear:

1. stop broad implementation
2. explain the ambiguity
3. propose the smallest safe option
4. note any schema or product decision that should be confirmed first

## Short Version

- Supabase is the backend.
- Airtable is not used.
- Guest identity is real application state, not temporary UI state.
- RSVP/waitlist changes are high risk.
- Schema and code are currently not perfectly aligned.
- Keep changes small, explicit, and documented.
