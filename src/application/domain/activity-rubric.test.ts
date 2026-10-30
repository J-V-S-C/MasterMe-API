import { expect, test } from 'bun:test';
import { criteriaForActivity } from './activity-rubric';

test('relation rubric accepts a source-backed contrast without inventing causation', () => {
  expect(criteriaForActivity('RELATION', 'en-US', ['A contrasts with B.'])[0]).toContain('do not require causation');
  expect(criteriaForActivity('RELATION', 'en-US', ['A contrasts with B.'])[1]).toBe('A contrasts with B.');
});

test('application and retention use distinct criteria while retaining source premises', () => {
  const application = criteriaForActivity('APPLICATION', 'pt-BR', ['A premissa observada.']);
  const retention = criteriaForActivity('RETENTION', 'pt-BR', ['A premissa observada.']);
  expect(application[0]).toContain('caso concreto');
  expect(retention[0]).toContain('Retome');
  expect(application[1]).toBe(retention[1]);
});

test('reasoning asks the student to acknowledge missing support in a short excerpt', () => {
  expect(criteriaForActivity('REASONING', 'en-US', [])[0]).toContain('what it does not establish');
});
