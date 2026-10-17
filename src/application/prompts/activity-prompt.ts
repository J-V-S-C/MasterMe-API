import type { EvidenceActivity } from '../domain/learning-cycle';
import type { SupportedLocale } from '../domain/material';

export function buildActivityPrompt(input: {
  activityType: EvidenceActivity;
  locale: SupportedLocale;
  conceptName: string;
  studyQuestion?: string;
  relation?: { sourceName: string; targetName: string };
}): string {
  const english = input.locale === 'en-US';
  if (input.relation) {
    const { sourceName, targetName } = input.relation;
    return english
      ? `Explain why ${sourceName} relates to ${targetName}, using the source excerpt.`
      : `Explique por que ${sourceName} se relaciona com ${targetName}, usando o trecho do material.`;
  }
  const question = input.studyQuestion ?? (english
    ? `Explain the mechanism of ${input.conceptName} using the material.`
    : `Explique o mecanismo de ${input.conceptName} usando o material.`);
  if (input.activityType === 'APPLICATION') {
    return english
      ? `How would you apply ${input.conceptName} in a concrete case? Justify the mechanism using the excerpt.`
      : `Como você aplicaria ${input.conceptName} em um caso concreto? Justifique o mecanismo com base no trecho.`;
  }
  if (input.activityType === 'RETENTION') {
    return english
      ? `Without consulting the material, recall: ${question}`
      : `Sem consultar o material, retome: ${question}`;
  }
  return question;
}
