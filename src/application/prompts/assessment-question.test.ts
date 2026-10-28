import { expect, test } from 'bun:test';
import { focusExcerptOnChapter, questionIntroducesUnsupportedTerms, sourceGroundedFallbackQuestion } from './assessment-question';

test('flags a question about a registry absent from its cited introduction', () => {
  const source = 'Chapter 12. Microkernel Architecture Style. The microkernel architecture style is also called the plug-in architecture. It has a core system and plug-in components.';
  const question = 'Explain how the microkernel architecture style uses a plug-in registry to allow the core system to invoke specialized electronic device assessment components dynamically.';
  expect(questionIntroducesUnsupportedTerms(question, source)).toBe(true);
  expect(questionIntroducesUnsupportedTerms(question, 'Microkernel architecture has a core system and independent plug-in components.')).toBe(true);
  expect(questionIntroducesUnsupportedTerms('How are the core system and plug-in components organized in the microkernel architecture?', source)).toBe(false);
  expect(sourceGroundedFallbackQuestion('MicrokernelArchitecture', 'en-US').text).toContain('selected passage');
  expect(questionIntroducesUnsupportedTerms(sourceGroundedFallbackQuestion('MicrokernelArchitecture', 'en-US').text, source)).toBe(false);
});

test('focuses a legacy excerpt on the chapter named by the concept', () => {
  const excerpt = 'Pipeline architectures have monolithic deployments.\nChapter 12. Microkernel Architecture Style\nA microkernel has a core and plug-in components.';
  const focused = focusExcerptOnChapter(excerpt, 'MicrokernelArchitecture');
  expect(focused.text.startsWith('Chapter 12. Microkernel Architecture Style')).toBe(true);
  expect(excerpt.slice(focused.offsetDelta)).toBe(focused.text);
});
