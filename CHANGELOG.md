# CHANGELOG

## 2026-04-14

### Activity-detail feedback button placement

- moved the global floating feedback button to the top-right area (below the sticky header) on attendee-facing activity detail pages at `/events/:slug`
- kept the existing bottom-floating feedback button placement unchanged for all non-activity-detail routes, including main-tab routes and host/admin pages
- preserved the same feedback modal behavior, payload source tagging, and visual button styling while applying route-aware positioning logic only

## 2026-04-12

### Host join notifications and migration reconciliation

- added a new host-facing `host_join` notification so hosts are alerted when someone newly joins an activity in `waitlist`, `pending_approval`, or `confirmed` state
- added a dedicated installed-app push preference toggle (`Someone joined your activity`) so hosts can independently opt in or out of that alert category
- registered the new `host_join` category across shared app types and push-preference SQL helpers so push dispatch can honor the new checkbox
- added a follow-up SQL reconciliation migration for the attendee notification trigger so host join alerts no longer depend on a non-existent `event_attendees.resolved_display_name` row field and instead resolve names safely from attendee row/profile data
- changed host join alerts to batch rapid same-actor additions for the same activity into a single delayed notification that lists all joined names instead of sending one host notification per inserted attendee row
- updated host-facing notification links so `host_join` alerts now open the host management page for that activity, while attendee-facing notifications continue deep-linking to the attendee/private activity page
- stopped web-push notification payloads from silently defaulting activity notifications to `/`, so push clicks now prefer the stored activity-specific URL and only fall back to a generic signed-in destination when no action URL exists

### Host-configurable custom join field

- added one host-configurable custom join field per activity, with support for `text`, `number`, and dropdown/multiple-choice options
- added host-side create/edit and dashboard settings UI to enable the field, set its label, choose whether it is required, and define dropdown options
- updated attendee join flows so both `I'm in` and `My Kids in` can capture the extra answer before submitting
- stored custom join answers in a dedicated host-only table (`event_signup_field_answers`) instead of `event_attendees`, keeping answers off publicly readable attendee rows
- added wrapper RSVP/proxy RPCs (`request_or_submit_rsvp_with_custom_answer`, `add_proxy_attendee_with_custom_answer`) plus follow-up migration fixes for trigger compatibility and custom-answer upsert indexes
- improved host readability by surfacing custom answers as clearly highlighted host-only cards in join-request, attendee, pending-approval, and waitlist views
- fixed custom-field builder UX so multi-line dropdown options accept `Enter` normally and field labels accept spaces while editing
- fixed direct `I'm in` behavior so required custom fields force the modal open before join instead of silently bypassing the extra question

### Host add-attendee duplicate handling hardening

- fixed host-side `Add Attendee` duplicate handling so duplicate inserts no longer surface raw Postgres unique-constraint errors in the UI
- normalized add-attendee guest input handling (`guest_name` whitespace cleanup, lowercased/trimmed email) before duplicate checks and writes
- changed no-email host adds to use deterministic placeholder emails derived from normalized guest name instead of random placeholders, so repeat adds dedupe consistently
- updated duplicate detection messaging to show a friendly host-facing message (`This attendee is already on the activity.`) when the attendee already exists

### Activity gallery uploads, moderation, and admin review

- added host activity gallery support (multi-image uploads) in create/edit, including image queueing/removal and persisted image management while editing
- added HEIC/HEIF upload support for iPhone photos by converting them to JPEG before storage
- added per-activity gallery visibility control (`private_only` vs `public_preview`), with private activities forcing private-only gallery behavior
- added backend gallery schema (`events.gallery_visibility`, `event_gallery_images`, `event_gallery_image_reports`) plus viewer-safe gallery RPCs and image report RPC flow
- added new Supabase Edge Functions for gallery fetch (`event-gallery`), image moderation (`moderate-event-gallery`), and admin review actions (`gallery-admin`)
- added gallery rendering on activity detail pages, including approved public-preview display and signed-in image reporting
- added hidden admin gallery review page at `/admin/gallery` and linked it from the admin hub for moderation allowlisted users

## 2026-04-11

### Moderation auto-run reliability and discovery diagnostics

