import type { EvidenceActivity, EvidenceStatus } from './learning-cycle';

/**
 * Conservative, configurable retrieval rhythm. The first review happens one
 * day after an independent success; later independent retrievals expand the
 * interval. Failures and assisted attempts return to one day.
 *
 * These constants are a product policy, not a claim that one spacing
 * algorithm is optimal for every learner or subject.
 */
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60] as const;
export const MIN_REVIEW_INTERVAL_DAYS = 1;
export const MAX_REVIEW_INTERVAL_DAYS = 365;

export type ReviewScheduleSnapshot = {
  intervalDays: number;
  reviewCount: number;
};

export type ReviewDecision = {
  intervalDays: number;
  reviewCount: number;
  dueAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const clampInterval = (days: number): number =>
  Math.min(MAX_REVIEW_INTERVAL_DAYS, Math.max(MIN_REVIEW_INTERVAL_DAYS, Math.round(days)));

const resetDecision = (at: Date): ReviewDecision => ({
  intervalDays: REVIEW_INTERVALS_DAYS[0],
  reviewCount: 0,
  dueAt: new Date(at.getTime() + REVIEW_INTERVALS_DAYS[0] * DAY_MS),
});

/**
 * Returns the next review state, or null when the event must not change the
 * existing schedule. SELF_REPORTED and CONTESTED evidence never schedules.
 */
export function decideReview(input: {
  status: EvidenceStatus;
  activityType: EvidenceActivity;
  assisted: boolean;
  solutionRevealed?: boolean;
  at: Date;
  previous?: ReviewScheduleSnapshot | null;
}): ReviewDecision | null {
  if (input.status === 'SELF_REPORTED' || input.status === 'CONTESTED') return null;

  const needsShorterInterval =
    input.status !== 'PASSED' ||
    input.assisted ||
    input.solutionRevealed === true;

  if (needsShorterInterval) return resetDecision(input.at);

  if (input.activityType !== 'RETENTION') {
    // An application or reasoning success is useful evidence, but it must not
    // erase a longer retrieval interval already earned by a recall success.
    return input.previous ? null : resetDecision(input.at);
  }

  const nextIndex = input.previous
    ? Math.min(input.previous.reviewCount + 1, REVIEW_INTERVALS_DAYS.length - 1)
    : 0;
  const intervalDays = clampInterval(REVIEW_INTERVALS_DAYS[nextIndex] ?? REVIEW_INTERVALS_DAYS[0]);
  return {
    intervalDays,
    reviewCount: nextIndex,
    dueAt: new Date(input.at.getTime() + intervalDays * DAY_MS),
  };
}
