# I'm In

`I'm In` is a lightweight community activity app for organizing, sharing, discovering, and joining real-world activities.

It is built to work alongside the chat groups people already use. The app does not try to replace WhatsApp-style coordination; it adds a cleaner way to publish an activity, track who is coming, handle waitlists, share the right link, and give hosts a simple management view.

## Current Status

The app is an active early-stage product with substantial real functionality, but it is still evolving.

What is solid today:

- activity creation and editing
- public / semi-public / private visibility modes
- signed-in and guest RSVP flows
- waitlist behavior and cancellation promotion
- proxy RSVP / "add another person"
- guest session persistence and guest bookings
- host dashboard and co-host support
- WhatsApp verification/linking with persisted verified WhatsApp numbers when returned by Lalo
- in-app notifications, including host-sent activity messages and guest replies back to hosts
- public browse/search
- public browse/search with a subtle "other activities this week" count for hidden upcoming activity volume
- Google Calendar and `.ics` export from joined activities
- "thinking about it" interest tracking
- lightweight platform moderation for public-facing activity content, with a hidden admin review queue and a public transparency log
- mobile modal behavior across the main user flows, including sticky headers, internal modal scrolling, background-page scroll locking, and no forced keyboard pop on open for the main form modals

What is still rough or partial:

- guest recovery is only partially realized as a product flow
- schema truth is split across multiple SQL files
- automated verification is still light and focused, not broad regression coverage
- some older docs/checklists are historical and not the full source of truth

## Product Overview

Although the codebase still uses many `event` names internally, the live product language is **activity / activities**.

Main product areas:

- a public home page for everyone, with browse, create, transparency, and community/about messaging
- public activity browsing through `/calendar`
- a signed-in dashboard through `/my-activities`
- activity detail pages with RSVP, proxy RSVP, cancellation, sharing, and host contact actions
- a create/edit flow with delayed authentication
- a 3-step create/edit flow with visibility first
- a host dashboard for attendee, host, and access-request management
- a guest bookings/recovery flow for users operating without a full signed-in account experience
- shared modal UX patterns that keep long sheets usable on mobile without scrolling the page behind them

## Key Features

### Visibility model

- `public`: publicly discoverable, full public-facing details shown
- `semi_public`: appears in public browse with limited details; host shares the private access link manually
- `private`: unlisted / link-only
- host names are always shown on public and semi-public activity surfaces
- `public` activities can be gated by lightweight platform moderation and host trust before broader browse visibility is enabled
- `semi_public` public-preview content also goes through moderation and can appear in the public transparency log, while its private-link-only content stays outside platform moderation review
- `private` activities stay outside platform moderation review and do not appear in the public moderation transparency log
- the public browse page can also show a subtle count of upcoming activities that are happening this week but are not currently visible in public discovery, excluding items marked as spam

### Scheduling model

- `starts_at` is stored in UTC
- each activity also stores a `timezone`
- duration is stored as `duration_minutes`
- create/edit authoring uses 15-minute increments

### Attendance model

- signed-in RSVP
- guest RSVP
- per-activity host setting for whether guest email is required to join
- waitlist placement when full
- optional host approval before membership is granted
- pending-approval attendees appear in `Going` with clear `Pending host approval` labels
- cancellation with promotion
- proxy RSVP / "add another person" (approval-aware when host approval is enabled)
- host-added attendees
- "thinking about it" interests

### Host features

- create and edit activities
- duplicate activities
- manage attendees and waitlist
- approve/decline/request more info on semi-public access requests
- review and approve/reject join requests when host approval is enabled
- share public and private links
- add co-hosts
- see neutral discovery-status messaging when broader public visibility is limited
- allowlisted admins can use a hidden moderation page to review, archive, spam-mark, or manually override discovery decisions for public-facing activity listings

## Core User Flows

### Attendee flow

- browse public activities on `/calendar`
- open `/events/:slug`
- RSVP directly as a signed-in user or guest
- when guest email is optional for an activity, guests can join with just a name and add email later
- if host approval is enabled, submit a join request and appear in `Going` as `Pending host approval` until host review
- if full, join the waitlist when allowed
- optionally add another person
- optionally mark "thinking about it"
- after joining, add to Google Calendar or download `.ics`

### Host flow

- create via `/create-event`
- land on `/host/events/:id` after save
- manage attendees, requests, hosts, sharing, and duplication
- edit through `/host/events/:id/edit`
- review pending join requests where pending attendees are already visible in `Going`
- hosts can always open Google Calendar and `.ics` export actions from the activity detail page

### Create flow

