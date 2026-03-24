import { EventInterest } from '../types';

interface FindMyInterestInput {
  userId?: string;
  userEmail?: string;
  guestProfileId?: string;
}

export function findMyInterest(interests: EventInterest[], input: FindMyInterestInput): EventInterest | null {
  const { userId, userEmail, guestProfileId } = input;
  const normalizedEmail = (userEmail || '').trim().toLowerCase();

  const byUserId =
    userId && interests.find((interest) => interest.user_id && interest.user_id === userId);
  if (byUserId) return byUserId;

  const byProfileId =
    guestProfileId &&
    interests.find(
      (interest) =>
        interest.attendee_profile_id && interest.attendee_profile_id === guestProfileId,
    );
  if (byProfileId) return byProfileId;

  if (normalizedEmail) {
    const byEmail = interests.find(
      (interest) => (interest.guest_email || '').trim().toLowerCase() === normalizedEmail,
    );
    if (byEmail) return byEmail;
  }

  return null;
}

export function getThinkingCount(interests: EventInterest[]): number {
  return interests.length;
}

export function getNamedThinkingInterests(interests: EventInterest[]): EventInterest[] {
  return interests.filter((interest) => interest.visibility_mode === 'named');
}
