import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client';
import { deriveEditorialUnits } from '../../parsers/editorial-structure';
import {
  scheduledLoad,
  type EvidenceActivity,
  type EvidenceStatus,
} from '../../../application/domain/learning-cycle';
import { ConflictError, NotFoundError } from '../../../application/errors';
import type { ActivityContext, ActivityClaim, DueReview, EvidenceSuggestion } from '../../../application/repositories/learning-workspace.repository';
import type { ActivityInput, EvidenceInput, FocusedDrillContext, ObjectiveQuestionRecord, OutlineEdit, TaskInput, TaskUpdate } from '../../../application/contracts/learning-workspace.service';
import type { SuggestionDecision } from '../../../application/contracts/learning-workspace.service';
import { decideReview } from '../../../application/domain/review-policy';
import type { TodayAction } from '../../../application/domain/today-policy';

export class PrismaLearningWorkspaceRepository {
  public constructor(private readonly db: PrismaClient) {}

  private async ownedMaterial(ownerId: string, id: string) {
    const material = await this.db.study_materials.findFirst({
      where: { id, owner_id: ownerId },
    });
    if (!material) throw new NotFoundError('Material');
    return material;
  }

  public async questionBank(ownerId: string, materialId: string): Promise<ObjectiveQuestionRecord[]> {
    const material = await this.ownedMaterial(ownerId, materialId);
    const concepts = await this.db.concepts.findMany({
      where: { material_id: materialId, extraction_job_id: material.active_extraction_job_id },
      include: { learning_objectives: { include: { question_versions: { orderBy: { created_at: 'asc' } } } } },
      orderBy: [{ source_offset: 'asc' }, { name: 'asc' }],
    });
    return concepts.map((concept) => {
      const objective = concept.learning_objectives;
      const generated = concept.study_question;
      const fallbackText = generated && typeof generated === 'object' && !Array.isArray(generated) && 'learningObjective' in generated && typeof generated.learningObjective === 'string'
        ? generated.learningObjective.trim() || concept.description : concept.description;
      return {
        objectiveId: objective?.id ?? null,
        conceptId: concept.id,
        conceptName: concept.name,
        objectiveText: objective?.objective_text ?? fallbackText,
        sourceExcerpt: objective?.source_excerpt ?? concept.source_excerpt,
        sourceOffset: objective?.source_offset ?? concept.source_offset,
        sourceExtractionJobId: objective?.extraction_job_id ?? concept.extraction_job_id,
        questions: objective?.question_versions.map((version) => ({
          id: version.id, activityType: version.activity_type, prompt: version.prompt,
          promptVersion: version.prompt_version,
          criteria: Array.isArray(version.criteria) ? version.criteria.filter((item): item is string => typeof item === 'string') : [],
          sourceExcerpt: version.source_excerpt, sourceOffset: version.source_offset,
          createdAt: version.created_at.toISOString(),
        })) ?? [],
      };
    });
  }

