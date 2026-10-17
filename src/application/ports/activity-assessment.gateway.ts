import type { EvidenceActivity } from '../domain/learning-cycle';
import type { Evaluation } from '../domain/assessment';
import type { SupportedLocale } from '../domain/material';

export interface ActivityAssessmentGateway {
  evaluateActivity(input: {
    locale: SupportedLocale;
    activityType: EvidenceActivity;
    conceptName: string;
    sourceExcerpt: string;
    criteria: string[];
    prompt: string;
    answer: string;
  }): Promise<Evaluation>;
}
