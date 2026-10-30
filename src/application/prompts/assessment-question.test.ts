import { expect, test } from 'bun:test';
import { focusExcerptOnChapter } from './assessment-question';

test('focuses a legacy excerpt on the chapter named by the concept', () => {
  const excerpt = 'Pipeline architectures have monolithic deployments.\nChapter 12. Microkernel Architecture Style\nA microkernel has a core and plug-in components.';
  const focused = focusExcerptOnChapter(excerpt, 'MicrokernelArchitecture');
  expect(focused.text.startsWith('Chapter 12. Microkernel Architecture Style')).toBe(true);
  expect(excerpt.slice(focused.offsetDelta)).toBe(focused.text);
});