  public async focusedDrillContext(ownerId: string, materialId: string, requestedConceptId?: string): Promise<FocusedDrillContext> {
    const material = await this.ownedMaterial(ownerId, materialId);
    const concepts = await this.db.concepts.findMany({
      where: { material_id: materialId, extraction_job_id: material.active_extraction_job_id },
      include: { learning_objectives: true },
      orderBy: [{ source_offset: 'asc' }, { name: 'asc' }],
    });
    if (!concepts.length) throw new ConflictError('Este material ainda não tem conceitos prontos para prática.');
    if (requestedConceptId && !concepts.some((concept) => concept.id === requestedConceptId)) throw new NotFoundError('Conceito');
    const attempts = await this.db.learning_evidence.findMany({
      where: { owner_id: ownerId, material_id: materialId, concept_id: { in: concepts.map((concept) => concept.id) }, activity_type: { in: ['COMPREHENSION', 'REASONING', 'APPLICATION'] }, status: { in: ['PASSED', 'INCOMPLETE', 'LOGICAL_BREAK'] } },
      include: { evidence_contestations: { select: { id: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    const latestByConcept = new Map<string, typeof attempts[number]>();
    for (const attempt of attempts) if (attempt.concept_id && !latestByConcept.has(attempt.concept_id)) latestByConcept.set(attempt.concept_id, attempt);
    const unresolved = attempts.find((attempt) => attempt.concept_id && latestByConcept.get(attempt.concept_id)?.id === attempt.id && !attempt.evidence_contestations.length && (attempt.status === 'INCOMPLETE' || attempt.status === 'LOGICAL_BREAK'));
    const selected = concepts.find((concept) => concept.id === (requestedConceptId ?? unresolved?.concept_id)) ?? concepts[0]!;
    const latest = latestByConcept.get(selected.id);
    const observedGap = latest && !latest.evidence_contestations.length && (latest.status === 'INCOMPLETE' || latest.status === 'LOGICAL_BREAK')
      ? (latest.gap ?? latest.logical_break ?? latest.diagnosis).slice(0, 500) : null;
    const previousApplication = attempts.find((attempt) => attempt.concept_id === selected.id && attempt.activity_type === 'APPLICATION' && !attempt.evidence_contestations.length);
    const generated = selected.study_question;
    const fallbackObjective = generated && typeof generated === 'object' && !Array.isArray(generated) && 'learningObjective' in generated && typeof generated.learningObjective === 'string'
      ? generated.learningObjective.trim() || selected.description : selected.description;
    return {
      materialId, conceptId: selected.id, conceptName: selected.name,
      objectiveId: selected.learning_objectives?.id ?? null,
      objectiveText: selected.learning_objectives?.objective_text ?? fallbackObjective,
      observedGap,
      sourceExcerpt: selected.source_excerpt, sourceOffset: selected.source_offset,
      criteria: Array.isArray(selected.fundamental_premises) ? selected.fundamental_premises.filter((item): item is string => typeof item === 'string') : [],
      locale: material.locale === 'en-US' ? 'en-US' : 'pt-BR',
      previousEvidenceId: previousApplication?.id ?? null,
      questionVariant: previousApplication ? previousApplication.prompt_version === 'activity-v4-variant1' ? 2 : 1 : 0,
    };
  }

  public async outline(ownerId: string, materialId: string) {
    const material = await this.ownedMaterial(ownerId, materialId);
    let rows = await this.db.material_units.findMany({
      where: { material_id: materialId },
      orderBy: { ordinal: 'asc' },
    });
    if (!rows.length) {
      const units = deriveEditorialUnits(
        material.content,
        material.source_type === 'MARKDOWN'
          ? 'MARKDOWN'
          : material.source_type === 'PDF'
            ? 'PDF'
            : 'TEXT',
      );
      await this.db.material_units.createMany({
        data: units.map((unit) => ({
          id: randomUUID(),
          material_id: materialId,
          ordinal: unit.order,
          title: unit.title,
          original_title: unit.title,
          original_ordinal: unit.order,
          level: unit.level,
          start_offset: unit.startOffset,
          end_offset: unit.endOffset,
          provenance: unit.provenance,
          page_number: unit.pageNumber ?? null,
        })),
        skipDuplicates: true,
      });
      rows = await this.db.material_units.findMany({
        where: { material_id: materialId },
        orderBy: { ordinal: 'asc' },
      });
    }
    return rows.map((row) => ({
      id: row.id,
      order: row.ordinal,
      title: row.title,
      originalTitle: row.original_title ?? row.title,
      originalOrder: row.original_ordinal ?? row.ordinal,
      level: row.level,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      provenance: row.provenance,
      pageNumber: row.page_number,
    }));
  }

  public async outlineState(ownerId: string, materialId: string) {
    const units = await this.outline(ownerId, materialId);
    const material = await this.ownedMaterial(ownerId, materialId);
    return { revision: material.outline_revision, units };
  }

  public async updateOutline(ownerId: string, materialId: string, input: OutlineEdit) {
    await this.outline(ownerId, materialId);
    await this.db.$transaction(async (tx) => {
      const claimed = await tx.study_materials.updateMany({
        where: { id: materialId, owner_id: ownerId, outline_revision: input.expectedRevision },
        data: { outline_revision: { increment: 1 } },
      });
      if (!claimed.count) {
        const exists = await tx.study_materials.findFirst({ where: { id: materialId, owner_id: ownerId }, select: { id: true } });
        if (!exists) throw new NotFoundError('Material');
        throw new ConflictError('O índice mudou. Recarregue e tente novamente.');
      }
      const current = await tx.material_units.findMany({ where: { material_id: materialId }, orderBy: { ordinal: 'asc' } });
      const material = await tx.study_materials.findUniqueOrThrow({ where: { id: materialId }, select: { content: true } });
      const ids = new Set(current.map((unit) => unit.id));
      if (input.units.some((unit) => unit.id && !ids.has(unit.id)))
        throw new ConflictError('O índice mudou. Recarregue e tente novamente.');
      const byId = new Map(current.map((unit) => [unit.id, unit]));
      const offset = Math.max(...current.map((unit) => unit.ordinal)) + input.units.length + 1;
      const newIds: string[] = [];
      for (const [index, unit] of input.units.entries()) {
        if (!unit.id) {
          if (unit.startOffset === undefined || unit.endOffset === undefined || unit.endOffset <= unit.startOffset || unit.endOffset > material.content.length)
            throw new ConflictError('A seção está fora do texto original.');
          const id = randomUUID();
          newIds.push(id);
          await tx.material_units.create({ data: {
            id, material_id: materialId, ordinal: offset + index,
            title: unit.title, level: 1, start_offset: unit.startOffset, end_offset: unit.endOffset,
            provenance: 'STUDENT', original_title: null, original_ordinal: null,
          } });
          continue;
        }
        const previous = byId.get(unit.id);
        if (!previous) throw new ConflictError('Unidade editorial indisponível.');
        await tx.material_units.update({
          where: { id: unit.id },
          data: {
            ordinal: offset + index,
            title: unit.title,
            provenance: unit.title !== previous.title || index !== previous.ordinal ? 'STUDENT' : previous.provenance,
            original_title: previous.original_title ?? previous.title,
            original_ordinal: previous.original_ordinal ?? previous.ordinal,
          },
        });
      }
      const retainedIds = input.units.flatMap((unit) => unit.id ? [unit.id] : []);
      const removed = current.filter((unit) => !retainedIds.includes(unit.id));
      if (removed.length) {
        const completed = await tx.processing_job_units.count({ where: { unit_id: { in: removed.map((unit) => unit.id) } } });
        const linked = await tx.study_tasks.count({ where: { unit_id: { in: removed.map((unit) => unit.id) } } });
        if (completed || linked) throw new ConflictError('Uma seção com progresso ou tarefa não pode ser removida.');
        await tx.material_units.deleteMany({ where: { id: { in: removed.map((unit) => unit.id) }, material_id: materialId } });
      }
      let newIndex = 0;
      for (const [index, unit] of input.units.entries()) {
        const id = unit.id ?? newIds[newIndex++];
        if (!id) throw new ConflictError('Unidade editorial indisponível.');
        await tx.material_units.update({ where: { id }, data: { ordinal: index } });
      }
    });
    return this.outlineState(ownerId, materialId);
  }

  public async readingPosition(ownerId: string, materialId: string) {
    const material = await this.ownedMaterial(ownerId, materialId);
    return { offset: Math.min(material.reading_offset, material.content.length) };
  }

  public async setReadingPosition(ownerId: string, materialId: string, offset: number) {
    const material = await this.ownedMaterial(ownerId, materialId);
    if (offset > material.content.length)
      throw new ConflictError('A posição de leitura está fora do material.');
    await this.db.study_materials.update({
      where: { id: materialId },
      data: { reading_offset: offset },
    });
    return { offset };
  }

  public async relations(ownerId: string, materialId: string) {
    const material = await this.ownedMaterial(ownerId, materialId);
    return this.db.concept_relations.findMany({
      where: { material_id: materialId, extraction_job_id: material.active_extraction_job_id },
      orderBy: { created_at: 'asc' },
    });
  }

  public async createRelation(
    ownerId: string,
    input: {
      materialId: string;
      fromConceptId: string;
      toConceptId: string;
      relationType:
        | 'REQUIRES'
        | 'ENABLES'
        | 'CONTRASTS'
        | 'APPLIES_TO'
        | 'PART_OF';
      statement: string;
      justification: string;
      sourceExcerpt: string;
      sourceOffset?: number;
    },
  ) {
    const material = await this.ownedMaterial(ownerId, input.materialId);
    if (!material.content.includes(input.sourceExcerpt))
      throw new ConflictError('O trecho da relação não pertence ao material.');
    if (input.sourceOffset !== undefined && material.content.slice(input.sourceOffset, input.sourceOffset + input.sourceExcerpt.length) !== input.sourceExcerpt)
      throw new ConflictError('A posição da relação não corresponde ao trecho.');
    const firstOffset = material.content.indexOf(input.sourceExcerpt);
    const sourceOffset = input.sourceOffset ?? (material.content.indexOf(input.sourceExcerpt, firstOffset + 1) < 0 ? firstOffset : undefined);
    const concepts = await this.db.concepts.findMany({
      where: {
        id: { in: [input.fromConceptId, input.toConceptId] },
        material_id: material.id,
        extraction_job_id: material.active_extraction_job_id,
      },
      select: { id: true },
    });
    if (input.fromConceptId === input.toConceptId || concepts.length !== 2)
      throw new ConflictError(
        'A relação precisa ligar dois conceitos do mesmo material.',
      );
    return this.db.concept_relations.upsert({
      where: {
        material_id_from_concept_id_to_concept_id_relation_type: {
          material_id: material.id,
          from_concept_id: input.fromConceptId,
          to_concept_id: input.toConceptId,
          relation_type: input.relationType,
        },
      },
      create: {
        id: randomUUID(),
        material_id: material.id,
        extraction_job_id: material.active_extraction_job_id,
        from_concept_id: input.fromConceptId,
        to_concept_id: input.toConceptId,
        relation_type: input.relationType,
        statement: input.statement,
        justification: input.justification,
        source_excerpt: input.sourceExcerpt,
        source_offset: sourceOffset ?? null,
        provenance: 'STUDENT',
      },
      update: {},
    });
  }

  public shelves(ownerId: string) {
    return this.db.shelves.findMany({
      where: { owner_id: ownerId },
      include: { shelf_materials: { select: { material_id: true } } },
      orderBy: { created_at: 'asc' },
    });
  }
  public createShelf(ownerId: string, name: string) {
    return this.db.shelves.upsert({
      where: { owner_id_name: { owner_id: ownerId, name } },
      create: { id: randomUUID(), owner_id: ownerId, name },
      update: {},
    });
  }
  public async deleteShelf(ownerId: string, id: string) {
    const result = await this.db.shelves.deleteMany({
      where: { id, owner_id: ownerId },
    });
    if (!result.count) throw new NotFoundError('Prateleira');
  }
  public async setShelfMaterial(
    ownerId: string,
    shelfId: string,
    materialId: string,
    included: boolean,
  ) {
    const shelf = await this.db.shelves.findFirst({
      where: { id: shelfId, owner_id: ownerId },
    });
    if (!shelf) throw new NotFoundError('Prateleira');
    await this.ownedMaterial(ownerId, materialId);
    if (included)
      await this.db.shelf_materials.upsert({
        where: {
          shelf_id_material_id: { shelf_id: shelfId, material_id: materialId },
        },
        create: { shelf_id: shelfId, material_id: materialId },
        update: {},
      });
    else
      await this.db.shelf_materials.deleteMany({
        where: { shelf_id: shelfId, material_id: materialId },
      });
  }

  public async cards(ownerId: string) {
    return this.db.concept_cards.findMany({
      where: { owner_id: ownerId },
      include: {
        concepts: {
          select: { name: true, material_id: true, source_excerpt: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }
  public async saveCard(ownerId: string, conceptId: string, note: string) {
    const concept = await this.db.concepts.findUnique({
      where: { id: conceptId },
      include: { study_materials: { select: { owner_id: true } } },
    });
    if (!concept || concept.study_materials.owner_id !== ownerId)
      throw new NotFoundError('Conceito');
    return this.db.concept_cards.upsert({
      where: {
        owner_id_concept_id: { owner_id: ownerId, concept_id: conceptId },
      },
      create: { owner_id: ownerId, concept_id: conceptId, note },
      update: { note },
    });
  }
  public async deleteCard(ownerId: string, conceptId: string) {
    await this.db.concept_cards.deleteMany({
      where: { owner_id: ownerId, concept_id: conceptId },
    });
  }

  public goals(ownerId: string) {
    return this.db.learning_goals.findMany({
      where: { owner_id: ownerId },
      orderBy: { created_at: 'desc' },
    });
  }
  public createGoal(
    ownerId: string,
    input: { title: string; description: string; deadline?: Date },
  ) {
    return this.db.learning_goals.create({
      data: { id: randomUUID(), owner_id: ownerId, ...input },
    });
  }
  public async updateGoal(
    ownerId: string,
    id: string,
    input: { title?: string; description?: string; deadline?: Date | null },
  ) {
    const updated = await this.db.learning_goals.updateMany({
      where: { id, owner_id: ownerId },
      data: input,
    });
    if (!updated.count) throw new NotFoundError('Objetivo');
    return this.db.learning_goals.findFirstOrThrow({ where: { id, owner_id: ownerId } });
  }
  public plans(ownerId: string) {
    return this.db.study_plans.findMany({
      where: { owner_id: ownerId },
      include: { study_plan_materials: { orderBy: { ordinal: 'asc' }, select: { material_id: true, ordinal: true } } },
      orderBy: { created_at: 'desc' },
    });
  }
  public async createPlan(
    ownerId: string,
    input: { title: string; goalId?: string; materialIds?: string[] },
  ) {
    if (
      input.goalId &&
      !(await this.db.learning_goals.findFirst({
        where: { id: input.goalId, owner_id: ownerId },
      }))
    )
      throw new NotFoundError('Objetivo');
    await this.assertOwnedPlanMaterials(ownerId, input.materialIds ?? []);
    return this.db.$transaction(async (tx) => {
      const plan = await tx.study_plans.create({
        data: { id: randomUUID(), owner_id: ownerId, title: input.title, goal_id: input.goalId ?? null },
      });
      if (input.materialIds?.length) await tx.study_plan_materials.createMany({
        data: input.materialIds.map((materialId, ordinal) => ({ plan_id: plan.id, owner_id: ownerId, material_id: materialId, ordinal })),
      });
      return tx.study_plans.findUniqueOrThrow({
        where: { id: plan.id },
        include: { study_plan_materials: { orderBy: { ordinal: 'asc' }, select: { material_id: true, ordinal: true } } },
      });
    });
  }
  public async updatePlan(ownerId: string, id: string, input: { title?: string; goalId?: string | null; materialIds?: string[] }) {
    if (!(await this.db.study_plans.findFirst({ where: { id, owner_id: ownerId } })))
      throw new NotFoundError('Roteiro');
    if (input.goalId && !(await this.db.learning_goals.findFirst({ where: { id: input.goalId, owner_id: ownerId } })))
      throw new NotFoundError('Objetivo');
    if (input.materialIds) await this.assertOwnedPlanMaterials(ownerId, input.materialIds);
    return this.db.$transaction(async (tx) => {
      const changed = await tx.study_plans.updateMany({
        where: { id, owner_id: ownerId },
        data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.goalId !== undefined ? { goal_id: input.goalId } : {}) },
      });
      if (!changed.count) throw new NotFoundError('Roteiro');
      if (input.materialIds) {
        await tx.study_plan_materials.deleteMany({ where: { plan_id: id, owner_id: ownerId } });
        if (input.materialIds.length) await tx.study_plan_materials.createMany({
          data: input.materialIds.map((materialId, ordinal) => ({ plan_id: id, owner_id: ownerId, material_id: materialId, ordinal })),
        });
      }
      return tx.study_plans.findFirstOrThrow({
        where: { id, owner_id: ownerId },
        include: { study_plan_materials: { orderBy: { ordinal: 'asc' }, select: { material_id: true, ordinal: true } } },
      });
    });
  }

  public async reorderPlanTasks(ownerId: string, planId: string, taskIds: string[]) {
    return this.db.$transaction(async (tx) => {
      const owned = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM study_plans WHERE id=${planId}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE
      `;
      if (!owned.length) throw new NotFoundError('Roteiro');
      const current = await tx.study_tasks.findMany({
        where: { owner_id: ownerId, plan_id: planId, status: { not: 'REMOVED' } },
        select: { id: true },
      });
      const requestedIds = new Set(taskIds);
      if (requestedIds.size !== taskIds.length || current.length !== taskIds.length ||
        current.some(({ id }) => !requestedIds.has(id)))
        throw new ConflictError('A ordem deve incluir todas as tarefas ativas do roteiro.');
      for (const [sortOrder, id] of taskIds.entries()) {
        const changed = await tx.study_tasks.updateMany({
          where: { id, owner_id: ownerId, plan_id: planId, status: { not: 'REMOVED' } },
          data: { sort_order: sortOrder, updated_at: new Date() },
        });
        if (!changed.count) throw new ConflictError('As tarefas do roteiro mudaram. Recarregue e tente novamente.');
      }
      return tx.study_tasks.findMany({
        where: { owner_id: ownerId, plan_id: planId, status: { not: 'REMOVED' } },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      });
    }, { timeout: 30_000 });
  }

  public async reorderTasks(ownerId: string, taskIds: string[], statuses?: Record<string, 'PENDING' | 'IN_PROGRESS' | 'DONE'>) {
    return this.db.$transaction(async (tx) => {
      const current = await tx.study_tasks.findMany({
        where: { owner_id: ownerId, status: { not: 'REMOVED' } }, select: { id: true },
      });
      const requestedIds = new Set(taskIds);
      if (requestedIds.size !== taskIds.length || current.length !== taskIds.length ||
        current.some(({ id }) => !requestedIds.has(id)) ||
        (statuses && Object.keys(statuses).some((id) => !requestedIds.has(id))))
        throw new ConflictError('A ordem deve incluir todas as tarefas ativas. Recarregue e tente novamente.');
      for (const [sortOrder, id] of taskIds.entries()) {
        const changed = await tx.study_tasks.updateMany({
          where: { id, owner_id: ownerId, status: { not: 'REMOVED' } },
          data: { sort_order: sortOrder, ...(statuses?.[id] ? { status: statuses[id] } : {}), updated_at: new Date() },
        });
        if (!changed.count) throw new ConflictError('As tarefas mudaram. Recarregue e tente novamente.');
      }
      return tx.study_tasks.findMany({
        where: { owner_id: ownerId, status: { not: 'REMOVED' } },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      });
    }, { timeout: 30_000 });
  }

  private async assertOwnedPlanMaterials(ownerId: string, ids: string[]) {
    if (!ids.length) return;
    const count = await this.db.study_materials.count({ where: { id: { in: ids }, owner_id: ownerId } });
    if (count !== ids.length) throw new NotFoundError('Material');
  }
  public tasks(ownerId: string) {
    return this.db.study_tasks.findMany({
      where: { owner_id: ownerId },
      include: { concepts: { select: { name: true } }, study_suggestions: { select: { learning_evidence: {
        select: { id: true, prompt: true, diagnosis: true, source_excerpt: true, source_offset: true, status: true, created_at: true },
      } } } },
      orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
    });
  }
  public async createTask(
    ownerId: string,
    input: TaskInput,
  ) {
    if (input.materialId) await this.ownedMaterial(ownerId, input.materialId);
    let effectiveMaterialId = input.materialId;
    let effectiveConceptId = input.conceptId;
    if (input.reviewId) {
      const review = await this.db.review_schedules.findFirst({
        where: { id: input.reviewId, owner_id: ownerId, status: 'SCHEDULED' },
      });
      if (!review) throw new NotFoundError('Revisão');
      if (
        (input.materialId && review.material_id !== input.materialId) ||
        (input.conceptId && review.concept_id !== input.conceptId)
      )
        throw new NotFoundError('Revisão');
      effectiveMaterialId = review.material_id;
      effectiveConceptId = review.concept_id;
    }
    if (input.conceptId) {
      const concept = await this.db.concepts.findFirst({
        where: { id: input.conceptId, study_materials: { owner_id: ownerId } },
      });
      if (
        !concept ||
        (effectiveMaterialId && concept.material_id !== effectiveMaterialId)
      )
        throw new NotFoundError('Conceito');
      effectiveMaterialId = concept.material_id;
    }
    if (input.unitId) {
      const unit = await this.db.material_units.findFirst({
        where: { id: input.unitId, study_materials: { owner_id: ownerId } },
      });
      if (
        !unit ||
        (effectiveMaterialId && unit.material_id !== effectiveMaterialId)
      )
        throw new NotFoundError('Unidade');
      effectiveMaterialId = unit.material_id;
    }
    if (input.projectId) {
      if (input.activityType !== 'PRACTICE' || input.reviewId) throw new ConflictError('Um projeto exige tarefa de prática sem revisão.');
      const project = await this.db.practice_projects.findFirst({ where: { id: input.projectId, study_materials: { owner_id: ownerId } } });
      if (!project || (effectiveMaterialId && project.material_id !== effectiveMaterialId)) throw new NotFoundError('Projeto');
      effectiveMaterialId = project.material_id;
    }
    const data = {
      id: randomUUID(),
      owner_id: ownerId,
      title: input.title,
      description: input.description ?? '',
      activity_type: input.activityType,
      plan_id: input.planId ?? null,
      material_id: effectiveMaterialId ?? null,
      concept_id: effectiveConceptId ?? null,
      unit_id: input.unitId ?? null,
      review_id: input.reviewId ?? null,
      project_id: input.projectId ?? null,
      duration_minutes: input.durationMinutes ?? null,
      scheduled_at: input.scheduledAt ?? null,
      reason: input.reason ?? '',
    };
    if (!input.planId) return this.db.study_tasks.create({ data });
    return this.db.$transaction(async (tx) => {
      const owned = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM study_plans WHERE id=${input.planId}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE
      `;
      if (!owned.length) throw new NotFoundError('Roteiro');
      return tx.study_tasks.create({ data });
    });
  }
  public async updateTask(
    ownerId: string,
    id: string,
    input: TaskUpdate,
  ) {
    let effectiveMaterialId = input.materialId;
    if (input.materialId !== undefined || input.conceptId !== undefined || input.projectId !== undefined) {
      const current = await this.db.study_tasks.findFirst({ where: { id, owner_id: ownerId } });
      if (!current) throw new NotFoundError('Tarefa');
      const materialId = input.materialId !== undefined ? input.materialId : current.material_id;
      const conceptId = input.conceptId !== undefined ? input.conceptId : current.concept_id;
      const projectId = input.projectId !== undefined ? input.projectId : current.project_id;
      if (materialId) await this.ownedMaterial(ownerId, materialId);
      if (conceptId) {
        const concept = await this.db.concepts.findFirst({ where: { id: conceptId, study_materials: { owner_id: ownerId } } });
        if (!concept || (materialId && concept.material_id !== materialId)) throw new NotFoundError('Conceito');
        if (!materialId) effectiveMaterialId = concept.material_id;
      }
      if (projectId) {
        if (current.activity_type !== 'PRACTICE' || current.review_id) throw new ConflictError('Um projeto exige tarefa de prática sem revisão.');
        const project = await this.db.practice_projects.findFirst({ where: { id: projectId, study_materials: { owner_id: ownerId } } });
        const linkedMaterialId = effectiveMaterialId !== undefined ? effectiveMaterialId : materialId;
        if (!project || (linkedMaterialId && project.material_id !== linkedMaterialId)) throw new NotFoundError('Projeto');
        if (!linkedMaterialId) effectiveMaterialId = project.material_id;
      }
    }
    const changed = await this.db.study_tasks.updateMany({
      where: { id, owner_id: ownerId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(effectiveMaterialId !== undefined ? { material_id: effectiveMaterialId } : {}),
        ...(input.conceptId !== undefined ? { concept_id: input.conceptId } : {}),
        ...(input.projectId !== undefined ? { project_id: input.projectId } : {}),
        ...(input.durationMinutes !== undefined
          ? { duration_minutes: input.durationMinutes }
          : {}),
        ...(input.scheduledAt !== undefined
          ? { scheduled_at: input.scheduledAt }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updated_at: new Date(),
      },
    });
    if (!changed.count) throw new NotFoundError('Tarefa');
    return this.db.study_tasks.findUniqueOrThrow({
      where: { id },
      include: { concepts: { select: { name: true } }, study_suggestions: { select: { learning_evidence: {
        select: { id: true, prompt: true, diagnosis: true, source_excerpt: true, source_offset: true, status: true, created_at: true },
      } } } },
    });
  }

  public availability(ownerId: string) {
    return this.db.study_availability.findMany({
      where: { owner_id: ownerId },
      orderBy: { weekday: 'asc' },
    });
  }
  public setAvailability(
    ownerId: string,
    weekday: number,
    minutes: number,
    timezone: string,
  ) {
    return this.db.study_availability.upsert({
      where: { owner_id_weekday: { owner_id: ownerId, weekday } },
      create: { owner_id: ownerId, weekday, minutes, timezone },
      update: { minutes, timezone },
    });
  }

  public async desk(ownerId: string, localDate: string, timezone: string) {
    const tasks = await this.tasks(ownerId);
    const today = tasks.filter(
      (task) =>
        task.scheduled_at &&
        new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(task.scheduled_at) === localDate,
    );
    const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
    const availability = await this.db.study_availability.findUnique({
      where: { owner_id_weekday: { owner_id: ownerId, weekday } },
    });
    return {
      tasks: today,
      load: scheduledLoad(
        today.map((task) => ({
          status: task.status as 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'REMOVED',
          durationMinutes: task.duration_minutes,
        })),
        availability?.minutes ?? 0,
      ),
    };
  }

  public async todayCandidates(ownerId: string, localDate: string, timezone: string): Promise<{ availableMinutes: number; candidates: TodayAction[] }> {
    const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
    const bounds = await this.db.$queryRaw<Array<{ start_at: Date; end_at: Date }>>`
      SELECT (${localDate}::date AT TIME ZONE ${timezone}) AS start_at,
             ((${localDate}::date + interval '1 day') AT TIME ZONE ${timezone}) AS end_at`;
    const start = bounds[0]?.start_at;
    const end = bounds[0]?.end_at;
    if (!start || !end) throw new ConflictError('Não foi possível determinar o dia local.');
    const [availability, tasks, reviews, gaps, materials] = await Promise.all([
      this.db.study_availability.findUnique({ where: { owner_id_weekday: { owner_id: ownerId, weekday } } }),
      this.db.study_tasks.findMany({ where: { owner_id: ownerId, status: { in: ['PENDING', 'IN_PROGRESS'] }, scheduled_at: { gte: start, lt: end } }, orderBy: { scheduled_at: 'asc' }, take: 100 }),
      this.dueReviews(ownerId, new Date(end.getTime() - 1)),
      this.db.study_suggestions.findMany({ where: { owner_id: ownerId, status: 'PENDING' }, include: { learning_evidence: { select: { material_id: true, concept_id: true } } }, orderBy: { created_at: 'desc' }, take: 5 }),
      this.db.study_materials.findMany({ where: { owner_id: ownerId, processing_status: 'READY' }, include: { material_units: { orderBy: { ordinal: 'asc' } } }, orderBy: { created_at: 'desc' }, take: 5 }),
    ]);
    const todayTasks = tasks.slice(0, 5);
    const candidates: TodayAction[] = todayTasks.map((task) => ({
      id: `task:${task.id}`, kind: 'TASK', title: task.title, reason: 'SCHEDULED',
      estimatedMinutes: task.duration_minutes ?? 25,
      href: task.material_id ? `${task.activity_type === 'PRACTICE' ? '/practice' : '/study'}?material=${task.material_id}${task.project_id && task.activity_type === 'PRACTICE' ? `&project=${task.project_id}` : task.concept_id ? `&concept=${task.concept_id}` : ''}${task.review_id && task.activity_type !== 'PRACTICE' ? `&review=${task.review_id}` : ''}` : '/library',
      priority: 0, dueAt: task.scheduled_at?.toISOString(),
    }));
    const scheduledReviewIds = new Set(todayTasks.flatMap((task) => task.review_id ? [task.review_id] : []));
    for (const review of reviews.slice(0, 8)) {
      if (scheduledReviewIds.has(review.id)) continue;
      candidates.push({
        id: `review:${review.id}`, kind: 'REVIEW', title: review.conceptName, reason: 'DUE_REVIEW',
        estimatedMinutes: 10, href: `/study?material=${review.materialId}&concept=${review.conceptId}&review=${review.id}`,
        priority: 1, dueAt: review.dueAt,
      });
    }
    for (const gap of gaps.slice(0, 3)) {
      candidates.push({
        id: `gap:${gap.id}`, kind: 'GAP', title: gap.title, reason: 'OPEN_GAP', estimatedMinutes: 15,
        href: `/practice?material=${gap.learning_evidence.material_id}${gap.concept_id ? `&concept=${gap.concept_id}` : ''}`,
        priority: 2,
      });
    }
    for (const material of materials) {
      if (material.reading_offset >= material.content.length) continue;
      const unit = [...material.material_units].sort((left, right) => left.start_offset - right.start_offset)
        .find((item) => item.end_offset > material.reading_offset);
      candidates.push({
        id: `read:${material.id}`, kind: 'READ', title: unit?.title ?? material.title,
        reason: material.material_kind === 'BOOK' ? 'CONTINUE_BOOK' : 'CONTINUE_MATERIAL',
        estimatedMinutes: 25, href: `/study?material=${material.id}${unit ? `&unit=${unit.id}` : ''}`,
        priority: 3, dueAt: material.created_at.toISOString(),
      });
      break;
    }
    return { availableMinutes: availability?.minutes ?? 30, candidates };
  }

  public evidence(ownerId: string, materialId: string) {
    return this.db.learning_evidence.findMany({
      where: { owner_id: ownerId, material_id: materialId },
      include: {
        evidence_contestations: {
          select: { id: true, reason: true, created_at: true },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }
  public async dueReviews(ownerId: string, now: Date): Promise<DueReview[]> {
    const rows = await this.db.review_schedules.findMany({
      where: { owner_id: ownerId, status: 'SCHEDULED', due_at: { lte: now } },
      include: {
        concepts: { select: { name: true } },
        study_materials: { select: { title: true } },
      },
      orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
      take: 50,
    });
    const evidenceIds = rows.flatMap((row) => row.last_evidence_id ? [row.last_evidence_id] : []);
    const lastEvidence = evidenceIds.length
      ? await this.db.learning_evidence.findMany({
          where: { id: { in: evidenceIds }, owner_id: ownerId },
          select: { id: true, status: true, diagnosis: true },
        })
      : [];
    const byId = new Map(lastEvidence.map((row) => [row.id, row]));
    return rows.map((row) => {
      const evidence = row.last_evidence_id ? byId.get(row.last_evidence_id) : undefined;
      return {
        id: row.id,
        materialId: row.material_id,
        materialTitle: row.study_materials.title,
        conceptId: row.concept_id,
        conceptName: row.concepts.name,
        dueAt: row.due_at.toISOString(),
        intervalDays: row.interval_days,
        reviewCount: row.review_count,
        lastStatus: evidence?.status ?? null,
        lastDiagnosis: evidence?.diagnosis ?? null,
      };
    });
  }
  public async decideReviewReminder(ownerId: string, reviewId: string, action: 'POSTPONE' | 'SKIP', now: Date, days?: number) {
    const review = await this.db.review_schedules.findFirst({ where: { id: reviewId, owner_id: ownerId } });
    if (!review) throw new NotFoundError('Revisão');
    if (review.status === 'CANCELLED') return { id: review.id, status: review.status, dueAt: review.due_at.toISOString() };
    if (action === 'POSTPONE' && review.due_at > now) return { id: review.id, status: review.status, dueAt: review.due_at.toISOString() };
    const dueAt = action === 'POSTPONE' ? new Date(now.getTime() + (days ?? 1) * 24 * 60 * 60 * 1000) : review.due_at;
    const updated = await this.db.review_schedules.updateMany({
      where: { id: reviewId, owner_id: ownerId, status: 'SCHEDULED', due_at: review.due_at },
      data: { status: action === 'SKIP' ? 'CANCELLED' : 'SCHEDULED', due_at: dueAt, updated_at: now },
    });
    if (!updated.count) throw new ConflictError('A revisão mudou. Recarregue e tente novamente.');
    return { id: review.id, status: action === 'SKIP' ? 'CANCELLED' : 'SCHEDULED', dueAt: dueAt.toISOString() };
  }
  public async contestEvidence(
    ownerId: string,
    evidenceId: string,
    reason: string,
  ) {
    const event = await this.db.learning_evidence.findFirst({
      where: { id: evidenceId, owner_id: ownerId },
    });
    if (!event) throw new NotFoundError('Evidência');
    return this.db.evidence_contestations.create({
      data: {
        id: randomUUID(),
        owner_id: ownerId,
        evidence_id: evidenceId,
        reason,
      },
    });
  }
  public async evidenceConceptName(ownerId: string, materialId: string, conceptId?: string): Promise<string> {
    const material = await this.ownedMaterial(ownerId, materialId);
    if (!conceptId) return material.title;
    const concept = await this.db.concepts.findFirst({ where: { id: conceptId, material_id: materialId } });
    if (!concept) throw new NotFoundError('Conceito');
    return concept.name;
  }

  public async recordEvidence(
    ownerId: string,
    input: EvidenceInput,
    proposed: EvidenceSuggestion,
  ) {
    const material = await this.ownedMaterial(ownerId, input.materialId);
    if (!material.content.includes(input.sourceExcerpt))
      throw new ConflictError('A evidência não pertence ao material.');
    if (input.sourceOffset !== undefined && material.content.slice(input.sourceOffset, input.sourceOffset + input.sourceExcerpt.length) !== input.sourceExcerpt)
      throw new ConflictError('A posição da evidência não corresponde ao trecho.');
    const concept = input.conceptId
      ? await this.db.concepts.findFirst({
        where: { id: input.conceptId, material_id: material.id },
      }) : null;
    if (input.conceptId && !concept) throw new NotFoundError('Conceito');
    if (
      input.relationId &&
      !(await this.db.concept_relations.findFirst({
        where: { id: input.relationId, material_id: material.id },
      }))
    )
      throw new NotFoundError('Relação');
    if (input.taskId) {
      const task = await this.db.study_tasks.findFirst({
        where: { id: input.taskId, owner_id: ownerId },
      });
      if (
        !task ||
        (task.material_id && task.material_id !== material.id) ||
        (task.concept_id && task.concept_id !== input.conceptId)
      )
        throw new NotFoundError('Tarefa');
    }
    if (input.previousEvidenceId) {
      const previous = await this.db.learning_evidence.findFirst({
        where: {
          id: input.previousEvidenceId,
          owner_id: ownerId,
          material_id: input.materialId,
          activity_type: input.activityType,
          concept_id: input.conceptId ?? null,
          relation_id: input.relationId ?? null,
        },
      });
      if (!previous) throw new NotFoundError('Tentativa anterior');
    }
    const existingReview = input.conceptId
      ? await this.db.review_schedules.findUnique({
          where: {
            owner_id_concept_id_activity_type: {
              owner_id: ownerId,
              concept_id: input.conceptId,
              activity_type: 'RETENTION',
            },
          },
        })
      : null;
    if (
      input.reviewId &&
      (!existingReview ||
        existingReview.id !== input.reviewId ||
        existingReview.material_id !== material.id ||
        existingReview.status !== 'SCHEDULED')
    )
      throw new NotFoundError('Revisão');
    const now = new Date();
    return this.db.$transaction(async (tx) => {
      const previousReview = existingReview
        ? await tx.review_schedules.findUnique({
            where: { id: existingReview.id },
          })
        : null;
      const decision = input.conceptId
        ? decideReview({
            status: input.status,
            activityType: input.activityType,
            assisted: input.assisted,
            solutionRevealed: input.solutionRevealed,
            at: now,
            previous: previousReview
              ? {
                  intervalDays: previousReview.interval_days,
                  reviewCount: previousReview.review_count,
                }
              : null,
          })
        : null;
      const scheduleId = previousReview?.id ?? randomUUID();
      const reviewId = input.reviewId ?? previousReview?.id ?? null;
      const evidenceId = randomUUID();
      let questionVersionId: string | null = null;
      if (input.requestId && concept) {
        const storedQuestion = concept.study_question;
        const objectiveText = storedQuestion && typeof storedQuestion === 'object' && !Array.isArray(storedQuestion) && 'learningObjective' in storedQuestion && typeof storedQuestion.learningObjective === 'string'
          ? storedQuestion.learningObjective.trim() || concept.description : concept.description;
        const objective = await tx.learning_objectives.upsert({
          where: { concept_id: concept.id },
          create: { id: randomUUID(), material_id: material.id, concept_id: concept.id, objective_text: objectiveText, source_excerpt: concept.source_excerpt, source_offset: concept.source_offset, extraction_job_id: concept.extraction_job_id, generator_version: 'objective-v1' },
          update: {},
        });
        const promptVersion = input.promptVersion ?? 'activity-v3';
        const criteria = input.criteria ?? [];
        const contentHash = createHash('sha256').update(JSON.stringify([input.activityType, input.prompt, promptVersion, criteria, input.sourceExcerpt, input.sourceOffset ?? null])).digest('hex');
        const version = await tx.question_versions.upsert({
          where: { objective_id_content_hash: { objective_id: objective.id, content_hash: contentHash } },
          create: { id: randomUUID(), objective_id: objective.id, material_id: material.id, activity_type: input.activityType, prompt: input.prompt, prompt_version: promptVersion, criteria, source_excerpt: input.sourceExcerpt, source_offset: input.sourceOffset ?? null, content_hash: contentHash },
          update: {},
          select: { id: true },
        });
        questionVersionId = version.id;
      }
      const event = await tx.learning_evidence.create({
        data: {
          id: evidenceId,
          owner_id: ownerId,
          material_id: material.id,
          concept_id: input.conceptId ?? null,
          relation_id: input.relationId ?? null,
          task_id: input.taskId ?? null,
          review_id: reviewId,
          question_version_id: questionVersionId,
          activity_type: input.activityType,
          attempt_context: input.attemptContext ?? 'STUDY',
          prompt: input.prompt,
          prompt_version: input.promptVersion ?? 'self-report-v1',
          criteria: input.criteria ?? [],
          hints_used: input.hintsUsed ?? [],
          previous_evidence_id: input.previousEvidenceId ?? null,
          answer: input.answer,
          status: input.status,
          assisted: input.assisted,
          assistance_level: input.assistanceLevel ?? 0,
          solution_revealed: input.solutionRevealed ?? false,
          diagnosis: input.diagnosis,
          strength: input.strength ?? null,
          gap: input.gap ?? null,
          next_action: input.nextAction ?? null,
          evidence_quote: input.evidenceQuote ?? null,
          missing_premises: input.missingPremises ?? [],
          logical_break: input.logicalBreak ?? null,
          source_excerpt: input.sourceExcerpt,
          source_offset: input.sourceOffset ?? null,
          request_id: input.requestId ?? null,
        },
      });
      if (input.conceptId && decision) {
        await tx.review_schedules.upsert({
          where: {
            owner_id_concept_id_activity_type: {
              owner_id: ownerId,
              concept_id: input.conceptId,
              activity_type: 'RETENTION',
            },
          },
          create: {
            id: scheduleId,
            owner_id: ownerId,
            material_id: material.id,
            concept_id: input.conceptId,
            activity_type: 'RETENTION',
            due_at: decision.dueAt,
            interval_days: decision.intervalDays,
            review_count: decision.reviewCount,
            status: 'SCHEDULED',
            last_evidence_id: evidenceId,
          },
          update: {
            due_at: decision.dueAt,
            interval_days: decision.intervalDays,
            review_count: decision.reviewCount,
            status: 'SCHEDULED',
            last_evidence_id: evidenceId,
            updated_at: now,
          },
        });
        if (!previousReview && reviewId === null) {
          await tx.learning_evidence.update({
            where: { id: evidenceId },
            data: { review_id: scheduleId },
          });
        }
      }
      const suggestion = proposed
        ? await tx.study_suggestions.create({
            data: {
              id: randomUUID(),
              owner_id: ownerId,
              evidence_id: event.id,
              concept_id: input.conceptId ?? null,
              title: proposed.title,
              reason: proposed.reason,
            },
          })
        : null;
      if (input.requestId && input.leaseToken) {
        const completed = await tx.activity_requests.updateMany({
          where: {
            owner_id: ownerId,
            request_id: input.requestId,
            lease_token: input.leaseToken,
            status: 'PENDING',
          },
          data: { status: 'DONE', evidence_id: event.id },
        });
        if (!completed.count)
          throw new ConflictError(
            'A tentativa já foi concluída em outra solicitação.',
          );
      }
      return { event, suggestion };
    });
  }
  public async loadActivityContext(ownerId: string, input: Pick<ActivityInput, 'conceptId' | 'relationId' | 'taskId'> & Partial<Pick<ActivityInput, 'previousEvidenceId' | 'activityType'>>): Promise<ActivityContext> {
    let materialId: string;
    let conceptId = input.conceptId;
    let conceptName: string;
    let sourceExcerpt: string;
    let sourceOffset: number | undefined;
    let criteria: string[];
    let studyQuestion: string | undefined;
    let relation: { sourceName: string; targetName: string } | undefined;
    if (input.relationId) {
      const row = await this.db.concept_relations.findFirst({
        where: { id: input.relationId, study_materials: { owner_id: ownerId } },
        include: {
          source: { select: { name: true } },
          target: { select: { name: true } },
        },
      });
      if (!row) throw new NotFoundError('Relação');
      materialId = row.material_id;
      conceptId = row.from_concept_id;
      conceptName = `${row.source.name} → ${row.target.name}`;
      sourceExcerpt = row.source_excerpt;
      sourceOffset = row.source_offset ?? undefined;
      criteria = [row.statement, row.justification];
      relation = { sourceName: row.source.name, targetName: row.target.name };
    } else {
      const row = await this.db.concepts.findFirst({
        where: { id: input.conceptId, study_materials: { owner_id: ownerId } },
      });
      if (!row) throw new NotFoundError('Conceito');
      materialId = row.material_id;
      conceptName = row.name;
      sourceExcerpt = row.source_excerpt;
      sourceOffset = row.source_offset ?? undefined;
      criteria = Array.isArray(row.fundamental_premises)
        ? row.fundamental_premises.filter((item): item is string => typeof item === 'string')
        : [];
      studyQuestion = typeof row.study_question === 'object' &&
        row.study_question !== null && 'text' in row.study_question &&
        typeof row.study_question.text === 'string'
          ? row.study_question.text
          : undefined;
    }
    const material = await this.ownedMaterial(ownerId, materialId);
    if (input.taskId && !(await this.db.study_tasks.findFirst({
      where: { id: input.taskId, owner_id: ownerId, material_id: materialId },
    }))) throw new NotFoundError('Tarefa');
    if (input.previousEvidenceId && !(await this.db.learning_evidence.findFirst({
      where: { id: input.previousEvidenceId, owner_id: ownerId, material_id: materialId, concept_id: conceptId ?? null, relation_id: input.relationId ?? null, activity_type: input.activityType },
      select: { id: true },
    }))) throw new NotFoundError('Tentativa anterior');
    return {
      materialId,
      conceptId,
      conceptName,
      sourceExcerpt,
      sourceOffset,
      criteria,
      studyQuestion,
      relation,
      locale: material.locale === 'en-US' ? 'en-US' : 'pt-BR',
    };
  }

  public async claimActivity(
    ownerId: string,
    requestId: string,
    inputHash: string,
    legacyHash?: string,
  ): Promise<ActivityClaim> {
    const leaseToken = randomUUID();
    const key = { owner_id: ownerId, request_id: requestId };
    const request = await this.db.activity_requests.upsert({
      where: { owner_id_request_id: key },
      create: {
        ...key,
        input_hash: inputHash,
        status: 'PENDING',
        lease_token: leaseToken,
        lease_expires_at: new Date(Date.now() + 10 * 60_000),
      },
      update: {},
    });
    if (request.input_hash !== inputHash && request.input_hash !== legacyHash)
      throw new ConflictError('Identificador de tentativa reutilizado para outra resposta.');
    if (request.status === 'DONE' && request.evidence_id) {
      const event = await this.db.learning_evidence.findFirst({
        where: { id: request.evidence_id, owner_id: ownerId },
      });
      if (event) return {
        kind: 'REPLAY',
        outcome: {
          event,
          suggestion: await this.db.study_suggestions.findFirst({
            where: { owner_id: ownerId, evidence_id: event.id },
          }),
        },
      };
    }
    let token = leaseToken;
    if (request.lease_token !== leaseToken) {
      const newToken = randomUUID();
      const claimed = await this.db.activity_requests.updateMany({
        where: {
          ...key,
          status: 'PENDING',
          lease_token: request.lease_token,
          lease_expires_at: { lt: new Date() },
        },
        data: {
          lease_token: newToken,
          lease_expires_at: new Date(Date.now() + 10 * 60_000),
        },
      });
      if (!claimed.count)
        throw new ConflictError('Esta tentativa está sendo avaliada em outra aba.');
      token = newToken;
    }
    return { kind: 'CLAIMED', leaseToken: token };
  }

  public async releaseActivity(ownerId: string, requestId: string, leaseToken: string): Promise<void> {
    await this.db.activity_requests.deleteMany({
      where: { owner_id: ownerId, request_id: requestId, status: 'PENDING', lease_token: leaseToken },
    });
  }

  public suggestions(ownerId: string) {
    return this.db.study_suggestions.findMany({
      where: { owner_id: ownerId },
      include: {
        learning_evidence: {
          select: {
            id: true,
            material_id: true,
            prompt: true,
            diagnosis: true,
            source_excerpt: true,
            source_offset: true,
            activity_type: true,
            status: true,
            created_at: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }
  public async requestRevisit(ownerId: string, evidenceId: string) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM learning_evidence WHERE id=${evidenceId}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundError('Evidência');
      const evidence = await tx.learning_evidence.findUniqueOrThrow({
        where: { id: evidenceId }, include: { study_materials: { select: { locale: true } } },
      });
      const existing = await tx.study_suggestions.findUnique({
        where: { owner_id_evidence_id: { owner_id: ownerId, evidence_id: evidenceId } },
      });
      if (existing) {
        if (existing.status === 'IGNORED') return tx.study_suggestions.update({
          where: { id: existing.id }, data: { status: 'PENDING' },
        });
        return existing;
      }
      const concept = evidence.concept_id
        ? await tx.concepts.findUnique({ where: { id: evidence.concept_id }, select: { name: true } })
        : null;
      return tx.study_suggestions.create({
        data: {
          id: randomUUID(), owner_id: ownerId, evidence_id: evidenceId,
          concept_id: evidence.concept_id,
          title: evidence.study_materials.locale === 'en-US'
            ? `Revisit ${concept?.name ?? 'material'}`
            : `Retomar ${concept?.name ?? 'material'}`,
          reason: evidence.study_materials.locale === 'en-US'
            ? 'You requested a revisit of this attempt and its source.'
            : 'Retomada solicitada por você para revisitar esta tentativa e sua fonte.',
        },
      });
    });
  }
  public async decideSuggestion(
    ownerId: string,
    id: string,
    input: SuggestionDecision,
  ) {
    return this.db.$transaction(async (tx) => {
      const suggestion = await tx.study_suggestions.findFirst({
        where: { id, owner_id: ownerId },
        include: { learning_evidence: true },
      });
      if (!suggestion) throw new NotFoundError('Sugestão');
      if (suggestion.status !== 'PENDING') return suggestion;
      if (input.planId) {
        const owned = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM study_plans WHERE id=${input.planId}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE
        `;
        if (!owned.length) throw new NotFoundError('Roteiro');
      }
      const claimed = await tx.study_suggestions.updateMany({
        where: { id, owner_id: ownerId, status: 'PENDING' },
        data: { status: input.decision },
      });
      if (!claimed.count)
        return tx.study_suggestions.findUniqueOrThrow({ where: { id } });
      if (input.decision === 'IGNORED')
        return tx.study_suggestions.findUniqueOrThrow({ where: { id } });
      const task = await tx.study_tasks.create({
        data: {
          id: randomUUID(),
          owner_id: ownerId,
          material_id: suggestion.learning_evidence.material_id,
          concept_id: suggestion.concept_id,
          review_id: suggestion.learning_evidence.review_id,
          title: input.title ?? suggestion.title,
          plan_id: input.planId ?? null,
          duration_minutes: input.durationMinutes ?? null,
          scheduled_at: input.scheduledAt ?? null,
          activity_type: 'REVISIT',
          reason: suggestion.reason,
        },
      });
      return tx.study_suggestions.update({
        where: { id },
        data: { task_id: task.id },
      });
    });
  }
}
