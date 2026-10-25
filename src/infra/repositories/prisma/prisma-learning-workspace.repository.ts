import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client';
import { deriveEditorialUnits } from '../../parsers/editorial-structure';
import {
  scheduledLoad,
  type EvidenceActivity,
  type EvidenceStatus,
  type TaskActivity,
} from '../../../application/domain/learning-cycle';
import { ConflictError, NotFoundError } from '../../../application/errors';
import type { ActivityContext, ActivityClaim, EvidenceSuggestion } from '../../../application/repositories/learning-workspace.repository';
import type { ActivityInput } from '../../../application/contracts/learning-workspace.service';
import type { SuggestionDecision } from '../../../application/contracts/learning-workspace.service';

export class PrismaLearningWorkspaceRepository {
  public constructor(private readonly db: PrismaClient) {}

  private async ownedMaterial(ownerId: string, id: string) {
    const material = await this.db.study_materials.findFirst({
      where: { id, owner_id: ownerId },
    });
    if (!material) throw new NotFoundError('Material');
    return material;
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
      level: row.level,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      provenance: row.provenance,
      pageNumber: row.page_number,
    }));
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
    input: {
      title: string;
      activityType: TaskActivity;
      planId?: string;
      materialId?: string;
      conceptId?: string;
      unitId?: string;
      durationMinutes?: number;
      scheduledAt?: Date;
      reason?: string;
    },
  ) {
    if (input.materialId) await this.ownedMaterial(ownerId, input.materialId);
    let effectiveMaterialId = input.materialId;
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
    const data = {
      id: randomUUID(),
      owner_id: ownerId,
      title: input.title,
      activity_type: input.activityType,
      plan_id: input.planId ?? null,
      material_id: effectiveMaterialId ?? null,
      concept_id: input.conceptId ?? null,
      unit_id: input.unitId ?? null,
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
    input: {
      title?: string;
      materialId?: string | null;
      conceptId?: string | null;
      durationMinutes?: number | null;
      scheduledAt?: Date | null;
      status?: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'REMOVED';
    },
  ) {
    let effectiveMaterialId = input.materialId;
    if (input.materialId !== undefined || input.conceptId !== undefined) {
      const current = await this.db.study_tasks.findFirst({ where: { id, owner_id: ownerId } });
      if (!current) throw new NotFoundError('Tarefa');
      const materialId = input.materialId !== undefined ? input.materialId : current.material_id;
      const conceptId = input.conceptId !== undefined ? input.conceptId : current.concept_id;
      if (materialId) await this.ownedMaterial(ownerId, materialId);
      if (conceptId) {
        const concept = await this.db.concepts.findFirst({ where: { id: conceptId, study_materials: { owner_id: ownerId } } });
        if (!concept || (materialId && concept.material_id !== materialId)) throw new NotFoundError('Conceito');
        if (!materialId) effectiveMaterialId = concept.material_id;
      }
    }
    const changed = await this.db.study_tasks.updateMany({
      where: { id, owner_id: ownerId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(effectiveMaterialId !== undefined ? { material_id: effectiveMaterialId } : {}),
        ...(input.conceptId !== undefined ? { concept_id: input.conceptId } : {}),
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
    return this.db.study_tasks.findUniqueOrThrow({ where: { id } });
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
    input: {
      materialId: string;
      conceptId?: string;
      relationId?: string;
      taskId?: string;
      activityType: EvidenceActivity;
      prompt: string;
      answer: string;
      status: EvidenceStatus;
      assisted: boolean;
      hintsUsed?: string[];
      previousEvidenceId?: string;
      promptVersion?: string;
      criteria?: string[];
      diagnosis: string;
      sourceExcerpt: string;
      sourceOffset?: number;
      requestId?: string;
      leaseToken?: string;
    },
    proposed: EvidenceSuggestion,
  ) {
    const material = await this.ownedMaterial(ownerId, input.materialId);
    if (!material.content.includes(input.sourceExcerpt))
      throw new ConflictError('A evidência não pertence ao material.');
    if (input.sourceOffset !== undefined && material.content.slice(input.sourceOffset, input.sourceOffset + input.sourceExcerpt.length) !== input.sourceExcerpt)
      throw new ConflictError('A posição da evidência não corresponde ao trecho.');
    if (input.conceptId) {
      const concept = await this.db.concepts.findFirst({
        where: { id: input.conceptId, material_id: material.id },
      });
      if (!concept) throw new NotFoundError('Conceito');
    }
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
    return this.db.$transaction(async (tx) => {
      const event = await tx.learning_evidence.create({
        data: {
          id: randomUUID(),
          owner_id: ownerId,
          material_id: material.id,
          concept_id: input.conceptId ?? null,
          relation_id: input.relationId ?? null,
          task_id: input.taskId ?? null,
          activity_type: input.activityType,
          prompt: input.prompt,
          prompt_version: input.promptVersion ?? 'self-report-v1',
          criteria: input.criteria ?? [],
          hints_used: input.hintsUsed ?? [],
          previous_evidence_id: input.previousEvidenceId ?? null,
          answer: input.answer,
          status: input.status,
          assisted: input.assisted,
          diagnosis: input.diagnosis,
          source_excerpt: input.sourceExcerpt,
          source_offset: input.sourceOffset ?? null,
          request_id: input.requestId ?? null,
        },
      });
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
  public async loadActivityContext(ownerId: string, input: ActivityInput): Promise<ActivityContext> {
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