- Step 1: choose visibility
- Step 2: add activity details
- Step 3: set joining rules and host info
- field-level `Public` / `Private` badges explain what is shown publicly and what stays behind the private link or after joining
- in-flow back navigation keeps draft state while moving between steps

### Delayed-auth create flow

- signed-out users can fill the create form before authenticating
- draft state is stored locally
- on save, the app prompts for email and sends a magic link
- after sign-in, the user returns to Step 3 and only sees `One Last Step` name capture when profile details are still missing

### Guest bookings flow

- guest RSVP creates or reuses an `attendee_profiles` row plus `attendee_sessions` token
- activities can allow guest join without email; those guests still get local guest-session continuity on the same device
- token is stored locally in the browser
- `/bookings` reads bookings using that guest session
- `/recover?token=...` can restore the guest session if a valid token exists

Important caveat:

- the "Find my bookings" screen in `/login?recovery=true` currently sends a Supabase magic link, not a true guest-session recovery email
- `guestService.sendRecoveryEmail()` exists in code but is not wired into the UI and still contains TODO-level email delivery scaffolding

## Auth And Identity

Current sign-in model:

- **magic-link only**
- Google sign-in is not part of the current app

Current identity model in practice:

- signed-in users use Supabase Auth
- guests use `attendee_profiles` + `attendee_sessions`
- signed-in users are also synchronized into the profile/session-backed attendee model
- WhatsApp verification/linking can enrich the canonical attendee profile with both `lalo_user_id` and a verified `whatsapp_number`
- no-email guests can add email later to unlock account recovery and cross-activity identity continuity
- guest-email upgrades now merge identities through a dedicated SQL RPC so attendee ownership, inviter attribution, sessions, interests, and join requests move together

Current hardening notes:

- signed-in profile hydration prefers the canonical `attendee_profiles` row over stale auth-email display during pending email-change confirmation
- signed-in RSVP now ensures a profile exists before submit, matching the safer signed-in `thinking about it` flow
- `/login` now redirects authenticated users to `/my-activities`

This means the app currently has a **dual identity model**, not a fully unified one.

For the longer-term migration direction, see `AUTH_UNIFICATION_PLAN.md`.

## Webview Guidance Prompts

The app includes a global, lightweight prompt system for users who open links inside in-app browsers/webviews.

- Runtime detection lives in `src/utils/runtimeEnvironment.ts`.
- Prompt eligibility logic lives in `src/utils/installPromptEligibility.ts`.
- Local prompt persistence (dismiss timers + one-time post-verify follow-up) lives in `src/utils/inAppBrowserPromptState.ts`.
- Shared profile input for prompt eligibility lives in `src/hooks/useAttendeeProfile.ts`.
- Shared post-verify install-prompt request helper lives in `src/utils/postVerifyInstallPrompt.ts`.
- Global UI/controller lives in `src/components/system/InAppBrowserPrompt.tsx`.

Current behavior:

- Prompts are considered in browser sessions generally (not only in-app browsers).
- Prompts are suppressed in standalone/installed PWA display mode.
- If not WhatsApp-verified, users see the Verify prompt.
- If WhatsApp-verified, users see the Add to Home Screen prompt and the linked profile can also retain the verified WhatsApp number returned by Lalo.
- After successful WhatsApp verification, a one-time install follow-up can appear.
- Banner dismissals are stored locally with a 7-day cooldown.
- If WhatsApp verification is disabled by environment flags, the Verify prompt can still appear, but its Verify CTA is disabled so guidance does not silently disappear.
- WhatsApp completion paths use one shared handoff (`src/integrations/lalo/completeWhatsAppAuth.ts`) so install follow-up prompt logic is not duplicated per page.

Detection caveat:

- In-app-browser/webview detection still uses user-agent plus referrer heuristics for instruction tailoring, and remains intentionally best-effort. The prompts themselves are non-blocking and fully dismissible.

## In-App Notifications

The app includes a Supabase-backed in-app notification system for signed-in users.

- Notification UX is mounted in the main top header (`AppTopBar`) with bell + unread badge (capped at `9+`), bottom-sheet inbox, and detail modal.
- Client state and live updates are handled in `src/hooks/useNotifications.ts`.
- Notification UI components live in `src/components/system/NotificationBell.tsx`, `src/components/system/NotificationsSheet.tsx`, and `src/components/system/NotificationDetailModal.tsx`.
- Notification schema, RLS, host-send RPCs, and automatic notification triggers are defined in `supabase/migrations/20260406113000_add_in_app_notifications.sql`.

Current behavior:

