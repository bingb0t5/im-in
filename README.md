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
- public browse/search
- public browse/search with a subtle "other activities this week" count for hidden upcoming activity volume
- Google Calendar and `.ics` export from joined activities
- "thinking about it" interest tracking
- lightweight platform moderation for public-facing activity content, with a hidden admin review queue and a public transparency log

What is still rough or partial:

- guest recovery is only partially realized as a product flow
- schema truth is split across multiple SQL files
- there is no automated test suite
- some older docs/checklists are historical and not the full source of truth

## Product Overview

Although the codebase still uses many `event` names internally, the live product language is **activity / activities**.

Main product areas:

- a signed-out landing page with browse, create, and community/about messaging
- public activity browsing through `/calendar`
- activity detail pages with RSVP, proxy RSVP, cancellation, sharing, and host contact actions
- a create/edit flow with delayed authentication
- a host dashboard for attendee, host, and access-request management
- a guest bookings/recovery flow for users operating without a full signed-in account experience

## Key Features

### Visibility model

- `public`: publicly discoverable, full public-facing details shown
- `semi_public`: appears in public browse with limited details; host shares the private access link manually
- `private`: unlisted / link-only
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
- waitlist placement when full
- cancellation with promotion
- proxy RSVP / "add another person"
- host-added attendees
- "thinking about it" interests

### Host features

- create and edit activities
- duplicate activities
- manage attendees and waitlist
- approve/decline/request more info on semi-public access requests
- share public and private links
- add co-hosts
- see neutral discovery-status messaging when broader public visibility is limited
- allowlisted admins can use a hidden moderation page to review, archive, spam-mark, or manually override discovery decisions for public-facing activity listings

## Core User Flows

### Attendee flow

- browse public activities on `/calendar`
- open `/events/:slug`
- RSVP directly as a signed-in user or guest
- if full, join the waitlist when allowed
- optionally add another person
- optionally mark "thinking about it"
- after joining, add to Google Calendar or download `.ics`

### Host flow

- create via `/create-event`
- land on `/host/events/:id` after save
- manage attendees, requests, hosts, sharing, and duplication
- edit through `/host/events/:id/edit`

### Delayed-auth create flow

- signed-out users can fill the create form before authenticating
- draft state is stored locally
- on save, the app prompts for email and sends a magic link
- after sign-in, the user returns and completes the save

### Guest bookings flow

- guest RSVP creates or reuses an `attendee_profiles` row plus `attendee_sessions` token
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

This means the app currently has a **dual identity model**, not a fully unified one.

For the longer-term migration direction, see `AUTH_UNIFICATION_PLAN.md`.

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
- `src/lib/`: shared helpers for events, navigation, interests, RSVP, bookings, attendees, auth redirects
- `src/utils.ts`: shared formatting, timezone, slug, and calendar helpers
- `supabase_schema.sql`: baseline schema snapshot
- `supabase_reconcile_live_schema.sql`: reconciliation/RPC-heavy SQL for live environments
- `supabase_guest_identity_migration.sql`: guest/session bootstrap schema

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

Edge function runtime:

- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Optional edge function runtime:

- `OPENAI_MODERATION_MODEL`
  - defaults to `gpt-5.4-nano`
- `OPENAI_API_BASE_URL`
  - for OpenAI-compatible endpoints if needed
- `MODERATION_ADMIN_EMAILS`
  - comma-separated allowlist for server-authorized manual moderation overrides

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

## Routes

Important app routes:

- `/`
- `/login`
- `/create-event`
- `/host/events/:id/edit`
- `/events/:slug`
- `/host/events/:id`
- `/calendar`
- `/moderation`
- `/admin/moderation`
- `/bookings`
- `/recover`

Important route behavior:

- `/host/events/:id` and `/host/events/:id/edit` require a signed-in user
- `/moderation` is public-facing and only shows moderation history for public content
- `/admin/moderation` is a hidden allowlist-gated admin page layered on top of normal auth
- `/bookings` is guest-session driven, not the main authenticated dashboard
- unknown routes redirect to `/`

## Database / RPC Expectations

The frontend relies on these important RPCs in `supabase_reconcile_live_schema.sql`:

- `submit_rsvp(...)`
- `cancel_attendee_with_promotion(...)`
- `add_proxy_attendee(...)`
- `toggle_event_interest(...)`

The app also relies on these core tables:

- `events`
- `event_attendees`
- `event_hosts`
- `event_interests`
- `event_access_requests`
- `attendee_profiles`
- `attendee_sessions`

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

## Important Limitations And Risks

- `supabase_schema.sql` is not a guaranteed production snapshot by itself
- schema and behavior are split across `supabase_schema.sql`, `supabase_reconcile_live_schema.sql`, `supabase_guest_identity_migration.sql`, and `SCHEMA_ALIGNMENT.md`
- guest recovery messaging and implementation are not perfectly aligned
- `/bookings` is guest-session-centric, while signed-in users mainly use Home
- waitlist behavior depends on a mix of client helpers, SQL triggers, and RPCs
- some identity/name resolution logic remains more complex than it should be
- no automated tests currently protect the high-risk flows

## Contributing

If you are new to the project, start with:

- `README.md`
- `PROJECT_ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `CONTRIBUTING.md`
- `SCHEMA_OR_DATA_MODEL.md`
- `AI_DEV_RULES.md`

Contributors should treat auth, RSVP/waitlist logic, guest identity, visibility/share behavior, and schema changes as high-risk areas.

## Community / Open Build

The product is positioned as an open, community-built project. The landing page currently links to:

- roadmap: [Trello board](https://trello.com/b/kauEWnAe/im-in-dev-board)
- contact: `hello@joinimin.com`

## Documentation Map

- `PROJECT_ARCHITECTURE.md`: current architecture and flow-level explanation
- `FEATURES.md`: feature-by-feature product reference
- `CURRENT_STATE.md`: truth-on-the-ground implementation and gaps
- `CONTRIBUTING.md`: contributor guidance and safety notes
- `SCHEMA_OR_DATA_MODEL.md`: data model and identity/schema assumptions
- `AI_MODERATION.md`: moderation triggers, stored fields, prompt, and cost-control strategy
- `AI_MODERATION.md`: public-facing moderation boundaries, transparency log, prompt, and privacy rules
- `CHANGELOG.md`: human-readable summary of notable product and technical changes
- `AI_DEV_RULES.md`: implementation safety guidance
- `AUTH_UNIFICATION_PLAN.md`: future-facing auth unification plan
- `SCHEMA_ALIGNMENT.md`: schema drift notes
- `RELEASE_CHECKLIST.md`: release smoke-check list
