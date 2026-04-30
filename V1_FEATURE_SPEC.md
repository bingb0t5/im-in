# I'm In - V1 Feature Spec (Definitive)

## 1. What This Document Is

This document defines the intended V1 product scope for `I'm In`.

It is based on:

- the current codebase
- the current product documentation in `README.md`, `CURRENT_STATE.md`, and `FEATURES.md`
- the desired V1 direction captured in the outline for this document

This document is meant to make three things explicit:

- what `I'm In` already is today
- what must be true for V1 to be considered complete
- what is intentionally not part of V1

This is not a technical implementation plan and not a backlog dump.

It is a product scope document that should help answer:

- what product we are actually building
- what users should be able to do in V1
- what gaps still exist between the current product and the V1 target

Where the current codebase already supports a feature, that is noted here.
Where the codebase only partially supports a feature, that is called out.
Where the feature is part of V1 but not yet implemented, that is also called out.

## 2. Product Definition

`I'm In` is a lightweight community activity organiser.

Its job is to make real-world plans easier to publish, join, and manage.

It helps people:

- see what is happening nearby or within a relevant community
- use one trusted place to understand what is going on in an area
- organise activities without needing a heavy setup flow
- join activities quickly, even without creating a full account first
- contact or connect with the actual host of an activity
- coordinate attendance without relying only on chat threads

It is especially useful for:

- expats
- worldschoolers
- short-term communities
- local organisers who repeatedly host informal activities
- parents, coordinators, and community builders who need simple attendance tracking

Core idea:

Someone arriving in a place or plugging into a temporary community should be able to quickly understand what is going on and join in with minimal friction.

For worldschoolers, expats, and digital nomads, this matters because people constantly arrive, leave, and re-enter local community contexts.

V1 should reduce dependence on one person, one WhatsApp admin, or one informal gatekeeper who happens to know everything.

The product should make the local activity picture visible while keeping activity-level control with the people actually hosting each activity.

The product is intentionally:

- lightweight rather than social-network-heavy
- activity-first rather than profile-first
- WhatsApp-compatible rather than chat-replacement-oriented
- decentralised around hosts rather than controlled by one local gatekeeper
- useful for both signed-in users and remembered guest users

### 2.1 Relationship to Worldschooling

`I'm In` is not a worldschooling-only product.

Worldschooling is a strong use case, not the entire identity of the app.

V1 should support a worldschooling lens by:

- making it easier to discover activities relevant to that audience
- supporting community-specific visibility and grouping
- allowing hosts and imported listings to signal community relevance

V1 should not:

- rebrand the whole product around worldschooling
- create a separate standalone product experience for worldschoolers
- require every activity to belong to a worldschooling concept

The correct V1 posture is:

- one product
- multiple community lenses
- worldschooling as one important lens

## 3. Feature Set Overview

V1 consists of five primary product layers:

- Core Activity System
- Explore + Discovery
- Guest + Identity Layer
- Host Tools
- WhatsApp Layer
- Trust + Community Layer

These are supported by one cross-cutting area:

- Notifications

The codebase already has strong coverage in the Core Activity System and parts of Host Tools.

Explore + Discovery needs more product emphasis for V1.
It is not just a browsing page.
It is the main answer to "what is going on here?"

The biggest V1 gaps are:

- clearer identity and guest recovery
- a stronger single-source-of-truth discovery experience for each local area or community lens
- WhatsApp automation rather than mostly manual sharing
- trust and reputation signals beyond simple moderation/trust heuristics
- a true community layer rather than only broad community-oriented positioning

## 4. Core Activity System

The Core Activity System is the heart of `I'm In`.

V1 should make creating, viewing, joining, and sharing activities feel fast and dependable.

### 4.1 Activity Creation

#### Current product reality

The current codebase already supports a meaningful creation flow:

- create and edit activity flow
- four-step authoring flow:
  - visibility
  - details
  - photos
  - joining settings
- visibility modes:
  - `public`
  - `semi_public`
  - `private`
- timezone-aware scheduling
- duration selection
- capacity limits
- waitlist enable/disable
- host approval for join
- guest email requirement for join
- one custom join field per activity:
  - text
  - number
  - select
- public summary vs private detail separation
- public location plus exact private location details
- Google Maps link parsing
- image gallery uploads
- gallery visibility control for public-preview vs private-only images
- delayed-auth create flow so signed-out users can start before signing in

