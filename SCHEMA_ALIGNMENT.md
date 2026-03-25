# SCHEMA_ALIGNMENT

## Purpose

Phase 1 schema/data contract alignment for this repository.

This document compares:

- the checked-in `supabase_schema.sql` snapshot
- the actual live schema exported from Supabase
- what the frontend code expects

## Live Schema Status (Current)

Based on the Supabase schema you provided, the core guest identity contract now **does** exist in production:

- `attendee_profiles`
- `attendee_sessions`
- `event_attendees.attendee_profile_id`

So the largest frontend/schema mismatch previously reported has been resolved in the live database.

## What Is Still Out Of Sync

`supabase_schema.sql` in this repo is still stale compared with live Supabase.

Key differences:

1. **`events.is_public` default**
   - repo snapshot: default `false`
   - live schema: default `true`

2. **`event_attendees` uniqueness**
   - repo snapshot: `UNIQUE(event_id, guest_email)`
   - live schema provided: no such unique constraint

3. **`event_waitlist_positions` uniqueness**
   - repo snapshot has unique constraints on `(event_id, attendee_id)` and `(event_id, position)`
   - live schema provided does not show those constraints

4. **Policy/function visibility**
   - repo snapshot contains explicit RLS policies, triggers, and `rsvp_to_event(...)`
   - live schema snippet provided lists tables/constraints only, so policy/function parity is unknown from this excerpt

## App Contract Risks That Still Matter

### 1) Split RSVP/waitlist logic

Business logic remains split between:

- client helpers (`src/lib/rsvp.ts`, page-level guard logic)
- RPC-driven write paths in `supabase_reconcile_live_schema.sql` such as:
  - `submit_rsvp(...)`
  - `cancel_attendee_with_promotion(...)`
  - `add_proxy_attendee(...)`
- older trigger/function logic in `supabase_schema.sql` snapshot such as `rsvp_to_event(...)` and waitlist promotion triggers

This is still a consistency risk regardless of table parity.

### 2) Duplicate RSVP identity risk

Without a DB uniqueness guard on attendee identity, `.maybeSingle()` query assumptions in the app can fail if duplicates accumulate for the same event/email/profile combination.

### 3) `full_name` staleness risk

Live `attendee_profiles.full_name` is defined as a default expression, not a generated column. If first/last names are updated later, `full_name` can become stale unless application logic updates it.

### 4) Newer frontend features depend on newer tables

The current app also relies on:

- `event_hosts`
- `event_interests`
- `event_access_requests`

If a database environment is aligned only to older event/attendee tables, current host, interest, and semi-public flows will not behave correctly.

## Decision

Treat `supabase_schema.sql` as a historical/starter script, not as the source of truth for production state.

Use the live schema export plus explicit reconciliation scripts for production-facing changes.

## Recommended Next Step

Use a **non-destructive reconciliation script** to:

- add performance indexes used by app query patterns
- add defensive uniqueness on waitlist position table (if aligned with product intent)
- preserve proxy RSVP behavior (do not add `UNIQUE(event_id, guest_email)` without product decision)
- keep current RPC expectations explicit in documentation
- optionally add/update helper DB function and triggers only if you want DB-side authority

## About `supabase_guest_identity_migration.sql`

`supabase_guest_identity_migration.sql` is now mainly useful for:

- bootstrapping a new environment that does not yet have guest identity/session tables
- aligning non-production environments with frontend expectations

It is likely redundant for your current production database where those structures already exist.

## Current Status

Phase 1 is now in a better state:

- live schema and frontend guest contract broadly align
- current frontend also expects co-host, interest, and access-request structures
- remaining work is reconciliation/documentation, not missing-table emergency fixes
- biggest unresolved technical choice remains RSVP/waitlist source-of-truth ownership
