# IMPLEMENTATION_CHECKLIST

## Purpose

This file breaks the recommended cleanup work into small, low-risk phases.

The goal is to improve structure, consistency, and maintainability while keeping the codebase lightweight and avoiding unnecessary architecture.

## Principles

- Prefer small batches of change.
- Keep the app lightweight.
- Avoid broad refactors until schema and data-flow risks are understood.
- Update docs when architecture assumptions change.
- Verify auth, RSVP, bookings, and recovery after meaningful changes.

## Phase 0: Repo Clarity

### Goal

Remove misleading project metadata and stale setup guidance.

### Tasks

- Update `README.md` so it describes the actual app, not AI Studio/Gemini scaffolding.
- Update `index.html` title to match the real product.
- Update `package.json` metadata so the project name is no longer `react-example`.
- Clarify `.env.example` so required env vars are separated from legacy or unused ones.
- Ensure `PROJECT_ARCHITECTURE.md` stays aligned with the codebase.

### Why This Matters

- Reduces confusion for future contributors and AI tools.
- Prevents incorrect setup assumptions.
- Makes deployment and onboarding simpler.

### Verification

- README setup steps match actual runtime requirements.
- No docs claim Airtable is used.
- No docs imply Gemini is required for current app behavior.

## Phase 1: Schema And Data Contract Alignment

### Goal

Document and reconcile the difference between the checked-in SQL schema and the frontend expectations.

### Tasks

- Review `supabase_schema.sql` against:
  - `src/services/guestService.ts`
  - `src/pages/EventDetail.tsx`
  - `src/types.ts`
- Confirm whether these structures exist in the real database:
  - `attendee_profiles`
  - `attendee_sessions`
  - `event_attendees.attendee_profile_id`
- Decide whether to:
  - update `supabase_schema.sql`, or
  - add new migration files, or
  - explicitly document that the checked-in SQL is incomplete
- Document the real expected data model in repo docs.

### Why This Matters

- This is the highest-risk mismatch in the repo.
- Future refactors will be unsafe until schema assumptions are explicit.

### Verification

- The schema docs match the fields and tables used in the app.
- Contributors can understand guest identity without reading the whole codebase.

## Phase 2: Lightweight Structure Cleanup

### Goal

Reduce page complexity without introducing heavy architecture.

### Tasks

- Keep `src/pages/` for screens only.
- Introduce or normalize a small shared structure such as:
  - `src/services/`
  - `src/lib/`
  - `src/types/`
- Move pure reusable logic out of page components:
  - attendee grouping
  - event count calculations
  - waitlist display helpers
  - share-link text generation
  - date/format helpers
- Keep page components focused on:
  - rendering
  - local UI state
  - event handlers that call shared helpers/services

### Candidates

- `src/pages/EventDetail.tsx`
- `src/pages/HostDashboard.tsx`
- `src/pages/Home.tsx`
- `src/pages/Bookings.tsx`

### Why This Matters

- Reduces cognitive load.
- Makes future edits safer.
- Keeps the app simple while improving organization.

### Verification

- Page files become shorter and easier to scan.
- Shared logic lives in obvious, reusable places.
- No new heavy abstractions are introduced.

## Phase 3: RSVP And Waitlist Consistency

### Goal

Reduce the risk of inconsistent attendee state.

### Tasks

- Inventory all places that create, update, cancel, or promote RSVPs.
- Compare client-side behavior with:
  - `handle_attendee_cancellation()`
  - `handle_attendee_deletion()`
  - `rsvp_to_event(...)`
- Decide which layer should be the source of truth:
  - client-side writes, or
  - SQL/RPC-driven business logic
- Document the decision in `PROJECT_ARCHITECTURE.md` and/or `AI_DEV_RULES.md`.
- Minimize duplicate business logic paths.

### Why This Matters

- This is the most fragile behavior in the app.
- Concurrency and ordering bugs are most likely here.

