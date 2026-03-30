import { Attendee } from '../types';

interface FindMyRsvpsInput {
  userId?: string;
  userEmail?: string;
  profileId?: string;
}

function isActive(attendee: Attendee) {
  return attendee.status !== 'cancelled';
}

export function getMyRsvpBuckets(attendees: Attendee[], input: FindMyRsvpsInput) {
  const { userId, userEmail, profileId } = input;
  const selfRsvps: Attendee[] = [];

  const addIfMissing = (bucket: Attendee[], attendee: Attendee) => {
    if (!bucket.some((item) => item.id === attendee.id)) {
      bucket.push(attendee);
    }
  };

  attendees.forEach((attendee) => {
    if (!isActive(attendee)) return;
    if (attendee.added_by_type === 'proxy') return;

    if (userId && attendee.user_id === userId) {
      addIfMissing(selfRsvps, attendee);
      return;
    }

    if (profileId && attendee.attendee_profile_id === profileId) {
      addIfMissing(selfRsvps, attendee);
      return;
    }

    if (userEmail && attendee.guest_email?.toLowerCase() === userEmail.toLowerCase()) {
      addIfMissing(selfRsvps, attendee);
    }
  });

  const managedProxyRsvps = attendees.filter(
    (attendee) =>
      isActive(attendee) &&
      attendee.added_by_type === 'proxy' &&
      !!profileId &&
      attendee.added_by_attendee_profile_id === profileId,
  );

  return { selfRsvps, managedProxyRsvps };
}

export function findMyRsvps(attendees: Attendee[], input: FindMyRsvpsInput): Attendee[] {
  const { selfRsvps, managedProxyRsvps } = getMyRsvpBuckets(attendees, input);
  return [...selfRsvps, ...managedProxyRsvps];
}

export function getAttendanceSummary(attendees: Attendee[], capacity: number) {
  const confirmedCount = attendees.filter((a) => a.status === 'confirmed').length;
  const waitlistCount = attendees.filter((a) => a.status === 'waitlist').length;
  const isFull = confirmedCount >= capacity;
  const spotsRemaining = Math.max(0, capacity - confirmedCount);

  return { confirmedCount, waitlistCount, isFull, spotsRemaining };
}

export function getNextWaitlistAttendee(attendees: Attendee[], excludeAttendeeId?: string): Attendee | undefined {
  return attendees
    .filter((a) => a.id !== excludeAttendeeId && a.status === 'waitlist')
    .sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime())[0];
}