- hardened post-save moderation in create/edit flows so automatic moderation now retries once before declaring failure
- stopped silently swallowing create-flow moderation invoke failures; hosts are now taken to management with a clear warning when auto-moderation did not run
- added host-side `Retry moderation now` action directly in activity settings when discovery remains locked
- updated copy-activity flow to run moderation automatically for copied public/semi-public events instead of leaving them stuck in `pending` until manual admin action
- removed stale moderation-state carry-over from copied events so each copied activity gets a fresh moderation decision
- added admin moderation `Public browse gates` diagnostics showing pass/fail checks for scheduled status, visibility scope, future timing, and discovery flag
- added internal privacy-safe moderation runtime telemetry (`moderation_runtime_events`) with minimal metadata only (`event_id`, source tag, success/failure outcome, coarse error code) and no activity content or personal message data

### Verify with WhatsApp UX guidance and build-time UI sync

- refreshed the `Verify with WhatsApp` UI copy so the flow now explains each step more clearly (what to tap, what happens in WhatsApp, and when to return to the app)
- improved the verify-screen guidance to reduce confusion during handoff and make completion expectations more explicit
- updated build behavior so WhatsApp verify UI updates are now pulled directly from the Lalo server during build, reducing drift between hosted verify messaging and app UI

### Profile editing UX polish and My Activities default-tab behavior

- updated signed-in `/profile` account details so `Name` and `Email` are now locked/read-only by default with compact inline edit controls
- replaced the large profile save buttons with small edit actions that switch into an obvious inline `Save` state per field
- removed redundant helper copy above the WhatsApp re-verification CTA so the `Change WhatsApp number` action remains clear without extra text
- guarded inline profile saves so unchanged `Name` / `Email` submissions no longer trigger unnecessary backend updates or noisy sync warnings
- updated `/my-activities` default tab selection so users with no upcoming hosted activities land on `Attending` by default instead of an empty `Hosting` view
- refreshed profile section-label styling to brand teal and removed the extra `Profile` eyebrow heading above `Account details`

### Moderation transparency naming and override reset safeguards

- updated public moderation log display names so entries now prefer the moderator's real profile name when available instead of always showing pseudonymous handles
- expanded moderation admin review cards to show clearer public-view context (summary/location/timing) and to load the latest log entries with richer timeline details
- added a required explanation step in the admin moderation decision modal so manual moderation actions are accompanied by public-facing rationale text
- updated moderation trigger/reset behavior so stale manual overrides are cleared when meaningful public-facing content changes and needs fresh review

## 2026-04-09

### WhatsApp auth session minting and richer sharing shortcuts

- updated WhatsApp auth completion so sign-in can use a returned pre-minted browser auth session (`setSession`) instead of rotating the user's password on each verification
- kept compatibility fallback to password completion for older flows while preferring direct session handoff when available
- added dedicated shortcut routes for shared activity utilities: `/loc/:code`, `/gcal/:code`, and `/ical/:code`
- added a new shortcut resolver page that opens map links, launches Google Calendar, or downloads `.ics` files from compact activity links
- expanded private WhatsApp share text so it now includes richer date/location context plus one-tap shortcut links for maps and calendar actions

## 2026-04-07

### Auth session recovery, admin access, and activity location locking

- added a shared `useSupabaseSession()` bootstrap path so `App`, the delayed-auth create flow, and account-merge completion read the current Supabase user state more consistently after auth handoffs
- hardened local auth-session recovery by clearing stale invalid refresh tokens, explicitly matching Supabase's browser storage key, retrying session reads on visibility/focus, and surfacing a clean `session expired` message when authed function calls can no longer refresh
- added an `Admin Panel` entry in the top-bar account menu for allowlisted admins so the hidden `/admin` tools are easier to reach once signed in
- locked the create/edit `Public location` UI to an approved dropdown value of `Hoi An, Vietnam`, while leaving older stored rows untouched until they are edited or duplicated through the current UI
- updated Google Maps host autofill so it still fills exact location details from shared links without overwriting the locked public location value
- changed duplicate activity so copied activities now normalize their new `public_location_text` to `Hoi An, Vietnam` instead of inheriting arbitrary older text
- moved hosted/shared/joined confirmed + `thinking` counts into the `list_my_*` RPC layer so `My Activities` no longer has to fan out extra per-activity count queries

### WhatsApp number capture, host contact visibility, and guest replies

