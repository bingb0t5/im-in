# AI_DEV_RULES

## Purpose

These rules are for any AI assistant or developer working in this codebase.

The app is small, but it has several high-risk flows: auth bootstrap, delayed-auth activity creation, guest identity, RSVP/waitlist logic, semi-public/private access behavior, and Supabase schema drift. Treat those flows carefully.

## Core Principles

1. Treat this as a `React + Vite + Supabase` app, not an Airtable app or AI Studio/Gemini app.
2. Assume frontend code, Supabase schema, RLS, and RPC behavior are tightly coupled.
3. Prefer small, verifiable changes over broad refactors.
4. Do not assume the checked-in SQL fully matches production.
5. Preserve existing user flows unless the task explicitly changes product behavior.
6. Keep user-facing copy as **activity / activities**, even though routes/tables still use `event` naming internally.

## Architectural Truths

Unless the repository is intentionally changed, always assume:

- this is a browser SPA with no first-party backend server in this repo
- Supabase is the real backend integration
- there is no Airtable integration
- signed-in users use Supabase Auth
- guests use `attendee_profiles` + `attendee_sessions` + local token storage
- guest email can be host-required or optional per activity (`require_guest_email_for_join`)
- the create flow supports delayed auth: fill the form first, authenticate only at save time
- visibility modes matter: `public`, `semi_public`, and `private`
- RSVP and waitlist integrity depend on both shared frontend logic and database-backed operations

## Files That Matter Most

Be especially careful when editing these:

- `src/App.tsx`
- `src/supabase.ts`
- `src/services/guestService.ts`
- `src/pages/CreateEvent.tsx`
- `src/pages/EventDetail.tsx`
- `src/pages/HostDashboard.tsx`
- `src/pages/Login.tsx`
- `src/pages/Bookings.tsx`
- `src/pages/Recovery.tsx`
- `src/pages/Calendar.tsx`
- `src/pages/Home.tsx`
- `src/lib/events.ts`
- `src/lib/interests.ts`
- `src/lib/rsvp.ts`
- `src/lib/navigation.ts`
- `src/lib/authRedirect.ts`
- `src/utils.ts`
- `supabase_schema.sql`
- `supabase_reconcile_live_schema.sql`
- `SCHEMA_ALIGNMENT.md`

## Mandatory Safety Checks Before Changing Data Flows

Before changing RSVP, waitlist, auth, guest recovery, bookings, access requests, or visibility behavior:

1. Read the relevant page/service/helper files completely.
2. Check both `supabase_schema.sql` and `supabase_reconcile_live_schema.sql` for related tables, RLS, RPCs, triggers, and constraints.
3. Compare the frontend code against schema/docs for drift.
4. Confirm whether the flow depends on:
   - `auth.users`
   - `attendee_profiles`
   - `attendee_sessions`
   - `event_attendees`
   - `event_hosts`
   - `event_interests`
   - `event_access_requests`
   - `event_waitlist_positions`
   - `events.visibility`
   - `events.access_code`
5. Document mismatches instead of silently coding past them.

## Do Not Assume The Schema Is Complete

`supabase_schema.sql` is a repository snapshot and may lag the live Supabase schema.

Rules:

- Do not claim the checked-in SQL is the full production truth unless you verify it.
- If you touch guest identity, access requests, timezone/duration fields, or RSVP behavior, call out the schema dependencies explicitly.
- If a task changes schema expectations, update docs and migrations/scripts together.
- Treat `SCHEMA_ALIGNMENT.md` as relevant context when schema truth is unclear.

## Auth And Identity Rules

### Signed-In Users

- Protected host routes depend on Supabase `user`.
- Login is currently **magic-link only**.
- `App.tsx` syncs signed-in users into the guest-profile system.

Rules:

- Do not break `supabase.auth.getSession()` bootstrap behavior.
- Do not remove `onAuthStateChange` syncing without equivalent replacement.
- Do not reintroduce Google OAuth or UI for it unless explicitly requested.
- Do not add host-only UI without protecting the route or action.
- Preserve deployment-aware redirect handling when touching auth flows.

### Delayed-Auth Create Flow

`CreateEvent.tsx` intentionally allows signed-out users to fill the form before they authenticate.

Rules:

- Do not force login at page entry unless explicitly requested.
- Do not break create-form draft persistence.
- If you change create/edit fields, verify draft restore behavior.
- If you touch auth redirects in the create flow, verify the user can still finish saving after login.

### Guest Users

Guest identity is real application state, persisted through:

- `localStorage`
- `attendee_profiles`
- `attendee_sessions`

Rules:

- Do not clear or overwrite guest session tokens casually.
- Do not change storage keys without backward-compat handling.
- Do not assume guest bookings can be derived from email alone.
- Treat no-email guest profiles as valid identities; profile/session matching is primary when available.
- Preserve recovery-link behavior unless explicitly redesigning it.
- Be explicit that `/recover` token restore is real, but `/login?recovery=true` currently behaves like OTP login rather than a true guest-session recovery flow.

## RSVP And Waitlist Rules

This is one of the most fragile areas in the app.

Rules:

- Do not introduce new RSVP paths without checking existing logic in:
  - `src/pages/EventDetail.tsx`
  - `src/pages/HostDashboard.tsx`
  - `src/lib/rsvp.ts`
  - `src/lib/attendees.ts`
  - `supabase_reconcile_live_schema.sql`
- Do not change waitlist behavior in only one place if the same concept exists elsewhere.
- Prefer existing RPCs for fragile attendee operations instead of adding new direct write paths casually.
- If you touch attendee transitions, inspect:
  - `confirmed`
  - `waitlist`
  - `cancelled`
  - `promoted_at`
  - `cancelled_at`
  - proxy-added attendees
  - host-added attendees

