import { expect, test } from 'bun:test';
import { buildActivityPrompt } from './activity-prompt';

test('activity prompts follow the material locale, including fallbacks and relation prompts', () => {
  expect(buildActivityPrompt({ activityType: 'COMPREHENSION', locale: 'en-US', conceptName: 'Dependency injection' }))
    .toBe('Explain the mechanism of Dependency injection using the material.');
  expect(buildActivityPrompt({ activityType: 'RETENTION', locale: 'en-US', conceptName: 'Dependency injection', studyQuestion: 'Why inject dependencies?' }))
    .toBe('Without consulting the material, recall: Why inject dependencies?');
  expect(buildActivityPrompt({ activityType: 'RELATION', locale: 'en-US', conceptName: 'A → B', relation: { sourceName: 'A', targetName: 'B' } }))
    .toBe('Explain why A relates to B, using the source excerpt.');
  expect(buildActivityPrompt({ activityType: 'APPLICATION', locale: 'pt-BR', conceptName: 'Injeção' }))
    .toContain('Como você aplicaria Injeção');
  expect(buildActivityPrompt({ activityType: 'REASONING', locale: 'en-US', conceptName: 'Dependency injection' }))
    .toContain('If the passage leaves a step unexplained');
});

test('retry and delayed retrieval variants change the requested cognitive move', () => {
  const base = { locale: 'en-US' as const, conceptName: 'Dependency injection' };
  const first = buildActivityPrompt({ ...base, activityType: 'APPLICATION' });
  const changedCondition = buildActivityPrompt({ ...base, activityType: 'APPLICATION', variant: 1 });
  const comparison = buildActivityPrompt({ ...base, activityType: 'APPLICATION', variant: 2 });
  expect(new Set([first, changedCondition, comparison]).size).toBe(3);
  expect(changedCondition).toContain('changed condition');
  expect(comparison).toContain('contrasting cases');
  expect(buildActivityPrompt({ ...base, activityType: 'RETENTION', variant: 1 })).toContain('Without consulting the material');
});
