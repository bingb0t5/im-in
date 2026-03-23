# CODEX_PROMPTS

## Purpose

These prompts are designed for GPT-5.3 Codex to work safely on this repository in small passes.

They assume the current repo is:

- a lightweight `React + Vite + TypeScript + Tailwind + Supabase` app
- not an Airtable app
- not using a first-party backend server in this repo

## How To Use These Prompts

- Run one prompt at a time.
- Prefer the smaller prompts before the larger ones.
- Ask Codex to explain findings before coding if the task is risky.
- After each implementation prompt, ask Codex to verify the relevant flow.

## Prompt 1: Repo Reality Check

```text
Read the repository and summarize the real current architecture in plain English.

Focus on:
- what the app actually does
- whether it uses Airtable or Supabase
- whether there is a backend server in this repo
- the auth flow
- the guest booking / guest recovery flow
- the main technical risks

Do not code.

Return:
- a 1-2 paragraph architecture summary
- a bullet list of the main routes/pages with file paths
- a bullet list of the main technical risks, ordered by severity
- a short note on any mismatch between docs/config and actual code

Keep it concise but specific, with file references.
```

## Prompt 2: Clean Up Stale Project Identity

```text
Clean up stale project identity and setup messaging without changing product behavior.

Update only the docs and metadata that are misleading, including:
- README.md
- index.html title
- package.json name/metadata if appropriate
- .env.example comments

The repo should describe the real app as a lightweight events app using Supabase.

Do not change application logic.
Keep the changes lightweight.
After editing, summarize exactly what was updated and note anything still intentionally left untouched.
```

## Prompt 3: Schema Drift Audit

```text
Audit the repository for schema drift between frontend code and the checked-in Supabase SQL.

Specifically compare:
- supabase_schema.sql
- src/services/guestService.ts
- src/pages/EventDetail.tsx
- src/types.ts

Identify:
- tables used in code but missing from SQL
- columns used in code but missing from SQL
- places where business logic exists in both SQL and client code

Do not code yet.
Return findings ordered by severity, with file references and a short recommendation for each.
```

## Prompt 4: Document The Real Data Model

```text
Update the repo documentation so the data model reflects the actual app behavior.

Focus on:
- events
- event_attendees
- event_waitlist_positions
- attendee_profiles
- attendee_sessions
- how authenticated users and guests map into those models

Do not invent schema that is not supported by the code.
If the checked-in SQL is incomplete, say so explicitly in the docs rather than pretending it is complete.

Keep the documentation practical and concise.
```

## Prompt 5: Extract Pure Helpers From Pages

```text
Refactor the codebase lightly by extracting pure reusable helper logic out of page components, while keeping the architecture simple.

Constraints:
- do not add a state-management library
- do not add a backend
- do not make a big folder reorg
- keep the app lightweight
- avoid changing behavior

Good candidates:
- attendee grouping helpers
- count calculations
- share/invite text helpers
- waitlist display helpers
- route-safe formatting helpers

Start with the smallest safe set of extractions.
Before editing, briefly state which functions you plan to extract and why.
After editing, verify there are no obvious type or lint issues.
```

## Prompt 6: Introduce A Minimal Shared Structure

```text
Improve project structure in a lightweight way.

Goal:
- keep page files focused on rendering and local UI state
- move shared logic into a minimal structure such as src/lib, src/services, and src/types

Constraints:
- no broad rewrite
- no architectural over-engineering
- no behavior changes unless required for correctness
- prefer small file moves / small helper extraction

Please:
1. explain the minimal structure you plan to use
2. make the changes
3. summarize what moved and why
4. note any hotspots that should be handled in a later pass instead of now
```

## Prompt 7: Public Event Visibility Fix

```text
Review all public event listing and event-detail behavior related to event visibility.

Focus on whether private events could accidentally appear in public flows.
Check the use of is_public in:
- src/pages/Calendar.tsx
- src/pages/EventDetail.tsx
- any event listing queries
- any relevant SQL or RLS assumptions

First, explain the current behavior and risks.
Then make only the smallest safe code changes needed to align public browsing with the intended public/private contract.
After editing, summarize the changes and any remaining limitations.
```

## Prompt 8: RSVP / Waitlist Design Review

```text
Review the RSVP and waitlist architecture before making any changes.

Compare the business logic in:
- src/pages/EventDetail.tsx
- src/pages/HostDashboard.tsx
- src/pages/CreateEvent.tsx
- supabase_schema.sql

Answer:
- where RSVP creation happens
- where cancellation happens
- where promotion from waitlist happens
- whether the source of truth is client-side, SQL-side, or split
- what the biggest risks are

Do not code yet.
Return findings first, then recommend the smallest safe next step.
```

