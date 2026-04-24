# AUTH_UNIFICATION_PLAN

## Purpose

This document reviews whether `I'm In` should move from its current dual-session model:

- Supabase Auth users
- guest profile/session users

to a simpler single-user model.

It also proposes the safest path if that change is pursued.

## Short Answer

Yes, moving toward one user model is a good long-term idea.

No, the safest version is **not** "make every user a normal magic-link user immediately."

The better target is:

- one canonical identity model
- one session model
- first-use still works without email friction
- magic link is used later for recovery or upgrade when needed

In practice, that means the best target architecture is:

- **anonymous-first auth/session**
- **profile-backed identity**
- **magic-link upgrade/recovery later**

## Current Reality

The app already has one main person record:

- `attendee_profiles`

But it currently has two session systems:

1. Supabase Auth session for signed-in users
2. custom guest session via `attendee_sessions` + local storage

That means the app often has to match a person using multiple identifiers:

- `auth.uid()`
- `attendee_profile_id`
- `guest_email`
- guest session token

This is why some flows are more complex than they look.

## Current Architecture Summary

Today:

- signed-in users use Supabase Auth
- guests can RSVP without logging in
- guests get an `attendee_profile`
- guests also get an `attendee_session`
- later, if they sign in with the same email, that profile can be linked to `user_id`

This current model has one strong product benefit:

- users do not need a magic link up front just to interact

That benefit should be preserved.

## Why The Current Model Feels Silly

The current setup is understandable but awkward because:

- the same human can exist in app logic as both "guest" and "signed-in user"
- multiple identity keys are used to decide ownership
- bookings/recovery/auth are split across separate concepts
- name hydration and display logic become more fragile
- guest recovery is a custom lightweight system instead of a standard auth flow

This is not just a UI problem. It affects:

- RSVP ownership
- cancellation permissions
- proxy add flows
- bookings lookup
- recovery
- visibility/access behaviors

## Is Unification A Good Idea?

### Yes, strategically

A unified identity/session model would likely improve:

- consistency
- maintainability
- fewer edge-case identity bugs
- fewer "guest vs user" branching paths
- simpler future features

### No, not as a quick refactor

The current app has several fragile flows that depend on guest sessions directly.

If this is handled as a fast cleanup, it is likely to break:

- bookings
- cancellation authorization
- RSVP ownership checks
- recovery
- proxy actions
- semi-public/private activity behavior

## Recommendation

### Recommended target

Move to:

- one real app identity model
- one real session model
- anonymous session first
- verified magic-link upgrade later

### Not recommended target

Do **not** move straight to:

- "everyone must be a normal logged-in user before the app really works"

That would increase friction and break one of the app's best product traits:

- fast, low-ceremony participation

## Best Product/Technical Model

### Proposed model

1. User opens the app for the first time.
2. The app establishes a lightweight anonymous authenticated session.
3. The app creates or reuses an app profile for that session.
4. User can RSVP, add others, save "thinking about it", and view bookings normally.
5. Later, if the session expires or the user wants durable account access across devices, they use magic link.
6. The system upgrades or links that anonymous identity to a real email-auth user.

### Why this is better

- It preserves the current low-friction experience.
- It reduces custom guest session logic.
- It makes ownership and permissions more internally consistent.
- It aligns better with one-user mental model.

### Important nuance

This still means there are two auth states:

- anonymous
- verified email user

But that is much better than today's split between:

- custom guest session system
- separate auth session system

## Main Issues And Risks

## 1. RSVP / cancellation / proxy flows are tightly coupled to current identity logic

Current logic depends on combinations of:

- `user_id`
- `attendee_profile_id`
- `guest_email`
- guest session token

Affected areas include:

- `src/pages/EventDetail.tsx`
- `src/pages/HostDashboard.tsx`
- `src/lib/attendees.ts`
- `src/lib/rsvp.ts`
- `src/services/guestService.ts`
- `supabase_reconcile_live_schema.sql`

Risk:

- if auth unification changes only frontend code or only SQL, identity bugs will reappear

## 2. Recovery currently depends on guest-session semantics

Today the app can restore a user's bookings through guest session recovery behavior.

Affected areas:

- `src/pages/Login.tsx`
- `src/pages/Recovery.tsx`
- `src/pages/Bookings.tsx`
- `src/services/guestService.ts`
- `attendee_sessions`

Risk:

- if you remove guest sessions without replacing recovery behavior, users lose access to historical "Activities I'm In"

## 3. Existing data is already built around profile-first identity

The app currently stores data using:

- `attendee_profiles`
- `event_attendees.attendee_profile_id`
- optional `event_attendees.user_id`
- `event_interests.attendee_profile_id`
- optional `event_interests.user_id`

Risk:

- a simplistic auth-only rewrite may break linkage to older rows that do not yet have `user_id`

## 4. Shared-device behavior needs a product decision

If the app becomes "always logged in", you should decide what happens on:

- shared phones
- shared tablets
- browsers used by multiple family members

Risk:

- silent persistent auth may feel confusing if the app behaves like a personal account but the device is shared

## 5. Supabase/RLS/RPC changes are required

This is not just a frontend project change.

If unification happens, the backend contract changes too:

- auth assumptions
- RLS policies
- RPC authorization checks
- recovery model

Risk:

- schema/code drift during migration

## What Would Actually Get Simpler

If this migration is done well, these become easier:

- "who is the current person?" logic
- bookings lookup
- RSVP ownership matching
- name hydration
- proxy attribution
- "thinking about it" identity matching
- future notifications/account features

