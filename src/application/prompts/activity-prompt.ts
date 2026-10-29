import type { EvidenceActivity } from '../domain/learning-cycle';
import type { SupportedLocale } from '../domain/material';

export function buildActivityPrompt(input: {
  activityType: EvidenceActivity;
  locale: SupportedLocale;
  conceptName: string;
  studyQuestion?: string;
  relation?: { sourceName: string; targetName: string };
  variant?: number;
}): string {
  const english = input.locale === 'en-US';
  if (input.relation) {
    const { sourceName, targetName } = input.relation;
    if (input.variant === 1) return english
      ? `What would be misunderstood if ${sourceName} and ${targetName} were treated as independent? Explain only what the excerpt supports.`
      : `O que seria mal interpretado se ${sourceName} e ${targetName} fossem tratados como independentes? Explique apenas o que o trecho sustenta.`;
    if (input.variant === 2) return english
      ? `Compare the roles of ${sourceName} and ${targetName} in a different example. State which part the excerpt does not establish.`
      : `Compare os papéis de ${sourceName} e ${targetName} em outro exemplo. Diga qual parte o trecho não estabelece.`;
    return english
      ? `Explain why ${sourceName} relates to ${targetName}, using the source excerpt.`
      : `Explique por que ${sourceName} se relaciona com ${targetName}, usando o trecho do material.`;
  }
  const question = input.studyQuestion ?? (english
    ? `Explain the mechanism of ${input.conceptName} using the material.`
    : `Explique o mecanismo de ${input.conceptName} usando o material.`);
  if (input.activityType === 'REASONING') {
    if (input.variant === 1) return english
      ? `Challenge the conclusion about ${input.conceptName}: change one premise, then explain what the excerpt still supports and what becomes uncertain.`
      : `Questione a conclusão sobre ${input.conceptName}: altere uma premissa e explique o que o trecho ainda sustenta e o que fica incerto.`;
    if (input.variant === 2) return english
      ? `Compare two explanations of ${input.conceptName}, one supported by the excerpt and one that goes beyond it. Identify the decisive premise.`
      : `Compare duas explicações de ${input.conceptName}, uma sustentada pelo trecho e outra que vai além dele. Identifique a premissa decisiva.`;
    return english
      ? `What does the excerpt support about ${input.conceptName}, and why? Trace the stated premises to its conclusion. If the passage leaves a step unexplained, identify that limit instead of assuming it.`
      : `O que o trecho sustenta sobre ${input.conceptName}, e por quê? Relacione as premissas declaradas à conclusão. Se faltar uma etapa no trecho, identifique esse limite sem supor a resposta.`;
  }
  if (input.activityType === 'APPLICATION') {
    if (input.variant === 1) return english
      ? `Apply ${input.conceptName} to a case with one changed condition from your previous example. Explain whether the mechanism still works, using only the excerpt.`
      : `Aplique ${input.conceptName} a um caso com uma condição diferente do exemplo anterior. Explique se o mecanismo ainda funciona, usando apenas o trecho.`;
    if (input.variant === 2) return english
      ? `Choose two contrasting cases for ${input.conceptName}. Explain where it applies, where it may fail, and what the excerpt cannot decide.`
      : `Escolha dois casos contrastantes para ${input.conceptName}. Explique onde se aplica, onde pode falhar e o que o trecho não permite decidir.`;
    return english
      ? `How would you apply ${input.conceptName} in a concrete case? Justify the mechanism using the excerpt.`
      : `Como você aplicaria ${input.conceptName} em um caso concreto? Justifique o mecanismo com base no trecho.`;
  }
  if (input.activityType === 'RETENTION') {
    if (input.variant === 1) return english
      ? `Without consulting the material, reconstruct ${input.conceptName} from a different starting point: what must be true for it to work, and why? Mark anything you cannot recall.`
      : `Sem consultar o material, reconstrua ${input.conceptName} por outro ponto de partida: o que precisa ser verdade para funcionar, e por quê? Indique o que você não lembra.`;
    if (input.variant === 2) return english
      ? `Without consulting the material, recall a boundary or counterexample for ${input.conceptName}, then explain the mechanism that makes the boundary matter.`
      : `Sem consultar o material, retome um limite ou contraexemplo de ${input.conceptName} e explique o mecanismo que torna esse limite importante.`;
    return english
      ? `Without consulting the material, recall: ${question}`
      : `Sem consultar o material, retome: ${question}`;
  }
  return question;
}
