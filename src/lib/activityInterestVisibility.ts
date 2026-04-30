import { Event } from '../types';

export type ActivityInterestVisibility = NonNullable<Event['interest_visibility']>;

export function normalizeInterestVisibility(
  interestVisibility?: Event['interest_visibility'] | null,
): ActivityInterestVisibility {
  return interestVisibility === 'hidden' || interestVisibility === 'named'
    ? interestVisibility
    : 'count_only';
}

export function isInterestHidden(
  interestVisibility?: Event['interest_visibility'] | null,
) {
  return normalizeInterestVisibility(interestVisibility) === 'hidden';
}

export function getVisibleThinkingCount(
  thinkingCount: number,
  interestVisibility?: Event['interest_visibility'] | null,
) {
  return isInterestHidden(interestVisibility) ? 0 : thinkingCount;
}
