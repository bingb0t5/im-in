# CHANGELOG

## 2026-03-24

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
