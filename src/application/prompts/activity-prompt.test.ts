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
});