- Users can only read or mark read their own notifications.
- Hosts can send notifications to valid, event-related users from `HostDashboard`.
- Guests can reply to eligible host-sent activity messages, which creates `guest_reply` notifications for hosts through `reply_to_event_hosts(...)`.
- Host-facing notification flows now work alongside richer WhatsApp-number visibility in host dashboard recipient/contact surfaces when that profile data exists.
- Hosts also receive `host_join` notifications when people newly join, request to join, or enter the waitlist for a hosted activity.
- Rapid same-actor joins for the same activity are batched into one delayed host notification listing all collected names instead of generating one host alert per attendee insert.
- Automatic notifications are generated for:
  - activity shared
  - important activity updates (title/time/timezone/duration/location/description/public summary)
  - waitlist and attendance status transitions
- Host-facing activity notifications should deep-link to `/host/events/:id`, while attendee-facing activity notifications should deep-link to `/events/:slug`.
- Realtime updates are used for inbox/unread count while the app is open.

## PWA Push Notifications

The app includes a push-notification delivery pipeline for installed PWA usage.

- Push controls live in `src/pages/ProfileSettings.tsx`.
- Push is only available when:
  - the app is opened in installed/standalone mode
  - the signed-in profile has `attendee_profiles.lalo_user_id`
- Browser subscriptions and push category preferences are stored in:
  - `public.push_subscriptions`
  - `public.notification_preferences`
- New rows in `public.notifications` are queued for push via `public.push_dispatch_queue`.
- Delivery is handled by the `push-dispatch` Supabase Edge Function.
- Push notification clicks now preserve stored activity-specific action URLs when available instead of defaulting all activity notifications to `/`.

Operational note:

- Run `push-dispatch` on an interval (cron/scheduler) with `x-push-dispatch-secret` so pending queue rows are delivered.

## Stack

- Frontend: React 19 + TypeScript + Vite 6
- Styling: Tailwind CSS v4
- Routing: `react-router-dom`
- Motion/animation: `motion`
- Backend/data/auth: Supabase (Auth, Postgres, Realtime)
- Utilities: `clsx`, `tailwind-merge`, `lucide-react`

There is no Airtable integration and no first-party backend server in this repository.

## Project Structure

Important areas:

- `src/App.tsx`: auth bootstrap and route table
- `src/pages/`: page-level UI and flow logic
- `src/services/guestService.ts`: guest identity and profile sync
- `src/lib/`: shared helpers for events, navigation, interests, RSVP, bookings, attendees, auth redirects, and modal/body-scroll behavior
- `src/utils.ts`: shared formatting, timezone, slug, and calendar helpers
- `supabase_schema.sql`: baseline schema snapshot
- `supabase_reconcile_live_schema.sql`: reconciliation/RPC-heavy SQL for live environments
- `supabase_guest_identity_migration.sql`: guest/session bootstrap schema

Identity-sensitive SQL:

- `merge_attendee_profiles(...)`: canonical guest/profile merge RPC used when a no-email or guest profile is upgraded into an existing email-backed identity

## Environment Variables

Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Recommended:

- `VITE_APP_URL`
  - used as an auth redirect override for hosted/proxied environments
  - important for reliable magic-link redirects outside localhost
- `VITE_MODERATION_ADMIN_EMAILS`
  - comma-separated allowlist for the hidden moderation page at `/admin/moderation`
  - only affects whether the page is shown/usable in the frontend
- `VITE_FEEDBACK_ADMIN_EMAILS`
  - optional comma-separated allowlist for `/admin` and `/admin/feedback`
  - can be omitted if you want to rely on the moderation frontend allowlist instead
- `VITE_WEB_PUSH_PUBLIC_KEY`
  - VAPID public key used by browser `PushManager.subscribe`

Edge function runtime:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` is provided automatically by Supabase Edge Functions and should not be manually set with `supabase secrets set`
- `OPENAI_API_KEY`
- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `PUSH_DISPATCH_SECRET`

Optional edge function runtime:

- `OPENAI_MODERATION_MODEL`
  - defaults to `gpt-5.4-nano`
- `OPENAI_FEEDBACK_MODEL`
  - model for abuse-only filtering in the feedback intake function
- `OPENAI_API_BASE_URL`
  - for OpenAI-compatible endpoints if needed
- `MODERATION_ADMIN_EMAILS`
  - comma-separated allowlist for server-authorized manual moderation overrides
- `FEEDBACK_ADMIN_EMAILS`
  - optional allowlist for manual `trello-prompt-sync` runs; falls back to `MODERATION_ADMIN_EMAILS` when unset
- `TRELLO_API_KEY`
- `TRELLO_API_TOKEN`
- `TRELLO_INTAKE_LIST_ID`
  - Trello list that receives sanitized cards from in-app feedback submissions
- `TRELLO_PROMPT_TRIGGER_LIST_ID`
  - moving any card into this list triggers Codex prompt generation
- `LALO_ENGINEERING_INTERNAL_API_KEY`
  - internal key used by `trello-prompt-sync` to call Lalo feedback prompt API
- `LALO_ENGINEERING_API_BASE_URL`
  - base URL for Lalo internal engineering API (`http://localhost:3000` by default)