#### V1 requirement

V1 must keep this flow lightweight while making it feel complete and intentional.

V1 activity creation must include:

- the existing four-step flow
- clear visibility guidance so hosts understand what each audience can see
- time, timezone, and duration as first-class fields
- capacity and waitlist controls
- host-approval option
- guest-email requirement option
- one custom join field
- location support with:
  - reusable public location grouping
  - exact location detail
  - map link support
- image gallery support

#### V1 definition of done

A host should be able to create a useful activity in a few minutes without needing:

- a complex profile
- a long onboarding flow
- external tools for the core setup

### 4.2 Participation

#### Current product reality

The current app already supports:

- RSVP for signed-in users
- RSVP for guests
- cancel RSVP
- waitlist join
- waitlist promotion after cancellation
- proxy RSVP / add another person
- host approval flow for join requests
- semi-public access requests
- "thinking about it" interest tracking
- host-added attendees
- one custom join-field answer captured at join time

There is also a meaningful distinction in the current codebase between:

- full RSVP participation
- interest-only participation

#### V1 requirement

V1 participation must make joining feel instant, but still give hosts enough control for real community use.

V1 must support:

- instant RSVP when approval is not required
- join request flow when host approval is on
- waitlist when capacity is reached
- automatic promotion when space opens
- proxy RSVP
- "thinking about it"
- guest participation without requiring a full account
- collection of one extra host-defined signup detail when needed

#### V1 definition of done

Guests and signed-in users should both be able to move from link click to successful participation with minimal friction.

Hosts should be able to enforce basic attendance rules without turning the product into a heavy registration system.

### 4.3 Activity Viewing

#### Current product reality

The current app already supports:

- activity detail page
- public vs semi-public preview distinctions
- attendee state display
- host information when configured
- image gallery preview
- Google Calendar export
- `.ics` download
- share actions from the detail page

The current browse experience already includes:

- `/explore`
- public discovery gating
- semi-public preview cards
- grouped upcoming activity display

#### V1 requirement

V1 activity viewing must make it easy to answer:

- what is this
- when is it
- where is it
- who is hosting it
- can I join
- how many spots are left
- who is already in, when that is allowed

V1 detail pages must support:

- clear title, description, date, time, timezone, and duration
- location summary and exact join-ready location when appropriate
- visibility-aware attendee information
- join status and join actions
- calendar export
- simple share actions

### 4.4 Sharing Model

#### Current product reality

The current product is already strongly link-based and WhatsApp-oriented:

- public and private activity links
- private short-link flows
- WhatsApp share actions
- no account required for receiving a link and joining

The current product does not yet fully automate communication after sharing.

#### V1 requirement

V1 sharing must remain:

- link-based
- mobile-friendly
- WhatsApp-first
- low-friction

V1 should preserve the principle that:

- the app provides the structured activity layer
- existing chat groups remain the social distribution layer

That means V1 should not force:

- everyone into full app accounts
- in-app chat as the primary coordination method

## 5. Guest + Identity Layer

Identity is one of the most important V1 areas because the product already supports guest use, but the current experience is still uneven.

### 5.1 Current State

The current codebase supports a dual identity model:

- signed-in users, with Verify with WhatsApp / the WhatsApp verification system becoming the primary account identity direction
- guest users via local device-backed guest sessions

The app already supports:

- guest RSVP and remembered bookings
- guest sessions stored on device
- guest profile continuity across activities on the same device
- guest email as backup and recovery support
- guest-to-account merge logic
- WhatsApp-linked identity enrichment
- prompt-based conflict handling for some merge cases

The current codebase also shows the main weakness clearly:

- guest recovery is only partially complete as a polished product flow
- some account and host-management surfaces still treat email as the primary lookup or invite method

### 5.2 V1 Requirements

V1 must make the identity model understandable to normal users.

The product should never leave people wondering:

- am I signed in
- am I just remembered on this phone
- how do I get my bookings back on another device
- what happens if I later create a proper account

V1 must include:

#### Clear guest state

Users operating through a remembered guest session should see:

- that they are currently using a local guest identity
- that the device remembers their activities
- that verifying with WhatsApp unlocks stronger continuity across devices

#### Reliable recovery

Guest recovery must work as a real user flow, not just as partial plumbing.

This means:

- a working recovery entry point
- a clear explanation of what can be recovered
- a dependable WhatsApp verification identity path, with email as backup recovery
- no confusing overlap between guest recovery, backup email recovery, and the primary WhatsApp verification path

