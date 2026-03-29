# AI Moderation

## Purpose

This document explains the lightweight moderation system used for public-facing activity discovery.

It is deliberately narrow:

- it does **not** stop people from creating activities
- it does **not** act like a full trust-and-safety platform
- it mainly decides whether a public-facing activity listing is ready for **broader public discovery**

The core product rule is:

- activity creation stays open
- broader public reach is earned more carefully

## What It Moderates

The platform moderation pass currently runs for:

- `public` activities
- `semi_public` public previews

It does **not** run for:

- `private` activities

Semi-public activities are split:

- the public preview surface is part of platform moderation review and can appear in the public moderation transparency log
- the private-link-only surface is not part of platform moderation review and never appears in the public moderation transparency log

## When It Runs

Moderation is triggered in two layers:

### 1. Database-side pending state

`events` rows now use a trigger to reset public discovery when meaningful public-facing content changes.

That trigger marks qualifying public-facing activity listings as:

- `moderation_status = 'pending'`
- `public_discovery_enabled = false`

This happens on:

- create
- visibility changes into or within `public` or `semi_public`
- meaningful edits to:
  - `title`
  - `public_summary`
  - `public_location_text`
  - and for `public` only, full public-facing fields such as `description` and `location_text`

### 2. Post-save AI moderation

After create/edit, the frontend calls the Supabase Edge Function:

- `supabase/functions/moderate-activity`

That function:

- verifies the caller is the host or a co-host
- reads the saved activity server-side
- builds a compact moderation payload
- computes a content hash
- reuses an existing moderation result if the hash has not changed
- otherwise calls a cheap language model for structured classification
- stores the result back on the `events` row

## Stored Fields

The moderation system adds these fields to `public.events`:

- `public_discovery_enabled`
- `moderation_status`
- `moderation_risk_level`
- `moderation_action`
- `moderation_confidence`
- `moderation_reasons`
- `moderation_input_hash`
- `moderated_at`
- `moderation_archived_at`
- `moderation_override`

### Meaning

- `public_discovery_enabled`
  - whether the activity can appear in broader public browse/search
- `moderation_status`
  - current effective moderation state
- `moderation_risk_level`
  - raw model risk classification
- `moderation_action`
  - raw model recommendation
- `moderation_confidence`
  - model confidence clamped to `0..1`
- `moderation_reasons`
  - array of structured reason codes
- `moderation_input_hash`
  - content fingerprint used to skip repeat model calls
- `moderated_at`
  - last successful moderation timestamp
- `moderation_archived_at`
  - optional manual reviewer archive timestamp for the admin queue only
- `moderation_override`
  - simple manual override hook for operational use

## Public Transparency Log

Public moderation history is stored separately from the `events` row.

Relevant database objects:

- `public.public_moderation_log_entries`
- `public.moderator_public_identities`
- `public.list_public_moderation_log(...)`
- `public.get_event_for_view(...)`
- `public.list_public_calendar_events(...)`

Important rules:

- moderation actions for `public` activities and `semi_public` previews may be written to the public log
- private content and private-link-only semi-public content must never be written to it
- public reads should use the safe RPC, not direct table access
- moderator public identity uses a stable pseudonymous handle such as `Moderator 01`

Read-path enforcement now relies on explicit backend entry points:

- `get_event_for_view(...)` returns full details for `public`, full details for `private` link holders, and preview-only fields for `semi_public` unless the private access token is present
- `list_public_calendar_events(...)` returns public-safe browse data only
- `get_guest_bookings(...)` and `get_guest_interests(...)` restore guest session data without reopening broad raw `events` reads

### Current `moderation_status` values

- `not_required`
- `pending`
- `approved`
- `limited`
- `review`
- `blocked`
- `error`

## How Discovery Decisions Work

The model returns structured JSON:

```json
{
  "risk_level": "low | medium | high",
  "recommended_action": "allow | limit_visibility | require_review | block",
  "reasons": ["reason_code"],
  "confidence": 0.0
}
```

The app then combines that with a lightweight host trust check:

- `new`
- `established`
- `trusted`

Current trust is intentionally simple:

- it is based on prior hosted-activity count
- it is used only to relax some medium-risk / soft-reason cases
- it is not a full reputation system

### Effective behavior

- `low` risk / `allow`
  - broader public discovery is enabled
- `medium` risk / `limit_visibility`
  - broader public discovery is limited by default
  - trusted hosts may still pass in softer low-detail cases
- `high` risk / `require_review` / `block`
  - broader public discovery stays off
  - the activity itself is still saved
  - direct-link sharing still works

This keeps the system aligned with product intent:

- creation stays open
- discovery is moderated

## Current Manual Override Scaffolding

There is now a small hidden admin review page, but it is intentionally lightweight rather than a full moderation operations console.

