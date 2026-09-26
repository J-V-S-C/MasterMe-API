import type {
  Concept,
  PrioritizedConcept,
  Evaluation,
  EdgeCaseChallenge,
  IsomorphicProblem,
  PracticeProjectContent,
  MasterMeQuestion,
  StudyMaterial,
} from '../domain/masterme'
import type { ExtractedKnowledge } from '../schemas/llm.schema'

export type ExtractionProgress = { stage: 'PREPARING' | 'EXTRACTING' | 'REDUCING'; totalChunks: number; completedChunks: number }

export interface MasterMeLlmGateway {
  extractKnowledge(material: StudyMaterial, onProgress?: (progress: ExtractionProgress) => Promise<void>): Promise<ExtractedKnowledge>
  evaluateAnswer(concept: Concept, question: MasterMeQuestion, answer: string): Promise<Evaluation>
  generateEdgeCaseChallenge(concept: Concept): Promise<EdgeCaseChallenge>
  evaluateEdgeCaseAnswer(concept: Concept, challenge: EdgeCaseChallenge, answer: string): Promise<Evaluation>
  generatePracticeProject(material: StudyMaterial, concepts: Concept[], priorities: PrioritizedConcept[]): Promise<PracticeProjectContent>
  generateIsomorphicProblem(concepts: Concept[], observedFailures: string[]): Promise<IsomorphicProblem>
}