- updated the Lalo Verify flow so successful WhatsApp verification now captures and persists the verified WhatsApp number on the linked attendee profile instead of only storing the linked identity id
- updated the signed-in `/profile` experience so linked accounts can now show the verified WhatsApp number directly when Lalo returns it
- expanded host dashboard people/contact surfaces so hosts can see available WhatsApp numbers more consistently across hosts, attendees, join requests, interests, lookup candidates, and notification recipient lists
- tightened the WhatsApp auth prep/verify and account-merge completion flows so linked identity data, including the returned WhatsApp number, is preserved more reliably across linking and merge completion
- added a guest-to-host in-app reply path through `reply_to_event_hosts(...)`, creating `guest_reply` notifications for hosts when someone replies to a host-sent activity message
- updated notification detail/top-bar behavior so host message threads can support the new guest reply action cleanly from the inbox flow

## 2026-03-30

### Optional guest email + name-first join flow

- added host-controlled `require_guest_email_for_join` so each activity can require guest email or allow name-only signup
- set guest-email requirement default to off (`not required`) and backfilled existing activities to unchecked/off
- changed guest RSVP, proxy add, and `thinking about it` flows to support name-first signup when email is optional
- added a post-success prompt that invites no-email guests to optionally add email for recovery and cross-activity continuity, with explicit copy that no other emails will be sent
- updated host attendee labeling and rendering so no-email guests are shown clearly and guest-added entries can display `added by guest user`
- updated guest profile/session handling to support no-email guest profiles with later email upgrade/merge behavior
- updated guest proxy-session bookings so activities still appear in `Activities I'm In` when a no-email guest only adds someone else
- refined attendee labels so guest-added entries show `added by <name> (guest)` and no-email self signups show `(guest account)` beside the attendee name
- fixed mixed-status attendee chips in `Your Activities` / `Activities I'm In` so `thinking` people render with the indigo style instead of looking confirmed
- made calendar actions always available on activity details (even without RSVP) and restyled them as clearer Google/Apple-style action buttons
- tightened the activity-detail calendar action layout to use smaller, compact white buttons that sit closer to the event details area
- updated `Your Activities` to show `(Guest account)` next to no-email sessions and added a clear CTA to add email for account recovery/access continuity
- fixed host-name derivation in create flow so email handles are no longer used as automatic host names
- updated post-magic-link create flow to force `One Last Step` name capture before creation, with no email-handle prefill
- added signed-in `/profile` page with editable name/email and profile-name sync across hosted and self-joined activity records
- aligned magic-link return to land on create Step 3 and updated profile name UX to show current value locked with an edit (pencil) toggle
- fixed profile-save failures by respecting generated `attendee_profiles.full_name` schema behavior and preventing background metadata sync from overwriting saved multi-word names
- added safe signed-in profile self-healing so previously truncated first-word names can be restored from trusted auth metadata without overwriting deliberate custom names
- fixed account-creation flow so the name entered in `One Last Step` is immediately persisted to the canonical signed-in profile instead of only living on the event form
- hardened guest-email upgrades by moving profile merges into a single database function that remaps attendee ownership, inviter attribution, sessions, interests, and join requests together
- stopped signed-in profile hydration from overwriting deliberate profile emails with stale auth emails during pending email-change confirmation windows
- aligned signed-in RSVP with the existing signed-in `thinking about it` path so a missing profile is created before submit instead of relying on race-prone state
- refined post-magic-link create behavior so returning users only see `One Last Step` when profile details are actually still missing
- improved auth-shell resilience so non-config `getSession()` failures no longer leave the app on an endless loading spinner, and signed-in `/login` now returns people to `My Activities`
- softened profile-save success copy when cross-activity name sync is only partially confirmed and made profile email display prefer the canonical profile record
- updated the required-email RSVP/signup modal copy to explain that host-required email helps stop spam, confirms the person is real, and is only used for account recovery
- added a small signed-out `Sign in` link on the home page and fixed the `/login` back/logout history loop by sending login back to `Home` and replacing the logout navigation entry
- fixed host request-to-view WhatsApp actions so approving/sharing now reliably opens WhatsApp with the prefilled message instead of silently approving when the browser delays popup creation
- updated approved request-to-view rows so hosts can send the private-link WhatsApp message again after a request has already been approved
- added public / semi-public / private visibility tags to hosted activity rows in `My Activities`
- updated the hosted `Semi-public` visibility badge in `My Activities` to use the same indigo color family as the public activities page
- made the top-left `I'm In` brand in `My Activities` clickable so it returns to `Home`
- updated the browser/app icon assets to use the same green calendar mark as the home-screen logo
- changed the feedback-to-Trello flow so Trello cards now receive the full submitted title/details message instead of a shortened sanitized summary, while still keeping the abuse check in place
- tweaked the `Help build it` modal bullet list alignment so wrapped items sit more cleanly beside their bullet dot
- made the headers in the longer home-page modals sticky so the title and close button stay visible while scrolling
- reworked long modal sheets so they use internal scrolling more reliably on mobile, fit the viewport better, and keep sticky headers flush to the top
- increased activity-detail bottom spacing and CTA safe-area handling so fixed bottom actions no longer chop off the host/details area on smaller screens
- stopped the main form modals from auto-opening the keyboard on arrival, which keeps mobile request/join/create sheets from jumping down before the user taps a field
- added shared body-scroll locking for the main modal-heavy pages so scrolling inside a modal no longer drifts the page behind it or returns people to the wrong scroll position on close
- updated schema/reconcile docs and project documentation to reflect the new identity and host-setting behavior

