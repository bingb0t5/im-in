# Analytics And Share Tracking

`I'm In` keeps analytics inside the app.

This repo does **not** implement a shared cross-app analytics platform.

Boundary rules:

- product analytics stay in `im-in`
- traffic analytics stay in `im-in`
- share-link attribution stays app-scoped
- verify/auth data stays in `lalo-verify`
- do not add phone numbers, email addresses, raw WhatsApp identifiers, or cross-app ids to analytics events

## Layers

### PostHog

Use PostHog only for product behavior inside `I'm In`.

Current event catalog:

- `event_viewed`
- `joined_event`
- `event_shared`
- `link_opened`
- `calendar_added`
- `map_opened`

Allowed properties are intentionally small:

- `activity_id`
- `link_id`
- `source`
- `share_channel`
- `visibility_type`
- `calendar_type`
- `page`
- short-lived anonymous app session id

Do not add:

- email
- phone number
- verify ids
- cross-app user ids
- raw external identifiers

### Umami

Use Umami only for traffic analytics on public web routes.

In this repo, Umami is intentionally separated from PostHog:

- Umami: public pageviews and traffic trends
- PostHog: product actions

Do not use Umami for detailed product events that belong in PostHog.

### App-local share links

`/s/:token` is an `I'm In` short-link system, backed by local Supabase tables and RPCs in this repo.

Current tables:

- `share_links`
- `share_link_opens`

This is intentionally app-scoped. It is not a shared attribution platform.

Stored fields are kept minimal and focus on:

- link token
- target activity
- public/private access type
- share source/channel
- creation time
- open count
- open time
- short-lived anonymous app session id
- coarse referrer domain

## Main implementation files

- `src/lib/productAnalytics.ts`
- `src/lib/trafficAnalytics.ts`
- `src/lib/shareLinks.ts`
- `src/pages/ShareLinkRedirect.tsx`
- `supabase/migrations/20260423130000_add_share_links_and_tracking.sql`

## Contributor rule

If a future change seems like it belongs in a generic tracking platform, stop and document why it cannot stay app-local before implementing it.
