import { expect, test } from 'bun:test';
import { suggestNextAction, scheduledLoad } from './learning-cycle';

test('a failed autonomous attempt suggests revisiting the same source without punishing a late task', () => {
  expect(suggestNextAction({ status: 'INCOMPLETE', activityType: 'COMPREHENSION', assisted: false, conceptName: 'Transações' }))
    .toEqual({ activityType: 'REVISIT', title: 'Retomar Transações', reason: 'A explicação ficou incompleta; releia o trecho e tente novamente.' });
  expect(suggestNextAction({ status: 'PASSED', activityType: 'COMPREHENSION', assisted: false, conceptName: 'Transações' })).toBeNull();
});

test('scheduled load is independent of task completion and timezone representation', () => {
  expect(scheduledLoad([{ status: 'PENDING', durationMinutes: 30 }, { status: 'DONE', durationMinutes: 20 }, { status: 'PENDING', durationMinutes: null }], 40))
    .toEqual({ plannedMinutes: 30, availableMinutes: 40, excessMinutes: 0 });
});
