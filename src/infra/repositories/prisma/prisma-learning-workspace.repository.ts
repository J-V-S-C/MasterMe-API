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

  public async relations(ownerId: string, materialId: string) {
    await this.ownedMaterial(ownerId, materialId);
    return this.db.concept_relations.findMany({
      where: { material_id: materialId },
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
    },
  ) {
    const material = await this.ownedMaterial(ownerId, input.materialId);
    if (!material.content.includes(input.sourceExcerpt))
      throw new ConflictError('O trecho da relação não pertence ao material.');
    const concepts = await this.db.concepts.findMany({
      where: {
        id: { in: [input.fromConceptId, input.toConceptId] },
        material_id: material.id,
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
        from_concept_id: input.fromConceptId,
        to_concept_id: input.toConceptId,
        relation_type: input.relationType,
        statement: input.statement,
        justification: input.justification,
        source_excerpt: input.sourceExcerpt,
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
  public plans(ownerId: string) {
    return this.db.study_plans.findMany({
      where: { owner_id: ownerId },
      orderBy: { created_at: 'desc' },
    });
  }
  public async createPlan(
    ownerId: string,
    input: { title: string; goalId?: string },
  ) {
    if (
      input.goalId &&
      !(await this.db.learning_goals.findFirst({
        where: { id: input.goalId, owner_id: ownerId },
      }))
    )
      throw new NotFoundError('Objetivo');
    return this.db.study_plans.create({
      data: {
        id: randomUUID(),
        owner_id: ownerId,
        title: input.title,
        goal_id: input.goalId ?? null,
      },
    });
  }
  public tasks(ownerId: string) {
    return this.db.study_tasks.findMany({
      where: { owner_id: ownerId },
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
    if (
      input.planId &&
      !(await this.db.study_plans.findFirst({
        where: { id: input.planId, owner_id: ownerId },
      }))
    )
      throw new NotFoundError('Roteiro');
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
    return this.db.study_tasks.create({
      data: {
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
      },
    });
  }
  public async updateTask(
    ownerId: string,
    id: string,
    input: {
      title?: string;
      durationMinutes?: number | null;
      scheduledAt?: Date | null;
      status?: 'PENDING' | 'DONE' | 'REMOVED';
    },
  ) {
    const changed = await this.db.study_tasks.updateMany({
      where: { id, owner_id: ownerId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
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
          status: task.status as 'PENDING' | 'DONE' | 'REMOVED',
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
      diagnosis: string;
      sourceExcerpt: string;
      requestId?: string;
      leaseToken?: string;
    },
    proposed: EvidenceSuggestion,
  ) {
    const material = await this.ownedMaterial(ownerId, input.materialId);
    if (!material.content.includes(input.sourceExcerpt))
      throw new ConflictError('A evidência não pertence ao material.');
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
          answer: input.answer,
          status: input.status,
          assisted: input.assisted,
          diagnosis: input.diagnosis,
          source_excerpt: input.sourceExcerpt,
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
            material_id: true,
            source_excerpt: true,
            activity_type: true,
            status: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }
  public async decideSuggestion(
    ownerId: string,
    id: string,
    decision: 'ACCEPTED' | 'IGNORED',
  ) {
    return this.db.$transaction(async (tx) => {
      const suggestion = await tx.study_suggestions.findFirst({
        where: { id, owner_id: ownerId },
        include: { learning_evidence: true },
      });
      if (!suggestion) throw new NotFoundError('Sugestão');
      if (suggestion.status !== 'PENDING') return suggestion;
      const claimed = await tx.study_suggestions.updateMany({
        where: { id, owner_id: ownerId, status: 'PENDING' },
        data: { status: decision },
      });
      if (!claimed.count)
        return tx.study_suggestions.findUniqueOrThrow({ where: { id } });
      if (decision === 'IGNORED')
        return tx.study_suggestions.findUniqueOrThrow({ where: { id } });
      const task = await tx.study_tasks.create({
        data: {
          id: randomUUID(),
          owner_id: ownerId,
          material_id: suggestion.learning_evidence.material_id,
          concept_id: suggestion.concept_id,
          title: suggestion.title,
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
