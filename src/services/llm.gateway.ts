import type {
  Concept,
  Evaluation,
  IsomorphicProblem,
  SocraticQuestion,
  StressTest,
  StudyMaterial,
} from '../domain/socratic'
import type { ExtractedKnowledge } from '../schemas/llm.schema'

export type ExtractionProgress = { stage: 'PREPARING' | 'EXTRACTING' | 'REDUCING'; totalChunks: number; completedChunks: number }

export interface SocraticLlmGateway {
  extractKnowledge(material: StudyMaterial, onProgress?: (progress: ExtractionProgress) => Promise<void>): Promise<ExtractedKnowledge>
  evaluateAnswer(concept: Concept, question: SocraticQuestion, answer: string): Promise<Evaluation>
  evaluateStressReply(concept: Concept, stressTest: StressTest, answer: string): Promise<Evaluation>
  generateIsomorphicProblem(concepts: Concept[], observedFailures: string[]): Promise<IsomorphicProblem>
}