#### Smooth upgrade to account

A user who starts as a guest should be able to:

- verify with WhatsApp later
- add email later as backup
- keep their existing activities
- avoid duplicate or conflicting identities when possible

#### WhatsApp-first account identity

V1 should treat Verify with WhatsApp / the WhatsApp verification system as the primary account identity path.

Email should still exist, but mainly as:

- backup recovery
- compatibility with existing users and flows
- a secondary contact method where useful

V1 should review and update places where the product still assumes email is the preferred account identifier.

Examples include:

- host and co-host lookup
- host invitation flows
- account recovery wording
- profile setup prompts
- any "enter email to identify this person" flow

For host and co-host management, the V1 direction should be:

- find or invite people by WhatsApp number first
- use verified WhatsApp identity where available
- keep email as a backup or fallback, not the primary path

#### Better "your activities" visibility

V1 should make it easy for both guests and signed-in users to find:

- activities they joined
- activities they are waitlisted for
- activities they are hosting
- activities they marked as "thinking about it"

### 5.3 V1 product standard

For V1, the identity system does not need to become architecturally perfect.

It does need to feel coherent.

That means:

- guest use must be intentional, not second-class
- recovery must feel real
- upgrade from guest to WhatsApp-verified account must feel safe
- the UI must explain the state clearly

## 6. Host Tools

Host workflow is already one of the strongest parts of the product.

V1 should turn that into a clearly host-useful system for recurring organisers.

### 6.1 Current

The current host toolset already includes:

- create activities
- edit activities
- manage attendee list
- manage waitlist
- manage join approvals
- review semi-public access requests
- add attendees manually
- view custom join answers
- co-host management
- duplicate activity
- share links
- WhatsApp share actions
- manual in-app activity messages
- host notifications when people join, request, or waitlist

Current caveat:

- some host collaboration flows still rely on email lookup or email-based invitation patterns, including co-host addition
- V1 should move those flows toward WhatsApp number / verified WhatsApp identity lookup, with email only as backup

### 6.2 V1 Improvements

#### Smart re-sharing

The current codebase already includes share suggestion infrastructure.

V1 should formalise this into a simple host tool that suggests:

- previous attendees
- recently relevant participants
- people the host has recently shared with

This must be:

- optional
- lightweight
- clearly framed as a suggestion, not a blast tool
- non-spammy in both product design and defaults

The host should feel like:

- "these are people you may want to invite again"

not:

- "send mass outreach now"

#### WhatsApp-first host collaboration

V1 host tools should align with the product's WhatsApp-first identity model.

Hosts should be able to add or invite co-hosts using:

- WhatsApp number
- verified WhatsApp identity where already known
- email only as a backup fallback

This matters because hosts and organisers often know each other through WhatsApp before they know each other's email addresses.

The product should not make email feel like the canonical identity when the rest of the product is designed around WhatsApp verification and WhatsApp coordination.

#### Location reuse

V1 should allow hosts to reuse location setups more intentionally.

This should include:

- save frequently used locations
- reuse a prior location setup
- preserve structured details like:
  - public area
  - exact location text
  - Google Maps link
  - booking or contact notes where relevant

The current codebase supports location parsing and structured location entry, but not yet a full saved-location host product.

#### Visibility controls

The current product already supports visibility modes and interest visibility options.

For V1, hosts also need clearer attendee visibility control.

V1 should support the ability to choose whether attendees are:

- shown by name
- shown only as counts
- hidden from attendees entirely

This should be explicit and understandable at setup time.

Today, "thinking about it" visibility has more control than the main RSVP attendee list.
That is not enough for V1.

#### Slot types

V1 should support lightweight slot framing where it materially helps hosts explain attendance.

The key use case is not a full booking engine.

It is a simple way to express distinctions such as:

- bring your own equipment
- host provides equipment
- limited provided spots vs unlimited joiners

This should stay lightweight and activity-focused.

The current app does not yet implement a real slot-type or equipment-layer feature.

### 6.3 V1 product standard

A recurring host should be able to run real activities from `I'm In` without needing:

- spreadsheets for attendance
- chat-thread memory for who is in
- repetitive manual share copying for every repeat activity

## 7. WhatsApp Layer (Critical)

This is a critical V1 area because the product is already designed to work alongside WhatsApp, but not yet far enough into WhatsApp-native automation.

