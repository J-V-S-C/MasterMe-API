import type { Concept, ConceptConfidence } from '../domain/concept';
import type { ConceptPerformance, MasterMeQuestion, StudySession } from '../domain/assessment';
import type { MaterialKind, SupportedLocale } from '../domain/material';
import type { PracticeFocusMode, PracticeProject } from '../domain/practice-project';

export interface CreateMaterialCommand {
  title: string;
  content: string;
  locale?: SupportedLocale;
  materialKind?: MaterialKind;
}



export interface PracticeFocusCommand {
  focusMode: PracticeFocusMode;
  conceptIds?: string[];
  difficulty?: 'FOUNDATION' | 'INTERMEDIATE' | 'ADVANCED';
  size?: 'SMALL' | 'MEDIUM';
}

export interface KnowledgeMapConcept {
  concept: Concept;
  status: 'READY' | 'REVIEW' | 'EXPLAINED';
  edgeCaseStatus: StudySession['edgeCaseStatus'];
  lastAttempt: StudySession['attempts'][number] | null;
  question: MasterMeQuestion;
}

export interface PracticeContext {
  knowledgeMap: KnowledgeMapConcept[];
  confidences: ConceptConfidence[];
  performance: ConceptPerformance[];
  projects: PracticeProject[];
}
