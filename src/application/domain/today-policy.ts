export type TodayReason = 'SCHEDULED' | 'DUE_REVIEW' | 'OPEN_GAP' | 'CONTINUE_BOOK' | 'CONTINUE_MATERIAL';
export type TodayAction = {
  id: string;
  kind: 'TASK' | 'REVIEW' | 'GAP' | 'READ';
  title: string;
  reason: TodayReason;
  estimatedMinutes: number;
  href: string;
  priority: number;
  dueAt?: string;
};

export function chooseTodayActions(candidates: TodayAction[], availableMinutes: number): TodayAction[] {
  if (!Number.isInteger(availableMinutes) || availableMinutes < 0) return [];
  let remaining = availableMinutes;
  const selected: TodayAction[] = [];
  const seen = new Set<string>();
  const ordered = [...candidates].sort((left, right) =>
    left.priority - right.priority ||
    (left.dueAt ?? '').localeCompare(right.dueAt ?? '') ||
    left.id.localeCompare(right.id));
  for (const candidate of ordered) {
    if (selected.length === 3) break;
    if (seen.has(candidate.id) || candidate.estimatedMinutes < 1 || candidate.estimatedMinutes > remaining) continue;
    selected.push(candidate);
    seen.add(candidate.id);
    remaining -= candidate.estimatedMinutes;
  }
  return selected;
}