## Prompt 9: RSVP / Waitlist Consistency Pass

```text
Make a small, safe consistency pass on RSVP and waitlist behavior.

Important constraints:
- do not do a large rewrite
- do not add a backend
- do not change product UX unless required for correctness
- be very careful about schema drift

Before editing:
- explain the exact inconsistency you plan to fix
- explain why the chosen fix is low risk

After editing:
- summarize the code changes
- describe what was intentionally not changed
- verify type/lint status if possible
```

## Prompt 10: Login / Guest Session Cleanup

```text
Clean up the auth and guest-session code paths without changing user-facing behavior.

Focus on:
- src/pages/Login.tsx
- src/services/guestService.ts
- src/pages/Bookings.tsx
- src/pages/Recovery.tsx
- src/App.tsx

Goals:
- improve readability
- reduce fragile control flow
- keep guest recovery working
- keep signed-in profile sync working

Do not redesign the product.
Make only lightweight structural or correctness improvements.
Explain the plan before editing, then summarize the results after.
```

## Prompt 11: Dependency Cleanup Audit

```text
Audit package.json for dependencies that appear unused or misleading.

Focus on:
- express
- dotenv
- @google/genai
- date-fns
- any other package that looks stale

Do not remove anything yet.
First return:
- likely unused packages
- evidence for each
- any package that looks intentionally retained
- a recommendation for the safest cleanup order
```

## Prompt 12: Dependency Cleanup Implementation

```text
Based on the repository usage, remove only dependencies that are clearly unused and safe to remove.

Constraints:
- do not remove anything that may be needed by current code
- keep the app buildable
- keep changes minimal

After editing:
- summarize what was removed
- mention any package you deliberately left in place because confidence was not high enough
- report any follow-up script or docs changes that were needed
```

## Prompt 13: README Rewrite

```text
Rewrite README.md so it accurately reflects the current codebase.

Include:
- what the app does
- actual frontend/backend stack
- required environment variables
- local development commands
- deployment notes for a static host such as Render
- known caveats around Supabase schema and guest bookings

Keep it concise and practical.
Do not oversell features that are not clearly implemented.
```

## Prompt 14: Safe Refactor Of One Large Page

```text
Choose one of the largest page files and perform a safe, lightweight refactor that improves readability without changing behavior.

Preferred candidates:
- src/pages/EventDetail.tsx
- src/pages/HostDashboard.tsx

Constraints:
- keep the app lightweight
- no broad architecture changes
- preserve behavior
- extract only obvious reusable or readability-focused pieces

Before editing, explain which file you chose and why.
After editing, summarize the refactor and note any risky areas left for later.
```

## Prompt 15: Create A Follow-Up Plan

```text
Read the repository and produce a phased cleanup plan for the next implementation steps.

Organize it into:
- quick wins
- medium-risk cleanup
- high-risk behavior work

For each item, include:
- expected value
- estimated effort
- main risk
- whether it should be done before or after schema alignment

Do not code.
Keep the output practical and execution-oriented.
```

## Best Prompt Order

If you want the safest sequence, use:

1. Prompt 1
2. Prompt 3
3. Prompt 13
4. Prompt 2
5. Prompt 5
6. Prompt 6
7. Prompt 7
8. Prompt 10
9. Prompt 11
10. Prompt 12
11. Prompt 8
12. Prompt 9

## Good Operating Rules For Codex

You can prepend this instruction block to any implementation prompt:

```text
Important constraints:
- Keep the app lightweight.
- Prefer small, low-risk edits.
- Do not add a backend server.
- Do not add a heavy state-management library.
- Do not assume the checked-in SQL schema is complete.
- Be careful with guest-session and RSVP behavior.
- If you find ambiguity in auth, schema, or waitlist logic, explain it before coding.
- After editing, summarize changes clearly and note any remaining risks.
```

## Best Prompt Style

When using Codex on this repo, prompts work best when they:

- name the exact files to inspect
- say whether coding is allowed
- explicitly forbid heavy refactors
- ask for findings first on risky tasks
- ask for verification after edits

## Short Reusable Prompt

```text
Read the relevant files first, explain the current behavior, then make the smallest safe change that improves structure without changing product behavior. Keep the app lightweight, avoid over-engineering, and call out any schema or auth ambiguity before coding.
```
