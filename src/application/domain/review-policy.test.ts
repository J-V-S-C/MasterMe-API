import { describe, expect, test } from 'bun:test';
import { decideReview, REVIEW_INTERVALS_DAYS } from './review-policy';

const at = new Date('2026-10-27T12:00:00.000Z');
const days = (value: number) => new Date(at.getTime() + value * 24 * 60 * 60 * 1000);

describe('review policy', () => {
  test('schedules the first review one day after an independent success', () => {
    expect(decideReview({
      status: 'PASSED',
      activityType: 'RETENTION',
      assisted: false,
      at,
    })).toEqual({ intervalDays: 1, reviewCount: 0, dueAt: days(1) });
  });

  test('expands the interval after independent recall', () => {
    expect(decideReview({
      status: 'PASSED',
      activityType: 'RETENTION',
      assisted: false,
      at,
      previous: { intervalDays: 1, reviewCount: 0 },
    })).toEqual({ intervalDays: REVIEW_INTERVALS_DAYS[1], reviewCount: 1, dueAt: days(3) });
    expect(decideReview({
      status: 'PASSED',
      activityType: 'RETENTION',
      assisted: false,
      at,
      previous: { intervalDays: 14, reviewCount: 3 },
    })).toEqual({ intervalDays: REVIEW_INTERVALS_DAYS[4], reviewCount: 4, dueAt: days(30) });
  });

  test('failure and assistance reset to one day without expanding', () => {
    for (const status of ['INCOMPLETE', 'LOGICAL_BREAK'] as const) {
      expect(decideReview({
        status,
        activityType: 'RETENTION',
        assisted: false,
        at,
        previous: { intervalDays: 30, reviewCount: 4 },
      })).toEqual({ intervalDays: 1, reviewCount: 0, dueAt: days(1) });
    }
    expect(decideReview({
      status: 'PASSED',
      activityType: 'RETENTION',
      assisted: true,
      at,
      previous: { intervalDays: 30, reviewCount: 4 },
    })).toEqual({ intervalDays: 1, reviewCount: 0, dueAt: days(1) });
    expect(decideReview({
      status: 'PASSED',
      activityType: 'RETENTION',
      assisted: true,
      solutionRevealed: true,
      at,
    })).toEqual({ intervalDays: 1, reviewCount: 0, dueAt: days(1) });
  });

  test('application success does not erase an existing recall interval', () => {
    expect(decideReview({
      status: 'PASSED',
      activityType: 'APPLICATION',
      assisted: false,
      at,
      previous: { intervalDays: 14, reviewCount: 3 },
    })).toBeNull();
  });

  test('self-reported and contested evidence cannot create a review', () => {
    expect(decideReview({ status: 'SELF_REPORTED', activityType: 'RETENTION', assisted: false, at })).toBeNull();
    expect(decideReview({ status: 'CONTESTED', activityType: 'RETENTION', assisted: false, at })).toBeNull();
  });
});
