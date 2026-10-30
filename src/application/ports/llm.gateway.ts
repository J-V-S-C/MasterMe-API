import type { Concept } from '../domain/concept';
import type { MasterMeQuestion } from '../domain/assessment';
import type { PrioritizedConcept, PracticeProjectContent } from '../domain/practice-project';
import type { Evaluation, EdgeCaseChallenge, IsomorphicProblem } from '../domain/assessment';
import type { MaterialOutlineUnit, StudyMaterial, SupportedLocale } from '../domain/material';
import type { AiOperation } from '../domain/billing';
import type { QuestionBundle } from '../domain/assessment';

export type AiUsageEvent = {
  operation: AiOperation;
  model: string;
  success: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
};
export type ExtractedKnowledge = {
  fragments: Array<Pick<Concept, 'name' | 'description' | 'kind' | 'sourceExcerpt' | 'fundamentalPremises' | 'edgeCases' | 'edgeCaseQuestion' | 'studyQuestion'> & { sourceOffset?: number; prerequisiteNames: string[] }>;
  relations?: Array<{ fromName: string; toName: string; relationType: 'REQUIRES' | 'ENABLES' | 'CONTRASTS' | 'APPLIES_TO' | 'PART_OF'; statement: string; justification: string; sourceExcerpt: string; sourceOffset?: number }>;
};

export type LocalizedKnowledgeResponse = {
  fragments: Array<{ id: string; name: string; description: string; fundamentalPremises: string[]; edgeCases: string[] }>;
};

export type ExtractionProgress = {
  stage: 'PREPARING' | 'EXTRACTING' | 'REDUCING';
  totalChunks: number;
  completedChunks: number;
};

export interface MasterMeLlmGateway {
  generateQuestionBundle(concept: Concept, variant?: number): Promise<QuestionBundle>;
  extractKnowledge(
    material: StudyMaterial,
    onProgress?: (progress: ExtractionProgress) => Promise<void>,
    outline?: MaterialOutlineUnit[],
    options?: { maxConcepts?: number; isBookChapter?: boolean; chapterTitle?: string },
  ): Promise<ExtractedKnowledge>;
  localizeKnowledge(
    concepts: Concept[],
    locale: SupportedLocale,
  ): Promise<LocalizedKnowledgeResponse>;
  evaluateAnswer(
    concept: Concept,
    question: MasterMeQuestion,
    answer: string,
  ): Promise<Evaluation>;
  generateEdgeCaseChallenge(concept: Concept): Promise<EdgeCaseChallenge>;
  evaluateEdgeCaseAnswer(
    concept: Concept,
    challenge: EdgeCaseChallenge,
    answer: string,
  ): Promise<Evaluation>;
  generatePracticeProject(
    material: StudyMaterial,
    concepts: Concept[],
    priorities: PrioritizedConcept[],
    preferences?: { difficulty?: 'FOUNDATION' | 'INTERMEDIATE' | 'ADVANCED'; size?: 'SMALL' | 'MEDIUM'; observedGaps?: string[]; chapterTitles?: string[] },
  ): Promise<PracticeProjectContent>;
  generateIsomorphicProblem(
    concepts: Concept[],
    observedFailures: string[],
  ): Promise<IsomorphicProblem>;
}
