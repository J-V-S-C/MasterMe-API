import type { LearningWorkspaceRepository } from '../repositories/learning-workspace.repository';
import type { ActivityInput, EvidenceInput, FocusedDrillPreview, GoalInput, GoalUpdate, OutlineEdit, PlanInput, PlanUpdate, RelationInput, SuggestionDecision, TaskInput, TaskUpdate } from '../contracts/learning-workspace.service';
import type { ActivityAssessmentGateway } from '../ports/activity-assessment.gateway';
import { ConflictError } from '../errors';
import { createHash } from 'node:crypto';
import { buildActivityPrompt } from '../prompts/activity-prompt';
import { suggestNextAction } from '../domain/learning-cycle';
import { criteriaForActivity } from '../domain/activity-rubric';
import { chooseTodayActions } from '../domain/today-policy';

export class LearningWorkspaceService {
  public constructor(
    private readonly repository: LearningWorkspaceRepository,
    private readonly assessment?: ActivityAssessmentGateway,
  ) {}

  public outline(ownerId: string, materialId: string) { return this.repository.outline(ownerId, materialId); }
  public questionBank(ownerId: string, materialId: string) { return this.repository.questionBank(ownerId, materialId); }
  public async focusedDrill(ownerId: string, materialId: string, conceptId?: string): Promise<FocusedDrillPreview> {
    const context = await this.repository.focusedDrillContext(ownerId, materialId, conceptId);
    return { ...context, activityType: 'APPLICATION', estimatedMinutes: 10,
      prompt: buildActivityPrompt({ activityType: 'APPLICATION', locale: context.locale, conceptName: context.conceptName, variant: context.questionVariant }),
      criteria: criteriaForActivity('APPLICATION', context.locale, context.criteria),
    };
  }
  public outlineState(ownerId: string, materialId: string) { return this.repository.outlineState(ownerId, materialId); }
  public updateOutline(ownerId: string, materialId: string, input: OutlineEdit) { return this.repository.updateOutline(ownerId, materialId, input); }
  public readingPosition(ownerId: string, materialId: string) { return this.repository.readingPosition(ownerId, materialId); }
  public setReadingPosition(ownerId: string, materialId: string, offset: number) { return this.repository.setReadingPosition(ownerId, materialId, offset); }
  public relations(ownerId: string, materialId: string) { return this.repository.relations(ownerId, materialId); }
  public createRelation(ownerId: string, input: RelationInput) { return this.repository.createRelation(ownerId, input); }
  public shelves(ownerId: string) { return this.repository.shelves(ownerId); }
  public createShelf(ownerId: string, name: string) { return this.repository.createShelf(ownerId, name); }
  public deleteShelf(ownerId: string, id: string) { return this.repository.deleteShelf(ownerId, id); }
  public setShelfMaterial(ownerId: string, shelfId: string, materialId: string, included: boolean) { return this.repository.setShelfMaterial(ownerId, shelfId, materialId, included); }
  public cards(ownerId: string) { return this.repository.cards(ownerId); }
  public saveCard(ownerId: string, conceptId: string, note: string) { return this.repository.saveCard(ownerId, conceptId, note); }
  public deleteCard(ownerId: string, conceptId: string) { return this.repository.deleteCard(ownerId, conceptId); }
  public goals(ownerId: string) { return this.repository.goals(ownerId); }
  public createGoal(ownerId: string, input: GoalInput) { return this.repository.createGoal(ownerId, input); }
  public updateGoal(ownerId: string, id: string, input: GoalUpdate) { return this.repository.updateGoal(ownerId, id, input); }
  public plans(ownerId: string) { return this.repository.plans(ownerId); }
  public createPlan(ownerId: string, input: PlanInput) { return this.repository.createPlan(ownerId, input); }
  public updatePlan(ownerId: string, id: string, input: PlanUpdate) { return this.repository.updatePlan(ownerId, id, input); }
  public reorderPlanTasks(ownerId: string, planId: string, taskIds: string[]) { return this.repository.reorderPlanTasks(ownerId, planId, taskIds); }
  public reorderTasks(ownerId: string, taskIds: string[], statuses?: Record<string, 'PENDING' | 'IN_PROGRESS' | 'DONE'>) { return this.repository.reorderTasks(ownerId, taskIds, statuses); }
  public tasks(ownerId: string) { return this.repository.tasks(ownerId); }
  public createTask(ownerId: string, input: TaskInput) { return this.repository.createTask(ownerId, input); }
  public updateTask(ownerId: string, id: string, input: TaskUpdate) { return this.repository.updateTask(ownerId, id, input); }
  public availability(ownerId: string) { return this.repository.availability(ownerId); }
  public setAvailability(ownerId: string, weekday: number, minutes: number, timezone: string) { return this.repository.setAvailability(ownerId, weekday, minutes, timezone); }
  public desk(ownerId: string, localDate: string, timezone: string) { return this.repository.desk(ownerId, localDate, timezone); }
  public async today(ownerId: string, localDate: string, timezone: string, availableMinutes?: number) {
    const input = await this.repository.todayCandidates(ownerId, localDate, timezone);
    const minutes = availableMinutes ?? input.availableMinutes;
    return { availableMinutes: minutes, actions: chooseTodayActions(input.candidates, minutes) };
  }
  public evidence(ownerId: string, materialId: string) { return this.repository.evidence(ownerId, materialId); }
  public dueReviews(ownerId: string) { return this.repository.dueReviews(ownerId, new Date()); }
  public decideReviewReminder(ownerId: string, reviewId: string, action: 'POSTPONE' | 'SKIP', days?: number) {
    return this.repository.decideReviewReminder(ownerId, reviewId, action, new Date(), days);
  }
  public async activityPrompts(ownerId: string, conceptId: string, variant = 0) {
    const context = await this.repository.loadActivityContext(ownerId, { conceptId });
    return {
      reasoning: buildActivityPrompt({ activityType: 'REASONING', locale: context.locale, conceptName: context.conceptName, studyQuestion: context.studyQuestion, variant }),
      application: buildActivityPrompt({ activityType: 'APPLICATION', locale: context.locale, conceptName: context.conceptName, studyQuestion: context.studyQuestion, variant }),
      retention: buildActivityPrompt({ activityType: 'RETENTION', locale: context.locale, conceptName: context.conceptName, studyQuestion: context.studyQuestion, variant }),
    };
  }
  public contestEvidence(ownerId: string, evidenceId: string, reason: string) { return this.repository.contestEvidence(ownerId, evidenceId, reason); }
  public async recordEvidence(ownerId: string, input: EvidenceInput) {
    const conceptName = await this.repository.evidenceConceptName(ownerId, input.materialId, input.conceptId);
    return this.repository.recordEvidence(ownerId, input, suggestNextAction({
      status: input.status,
      activityType: input.activityType,
      assisted: input.assisted,
      conceptName,
    }));
  }
  public async evaluateActivity(ownerId: string, input: ActivityInput) {
    if (!this.assessment) throw new ConflictError('Avaliação indisponível.');
    if (input.reviewId && input.activityType !== 'RETENTION') throw new ConflictError('Uma revisão exige atividade de retomada.');
    if (input.attemptContext === 'DRILL' && input.activityType !== 'APPLICATION') throw new ConflictError('Uma prática focada exige atividade de aplicação.');
    if ((input.activityType === 'RELATION') !== Boolean(input.relationId))
      throw new ConflictError('A atividade de relação exige uma relação verificada.');
    const context = await this.repository.loadActivityContext(ownerId, input);
    const promptInput = {
      activityType: input.activityType,
      locale: context.locale,
      conceptName: context.conceptName,
      studyQuestion: context.studyQuestion,
      relation: context.relation,
      variant: input.questionVariant ?? 0,
    };
    const prompt = buildActivityPrompt(promptInput);
    const criteria = criteriaForActivity(input.activityType, context.locale, context.criteria);
    const hashFor = (text: string) => createHash('sha256').update(JSON.stringify({
      ownerId,
      conceptId: context.conceptId,
      relationId: input.relationId,
      taskId: input.taskId,
      activityType: input.activityType,
      answer: input.answer,
      assisted: input.assisted,
      assistanceLevel: input.assistanceLevel ?? 0,
      solutionRevealed: input.solutionRevealed ?? false,
      ...(input.hintsUsed?.length ? { hintsUsed: input.hintsUsed } : {}),
      ...(input.previousEvidenceId ? { previousEvidenceId: input.previousEvidenceId } : {}),
      ...(input.reviewId ? { reviewId: input.reviewId } : {}),
      ...(input.attemptContext === 'DRILL' ? { attemptContext: 'DRILL' } : {}),
      prompt: text,
      sourceExcerpt: context.sourceExcerpt,
    })).digest('hex');
    // Older en-US requests used Portuguese fallback and wrapper text in the hash.
    const legacyHash = context.locale === 'en-US'
      ? hashFor(buildActivityPrompt({ ...promptInput, locale: 'pt-BR' }))
      : undefined;
    const claim = await this.repository.claimActivity(ownerId, input.requestId, hashFor(prompt), legacyHash);
    if (claim.kind === 'REPLAY') return claim.outcome;
    try {
      const evaluation = await this.assessment.evaluateActivity({
        locale: context.locale,
        activityType: input.activityType,
        conceptName: context.conceptName,
        sourceExcerpt: context.sourceExcerpt,
        criteria,
        prompt,
        answer: input.answer,
      });
      return await this.repository.recordEvidence(ownerId, {
        materialId: context.materialId,
        conceptId: context.conceptId,
        relationId: input.relationId,
        taskId: input.taskId,
        reviewId: input.reviewId,
        activityType: input.activityType,
        attemptContext: input.reviewId ? 'REVIEW' : input.attemptContext ?? 'STUDY',
        prompt,
        answer: input.answer,
        status: evaluation.status,
        assisted: input.assisted || input.solutionRevealed === true,
        assistanceLevel: input.assistanceLevel ?? (input.assisted ? 1 : 0),
        hintsUsed: input.hintsUsed,
        solutionRevealed: input.solutionRevealed,
        previousEvidenceId: input.previousEvidenceId,
        diagnosis: evaluation.feedback,
        strength: evaluation.strength,
        gap: evaluation.gap,
        nextAction: evaluation.nextAction,
        evidenceQuote: evaluation.evidenceQuote,
        missingPremises: evaluation.missingPremises,
        logicalBreak: evaluation.logicalBreak,
        promptVersion: input.questionVariant ? `activity-v4-variant${input.questionVariant}` : 'activity-v3',
        criteria,
        sourceExcerpt: context.sourceExcerpt,
        sourceOffset: context.sourceOffset,
        requestId: input.requestId,
        leaseToken: claim.leaseToken,
      }, suggestNextAction({
        status: evaluation.status,
        activityType: input.activityType,
        assisted: input.assisted,
        conceptName: context.conceptName,
      }));
    } catch (error: unknown) {
      await this.repository.releaseActivity(ownerId, input.requestId, claim.leaseToken);
      throw error;
    }
  }
  public suggestions(ownerId: string) { return this.repository.suggestions(ownerId); }
  public requestRevisit(ownerId: string, evidenceId: string) { return this.repository.requestRevisit(ownerId, evidenceId); }
  public decideSuggestion(ownerId: string, id: string, decision: SuggestionDecision) { return this.repository.decideSuggestion(ownerId, id, decision); }
}