## What Would Not Automatically Get Simpler

Even with auth unification, these still need careful design:

- cross-device recovery
- shared-device behavior
- anonymous-to-verified upgrade
- ownership of historical rows
- protecting host-only actions

## Recommended Migration Direction

## Phase 0: Decision And Scope

### Goal

Decide whether the team wants:

- anonymous-first unified auth
- or to keep the current dual-session approach

### Decisions needed

- Is anonymous auth acceptable?
- Should first-use still require no magic link?
- Should old guest recovery links remain supported during migration?
- Should bookings continue to work if a user has only email but no active auth session?

### Output

- confirmed target architecture
- confirmed rollout constraints

## Phase 1: Model The Target Identity Contract

### Goal

Write down the target identity rules before changing code.

### Define explicitly

- what the canonical user identity is
- whether `attendee_profiles` remains the canonical app profile
- whether `attendee_sessions` stays temporarily, becomes legacy, or is removed
- how anonymous users map to `attendee_profiles`
- how verified auth links to those same profiles

### Required artifacts

- update `PROJECT_ARCHITECTURE.md`
- update `AI_DEV_RULES.md`
- add schema notes to `SCHEMA_ALIGNMENT.md` if needed

## Phase 2: Inventory Current Dependencies

### Goal

Map every place that currently depends on guest sessions.

### Review areas

- `src/services/guestService.ts`
- `src/pages/Login.tsx`
- `src/pages/Recovery.tsx`
- `src/pages/Bookings.tsx`
- `src/pages/EventDetail.tsx`
- `src/pages/Home.tsx`
- `src/pages/CreateEvent.tsx`
- `src/pages/HostDashboard.tsx`
- `supabase_schema.sql`
- `supabase_reconcile_live_schema.sql`

### Review tables and concepts

- `attendee_profiles`
- `attendee_sessions`
- `event_attendees`
- `event_interests`
- `events.host_user_id`
- any RLS policies relying on current guest/session behavior
- existing RPC auth checks

### Why this matters

This avoids "partial migration" bugs where some screens use the new model and others still rely on the old one.

## Phase 3: Design The Upgrade Path

### Goal

Allow a person to start frictionlessly and later attach a durable email identity.

### The key rule

The same human should keep the same app identity across:

- anonymous session
- magic-link upgrade
- later sign-in on same device
- later sign-in on new device

### Questions to answer

- What keys will be used to merge identities safely?
- Will email be the only durable merge key?
- What happens if old guest data exists for the same email?
- How are attendee rows and interest rows linked during upgrade?

## Phase 4: Backend Contract Changes

### Goal

Make backend behavior safe for the unified model.

### Likely work

- revise or replace guest-session-dependent authorization checks
- update RPCs to trust the new session model
- backfill any missing `user_id` links where appropriate
- decide whether `attendee_sessions` remains during migration
- document any new assumptions in `supabase_reconcile_live_schema.sql`

### Important rule

Do not change frontend auth assumptions without updating SQL/RPC logic in the same phase.

## Phase 5: Frontend Migration

### Goal

Move UI/session flows gradually.

### Likely order

1. add support for the new session strategy
2. keep current guest flow working temporarily
3. move bookings lookup to the unified identity source
4. move RSVP/cancel/proxy ownership checks
5. migrate recovery/login UX
6. remove deprecated guest-only branches once stable

### Why gradual

This app now has a small focused automated test suite, but not enough auth/end-to-end coverage to make a big-bang auth rewrite low-risk.

## Phase 6: Recovery And Bookings UX

### Goal

Preserve the product promise:

- no magic link up front
- use magic link later only when needed

### Required behavior

- user can still quickly join/book without auth ceremony
- returning user on same device still feels seamless
- expired-session user can recover through email magic link
- "Activities I'm In" remains understandable and reliable

### Watch-out

If this phase is not well designed, the migration will feel worse than the current system even if it is technically cleaner.

## Phase 7: Deprecate Legacy Guest Session System

### Goal

Only after the new model is proven stable:

- stop writing new guest-session records
- leave compatibility for old sessions temporarily if needed
- eventually retire legacy guest-session recovery paths

### Important rule

Do not remove `attendee_sessions` until:

- bookings work
- recovery works
- RSVP and cancellation auth works
- proxy flows work
- existing historical users are not stranded

## Rollout Strategy

### Recommended rollout

- small staged migration
- compatibility period
- manual smoke testing between each phase

### Not recommended rollout

- one large auth rewrite
- removing guest-session logic first and "fixing it later"

## Suggested Manual Verification

After each phase, test at minimum:

1. first-time user can join without friction
2. signed-in user can RSVP
3. remembered returning user can view "Activities I'm In"
4. expired-session user can recover access
5. cancellation still works
6. proxy add still works
7. "thinking about it" still works
8. semi-public/private activity access still works
9. host management routes remain protected

## Recommendation Summary

### Good idea?

Yes, as a long-term architecture improvement.

### Good idea right now as a quick simplification?

No.

### Best version of the idea?

- unify around one identity model
- replace the custom dual-session approach gradually
- preserve low-friction first use
- use magic link for later recovery/upgrade

### Best next step

Do not code immediately.

First produce a concrete migration design covering:

- target auth/session model
- exact schema and RLS changes
- affected RPCs
- frontend file-by-file changes
- rollout and fallback plan

## Final Recommendation

If the product goal is:

- "people should not need a magic link up front"
- "but we do want one coherent user model later"

then the idea is good.

But it should be treated as an **auth migration project**, not as a small cleanup task.
