import { Attendee } from '../types';

type JoinStatus = 'confirmed' | 'waitlist';

interface RsvpDecisionAllowed {
  allowed: true;
  status: JoinStatus;
}

interface RsvpDecisionBlocked {
  allowed: false;
  reason: string;
}

export type RsvpDecision = RsvpDecisionAllowed | RsvpDecisionBlocked;

export function isRsvpBlocked(decision: RsvpDecision): decision is RsvpDecisionBlocked {
  return decision.allowed === false;
}

export function getConfirmedCount(attendees: Pick<Attendee, 'status'>[]): number {
  return attendees.filter((a) => a.status === 'confirmed').length;
}

export function decideRsvpStatus(
  confirmedCount: number,
  capacity: number,
  allowWaitlist: boolean,
): RsvpDecision {
  if (confirmedCount < capacity) {
    return { allowed: true, status: 'confirmed' };
  }

  if (allowWaitlist) {
    return { allowed: true, status: 'waitlist' };
  }

  return { allowed: false, reason: 'Activity is full and waitlist is disabled' };
}

export function pickWaitlistAttendeesForPromotion<T extends { joined_at: string }>(
  waitlistAttendees: T[],
  spotsAvailable: number,
): T[] {
  if (spotsAvailable <= 0) return [];
  return [...waitlistAttendees]
    .sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime())
    .slice(0, spotsAvailable);
}