The current MVP uses `events.moderation_override` plus a separate `events.moderation_archived_at` field for reviewer queue housekeeping.

The admin queue now stays aligned to the public-facing moderation surface:

- expanded items show the public-facing listing details moderators are actually reviewing
- queue links open the public activity page rather than the host dashboard
- recent moderation log entries are visible inline so reviewers can see earlier actions and explanations

Supported values:

- `force_visible`
- `force_limited`
- `hide`
- `mark_safe`
- `mark_spam`

These are intentionally simple operational hooks, not a full moderation workflow.

Manual archive is separate from manual hide/review. Archiving only removes an item from the active review queue; it does not change the effective discovery decision by itself.

## Privacy Boundary

This is the core architectural rule:

- platform moderation is for public-facing activity content
- `semi_public` preview content is in scope
- `semi_public` private-link-only content is out of scope
- platform moderators should not review or log private content or private-link-only semi-public content through normal moderation tooling
- public transparency should never expose private content or private-link-only semi-public content

## Exact Prompt Template

The Edge Function uses a compact prompt with structured input.

System prompt:

```text
You moderate listings for a real-world community activity app.

The app is for genuine local activities, classes, sports, meetups, games, and community plans.
Be tolerant of informal, casual, community-style wording.
Do not punish weak writing alone.

Focus on:
- obvious spam or repetitive mass-posting
- scams, misleading contact/payment requests, or impersonation
- unsafe, abusive, hateful, sexual-services, or clearly illicit listings
- listings so low-detail or low-trust that they should not get broad public discovery yet

This is not a hard safety takedown system.
The app still allows people to create activities.
Your job is to recommend how far the listing should spread in public discovery.

Return strict JSON only.
Prefer 1-3 reason codes.
Use "other" only as a last resort when no more specific reason code fits.
```

User payload shape:

```json
{
  "activity": {
    "title": "string",
    "description": "string",
    "publicSummary": "string",
    "location": "string",
    "publicLocation": "string",
    "hostName": "string",
    "visibility": "public | semi_public"
  },
  "host_trust": {
    "trust_level": "new | established | trusted",
    "prior_hosted_count": 0
  }
}
```

## Cost-Control Strategy

The moderation layer is designed to stay cheap:

- it uses a cheap model tier by default: `gpt-5.4-nano`
- it only runs for `public` and `semi_public`
- private activities bypass it
- a content hash avoids repeat model calls for unchanged content
- the prompt is short and structured
- the trust signals are intentionally lightweight

## Runtime Requirements

This system needs Supabase Edge Function environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Optional:

- `OPENAI_MODERATION_MODEL`
  - defaults to `gpt-5.4-nano`
- `OPENAI_API_BASE_URL`
  - for OpenAI-compatible endpoints if needed
- `MODERATION_ADMIN_EMAILS`
  - comma-separated email allowlist for manual moderation overrides in the hidden admin tooling

Frontend optional env:

- `VITE_MODERATION_ADMIN_EMAILS`
  - comma-separated email allowlist for the hidden route at `/admin/moderation`

## What Is Implemented Now

- schema fields for moderation state
- DB trigger to reset discovery on meaningful public-facing edits
- Edge Function moderation endpoint
- content-hash result reuse
- public calendar discovery gated by `public_discovery_enabled`
- public calendar can show a subtle count of other upcoming hidden activities in the next 7 days, excluding spam-marked items
- neutral host-facing messaging on the host dashboard
- hidden moderation admin page at `/admin/moderation` for allowlisted emails
- moderation admin queue shows public-facing listing details and recent moderation-log history inline
- manual override actions routed through the existing moderation edge function
- manual archive / return-to-review queue handling via `moderation_archived_at`
- public moderation transparency page at `/moderation`
- backend logging of public moderation actions into a separate public transparency log
- manual moderator actions can include a required public explanation which is then shown in the transparency log
- explicit backend rejection when platform moderation is attempted on private activities or on non-public fields of semi-public activities

## What Is Still Future Work

- richer reviewer/admin tooling beyond the current hidden queue
- backfill tooling for older activities
- richer trust scoring
- deeper automation from Trello labels/lists into external coding-agent workflows (currently prompt generation is list-triggered but remains inside Trello + Supabase flow)
- appeal / review workflows
- batching or async queue infrastructure for higher volume

## Interpreting `other`

`other` is a catch-all reason code.

It generally means:

- the model detected some concern with broader public discovery
- but it did not confidently match that concern to one of the named buckets such as `low_detail`, `possible_scam`, or `mass_posting_signals`

Operational rule:

- if a more specific reason code exists, `other` should not be kept alongside it

## Related but separate pipeline

User feedback / bug / feature intake now exists as a separate flow (`submit-feedback` + `trello-prompt-sync`) and is intentionally not mixed into activity visibility moderation.