### Documentation

- restored the root `LICENSING.md` file describing the dual-licensing model (AGPL open-source path plus separate commercial licensing path)

## 2026-03-29

### Host dashboard post-create modal fix

- fixed the host-dashboard success modal so it renders on the real management page instead of disappearing after the initial loading state
- kept the one-time post-create actions focused on sharing the private WhatsApp link or returning to `My Activities` / `Home`
- tightened the WhatsApp button layout so the icon and wrapped label stay aligned on mobile

## 2026-03-28

### Google Maps host autofill

- added a host-side `Fill from link` action on the create/edit activity form so shared Google Maps links can prefill `Exact location` and, when possible, `Public location`
- kept the public/exact location inputs fully editable after autofill so hosts can still refine or override the suggested text
- added a small public edge function to resolve shortened Google Maps links such as `maps.app.goo.gl/...` before parsing, without changing the existing schema or production event flows
- added focused parser tests for supported Google Maps URL formats, invalid/coordinate-only cases, and autofill fallback behavior

### Public calendar browse grouping

- grouped the public activities list with lightweight day breaks so it is easier to scan what is on `Today`, `Tomorrow`, and later in the week
- added weekday section labels for upcoming activities within the next 7 days
- grouped everything 7 or more days away into a single `Later` section to keep the browse view simple

### Moderation admin tooling

- changed the moderation queue action link from `Open host view` to `Open public view` so moderators stay on the public-facing surface instead of jumping into host-only tooling
- added public-facing activity details directly inside each expanded moderation item, including the current public summary, location, and date/time context
- surfaced recent moderation log entries inside the admin queue so reviewers can see prior moderation history without leaving the page
- made moderation reason chips more readable with plain-language labels and explanations
- tightened AI moderation reason handling so `other` is treated as a last-resort fallback and is dropped when a more specific reason is also present

### Create activity flow refresh

- refactored `Create Activity` into a 3-step flow with visibility as the first required decision
- replaced the old visibility dropdown with full-width public / semi-public / private selection options
- regrouped the form into clearer activity-details and joining-settings steps with lighter, more compact UI
- added field-level public/private badges to clarify what is shown publicly versus only after joining or via a private link
- removed the `Show my name on the public listing` toggle and now always show host names on public and semi-public activities
- marked `Host name` as a public field in the form and keep private activities as the only mode where host visibility stays private
- fixed a mobile step-transition bug where moving into Step 3 could immediately trigger save without a fresh tap
- fixed the create-flow header back button so Steps 2 and 3 go back within the flow instead of exiting and wiping the form
- corrected private-activity visibility badges so private fields no longer show misleading public labels
- updated calendar actions so hosts can always access Google Calendar / `.ics` links
- updated calendar exports so Google Maps share URLs populate the calendar location field when present, while exact location text moves into the calendar description

### Host approval join flow refinements

- changed approval-required joins so requesters are now added to the `Going` list immediately with a `Pending host approval` state instead of staying invisible until review
- updated attendee self-management UI so pending rows show `Cancel request` instead of generic `Cancel`
- updated proxy RSVP (`Add someone else`) so it now respects `require_host_approval_for_join` and creates pending join requests rather than bypassing host approval
- updated host approval/rejection handling so proxy pending rows are promoted or cancelled in sync with join-request decisions
- hardened `event_attendees` status-constraint migration logic to reliably replace legacy checks and allow `pending_approval` safely across drifted live schemas

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
