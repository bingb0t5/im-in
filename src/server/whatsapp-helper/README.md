# I’m In WhatsApp Helper

This is a new, isolated outbound-only WhatsApp helper module for I’m In. It is designed so the rest of the app can depend on a small provider interface instead of depending on Playwright directly.

The helper can:

- join a WhatsApp group from a host-provided invite URL
- return the exact joined group title so I’m In can store its own mapping
- send outbound updates to groups the helper account has already joined
- reuse one persistent helper-account session across many groups

## What was reused conceptually

The implementation borrows only a few ideas from the `lalo-whatsapp` prototype:

- persistent Playwright session handling
- WhatsApp Web login/session reuse
- exact-title chat navigation with selector fallbacks
- small centralized config loading

Those ideas were reimplemented here in a new module. The prototype structure was not copied.

## What was intentionally not reused

The following prototype behaviors were intentionally excluded:

- chat monitoring loops
- message extraction
- parsing or fingerprinting
- seen-message tracking
- Airtable or file persistence of chat content
- screenshots by default
- any logic that treats WhatsApp as a source of truth

This helper sends outbound updates only. Joining a group is supported only so the helper account can become a member of a host-approved group and later post outbound updates there.

## Privacy constraints

This module is intentionally privacy-first:

- it does not ingest normal group chat history
- it does not store WhatsApp message bodies in files or databases
- it does not scrape participant lists
- it only reads the minimum metadata needed to operate, such as the joined group title
- it does not capture screenshots unless debug artifacts are explicitly enabled
- it returns structured failure codes instead of dumping nearby chat content into logs

## Module layout

- `config.ts`: helper config and runtime directories
- `provider/`: Playwright launch, navigation, composition, send, and health logic
- `jobs/processJoinJob.ts`: queue-friendly join job stub
- `jobs/processSendJob.ts`: queue-friendly send job stub
- `templates.ts`: server-side message rendering
- `types/`: provider contracts, failure codes, and job types
- `index.ts`: public exports for the helper module

## Local setup

1. Install `playwright` in the main app before wiring this module into production code.
2. Copy `src/server/whatsapp-helper/.env.example` into a local, ignored env file if you want helper-specific settings.
3. Launch the helper provider once in a local environment and scan the QR code with the dedicated helper WhatsApp account.
4. When a host supplies a WhatsApp invite URL, call `joinGroupByInviteLink()` or `processJoinJob()` and persist the returned `groupNameExact` in I’m In.
5. Reuse the persisted session under `src/server/whatsapp-helper/runtime/session`.

## Production runtime

This helper should run as a separate long-lived Node worker, not in Cloudflare Workers or Supabase Edge Functions.

- Worker entrypoint: `src/server/whatsapp-helper/worker.ts`
- Suggested start command: `npm run whatsapp:worker`
- Required worker env vars:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `WHATSAPP_HELPER_ACCOUNT_LABEL` (optional, default `primary-helper`)
  - `WHATSAPP_WORKER_POLL_INTERVAL_MS` (optional)
  - `WHATSAPP_WORKER_HEALTH_INTERVAL_MS` (optional)

Recommended deployment shape:

- Keep the app UI on Cloudflare.
- Run this worker on a VM/container with persistent disk for the Playwright session.
- Use Supabase tables/jobs as the control plane for join/send orchestration.

## Runtime artifacts

This folder includes its own `.gitignore` so the helper can keep its experimental runtime state isolated:

- `.env`
- `node_modules/`
- `runtime/`
- `artifacts/`
- Playwright test/report output

## Operational principle

Treat WhatsApp as an unreliable outbound transport.

I’m In owns activity state. WhatsApp only receives updates.
