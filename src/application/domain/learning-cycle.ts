export type EvidenceActivity = 'COMPREHENSION' | 'RELATION' | 'APPLICATION' | 'RETENTION';
export type EvidenceStatus = 'SELF_REPORTED' | 'PASSED' | 'INCOMPLETE' | 'LOGICAL_BREAK' | 'CONTESTED';
export type TaskActivity = 'READ' | 'EXPLAIN' | 'RELATE' | 'APPLY' | 'REVISIT' | 'PRACTICE';

export function suggestNextAction(input: {
  status: EvidenceStatus;
  activityType: EvidenceActivity;
  assisted: boolean;
  conceptName: string;
}): { activityType: TaskActivity; title: string; reason: string } | null {
  if (input.status === 'PASSED' || input.status === 'SELF_REPORTED' || input.status === 'CONTESTED') return null;
  const reason = input.activityType === 'APPLICATION'
    ? 'A aplicação mostrou uma lacuna; experimente um cenário menor antes de avançar.'
    : input.activityType === 'RELATION'
      ? 'A ligação entre conceitos precisa de justificativa; volte aos trechos de origem.'
      : input.activityType === 'RETENTION'
        ? 'A retomada mostrou uma lacuna; releia o trecho e explique com suas palavras.'
        : input.status === 'LOGICAL_BREAK'
          ? 'O mecanismo ficou contraditório; releia o trecho antes de tentar novamente.'
          : 'A explicação ficou incompleta; releia o trecho e tente novamente.';
  return { activityType: 'REVISIT', title: `Retomar ${input.conceptName}`, reason };
}

export function scheduledLoad(tasks: Array<{ status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'REMOVED'; durationMinutes: number | null }>, availableMinutes: number) {
  const plannedMinutes = tasks.filter((task) => task.status === 'PENDING' || task.status === 'IN_PROGRESS').reduce((sum, task) => sum + (task.durationMinutes ?? 0), 0);
  return { plannedMinutes, availableMinutes, excessMinutes: Math.max(0, plannedMinutes - availableMinutes) };
}
