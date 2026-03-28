# CHANGELOG

## 2026-03-27

### Home and navigation

- changed `/` so it is now the real public home page for everyone, including signed-in users
- moved the signed-in hosting/attending dashboard to `/my-activities`
- updated the main home CTA so signed-in users now go to `My Activities`, while guest-session users still go to `/bookings`
- added a `Moderation transparency` link on the public activities page at `/calendar`
- changed `My Activities` and `Activities I'm In` so they only show today-and-future activities by default
- moved yesterday-and-older activities behind a compact `Past activities` toggle on both dashboard views
- simplified the home-page explainer links down to two modals by folding `How this works` into `Why this exists`

### Host approval join flow

- added per-activity host control to require approval before someone is added as a member (`require_host_approval_for_join`)
- added `event_join_requests` data model plus host-safe review RPCs (`request_or_submit_rsvp`, `list_event_join_requests_for_host`, `approve_event_join_request`, `reject_event_join_request`)
- updated attendee join UX so approval-required activities create pending join requests with clear request-state messaging
- added host-side join-request review controls in the host dashboard (approve/reject queues)

### Feedback to Trello pipeline

- added a public `Send feedback` modal on the home page for bug reports, feature requests, and general feedback
- added optional screenshot upload support for feedback submissions (stored privately)
- added `submit-feedback` Edge Function to run lightweight abuse filtering and create sanitized Trello intake cards
- added `trello-prompt-sync` Edge Function so Codex prompt generation is triggered by moving cards into a dedicated Trello list
- added SQL support for `feedback_submissions` and `trello_prompt_jobs` with private-by-default access boundaries
- documented and verified the Trello board webhook path for automatic prompt generation when cards enter the configured trigger list
- documented the manual admin sync fallback and clarified that `SUPABASE_SERVICE_ROLE_KEY` is runtime-provided by Supabase rather than manually set as a secret
- added hidden `/admin` hub page to link current and future `/admin/*` tools from one place
- added hidden `/admin/feedback` page plus `feedback-admin` function to review blocked/failed/internal feedback items and retry or archive them
- added a `Passed` bucket in `/admin/feedback` for items successfully sent to Trello
- added permanent delete support for feedback items, including related prompt-job cleanup and screenshot cleanup
- made destructive feedback deletion require typing `DELETE` in the admin UI
- updated the feedback success state so submitters can immediately open the public dev board from the confirmation message

### Moderation transparency UX

- made public moderation log entries clickable so they can open the current public-facing activity page in a modal
- kept those modal previews privacy-safe by loading them through the existing safe event read RPC
- added required moderator-written public explanations for manual moderation decisions
- now stores those moderator explanations in the public moderation transparency log instead of only generic system copy

## 2026-03-24

### Public moderation transparency

- added a public moderation transparency page at `/moderation`
- added a separate public moderation log data model for public-facing moderation history
- added stable pseudonymous moderator handles for public-facing moderation records
- added subtle public-activity history links for public and semi-public preview activity pages with moderation history
- added explicit backend guards so platform moderation only applies to public-facing activity content
- kept semi-public preview moderation in scope while excluding private-link-only semi-public content from platform moderation and public transparency

### AI moderation and public discovery

- added lightweight AI moderation for `public` and `semi_public` activities using the `moderate-activity` Supabase Edge Function
- added structured moderation storage on `events`, including risk level, recommended action, confidence, reasons, hash reuse, and moderation timestamps
- gated broader public browse visibility behind `events.public_discovery_enabled`
- added moderation reset behavior on meaningful public-facing activity edits
- added lightweight host-trust handling so some softer medium-risk cases can pass more easily for more established hosts

### Admin moderation tooling

- added hidden allowlist-gated moderation tooling at `/admin/moderation`
- added manual moderation actions for `force visible`, `force limited`, `hide / review`, `mark safe`, `mark spam`, and `re-run AI moderation`
- added a compact review queue with expandable rows and `review`, `archived`, `spam`, and `all` buckets
- separated manual queue archiving from moderation override behavior using `events.moderation_archived_at`
- kept `hide / review` in the review queue instead of treating it as archive

### Public browse updates

- kept `/calendar` limited to activities that are both public-capable and currently discoverable
- added a subtle 7-day count for other upcoming activities that are not currently shown in public browse
- excluded spam-marked items from that hidden upcoming count
- added a `Create your own activity` empty-state CTA on the public activities page

### Documentation

- updated core product, architecture, schema, and moderation docs to reflect the live moderation flow
- documented the separate reviewer archive state and the hidden moderation queue behavior
