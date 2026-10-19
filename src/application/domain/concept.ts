import type { GeneratedLocale } from './material';
import type { MasterMeQuestion } from './assessment';

export type FragmentKind = 'AXIOM' | 'NODE' | 'EDGE';
export interface Concept {
  id: string;
  materialId: string;
  name: string;
  description: string;
  kind: FragmentKind;
  sourceExcerpt: string;
  sourceOffset?: number;
  fundamentalPremises: string[];
  edgeCases: string[];
  edgeCaseQuestion?: string;
  studyQuestion?: MasterMeQuestion;
  generatedLocale: GeneratedLocale;
  prerequisiteIds: string[];
  nextIds: string[];
}
export interface ConceptRelation {
  id: string;
  materialId: string;
  fromConceptId: string;
  toConceptId: string;
  relationType: 'REQUIRES' | 'ENABLES' | 'CONTRASTS' | 'APPLIES_TO' | 'PART_OF';
  statement: string;
  justification: string;
  sourceExcerpt: string;
  sourceOffset?: number;
  provenance: 'EXTRACTED' | 'STUDENT';
}
export interface ConceptConfidence {
  conceptId: string;
  value: number;
  createdAt: string;
  updatedAt: string;
}
