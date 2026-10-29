import { expect, test } from 'bun:test';
import { chooseTodayActions, type TodayAction } from './today-policy';

const candidate = (id: string, priority: number, minutes: number): TodayAction => ({
  id, priority, estimatedMinutes: minutes, kind: 'TASK', title: id,
  reason: 'SCHEDULED', href: `/study?material=${id}`,
});

test('fits a due review and a short gap into ten minutes before a long chapter', () => {
  const actions = chooseTodayActions([
    { ...candidate('chapter', 3, 25), kind: 'READ' },
    { ...candidate('review', 1, 6), kind: 'REVIEW', reason: 'DUE_REVIEW' },
    { ...candidate('gap', 2, 4), kind: 'GAP', reason: 'OPEN_GAP' },
  ], 10);
  expect(actions.map((item) => item.id)).toEqual(['review', 'gap']);
});

test('honors a scheduled deadline and caps suggestions without duplicating one action', () => {
  const actions = chooseTodayActions([
    candidate('review', 1, 10), candidate('deadline', 0, 20), candidate('review', 1, 10),
    candidate('reading', 3, 15), candidate('optional', 4, 10),
  ], 45);
  expect(actions.map((item) => item.id)).toEqual(['deadline', 'review', 'reading']);
});
