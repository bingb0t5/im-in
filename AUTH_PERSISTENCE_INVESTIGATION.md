# Im In Auth Persistence Investigation

This document captures a production auth/session persistence issue in `im-in` that appears adjacent to, but distinct from, the `lalo-verify` migration work.

## Current conclusion

- WhatsApp auth appears to complete successfully in production.
- Users do get logged in and the app works in the moment.
- The likely issue is that the Supabase browser session is not persisting or surviving later bootstrap/focus refresh reliably.
- This should be treated as a separate investigation from the `lalo-verify` migration.

## Why this is probably separate from the migration

During migration testing, the new `lalo-verify` host successfully served:

- `lalo-verify` manifest and artifact files
- standalone platform auth routes
- standalone engineering/feedback routes

The production behavior reported on `joinimin.com` matches an existing `im-in` browser-session persistence problem more than a platform-host routing failure.

## Observed production symptoms

Browser console on `joinimin.com` shows repeated warnings:

- `Auth sync hit a recoverable session error.`
- `message: "Auth session missing!"`
- `lastCheck: "refreshSession"`
- triggers include `bootstrap` and `focus`

Also observed:

- browser launches `whatsapp://send?...`
- direct Supabase REST updates then fail with:
  - `PATCH ... /rest/v1/event_attendees ... 403 (Forbidden)`

## Important interpretation

The warning alone is not necessarily fatal. It can happen when:

- there is no existing browser session yet
- or the app is still in the middle of auth recovery

The more meaningful signal is the later `403`, which indicates browser-side writes are happening without a valid durable Supabase session.

## Most relevant code paths

### Session bootstrap warning

File: `src/hooks/useSupabaseSession.ts`

- On app bootstrap/focus/visibility resume, the app tries to recover a Supabase session.
- If no valid session is available, it logs:
  - `Auth sync hit a recoverable session error.`

Relevant behavior:

- calls `loadSessionWithRecovery(supabase.auth, ...)`
- logs `result.error.message`
- still treats this as recoverable unless a hard config error occurs

### Session recovery helper

File: `src/lib/authSession.ts`

- Performs:
  - `getSession()`
  - then `refreshSession()` if needed
- Can surface:
  - `"Auth session missing!"`
- Also clears stale invalid refresh tokens in some cases

This file is central to the later investigation because it determines whether an existing browser session is considered valid.

### WhatsApp completion -> browser session handoff

File: `src/integrations/lalo/laloAuth.ts`

This is the most important part of the flow:

- `finalizeLaloWhatsAppAuth()`
- `laloClient.completeWhatsAppAuth(attemptId)`
- `signInWithCompletion(completion)`

The expected success path is:

1. `lalo-auth-complete` returns `auth_session`
2. `supabase.auth.setSession({ access_token, refresh_token })` runs
3. browser session becomes durable
4. later bootstrap/focus checks should find that session

This is the key branch to inspect later.

### Backend completion response shape

File: `src/integrations/lalo/laloClient.ts`

Expected response from `lalo-auth-complete` includes:

- `auth_session.access_token`
- `auth_session.refresh_token`

If these are missing in production, the persistence issue may actually begin upstream in completion.

### 403 after login

File: `src/services/guestService.ts`

After sign-in/profile sync, the app attempts browser-side updates such as:

- updating `attendee_profiles`
- linking `event_attendees.user_id`

If the browser session is not truly authenticated at that point, Supabase RLS will reject those writes, which matches the observed `403`.

## Current working hypothesis

Most likely one of these is happening:

1. `lalo-auth-complete` does not always return `auth_session` in production
2. `supabase.auth.setSession(...)` is failing or not persisting cleanly
3. session is created briefly but lost on next bootstrap/focus refresh
4. app-side profile/guest sync runs before the durable session is actually established

## What to inspect next in a fresh debugging session

### Highest priority

Capture one full successful-but-not-persistent auth attempt in production and inspect:

1. Network response for `lalo-auth-complete`
2. Whether it includes:
   - `auth_session.access_token`
   - `auth_session.refresh_token`
3. Whether `supabase.auth.setSession(...)` logs or throws an error
4. Whether Supabase auth state actually changes to signed-in
5. Whether the browser stores the Supabase auth token key

### Browser/devtools checks

For one production attempt:

1. Open `joinimin.com`
2. Open DevTools `Network`
3. Complete one WhatsApp auth flow
4. Inspect:
   - `lalo-auth-start`
   - `lalo-auth-status`
   - `lalo-auth-complete`
5. Confirm `lalo-auth-complete` response payload
6. Check console for:
   - any `setSession` failure
   - any immediate sign-out / token refresh problem

### Storage checks

After a seemingly successful login, inspect browser storage for the Supabase auth token entry derived from the app's Supabase project ref.

If it is missing or disappears quickly, the persistence issue is almost certainly frontend/session-handling rather than migration routing.

## Why this should be parked for now

This issue is important, but it is not required to continue validating the `lalo-verify` migration itself.

Migration testing should continue with these goals:

- confirm `im-in` can talk to standalone `lalo-verify`
- confirm auth/verify routes are served by `lalo-verify`
- confirm engineering/feedback routes are served by `lalo-verify`
- confirm `lalo-app` is no longer required for `im-in`

Then return to this auth persistence investigation as a dedicated follow-up.

## Suggested next-chat prompt

Use something like this in a fresh chat:

`Investigate the im-in production auth persistence issue documented in AUTH_PERSISTENCE_INVESTIGATION.md. Focus on the WhatsApp completion -> Supabase browser session handoff, especially lalo-auth-complete, supabase.auth.setSession(...), useSupabaseSession bootstrap/focus recovery, and why event_attendees updates hit 403 after a seemingly successful login on joinimin.com.`