- `LALO_ENGINEERING_APP`
  - app identifier sent to Lalo (`im_in` by default)
- `FEEDBACK_SCREENSHOT_BUCKET`
  - defaults to `feedback-screenshots`
- `WEB_PUSH_SUBJECT`
  - optional VAPID subject, defaults to `mailto:support@im-in.local`

Legacy optional:

- `APP_URL`

See `.env.example` for the checked-in template.

## Local Development

Prerequisite: Node.js 20+ is recommended.

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env.local` or `.env`
3. Set `VITE_SUPABASE_URL`
4. Set `VITE_SUPABASE_ANON_KEY`
5. Set `VITE_APP_URL` if you want explicit hosted redirect behavior locally or in a proxy setup
6. Run `npm run dev`

If you want the AI moderation flow to work locally as well, also configure the Edge Function runtime with:

- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Changelog layman-summary generation:

- `npm run dev` and `npm run build` now run `scripts/generate-changelog-summary.mjs` before Vite starts/builds
- the script writes `src/generated/changelogSummary.ts`
- if `OPENAI_API_KEY` is set, it attempts AI rewriting with `OPENAI_CHANGELOG_MODEL` (default: `gpt-4.1-mini`)
- if AI credentials are missing or the API call fails, it falls back to deterministic non-AI summaries so builds still succeed
- the website never calls AI when users open `/changelog`; page views only read the generated static artifact

Default local URL:

- `http://localhost:3000`

## Build And Verification

- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run lint`
- `npm run clean`

Notes:

- `npm run lint` is currently a TypeScript no-emit check, not ESLint
- there is no automated test suite in the repo today
- meaningful changes should be smoke-tested manually
- changelog layman summaries are generated once per prebuild/predev run, not per page view

## Routes

Important app routes:

- `/`
- `/my-activities`
- `/login`
- `/create-event`
- `/host/events/:id/edit`
- `/events/:slug`
- `/host/events/:id`
- `/calendar`
- `/moderation`
- `/admin`
- `/admin/moderation`
- `/admin/feedback`
- `/bookings`
- `/recover`

Important route behavior:

- `/` is the public home page for both signed-out and signed-in users
- `/my-activities` is the signed-in dashboard for hosting and attending
- `/host/events/:id` and `/host/events/:id/edit` require a signed-in user
- `/moderation` is public-facing and only shows moderation history for public content
- `/admin` is the hidden landing page for admin tools
- `/admin/moderation` is a hidden allowlist-gated admin page layered on top of normal auth
- `/admin/feedback` is a hidden allowlist-gated admin page for internal feedback review
- `/bookings` is guest-session driven, not the main authenticated dashboard
- unknown routes redirect to `/`

Global menu behavior:

- the hamburger menu now comes from one shared component across top-bar routes and attendee activity detail headers
- `Create Activity` and `Explore Activities` appear at the very top of the hamburger menu list, with icons, across all menu entry points
- attendee activity detail headers pair icon-only share with the shared hamburger menu control for compact right-side actions

Feedback entry behavior:

- the public home page has a `Send feedback` modal available to signed-out and signed-in users
- a global floating feedback button is available across app routes and opens the same feedback modal
- on attendee activity detail pages (`/events/:slug`), that floating button is repositioned to the top-right below the sticky nav bar
- on all other routes, the floating button keeps its existing bottom-floating placement
- feedback supports `bug`, `feature`, and `feedback` types, plus optional screenshot upload
- submissions run a lightweight abuse filter first, then create a sanitized Trello card in the configured intake list
- the success state now also links people to the public dev board so they can see what is being worked on
- Codex prompt generation is intentionally separate and only runs when a Trello card is moved to the configured prompt-trigger list
- prompt generation now runs through Lalo internal API (`POST /v1/feedback/prompts/generate`) so `lalo/docs/ai/*` is the reusable rules source
- the recommended production setup is a Trello board webhook pointed at `trello-prompt-sync`
- a manual admin fallback still exists via `{"syncFromTriggerList": true}` when webhook setup is unavailable
- internal review for blocked/failed/not-sent feedback now lives at `/admin/feedback`
- `/admin/feedback` now includes `Review`, `Passed`, `Blocked`, `Failed`, `Archived`, and `All` buckets
- feedback records can be permanently deleted from `/admin/feedback`, with typed `DELETE` confirmation in the UI

## Database / RPC Expectations

The frontend relies on these important RPCs in `supabase_reconcile_live_schema.sql`:

- `submit_rsvp(...)`
- `request_or_submit_rsvp(...)`
- `get_my_join_request_for_event(...)`
- `list_event_join_requests_for_host(...)`
- `approve_event_join_request(...)`
- `reject_event_join_request(...)`
- `cancel_attendee_with_promotion(...)`
- `add_proxy_attendee(...)`
- `toggle_event_interest(...)`

The app also relies on these core tables:

- `events`
- `event_attendees`
- `event_hosts`
- `event_interests`
- `event_access_requests`
- `event_join_requests`
- `attendee_profiles`
- `attendee_sessions`
- `feedback_submissions`
- `trello_prompt_jobs`

### Quick DB Hotfix (legacy status constraint)

If join requests fail with `event_attendees_status_check` errors about `pending_approval`, run this in Supabase SQL editor:

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

This hotfix is safe to run multiple times and is already included in `supabase_reconcile_live_schema.sql`.

## Deployment Notes

This app is suitable for static deployment on platforms like Render, Cloudflare Pages, or similar static hosts.

Build settings:

- Build command: `npm run build`
- Publish directory: `dist`

Required build-time env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Recommended hosted env var:

- `VITE_APP_URL`

Because this is a SPA using `BrowserRouter`, configure rewrites/fallback to `index.html` so deep links continue to work.

Deep links that need rewrite support:

- `/events/:slug`
- `/host/events/:id`
- `/host/events/:id/edit`
- `/calendar`
- `/bookings`
- `/recover`

### Trello webhook note

For automatic Codex prompt generation, create a Trello webhook on the board and point it at:

- `https://<your-project-ref>.functions.supabase.co/trello-prompt-sync`

The function filters board events internally and only reacts when a card is moved into `TRELLO_PROMPT_TRIGGER_LIST_ID`.

## Important Limitations And Risks

- `supabase_schema.sql` is not a guaranteed production snapshot by itself
- schema and behavior are split across `supabase_schema.sql`, `supabase_reconcile_live_schema.sql`, `supabase_guest_identity_migration.sql`, and `SCHEMA_ALIGNMENT.md`
- guest recovery messaging and implementation are not perfectly aligned
- `/bookings` is guest-session-centric, while signed-in users mainly use Home
- waitlist behavior depends on a mix of client helpers, SQL triggers, and RPCs
- some identity/name resolution logic remains more complex than it should be
- no automated tests currently protect the high-risk flows

## Contributing

See CONTRIBUTING.md

## Governance

See GOVERNANCE.md

## Privacy

See PRIVACY.md

## Terms of Use

See TERMS.md

## Licensing

See LICENSING.md

## Community / Open Build

The product is positioned as an open, community-built project. The landing page currently links to:

- roadmap: [Trello board](https://trello.com/b/kauEWnAe/im-in-dev-board)
- contact: `hello@joinimin.com`
- explainer modals: `Why this exists` and `Help build it`

## Documentation Map

- `PROJECT_ARCHITECTURE.md`: current architecture and flow-level explanation
- `FEATURES.md`: feature-by-feature product reference
- `CURRENT_STATE.md`: truth-on-the-ground implementation and gaps
- `CONTRIBUTING.md`: contributor guidance and safety notes
- `SCHEMA_OR_DATA_MODEL.md`: data model and identity/schema assumptions
- `AI_MODERATION.md`: moderation triggers, stored fields, prompt, and cost-control strategy
- `AI_MODERATION.md`: public-facing moderation boundaries, transparency log, prompt, and privacy rules
- `FEEDBACK_PIPELINE.md`: feedback intake, abuse filtering, Trello sync, and Trello-triggered Codex prompt generation
- `CHANGELOG.md`: human-readable summary of notable product and technical changes
- `AI_DEV_RULES.md`: implementation safety guidance
- `AUTH_UNIFICATION_PLAN.md`: future-facing auth unification plan
- `SCHEMA_ALIGNMENT.md`: schema drift notes
- `RELEASE_CHECKLIST.md`: release smoke-check list

Admin rule:

- any new hidden `/admin/*` feature should also be linked from `/admin` so there is one discoverable entry point for internal tooling
