# AI Moderation

## Purpose

This document explains the lightweight AI moderation system used for activity discovery.

It is deliberately narrow:

- it does **not** stop people from creating activities
- it does **not** act like a full trust-and-safety platform
- it mainly decides whether a public or semi-public activity is ready for **broader public discovery**

The core product rule is:

- activity creation stays open
- broader public reach is earned more carefully

## What It Moderates

The moderation pass currently runs for:

- `public` activities
- `semi_public` activities

It does **not** run for:

- `private` activities

Private activities are still saved normally, but they are not eligible for broader public discovery.

## When It Runs

Moderation is triggered in two layers:

### 1. Database-side pending state

`events` rows now use a trigger to reset public discovery when meaningful public-facing content changes.

That trigger marks qualifying activities as:

- `moderation_status = 'pending'`
- `public_discovery_enabled = false`

This happens on:

- create
- visibility changes between private and public/semi-public
- meaningful edits to:
  - `title`
  - `description`
  - `public_summary`
  - `location_text`
  - `public_location_text`

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

There is no full reviewer dashboard yet.

The current MVP uses `events.moderation_override` plus a separate `events.moderation_archived_at` field for reviewer queue housekeeping.

Supported values:

- `force_visible`
- `force_limited`
- `hide`
- `mark_safe`
- `mark_spam`

These are intentionally simple operational hooks, not a full moderation workflow.

Manual archive is separate from manual hide/review. Archiving only removes an item from the active review queue; it does not change the effective discovery decision by itself.

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
- neutral host-facing messaging on the host dashboard
- hidden moderation admin page at `/admin/moderation` for allowlisted emails
- manual override actions routed through the existing moderation edge function

## What Is Still Future Work

- real reviewer/admin UI
- backfill tooling for older activities
- richer trust scoring
- user reports
- appeal / review workflows
- batching or async queue infrastructure for higher volume
