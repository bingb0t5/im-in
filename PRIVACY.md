# Privacy Policy

Last updated: 2026-04-23

We take privacy seriously.

`I'm In` is designed to help people organise activities without collecting more data than the app needs to function.

---

## What we collect

We collect the data needed to run the app:

- Name or display name
- Email for sign-in and recovery
- Verified WhatsApp number only when a user chooses the verification/link flow and the verification service returns it
- Activity data such as what you host, join, request access to, or mark as "thinking about it"
- In-app communication history such as host messages and guest replies
- Limited app analytics and traffic analytics described below

We do not intentionally collect unnecessary personal data.

---

## Product analytics

`I'm In` uses a small PostHog event set for product analytics.

Current tracked product events are limited to:

- `event_viewed`
- `joined_event`
- `event_shared`
- `link_opened`
- `calendar_added`
- `map_opened`

These events are app-scoped and are used to understand how activity sharing and participation flows work.

They are intentionally limited to minimal properties such as:

- activity id
- share link id
- share channel
- source surface
- activity visibility type
- page path
- a short-lived anonymous app session id

These analytics do **not** include:

- phone numbers
- email addresses
- raw WhatsApp identifiers
- cross-app identity stitching
- data pulled in from Lalo Verify

---

## Traffic analytics

`I'm In` uses Umami for simple traffic analytics on public web surfaces.

This is used for high-level pageview and traffic trend reporting, not for detailed product behavior.

Umami is not used for product event tracking that belongs in PostHog.

---

## Share-link tracking

`I'm In` also uses app-local share-link tracking for short links created inside this app.

When a short activity share link is created or opened, the app may store:

- the link token and internal link id
- the target activity id
- whether the link points to a public or private activity view
- the share channel or source surface when known
- creation time
- open count
- open time
- a short-lived anonymous app session id
- coarse referrer domain when available

This share-link tracking is used only to understand how `I'm In` links are shared and opened.

It is app-scoped and is not a shared cross-app attribution system.

---

## What is not pulled into analytics

The app intentionally keeps analytics separate from verify/auth systems.

That means:

- WhatsApp verification data stays in the verification flow
- verify/auth-sensitive identifiers are not sent into app analytics
- analytics are not used to stitch identities across apps

---

## Activity visibility

Activities can be:

- Public
- Semi-public
- Private

This matters:

- Public activities may be visible to anyone using the platform
- Semi-public activities are visible to people with access to the link or group
- Private activities are restricted

We do not expose private activity details publicly.

---

## Moderation visibility

For public and semi-public activities:

- Moderation actions may be visible for transparency and fairness
- Limited moderation runtime telemetry may be stored to help diagnose moderation failures without storing activity content in those runtime event records

Private activity content is never exposed through the public moderation log.

---

## Children and safety

This platform is used by families.

- We do not intentionally collect sensitive information about children
- Hosts are responsible for how they share activity details
- We prioritise minimising exposure of location and personal details

---

## Data storage

Data is stored using third-party infrastructure such as Supabase.

Where applicable:

- verified WhatsApp numbers returned by the verification provider may be stored on your profile record
- notification content and reply metadata may be stored so hosts and attendees can view relevant communication history inside the app
- app-local share-link records may be stored so activity share links can work and link opens can be counted

We take reasonable steps to secure data, but no system is 100% risk-free.

---

## Data sharing

We do not sell personal data.

We only share data with third parties when required to operate the service, support account verification, provide hosting/analytics infrastructure, or comply with law.

---

## Your control

You can:

- edit your information
- delete your account where supported

---

## Changes

This policy may be updated as the app evolves.

Significant changes will be communicated where possible.

---

## Contact

If you have concerns about privacy, raise an issue or contact the maintainer.
