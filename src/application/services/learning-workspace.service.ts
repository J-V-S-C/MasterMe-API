import type { LearningWorkspaceRepository } from '../repositories/learning-workspace.repository';
import type { ActivityInput, EvidenceInput, GoalInput, PlanInput, PlanUpdate, RelationInput, SuggestionDecision, TaskInput, TaskUpdate } from '../contracts/learning-workspace.service';
import type { ActivityAssessmentGateway } from '../ports/activity-assessment.gateway';
import { ConflictError } from '../errors';
import { createHash } from 'node:crypto';
import { buildActivityPrompt } from '../prompts/activity-prompt';
import { suggestNextAction } from '../domain/learning-cycle';

export class LearningWorkspaceService {
  public constructor(
    private readonly repository: LearningWorkspaceRepository,
    private readonly assessment?: ActivityAssessmentGateway,
  ) {}

  public outline(ownerId: string, materialId: string) { return this.repository.outline(ownerId, materialId); }
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
  public plans(ownerId: string) { return this.repository.plans(ownerId); }
  public createPlan(ownerId: string, input: PlanInput) { return this.repository.createPlan(ownerId, input); }
  public updatePlan(ownerId: string, id: string, input: PlanUpdate) { return this.repository.updatePlan(ownerId, id, input); }
  public reorderPlanTasks(ownerId: string, planId: string, taskIds: string[]) { return this.repository.reorderPlanTasks(ownerId, planId, taskIds); }
  public tasks(ownerId: string) { return this.repository.tasks(ownerId); }
  public createTask(ownerId: string, input: TaskInput) { return this.repository.createTask(ownerId, input); }
  public updateTask(ownerId: string, id: string, input: TaskUpdate) { return this.repository.updateTask(ownerId, id, input); }
  public availability(ownerId: string) { return this.repository.availability(ownerId); }
  public setAvailability(ownerId: string, weekday: number, minutes: number, timezone: string) { return this.repository.setAvailability(ownerId, weekday, minutes, timezone); }
  public desk(ownerId: string, localDate: string, timezone: string) { return this.repository.desk(ownerId, localDate, timezone); }
  public evidence(ownerId: string, materialId: string) { return this.repository.evidence(ownerId, materialId); }
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
    if ((input.activityType === 'RELATION') !== Boolean(input.relationId))
      throw new ConflictError('A atividade de relação exige uma relação verificada.');
    const context = await this.repository.loadActivityContext(ownerId, input);
    const promptInput = {
      activityType: input.activityType,
      locale: context.locale,
      conceptName: context.conceptName,
      studyQuestion: context.studyQuestion,
      relation: context.relation,
    };
    const prompt = buildActivityPrompt(promptInput);
    const hashFor = (text: string) => createHash('sha256').update(JSON.stringify({
      ownerId,
      conceptId: context.conceptId,
      relationId: input.relationId,
      taskId: input.taskId,
      activityType: input.activityType,
      answer: input.answer,
      assisted: input.assisted,
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
        criteria: context.criteria,
        prompt,
        answer: input.answer,
      });
      return await this.repository.recordEvidence(ownerId, {
        materialId: context.materialId,
        conceptId: context.conceptId,
        relationId: input.relationId,
        taskId: input.taskId,
        activityType: input.activityType,
        prompt,
        answer: input.answer,
        status: evaluation.status,
        assisted: input.assisted,
        diagnosis: evaluation.feedback,
        sourceExcerpt: context.sourceExcerpt,
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
  public decideSuggestion(ownerId: string, id: string, decision: SuggestionDecision) { return this.repository.decideSuggestion(ownerId, id, decision); }
}