The V1 product direction is not for `I'm In` to become a full WhatsApp automation and messaging-management system itself.

The intended direction is:

- `I'm In` owns activity data, host controls, attendance state, and user-facing activity flows
- a third-party WhatsApp automation tool/plugin owns WhatsApp delivery and messaging workflows
- `I'm In` plugs into that automation layer through a clear integration contract

### 7.1 Current

The current codebase already supports:

- manual WhatsApp sharing
- WhatsApp verification/linking
- verified WhatsApp number storage when available through the WhatsApp verification system
- host visibility into WhatsApp numbers where available
- in-app notifications
- host-sent activity messages inside the app
- guest replies to host messages
- beta-level host WhatsApp connect infrastructure

What it does not yet fully support is automated, system-sent WhatsApp communication tied to the activity lifecycle.

### 7.2 V1 Must Include

#### Automated updates

V1 must support system-generated WhatsApp messaging for important activity state changes, delivered through a third-party WhatsApp automation tool/plugin rather than by building a complete WhatsApp automation product inside `I'm In`.

At minimum this should cover:

- activity created
- spots remaining
- full
- spot reopened

This can be scoped carefully, but it must move beyond "host copies link into chat manually every time".

The required V1 work for `I'm In` is to expose the right activity events, permissions, recipient context, and links so the automation tool can send the right messages at the right time.

#### Reminders

V1 should include reminder messaging for:

- 24 hours before
- day of activity

These reminders should be:

- system-driven
- relevant
- easy to disable if needed

#### Message delivery fix

V1 must improve the gap between:

- activity state inside the app
- communication actually reaching people

That means:

- system-sent messages through an approved third-party WhatsApp automation provider, not only manual copy/share
- reliable deep links back into the right activity context
- fewer brittle WhatsApp-link edge cases

### 7.3 V1 product standard

For V1, `I'm In` should not become a full CRM or WhatsApp marketing engine.

It does need to integrate with a dependable communication layer for:

- invites
- reminders
- capacity changes
- simple lifecycle updates

## 8. Trust + Reputation Layer

### 8.1 Current State

The current product has:

- moderation
- public discovery gating
- simple host trust heuristics
- moderation transparency

What it does not yet have is a real reputation layer for attendance quality and host reliability.

Current trust is mainly about:

- whether public content is suitable for discovery
- whether a host has enough hosted activity history to relax moderation rules

That is useful, but it is not the same as product-level reputation.

### 8.2 V1 Requirements

V1 should introduce a lightweight reputation system focused on practical community trust.

#### Guest reputation

Hosts should be able to record simple attendance outcomes such as:

- showed up
- didn't show
- would invite again
- would not recommend

This should be easy to capture and not require a long review flow.

#### Host reputation

Guests should be able to leave lightweight feedback such as:

- simple event rating
- short structured feedback
- basic quality signal

The goal is not public review culture.

The goal is operational trust.

#### Visibility for V1

For V1, reputation should be primarily internal or minimally exposed.

That means:

- useful to improve host decisions
- useful to improve platform trust decisions
- not yet a fully public review marketplace

### 8.3 V1 product standard

V1 trust should help answer:

- is this guest reliable
- is this host worth joining again
- should this person or activity be handled differently next time

without turning the app into a review site.

## 9. Community Layer

The community layer is one of the most important V1 differentiators, but it is also one of the least fully realised parts of the current product.

The community layer must not create a new central gatekeeper.

Its purpose is to make local activity easier to find, easier to trust, and easier to join.

Control of an activity should belong primarily to its host.

### 9.1 Community Use Case

`I'm In` is designed for:

- all real-world communities where activities need to be easier to find and join
- location-based groups
- recurring informal networks
- mobile populations who repeatedly arrive in unfamiliar places

It is not only for temporary communities.

It is designed so newcomers to any community can quickly understand what is happening without needing insider knowledge first.

Examples:

- Hoi An families
- pickleball group
- worldschoolers in Bali
- local expat parents
- digital nomads in Chiang Mai
- recurring community organisers in one area
- long-running local clubs that want newcomers to find the right host

The product should help people understand:

- what is happening in this community
- what is public
- what is shared within the group
- who hosts each activity
- how to connect with the relevant host directly
- what is open to newcomers
- what requires host approval

### 9.2 Community Calendars

V1 should support community-level activity streams or calendars.

This means:

