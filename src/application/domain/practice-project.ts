export type PracticeFocusMode = 'OVERVIEW' | 'MANUAL' | 'CONFIDENCE' | 'PERFORMANCE' | 'COMBINED';
export interface PrioritizedConcept {
  conceptId: string;
  name: string;
  reason: string;
}
export interface PracticeProjectContent {
  title: string;
  context: string;
  goal: string;
  deliverables: string[];
  constraints: string[];
  firstStep: string;
}
export interface PracticeProject extends PracticeProjectContent {
  id: string;
  materialId: string;
  prioritizedConcepts: PrioritizedConcept[];
  focusMode: PracticeFocusMode;
  createdAt: string;
}
