# FEEDBACK_PIPELINE

## Purpose

This document describes the feedback/reporting pipeline that sends user submissions to Trello while keeping Codex prompt generation as a separate, Trello-driven step.

## High-level flow

1. User opens a feedback entry surface (home-page `Send feedback` modal or the global floating feedback button).
2. User submits a bug report, feature request, or general feedback.
3. Frontend success state confirms the submission and offers a link to the public dev board.
4. `submit-feedback` Edge Function:
   - validates payload
   - runs lightweight abuse filtering
   - stores raw submission in `feedback_submissions`
   - uploads optional screenshot to private storage bucket
   - creates a sanitized Trello card in intake list (when not blocked)
5. Later, when a Trello card is moved into the prompt-trigger list:
   - `trello-prompt-sync` calls the Lalo internal engineering work-item API
   - platform creates a durable engineering work item and review packet
   - Trello gets the latest Cursor-ready prompt draft plus work-item id
   - run metadata is logged in `trello_prompt_jobs`

UI placement note:

- the global floating feedback button is route-aware: on attendee activity detail pages (`/events/:slug`) it sits top-right below the sticky nav bar; on other routes it remains bottom-floating

## Why prompt generation is separate

Prompt generation is intentionally not automatic at intake time. This allows:

- using the same Trello prompt flow for cards created manually in Trello
- controlling when engineering prompts are generated
- reducing unnecessary AI prompt generation for low-value cards
- centralizing reusable prompt-generation rules in `lalo-verify/docs/ai/*` for multi-app reuse

## Data model

### `feedback_submissions`

Stores:

- submission type, title, details
- optional reporter metadata
- abuse filter output (`abuse_risk_level`, `abuse_reasons`, `abuse_blocked`, etc.)
- Trello sync metadata (`trello_card_id`, `trello_sync_status`, list id)
- optional screenshot path (`screenshot_storage_path`)
- optional generated prompt cache (`codex_prompt_draft`)

### `trello_prompt_jobs`

Stores:

- Trello card/action IDs
- trigger list and snapshot used for idempotency
- status (`pending`, `processed`, `skipped`, `failed`)
- generated prompt copy and error details

## Privacy boundaries

- feedback raw text and screenshots are private in Supabase
- Trello intake card is sanitized by default
- no direct public read policies are granted for feedback tables
- screenshot bucket is private (`feedback-screenshots`)
- abuse-blocked submissions are not sent to Trello

## Internal review path

Items that do not make it to the public Trello board still remain internal:

- abuse-blocked items stay in `feedback_submissions` with `status = blocked_abuse`
- failed Trello sync items stay in `feedback_submissions` with `trello_sync_status = failed`
- unsent review items stay internal until explicitly retried

These are reviewed through:

- `/admin/feedback`

That page can:

- inspect full private details
- open private screenshots via signed URLs
- retry sending an item to the Trello intake list
- archive/restore internal items
- review items by bucket, including `Passed` for already-synced Trello submissions
- permanently delete items with typed `DELETE` confirmation in the UI

## Required secrets (Edge functions)

- `SUPABASE_SERVICE_ROLE_KEY` (provided automatically by Supabase Edge Functions; do not manually set it with `supabase secrets set`)
- `OPENAI_API_KEY`
- `TRELLO_API_KEY`
- `TRELLO_API_TOKEN`
- `TRELLO_INTAKE_LIST_ID`
- `TRELLO_PROMPT_TRIGGER_LIST_ID`
- `LALO_ENGINEERING_INTERNAL_API_KEY`
- `TRELLO_API_SECRET` (Trello app secret used to verify `x-trello-webhook` signature)

Optional:

- `OPENAI_FEEDBACK_MODEL`
- `FEEDBACK_SCREENSHOT_BUCKET` (default `feedback-screenshots`)
- `FEEDBACK_ADMIN_EMAILS` (fallback: `MODERATION_ADMIN_EMAILS`)
- `ENGINEERING_SERVICE_BASE_URL` (preferred; required outside local dev unless using fallback)
- `LALO_ENGINEERING_API_BASE_URL` (legacy fallback outside local dev)
- `LALO_ENGINEERING_APP` (default `im_in`)
- `TRELLO_WEBHOOK_CALLBACK_URL` (optional override; should exactly match webhook callbackURL used in Trello)

## Functions

### `submit-feedback`

- public endpoint (`verify_jwt = false`)
- accepts anonymous or authenticated submissions
- performs abuse-only filtering
- stores records and creates sanitized Trello intake cards

### `trello-prompt-sync`

- supports Trello webhook payloads for list-move triggers
- supports admin-triggered manual sync mode (`syncFromTriggerList: true`)
- creates platform-owned engineering work items only when card is in trigger list by calling `POST /api/platform/internal/engineering-worker/work-items` on Lalo internal API
- writes prompt section into card description
- verifies Trello-native `x-trello-webhook` signature using `TRELLO_API_SECRET` and callback URL
- tolerates partial Lalo responses by safely defaulting summary/metadata while preserving the generated implementation prompt when present

### `feedback-admin`

- hidden admin endpoint for listing internal feedback items
- returns signed screenshot URLs for review
- supports retrying Trello sync
- supports archive/restore of internal feedback rows
- supports permanent deletion of feedback rows, related prompt-job rows, and stored screenshots

## Webhook setup

Recommended production setup:

- create a Trello webhook on the whole board
- set `callbackURL` to `https://<your-project-ref>.functions.supabase.co/trello-prompt-sync`
- keep `TRELLO_PROMPT_TRIGGER_LIST_ID` set to the specific list that should trigger prompt generation

Why board-level webhook:

- Trello sends all card-change events for the board
- the function filters internally and only reacts when the destination list matches `TRELLO_PROMPT_TRIGGER_LIST_ID`

## Cross-repo rollout order

For deployments using shared `im-in -> lalo` prompt generation:

1. Deploy Lalo engineering API changes first.
2. Confirm `POST /api/platform/internal/engineering-worker/work-items` is healthy with your internal key.
3. Deploy `im-in` `trello-prompt-sync` changes with:
   - `ENGINEERING_SERVICE_BASE_URL` (or legacy `LALO_ENGINEERING_API_BASE_URL`)
   - `LALO_ENGINEERING_INTERNAL_API_KEY`
   - `TRELLO_API_SECRET`
   - `TRELLO_WEBHOOK_CALLBACK_URL` (if you need explicit callback URL matching)
4. Run one manual sync (`{"syncFromTriggerList": true}`) before fully relying on webhook automation.

## Recommended model split

- `OPENAI_FEEDBACK_MODEL=gpt-5.4-nano`

Reasoning:

- abuse filtering is narrow, repetitive, and cost-sensitive
- prompt generation is now centralized in Lalo internal engineering API and uses the model configured there

## Manual run example

If you need to process all cards currently in the trigger list manually:

```json
{
  "syncFromTriggerList": true
}
```

Send that payload to `trello-prompt-sync` from an allowlisted admin session.
