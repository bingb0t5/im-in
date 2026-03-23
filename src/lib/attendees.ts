import { Attendee } from '../types';

interface FindMyRsvpsInput {
  userId?: string;
  userEmail?: string;
  guestProfileId?: string;
}

export function findMyRsvps(attendees: Attendee[], input: FindMyRsvpsInput): Attendee[] {
  const { userId, userEmail, guestProfileId } = input;
  let found: Attendee[] = [];

  if (userId) {
    const byUserId = attendees.filter((a) => a.user_id === userId && a.status !== 'cancelled');
    found = [...byUserId];
  }

  if (userEmail) {
    const email = userEmail.toLowerCase();
    const byEmail = attendees.filter(
      (a) =>
        a.guest_email?.toLowerCase() === email &&
        a.status !== 'cancelled' &&
        !found.some((f) => f.id === a.id),
    );
    found = [...found, ...byEmail];
  }

  if (guestProfileId) {
    const byProfileId = attendees.filter(
      (a) =>
        a.attendee_profile_id === guestProfileId &&
        a.status !== 'cancelled' &&
        !found.some((f) => f.id === a.id),
    );
    found = [...found, ...byProfileId];
  }

  return found;
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