### Verification

- RSVP behavior is defined in one clear way.
- Waitlist promotion logic is not duplicated unpredictably.
- Event capacity handling is consistent across flows.

## Phase 4: Public/Private Event Contract

### Goal

Make event visibility behavior explicit and trustworthy.

### Tasks

- Review all event-listing and event-detail queries for `is_public` intent.
- Confirm whether private events should ever appear in:
  - `Calendar.tsx`
  - public event browsing
  - shared links
- Add documentation for public/private expectations.
- Align RLS assumptions with UI behavior.

### Why This Matters

- The UI implies a public/private distinction.
- Current public listing behavior appears incomplete.

### Verification

- Public pages only show what should be public.
- Event visibility behavior is documented clearly.

## Phase 5: Auth And Guest Session Hardening

### Goal

Improve confidence in identity flows without building a full backend.

### Tasks

- Review how signed-in users and guest users are merged through attendee profiles.
- Document exact behavior of:
  - login
  - guest RSVP
  - guest recovery
  - post-login profile sync
- Review `Login.tsx` redirect behavior for cleanliness and predictability.
- Review guest recovery flow for production-readiness gaps.
- Decide whether recovery remains demo-only for now or should be upgraded later.

### Why This Matters

- Guest bookings are a key part of the product.
- Identity bugs are hard to notice and easy to create.

### Verification

- Auth routes still behave correctly.
- Guest users can still recover and view bookings.
- Signed-in users still connect to prior attendee identity where expected.

## Phase 6: Dependency And Tooling Cleanup

### Goal

Trim noise while keeping the project simple.

### Tasks

- Confirm whether these dependencies are truly unused:
  - `express`
  - `dotenv`
  - `@google/genai`
  - `date-fns`
- Remove unused packages only after verification.
- Make `npm run clean` cross-platform if needed.
- Keep scripts minimal and accurate.

### Why This Matters

- Reduces install noise.
- Makes the repo easier to understand.
- Helps future AI/code tools infer the architecture correctly.

### Verification

- Remaining dependencies are actually used or intentionally retained.
- Scripts work in the expected developer environment.

## Suggested Execution Order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 3

Note:

`Phase 3` is the highest-risk behavior area, but it is safer to do after docs, schema understanding, and small structural cleanup improve visibility.

## Small Safe Batches

If you want to keep each implementation pass tiny, use these batches:

### Batch A

- README cleanup
- package metadata cleanup
- title cleanup
- env docs cleanup

### Batch B

- schema/documentation alignment only

### Batch C

- extract pure helpers from one page only

### Batch D

- extract shared event/attendee query helpers

### Batch E

- public/private event visibility cleanup

### Batch F

- RSVP/waitlist consistency pass

## Manual Regression Checklist

After any substantial code changes, manually verify:

1. App boots with valid Supabase env vars.
2. Signed-out home page still loads.
3. Login with email still works.
4. Google login still works if configured.
5. Event creation still works.
6. Event editing still works.
7. Public calendar still loads.
8. Public event detail page still loads.
9. RSVP works for signed-in users.
10. RSVP works for guests.
11. Waitlist behavior still works when event is full.
12. Cancellation still updates attendee state.
13. Host dashboard still updates attendee lists.
14. Guest bookings still load from stored session.
15. Recovery link flow still restores bookings access.

## What Not To Do

- Do not introduce a backend server just to tidy structure.
- Do not add a heavy state-management library unless real complexity demands it.
- Do not build a large component system before business logic is stabilized.
- Do not do a broad rename/reorg and logic rewrite in the same pass.
- Do not treat the current SQL file as unquestionably complete.

## Done Definition

This cleanup effort is in a good place when:

- the docs describe the real app accurately
- schema expectations are explicit
- pages are easier to read
- reusable logic is not scattered
- public/private behavior is clear
- guest identity flow is understandable
- the app remains lightweight and easy to change
