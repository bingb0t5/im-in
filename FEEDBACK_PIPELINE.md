# FEEDBACK_PIPELINE

## Purpose

This document describes the feedback/reporting pipeline that sends user submissions to Trello while keeping Codex prompt generation as a separate, Trello-driven step.

## High-level flow

1. User opens `Send feedback` modal on `/`.
2. User submits a bug report, feature request, or general feedback.
3. `submit-feedback` Edge Function:
   - validates payload
   - runs lightweight abuse filtering
   - stores raw submission in `feedback_submissions`
   - uploads optional screenshot to private storage bucket
   - creates a sanitized Trello card in intake list (when not blocked)
4. Later, when a Trello card is moved into the prompt-trigger list:
   - `trello-prompt-sync` generates a Codex-ready prompt
   - writes prompt into Trello card description
   - logs run metadata in `trello_prompt_jobs`

## Why prompt generation is separate

Prompt generation is intentionally not automatic at intake time. This allows:

- using the same Trello prompt flow for cards created manually in Trello
- controlling when engineering prompts are generated
- reducing unnecessary AI prompt generation for low-value cards

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

## Required secrets (Edge functions)

- `SUPABASE_SERVICE_ROLE_KEY` (provided automatically by Supabase Edge Functions; do not manually set it with `supabase secrets set`)
- `OPENAI_API_KEY`
- `TRELLO_API_KEY`
- `TRELLO_API_TOKEN`
- `TRELLO_INTAKE_LIST_ID`
- `TRELLO_PROMPT_TRIGGER_LIST_ID`

Optional:

- `OPENAI_FEEDBACK_MODEL`
- `OPENAI_PROMPT_MODEL`
- `FEEDBACK_SCREENSHOT_BUCKET` (default `feedback-screenshots`)
- `FEEDBACK_ADMIN_EMAILS` (fallback: `MODERATION_ADMIN_EMAILS`)

## Functions

### `submit-feedback`

- public endpoint (`verify_jwt = false`)
- accepts anonymous or authenticated submissions
- performs abuse-only filtering
- stores records and creates sanitized Trello intake cards

### `trello-prompt-sync`

- supports Trello webhook payloads for list-move triggers
- supports admin-triggered manual sync mode (`syncFromTriggerList: true`)
- generates Codex prompts only when card is in trigger list
- writes prompt section into card description

## Webhook setup

Recommended production setup:

- create a Trello webhook on the whole board
- set `callbackURL` to `https://<your-project-ref>.functions.supabase.co/trello-prompt-sync`
- keep `TRELLO_PROMPT_TRIGGER_LIST_ID` set to the specific list that should trigger prompt generation

Why board-level webhook:

- Trello sends all card-change events for the board
- the function filters internally and only reacts when the destination list matches `TRELLO_PROMPT_TRIGGER_LIST_ID`

## Recommended model split

- `OPENAI_FEEDBACK_MODEL=gpt-5.4-nano`
- `OPENAI_PROMPT_MODEL=gpt-5.4`

Reasoning:

- abuse filtering is narrow, repetitive, and cost-sensitive
- prompt generation is low-volume and higher-value, so stronger reasoning quality is worth the extra cost

## Manual run example

If you need to process all cards currently in the trigger list manually:

```json
{
  "syncFromTriggerList": true
}
```

Send that payload to `trello-prompt-sync` from an allowlisted admin session.
