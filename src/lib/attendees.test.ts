import { describe, expect, it } from 'vitest';
import type { Attendee } from '../types';
import { findMyRsvps, getMyRsvpBuckets } from './attendees';

function makeAttendee(overrides: Partial<Attendee>): Attendee {
  return {
    id: overrides.id || crypto.randomUUID(),
    event_id: overrides.event_id || 'event-1',
    user_id: overrides.user_id,
    attendee_profile_id: overrides.attendee_profile_id,
    added_by_type: overrides.added_by_type ?? 'self',
    added_by_attendee_profile_id: overrides.added_by_attendee_profile_id ?? null,
    guest_name: overrides.guest_name || 'Guest',
    guest_email: overrides.guest_email || 'guest@example.com',
    status: overrides.status || 'confirmed',
    joined_at: overrides.joined_at || new Date().toISOString(),
    promoted_at: overrides.promoted_at,
    cancelled_at: overrides.cancelled_at,
  };
}

describe('attendee ownership matching', () => {
  it('treats a logged-out proxy add as managed rather than self attendance', () => {
    const ownerProfileId = 'profile-owner';
    const proxyRow = makeAttendee({
      id: 'proxy-1',
      attendee_profile_id: ownerProfileId,
      added_by_type: 'proxy',
      added_by_attendee_profile_id: ownerProfileId,
      guest_name: 'Charlie Smith',
      guest_email: 'owner@example.com',
    });

    const { selfRsvps, managedProxyRsvps } = getMyRsvpBuckets([proxyRow], {
      userEmail: 'owner@example.com',
      profileId: ownerProfileId,
    });

    expect(selfRsvps).toHaveLength(0);
    expect(managedProxyRsvps.map((attendee) => attendee.id)).toEqual(['proxy-1']);
  });

  it('keeps a normal logged-out RSVP classified as self attendance', () => {
    const ownerProfileId = 'profile-owner';
    const selfRow = makeAttendee({
      id: 'self-1',
      attendee_profile_id: ownerProfileId,
      guest_name: 'Owner Person',
      guest_email: 'owner@example.com',
      added_by_type: 'self',
    });

    const { selfRsvps, managedProxyRsvps } = getMyRsvpBuckets([selfRow], {
      userEmail: 'owner@example.com',
      profileId: ownerProfileId,
    });

    expect(selfRsvps.map((attendee) => attendee.id)).toEqual(['self-1']);
    expect(managedProxyRsvps).toHaveLength(0);
  });

  it('leaves other RSVP states unaffected', () => {
    const ownerProfileId = 'profile-owner';
    const waitlistRow = makeAttendee({
      id: 'wait-1',
      attendee_profile_id: ownerProfileId,
      guest_name: 'Owner Person',
      guest_email: 'owner@example.com',
      status: 'waitlist',
      added_by_type: 'self',
    });

    const matched = findMyRsvps([waitlistRow], {
      userEmail: 'owner@example.com',
      profileId: ownerProfileId,
    });

    expect(matched.map((attendee) => attendee.id)).toEqual(['wait-1']);
    expect(matched[0].status).toBe('waitlist');
  });
});