When editing RSVP logic, explicitly think through:

- duplicate RSVP prevention
- full-capacity handling
- waitlist ordering
- cancellation promotion
- guest vs authenticated attendee matching
- proxy RSVP behavior
- semi-public/private path behavior after join

## Visibility / Sharing Rules

Current visibility contract:

- `is_public = true` => discoverable in public browse
- `is_public = false` => hidden from public browse
- `visibility = semi_public` => public preview + host-shared private link
- `visibility = private` => unlisted/link-only behavior

Rules:

- Keep visibility behavior consistent across:
  - calendar browse
  - event path building
  - share/copy actions
  - host preview/manage pages
  - signed-in dashboard links
  - guest bookings links
- When editing navigation, confirm joined users still get the correct private/public path.
- When editing semi-public flows, check access-request behavior and host actions together.

## Time / Timezone Rules

The app now stores schedule data using:

- `starts_at` in UTC
- `timezone` as authoring/display context
- `duration_minutes` instead of authoring around end time

Rules:

- Do not reintroduce device-time assumptions accidentally.
- If you touch scheduling UI, verify create, edit, display, and copy/duplicate behavior.
- Keep `utils.ts` timezone helpers aligned with UI behavior.

## Supabase Access Rules

- Keep database access patterns readable and localized.
- Use existing table names and fields exactly.
- Do not invent schema fields without updating migrations/docs.
- Be careful with client-side writes because security depends on RLS, not hidden server code.
- If a change needs stronger guarantees, prefer an RPC or clearly documented server-side pattern.

## Environment Variable Rules

Current meaningful env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`

Legacy optional:

- `APP_URL`

Rules:

- Do not add new env vars unless truly needed.
- If you add or change an env var, update:
  - `.env.example`
  - `README.md`
  - `PROJECT_ARCHITECTURE.md`
  - deployment notes
- Remember that `VITE_*` vars are exposed to the client bundle.

## UI / Routing Rules

- Maintain compatibility with `BrowserRouter`.
- Preserve deep-link behavior for:
  - `/events/:slug`
  - `/host/events/:id`
  - `/host/events/:id/edit`
  - `/calendar`
  - `/bookings`
  - `/recover`
- When adding routes, ensure they still work with static-host SPA rewrites.
- After broad UI refactors, do route-by-route smoke checks.

## Documentation Rules

When architecture or product behavior changes, update docs in the same task when practical.

At minimum, update docs if you change:

- routes/pages
- auth flow
- create/edit behavior
- env vars
- deployment assumptions
- schema expectations
- visibility/share-link rules
- guest recovery behavior
- timezone/duration behavior
- user-facing features or behavior (`CHANGELOG.md`)

Docs should describe the current real architecture:

- Supabase, not Airtable
- activities app, not Gemini app
- magic-link only auth
- delayed-auth create flow

## Dependency Rules

Rules:

- Do not add packages casually for small problems.
- Before adding a dependency, check whether existing utilities already solve it.
- If removing a dependency, confirm it is actually unused.
- Avoid reintroducing stale setup assumptions into docs or code.

## Testing Expectations

There is no automated test suite right now, so manual verification matters.

After meaningful changes, verify the relevant flows manually when possible:

1. App boots with valid env vars.
2. Login still works.
3. Protected routes still redirect correctly.
4. Create activity still works for:
   - signed-in user
   - signed-out delayed-auth save flow
   - edit mode
5. Public calendar still loads.
6. Activity detail page still loads attendees.
7. RSVP still works for:
   - signed-in user
   - guest user
   - waitlist case
   - proxy/add-another-person case
8. Cancellation still works.
9. Semi-public share/access-request behavior still works.
10. Thinking-about-it state still works on public and non-public activities.
11. Guest bookings still load.
12. Recovery link flow still restores session.
13. Host manage page still supports preview/share/edit paths.

If you cannot verify a flow, say so clearly.

## Deployment Rules

Assume static deployment unless the repo changes significantly.

For Render/static hosting:

- build output is `dist`
- SPA rewrites are required
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be available at build time
- `VITE_APP_URL` should be considered when auth redirect correctness matters

If changing deployment behavior:

- update `PROJECT_ARCHITECTURE.md`
- update `README.md`
- call out required host configuration changes

## Good Change Patterns

Preferred patterns:

- small focused edits
- explicit comments only when logic is non-obvious
- updates that keep schema/docs/code aligned
- preserving current behavior unless product changes are requested
- route-by-route smoke checks after broad UI changes

Avoid:

- broad stylistic rewrites bundled into behavior fixes
- renaming core route/table/schema fields without migrations
- mixing unrelated refactors into fragile flow changes
- silently changing auth, guest-session, or visibility semantics

## Known Hotspots

Watch for these known risks:

- schema drift between frontend expectations and SQL
- stale README/setup instructions
- RPC/frontend logic drift for RSVP/cancel flows
- duplicated business logic across client and SQL
- demo-grade recovery token/email flow
- split signed-in dashboard vs guest bookings behavior
- auth redirect drift between localhost and deployed environments
- regressions in semi-public/private link handling
- regressions in timezone/duration save/display behavior

## If Unsure

When a task touches data integrity, auth, visibility, or deployment and the safest behavior is unclear:

1. stop broad implementation
2. explain the ambiguity
3. propose the smallest safe option
4. note any schema or product decision that should be confirmed first

## Short Version

- Supabase is the backend.
- Airtable is not used.
- Guest identity is real application state.
- Magic-link auth and delayed-auth create flow are important product behavior.
- RSVP/waitlist and visibility/link behavior are high risk.
- Schema and code are not perfectly aligned.
- Keep changes small, explicit, and documented.