- hosts can publish activities into a community context
- users can browse activities grouped by community
- community-specific discovery can sit on top of the core activity system
- visitors can use one place to understand the local activity landscape
- activity pages remain owned and managed by their hosts

The current codebase contains some source/community metadata and imported listing support, but it does not yet expose a fully realised in-app community calendar product.

### 9.3 Local Ambassadors

V1 may include a lightweight ambassador role.

This role should be optional and limited.

The purpose is to:

- encourage activity quality
- help seed local participation
- support moderation or quality signals where appropriate
- help relevant activities reach the right audience
- promote the existence of the local calendar or community lens
- help hosts understand how to publish well

This is not meant to become a heavy staff-like operations layer in V1.

Ambassadors should not become the person everyone must go through to access local activities.

Ambassadors should not decide who is allowed into a host's activity unless the host has explicitly delegated that responsibility for a specific activity.

The default model is:

- ambassadors promote and support the ecosystem
- hosts control their own activities
- attendees discover and contact hosts without needing a central intermediary

### 9.4 Worldschooling Lens

V1 should support a worldschooling-friendly browse experience through:

- filtered explore views
- community-specific grouping
- optional source or tag signals that help surface relevant activities

This should remain a lens on the same product, not a separate app.

For worldschoolers, the key job is practical:

- arrive in a new place
- see the current activity picture
- understand which activities are family, child, learning, sport, or community oriented
- connect with the right host directly
- avoid depending on one person who happens to control a WhatsApp group or local information flow

## 10. Discovery

Discovery is a primary V1 feature, not just a convenience page.

For the target users, especially worldschooling families, expats, and digital nomads, the hardest problem is often not joining one known activity.

The harder problem is arriving somewhere and figuring out what is actually happening.

V1 Explore should become the single best place to answer:

- what is happening in this area
- what is happening soon
- what is relevant to my community or situation
- who is hosting it
- how do I join or contact the host

The product should reduce the need to ask one local person to explain the whole scene.

It should also reduce the risk that one informal gatekeeper controls discovery or access.

### 10.1 Current

The current discovery model already includes:

- `/explore`
- public and semi-public discovery surfaces
- moderation-controlled public visibility
- grouped upcoming activity browsing
- a subtle count of hidden upcoming activity volume

### 10.2 V1 Improvements

V1 discovery should be better at answering:

- what is relevant to me
- what is happening in this place
- what is happening soon
- what belongs to this community
- what can I join easily right now
- who owns or hosts the activity
- what requires host approval versus what is open to join

V1 should improve:

- filtering
- grouping
- clarity of public vs semi-public discovery
- community-based views
- worldschooling or other lens-based discovery
- area-based views that feel like a reliable local calendar
- host contact and host-controlled access pathways

### 10.3 Single Source Of Truth

V1 Explore should be the shared local activity map.

That does not mean every private activity must become public.

It means the product should create one coherent place where users can see the discoverable activity picture for a place or community lens.

For a new arrival, the ideal experience is:

- open Explore
- choose or infer the local area
- see what is happening today, this week, and later
- filter by relevant community lens, such as worldschooling
- open an activity
- understand who is hosting it
- join, request access, or contact the host

This is especially important for communities where information is currently fragmented across:

- WhatsApp groups
- individual organisers
- informal recommendations
- old shared documents
- one person who happens to know everyone

V1 should make the activity layer more visible without taking ownership away from hosts.

### 10.4 Host-Controlled Access

Discovery should not imply centralised control.

The correct V1 access model is:

- the platform controls broad safety and discovery eligibility
- communities or lenses can help users find relevant activities
- ambassadors can promote and support quality
- each host controls access to their own activity

Hosts decide:

- whether an activity is public, semi-public, or private
- whether joining requires approval
- whether attendees are shown
- whether guests can join directly
- how people should contact them

Ambassadors and local community helpers should not become default gatekeepers.

Their role should be closer to:

- helping good activities get listed
- encouraging hosts to publish clear information
- welcoming new arrivals
- promoting the local calendar
- escalating obvious quality or safety concerns

Their role should not be:

- deciding who gets access to every activity
- forcing all communication through themselves
- owning the local community graph
- becoming the only person who knows what is happening

### 10.5 Worldschooling Discovery Standard

For worldschoolers, Explore must work well for families who are in a place temporarily.

That means V1 should make it easy to discover:

- family-friendly activities
- learning or enrichment activities
- sports and games
- casual meetups
- recurring community activities
- activities that are open to newcomers

The experience should assume users may not know:

- the local WhatsApp groups
- the local organiser names
- the local venues
- who is trustworthy
- which activities are still active

Explore should give them a reliable starting point.

It should not require them to first find the right gatekeeper.

Discovery in V1 should still feel lightweight.

It should not become:

- a marketplace-like listing directory
- a noisy feed
- an endless browse product disconnected from attendance

## 11. Notifications

### 11.1 Current

The current codebase already includes:

- in-app notifications
- host join alerts
- guest replies to host messages
- installed-app push notification infrastructure
- push preference toggles for signed-in linked users in supported contexts

### 11.2 V1 Additions

V1 should improve notifications in two directions:

#### Push opt-in prompt

The app should more intentionally ask eligible users to enable push notifications when it makes sense.

That prompt should feel:

- contextual
- low-pressure
- useful

#### Improved controls

Users should have clearer notification preferences for:

- join and attendance changes
- host messages
- reminders
- host-side join alerts
- other important lifecycle updates

### 11.3 Relationship to WhatsApp

Notifications and WhatsApp should work together.

V1 should not assume one channel solves everything.

The expected model is:

- in-app notifications for signed-in product continuity
- push for supported installed-app cases
- WhatsApp for critical real-world coordination

## 12. Data & Lifecycle

### 12.1 Event lifecycle

V1 should treat activities as lightweight, time-bound objects rather than permanent social posts.

The intended lifecycle is:

- activities are useful before and around the time they happen
- old detailed activity records should not accumulate forever as a heavy archive

V1 should therefore include an event lifecycle policy such as:

- auto-delete or archive activities after roughly 30 days

The exact implementation can be:

- delete
- archive then purge
- compacted retention

But the product intent should remain the same:

- recent activity matters most
- stale activity detail is not a core long-term asset

### 12.2 Data strategy

V1 should preserve the signals that improve future coordination while limiting unnecessary historical clutter.

Keep:

- reputation signals
- useful participation history needed for trust or smart re-sharing
- core identity continuity data

Remove or compact:

- detailed historical activity data that no longer serves product value
- old activity-level operational detail that does not need to live forever

### 12.3 Current codebase note

The current codebase already has time-bounded identity/session behavior in places, but it does not yet clearly implement the intended ~30-day event lifecycle policy as a finished product rule.

That remains a V1 requirement, not a completed feature.

## 13. Explicitly NOT V1

The following are out of scope for V1:

- chat system
- social feed
- marketplace-style discovery
- complex profiles
- heavy onboarding
- public review marketplace
- full community social network features
- complex booking engine behavior
- large-scale CRM-style outbound messaging

V1 should stay focused on:

- activities
- attendance
- sharing
- coordination
- lightweight trust

## 14. Definition of V1 Complete

V1 is complete when the product reliably supports the core real-world loop.

### Hosts can:

- create and run activities easily
- manage attendees, requests, and waitlist
- resend or re-invite relevant people without spammy behavior
- automate important communication
- control how visible their activity and attendees are

### Guests and attendees can:

- join instantly
- be remembered
- recover their identity when needed
- see the activities that matter to them
- receive useful reminders and updates

### The system:

- feels lightweight
- reduces friction
- works cleanly with WhatsApp rather than fighting it
- supports community-specific discovery without becoming a different product
- creates enough trust to support repeat participation

## 15. Biggest Gaps Today

Based on the current codebase review, the biggest gaps between today's product and the intended V1 are:

- identity clarity is improved but still not fully coherent for normal users
- some account and host-management flows still treat email as the preferred identifier instead of WhatsApp verification
- guest recovery is not yet a polished, reliable end-to-end product flow
- reputation is mostly absent as a product feature
- WhatsApp automation through a third-party tool/plugin is not yet present at the required V1 level
- smart sharing exists only as early infrastructure, not a finished host-facing system
- attendee visibility controls are incomplete
- saved/reusable location tooling is incomplete
- slot-type or equipment distinctions are not yet implemented
- the community layer exists more as positioning and source metadata than as a fully realised product surface
- community-specific discovery lenses are still limited

## 16. Product Principle Summary

If there is one core V1 rule, it is this:

`I'm In` should make community coordination feel easier, faster, and lighter without trying to become a full social network.

Everything in V1 should support that goal.
