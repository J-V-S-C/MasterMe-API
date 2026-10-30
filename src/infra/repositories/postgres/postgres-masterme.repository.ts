import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import type { Concept, ConceptConfidence, ConceptRelation } from '../../../application/domain/concept';
import type { AnswerAssistance, Evaluation, IsomorphicProblem, StudySession } from '../../../application/domain/assessment';
import type { EvidenceActivity, EvidenceStatus } from '../../../application/domain/learning-cycle';
import { decideReview } from '../../../application/domain/review-policy';
import type { MaterialKind, MaterialOutlineUnit, MaterialSummary, StudyMaterial, SupportedLocale } from '../../../application/domain/material';
import type { PracticeProject } from '../../../application/domain/practice-project';
import {
  ConceptConfidenceSchema,
  ConceptSchema,
  EvaluationSchema,
  IsomorphicProblemSchema,
  MaterialSchema,
  MaterialSummarySchema,
  PracticeProjectSchema,
  StudySessionSchema,
} from '../../../schemas/masterme.schema';
import type { AiUsageEvent } from '../../../application/ports/llm.gateway';
import type {
  AiUsageSummary,
  MasterMeRepository,
} from '../../../application/repositories/masterme.repository';
import { ConflictError } from '../../../application/errors';
import { QuestionBundleSchema, type QuestionBundle } from '../../../schemas/llm.schema';

const DatabaseDateSchema = z.coerce.date();

export class PostgresMasterMeRepository implements MasterMeRepository {
  public constructor(private readonly pool: Pool) {}

  public async conceptBelongsToOwner(conceptId: string, ownerId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM concepts c JOIN study_materials m ON m.id=c.material_id WHERE c.id=$1 AND m.owner_id=$2',
      [conceptId, ownerId],
    );
    return Boolean(result.rows[0]);
  }

  public async findQuestionBundle(inputHash: string): Promise<QuestionBundle | undefined> {
    const result = await this.pool.query(
      "SELECT payload FROM generated_artifacts WHERE kind='QUESTION_BUNDLE' AND input_hash=$1",
      [inputHash],
    );
    return result.rows[0] ? QuestionBundleSchema.parse(result.rows[0].payload) : undefined;
  }

  public async saveQuestionBundle(materialId: string, inputHash: string, bundle: QuestionBundle): Promise<void> {
    await this.pool.query(
      "INSERT INTO generated_artifacts (material_id,kind,input_hash,payload) VALUES ($1,'QUESTION_BUNDLE',$2,$3) ON CONFLICT (kind,input_hash) DO NOTHING",
      [materialId, inputHash, JSON.stringify(bundle)],
    );
  }

  public async saveMaterial(
    material: StudyMaterial,
    ownerId: string,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO study_materials (id, title, content, locale, created_at, owner_id, material_kind) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        material.id,
        material.title,
        material.content,
        material.locale,
        material.createdAt,
        ownerId,
        material.materialKind ?? 'TEXT',
      ],
    );
  }

  public async findMaterial(id: string): Promise<StudyMaterial | undefined> {
    const result = await this.pool.query(
      'SELECT id, title, content, locale, created_at, source_type, material_kind FROM study_materials WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return MaterialSchema.parse({
      id: row.id,
      title: row.title,
      content: row.content,
      locale: row.locale,
      createdAt: DatabaseDateSchema.parse(row.created_at).toISOString(),
      sourceType: row.source_type,
      ...(row.material_kind ? { materialKind: row.material_kind } : {}),
    });
  }

  public async findMaterialOutline(id: string): Promise<MaterialOutlineUnit[]> {
    const result = await this.pool.query(
      'SELECT ordinal,title,level,start_offset,end_offset,provenance,page_number FROM material_units WHERE material_id=$1 ORDER BY ordinal',
      [id],
    );
    return result.rows.map((row) => ({
      order: row.ordinal,
      title: row.title,
      level: row.level,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      provenance: row.provenance,
      pageNumber: row.page_number ?? undefined,
    }));
  }

  public async findAllMaterials(ownerId: string): Promise<MaterialSummary[]> {
    const result = await this.pool.query(
      'SELECT id, title, locale, created_at, source_type, material_kind FROM study_materials WHERE owner_id=$1 ORDER BY created_at ASC, id ASC',
      [ownerId],
    );
    return result.rows.map((row) =>
      MaterialSummarySchema.parse({
        id: row.id,
        title: row.title,
        locale: row.locale,
        createdAt: DatabaseDateSchema.parse(row.created_at).toISOString(),
        sourceType: row.source_type,
        ...(row.material_kind ? { materialKind: row.material_kind } : {}),
      }),
    );
  }

  public async updateMaterialKind(id: string, ownerId: string, kind: MaterialKind): Promise<StudyMaterial | undefined> {
    const owned = await this.pool.query('SELECT 1 FROM study_materials WHERE id=$1 AND owner_id=$2', [id, ownerId]);
    if (!owned.rows[0]) return undefined;
    const result = await this.pool.query(
      "UPDATE study_materials SET material_kind=$3 WHERE id=$1 AND owner_id=$2 AND NOT EXISTS(SELECT 1 FROM processing_jobs WHERE material_id=$1 AND status='PROCESSING') RETURNING id",
      [id, ownerId, kind],
    );
    if (!result.rows.length) throw new ConflictError('Cancele a extração em andamento antes de alterar o tipo do material.');
    return this.findMaterial(id);
  }

  public async saveConcepts(
    concepts: Concept[],
    relations: ConceptRelation[] = [],
    processingJobId?: string,
    unitId?: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (processingJobId) {
        const job = await client.query<{ material_id: string; status: string }>(
          'SELECT material_id,status FROM processing_jobs WHERE id=$1 FOR UPDATE',
          [processingJobId],
        );
        if (job.rows[0]?.status !== 'PROCESSING' || job.rows[0].material_id !== concepts[0]?.materialId)
          throw new ConflictError('A extração foi cancelada.');
        if (unitId) {
          const unit = await client.query('SELECT 1 FROM material_units WHERE id=$1 AND material_id=$2', [unitId, concepts[0]!.materialId]);
          if (!unit.rows[0]) throw new ConflictError('O capítulo não pertence ao material.');
          const completed = await client.query('SELECT 1 FROM processing_job_units WHERE job_id=$1 AND unit_id=$2', [processingJobId, unitId]);
          if (completed.rows[0]) { await client.query('COMMIT'); return; }
        }
      }
      for (const concept of concepts) {
        await client.query(
          'INSERT INTO concepts (id, material_id, name, description, kind, source_excerpt, fundamental_premises, edge_cases, study_question, edge_case_question, generated_locale, prerequisite_ids, next_ids, extraction_job_id, source_offset) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [
            concept.id,
            concept.materialId,
            concept.name,
            concept.description,
            concept.kind,
            concept.sourceExcerpt,
            JSON.stringify(concept.fundamentalPremises),
            JSON.stringify(concept.edgeCases),
            JSON.stringify(concept.studyQuestion ?? null),
            concept.edgeCaseQuestion ?? null,
            concept.generatedLocale,
            JSON.stringify(concept.prerequisiteIds),
            JSON.stringify(concept.nextIds),
            processingJobId ?? null,
            concept.sourceOffset ?? null,
          ],
        );
        await client.query(
          'INSERT INTO learning_objectives(id,material_id,concept_id,objective_text,source_excerpt,source_offset,extraction_job_id,generator_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [randomUUID(), concept.materialId, concept.id, concept.studyQuestion?.learningObjective?.trim() || concept.description, concept.sourceExcerpt, concept.sourceOffset ?? null, processingJobId ?? null, 'objective-v1'],
        );
      }
      for (const relation of relations) {
        await client.query(
          'INSERT INTO concept_relations (id,material_id,from_concept_id,to_concept_id,relation_type,statement,justification,source_excerpt,provenance,extraction_job_id,source_offset) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            relation.id,
            relation.materialId,
            relation.fromConceptId,
            relation.toConceptId,
            relation.relationType,
            relation.statement,
            relation.justification,
            relation.sourceExcerpt,
            relation.provenance,
            processingJobId ?? null,
            relation.sourceOffset ?? null,
          ],
        );
      }
      if (processingJobId && unitId) {
        await client.query('INSERT INTO processing_job_units(job_id,unit_id) VALUES ($1,$2)', [processingJobId, unitId]);
      } else if (processingJobId) {
        await client.query(
          "UPDATE processing_jobs SET status='DONE',stage='READY',progress_percent=100,finished_at=now(),updated_at=now() WHERE id=$1",
          [processingJobId],
        );
        await client.query(
          "UPDATE study_materials SET active_extraction_job_id=$2,processing_status='READY',processed_at=now(),processing_error=NULL WHERE id=$1",
          [concepts[0]!.materialId, processingJobId],
        );
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async saveConceptLocalizations(
    materialId: string,
    locale: SupportedLocale,
    concepts: Concept[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const concept of concepts) {
        await client.query(
          'UPDATE concepts SET name=$1,description=$2,fundamental_premises=$3,edge_cases=$4,study_question=$5,edge_case_question=$6,generated_locale=$7 WHERE id=$8 AND material_id=$9',
          [
            concept.name,
            concept.description,
            JSON.stringify(concept.fundamentalPremises),
            JSON.stringify(concept.edgeCases),
            JSON.stringify(concept.studyQuestion ?? null),
            concept.edgeCaseQuestion ?? null,
            locale,
            concept.id,
            materialId,
          ],
        );
      }
      await client.query('UPDATE study_materials SET locale=$1 WHERE id=$2', [
        locale,
        materialId,
      ]);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async findConcept(id: string): Promise<Concept | undefined> {
    const result = await this.pool.query('SELECT * FROM concepts WHERE id=$1', [
      id,
    ]);
    return this.toConcept(result.rows[0]);
  }
  public async findConceptsByMaterial(materialId: string): Promise<Concept[]> {
    const result = await this.pool.query(
      'SELECT c.* FROM concepts c JOIN study_materials m ON m.id=c.material_id WHERE c.material_id=$1 AND c.extraction_job_id IS NOT DISTINCT FROM m.active_extraction_job_id ORDER BY c.source_offset NULLS LAST,c.name',
      [materialId],
    );
    return result.rows.flatMap((row) => {
      const concept = this.toConcept(row);
      return concept ? [concept] : [];
    });
  }
  public async findAllConceptsByMaterial(materialId: string): Promise<Concept[]> {
    const result = await this.pool.query('SELECT * FROM concepts WHERE material_id=$1 ORDER BY source_offset NULLS LAST,name', [materialId]);
    return result.rows.flatMap((row) => {
      const concept = this.toConcept(row);
      return concept ? [concept] : [];
    });
  }
  public async findRecentLearningGaps(conceptIds: string[]): Promise<Array<{ conceptId: string; activityType: string; diagnosis: string; createdAt: string }>> {
    if (!conceptIds.length) return [];
    const result = await this.pool.query(
      `SELECT concept_id,activity_type,diagnosis,created_at FROM (
         SELECT DISTINCT ON (concept_id,activity_type) concept_id,activity_type,diagnosis,created_at,status,id
         FROM learning_evidence WHERE concept_id=ANY($1::uuid[]) AND status IN ('PASSED','INCOMPLETE','LOGICAL_BREAK','CONTESTED')
         ORDER BY concept_id,activity_type,created_at DESC,id DESC
       ) latest WHERE status IN ('INCOMPLETE','LOGICAL_BREAK')
         AND NOT EXISTS (SELECT 1 FROM evidence_contestations WHERE evidence_id=latest.id)
       ORDER BY created_at DESC LIMIT 500`,
      [conceptIds],
    );
    return result.rows.map((row) => ({ conceptId: row.concept_id, activityType: row.activity_type, diagnosis: row.diagnosis, createdAt: DatabaseDateSchema.parse(row.created_at).toISOString() }));
  }
  public async scheduleReview(input: {
    conceptId: string;
    activityType: EvidenceActivity;
    status: EvidenceStatus;
    assistance: AnswerAssistance;
    at: Date;
  }): Promise<void> {
    const concept = await this.pool.query(
      `SELECT c.material_id, m.owner_id, rs.interval_days, rs.review_count
         FROM concepts c
         JOIN study_materials m ON m.id=c.material_id
         LEFT JOIN review_schedules rs
           ON rs.owner_id=m.owner_id AND rs.concept_id=c.id AND rs.activity_type='RETENTION'
        WHERE c.id=$1`,
      [input.conceptId],
    );
    const row = concept.rows[0];
    if (!row) return;
    const decision = decideReview({
      status: input.status,
      activityType: input.activityType,
      assisted: input.assistance.assisted,
      solutionRevealed: input.assistance.solutionRevealed,
      at: input.at,
      previous: row.interval_days === null || row.interval_days === undefined
        ? null
        : {
            intervalDays: Number(row.interval_days),
            reviewCount: Number(row.review_count ?? 0),
          },
    });
    if (!decision) return;
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO review_schedules
         (id,owner_id,material_id,concept_id,activity_type,due_at,interval_days,review_count,status,updated_at)
       VALUES ($1,$2,$3,$4,'RETENTION',$5,$6,$7,'SCHEDULED',now())
       ON CONFLICT (owner_id,concept_id,activity_type) DO UPDATE SET
         due_at=EXCLUDED.due_at,
         interval_days=EXCLUDED.interval_days,
         review_count=EXCLUDED.review_count,
         status='SCHEDULED',
         updated_at=now()`,
      [id, row.owner_id, row.material_id, input.conceptId, decision.dueAt, decision.intervalDays, decision.reviewCount],
    );
  }
  public async saveSession(session: StudySession): Promise<void> {
    await this.pool.query(
      'INSERT INTO study_sessions (id,concept_id,version,state,question,stress_test,edge_case_status,edge_case_challenge,attempts,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        session.id,
        session.conceptId,
        session.version,
        session.state,
        JSON.stringify(session.question),
        null,
        session.edgeCaseStatus,
        JSON.stringify(session.edgeCaseChallenge),
        JSON.stringify(session.attempts),
        session.createdAt,
        session.updatedAt,
      ],
    );
  }
  public async findSession(id: string): Promise<StudySession | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM study_sessions WHERE id=$1',
      [id],
    );
    return this.toSession(result.rows[0]);
  }
  public async findSessionsByConceptIds(
    conceptIds: string[],
  ): Promise<StudySession[]> {
    if (conceptIds.length === 0) return [];
    const result = await this.pool.query(
      'SELECT * FROM study_sessions WHERE concept_id = ANY($1::uuid[])',
      [conceptIds],
    );
    return result.rows.flatMap((row) => {
      const session = this.toSession(row);
      return session ? [session] : [];
    });
  }
  public async claimSessionOperation(
    id: string,
    expectedVersion: number,
    operationHash: string,
    leaseToken: string,
  ): Promise<number | undefined> {
    const result = await this.pool.query(
      `UPDATE study_sessions SET pending_operation_hash=$3,pending_operation_token=$4,pending_operation_started_at=now()
       WHERE id=$1 AND version=$2
         AND (pending_operation_hash IS NULL OR pending_operation_started_at < now() - interval '10 minutes')
       RETURNING version`,
      [id, expectedVersion, operationHash, leaseToken],
    );
    return result.rows[0] ? Number(result.rows[0].version) : undefined;
  }
  public async renewSessionOperation(
    id: string,
    claimedVersion: number,
    leaseToken: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE study_sessions SET pending_operation_started_at=now()
       WHERE id=$1 AND version=$2 AND pending_operation_token=$3::uuid RETURNING id`,
      [id, claimedVersion, leaseToken],
    );
    return result.rowCount === 1;
  }
  public async completeSessionOperation(
    session: StudySession,
    claimedVersion: number,
    leaseToken: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE study_sessions SET state=$1,edge_case_status=$2,edge_case_challenge=$3,attempts=$4,updated_at=$5,
       version=$6,pending_operation_hash=NULL,pending_operation_token=NULL,pending_operation_started_at=NULL
       WHERE id=$7 AND version=$8 AND pending_operation_token=$9::uuid`,
      [
        session.state,
        session.edgeCaseStatus,
        JSON.stringify(session.edgeCaseChallenge),
        JSON.stringify(session.attempts),
        session.updatedAt,
        session.version,
        session.id,
        claimedVersion,
        leaseToken,
      ],
    );
    return result.rowCount === 1;
  }
  public async releaseSessionOperation(
    id: string,
    claimedVersion: number,
    leaseToken: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE study_sessions SET pending_operation_hash=NULL,pending_operation_token=NULL,pending_operation_started_at=NULL
       WHERE id=$1 AND version=$2 AND pending_operation_token=$3::uuid`,
      [id, claimedVersion, leaseToken],
    );
  }
  public async findValidatedConceptIds(): Promise<Set<string>> {
    const result = await this.pool.query(
      "SELECT DISTINCT concept_id FROM study_sessions WHERE state = 'EXPLANATION_PASSED'",
    );
    return new Set(
      result.rows.map((row) => z.string().uuid().parse(row.concept_id)),
    );
  }
  public async saveConfidence(confidence: ConceptConfidence): Promise<void> {
    await this.pool.query(
      'INSERT INTO concept_confidences (concept_id,value) VALUES ($1,$2) ON CONFLICT (concept_id) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
      [confidence.conceptId, confidence.value],
    );
  }
  public async deleteConfidence(conceptId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM concept_confidences WHERE concept_id=$1',
      [conceptId],
    );
  }
  public async findConfidencesByConceptIds(
    conceptIds: string[],
  ): Promise<ConceptConfidence[]> {
    if (!conceptIds.length) return [];
    const result = await this.pool.query(
      'SELECT concept_id,value,created_at,updated_at FROM concept_confidences WHERE concept_id = ANY($1::uuid[])',
      [conceptIds],
    );
    return result.rows.map((row) =>
      ConceptConfidenceSchema.parse({
        conceptId: row.concept_id,
        value: row.value,
        createdAt: DatabaseDateSchema.parse(row.created_at).toISOString(),
        updatedAt: DatabaseDateSchema.parse(row.updated_at).toISOString(),
      }),
    );
  }
  public async findPracticeProjectByHash(
    inputHash: string,
  ): Promise<PracticeProject | undefined> {
    const result = await this.pool.query(
      'SELECT payload FROM practice_projects WHERE input_hash=$1',
      [inputHash],
    );
    return result.rows[0]
      ? PracticeProjectSchema.parse(result.rows[0].payload)
      : undefined;
  }
  public async findPracticeProject(
    id: string,
  ): Promise<PracticeProject | undefined> {
    const result = await this.pool.query(
      'SELECT payload FROM practice_projects WHERE id=$1',
      [id],
    );
    return result.rows[0]
      ? PracticeProjectSchema.parse(result.rows[0].payload)
      : undefined;
  }
  public async findPracticeProjectsByMaterial(
    materialId: string,
  ): Promise<PracticeProject[]> {
    const result = await this.pool.query(
      'SELECT payload FROM practice_projects WHERE material_id=$1 ORDER BY created_at DESC,id DESC',
      [materialId],
    );
    return result.rows.map((row) => PracticeProjectSchema.parse(row.payload));
  }
  public async savePracticeProject(
    project: PracticeProject,
    inputHash: string,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO practice_projects (id,material_id,input_hash,focus_mode,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (input_hash) DO NOTHING',
      [
        project.id,
        project.materialId,
        inputHash,
        project.focusMode,
        JSON.stringify(project),
        project.createdAt,
      ],
    );
  }
  public async findEvaluation(
    requestHash: string,
  ): Promise<Evaluation | undefined> {
    const result = await this.pool.query(
      'SELECT evaluation FROM ai_evaluation_cache WHERE request_hash=$1',
      [requestHash],
    );
    return result.rows[0]
      ? EvaluationSchema.parse(result.rows[0].evaluation)
      : undefined;
  }
  public async saveEvaluation(
    requestHash: string,
    evaluation: Evaluation,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO ai_evaluation_cache (request_hash,evaluation) VALUES ($1,$2) ON CONFLICT (request_hash) DO NOTHING',
      [requestHash, JSON.stringify(evaluation)],
    );
  }
  public async findIsomorphicProblem(
    inputHash: string,
  ): Promise<IsomorphicProblem | undefined> {
    const result = await this.pool.query(
      "SELECT payload FROM generated_artifacts WHERE kind='ISOMORPHIC_PROBLEM' AND input_hash=$1",
      [inputHash],
    );
    return result.rows[0]
      ? IsomorphicProblemSchema.parse(result.rows[0].payload)
      : undefined;
  }
  public async saveIsomorphicProblem(
    materialId: string,
    inputHash: string,
    problem: IsomorphicProblem,
  ): Promise<void> {
    await this.pool.query(
      "INSERT INTO generated_artifacts (material_id,kind,input_hash,payload) VALUES ($1,'ISOMORPHIC_PROBLEM',$2,$3) ON CONFLICT (kind,input_hash) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()",
      [materialId, inputHash, JSON.stringify(problem)],
    );
  }
  public async consumeAiRequest(
    ownerId: string,
    dailyLimit: number,
  ): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO ai_daily_quotas (owner_id,usage_date,requests) VALUES ($1,CURRENT_DATE,1)
       ON CONFLICT (owner_id,usage_date) DO UPDATE SET requests=ai_daily_quotas.requests+1
       WHERE ai_daily_quotas.requests < $2 RETURNING requests`,
      [ownerId, dailyLimit],
    );
    if (result.rows[0]) return Number(result.rows[0].requests);
    const current = await this.pool.query(
      'SELECT requests FROM ai_daily_quotas WHERE owner_id=$1 AND usage_date=CURRENT_DATE',
      [ownerId],
    );
    return Math.max(
      dailyLimit + 1,
      Number(current.rows[0]?.requests ?? dailyLimit) + 1,
    );
  }
  public async recordAiUsage(
    event: AiUsageEvent,
    ownerId: string,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO ai_usage_events (operation,model,success,input_tokens,output_tokens,error_code,owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        event.operation,
        event.model,
        event.success,
        event.inputTokens,
        event.outputTokens,
        event.errorCode,
        ownerId,
      ],
    );
  }
  public async getAiUsageToday(
    ownerId: string,
    dailyLimit: number,
  ): Promise<AiUsageSummary> {
    const [total, models, operations, quota] = await Promise.all([
      this.pool.query(
        "SELECT count(*)::int AS requests,coalesce(sum(input_tokens),0)::int AS input_tokens,coalesce(sum(output_tokens),0)::int AS output_tokens FROM ai_usage_events WHERE owner_id=$1 AND created_at >= date_trunc('day',now())",
        [ownerId],
      ),
      this.pool.query(
        "SELECT model,count(*)::int AS requests,count(*) FILTER (WHERE success)::int AS successes,coalesce(sum(input_tokens),0)::int AS input_tokens,coalesce(sum(output_tokens),0)::int AS output_tokens FROM ai_usage_events WHERE owner_id=$1 AND created_at >= date_trunc('day',now()) GROUP BY model ORDER BY model",
        [ownerId],
      ),
      this.pool.query(
        "SELECT operation,count(*)::int AS requests,count(*) FILTER (WHERE success)::int AS successes,coalesce(sum(input_tokens),0)::int AS input_tokens,coalesce(sum(output_tokens),0)::int AS output_tokens FROM ai_usage_events WHERE owner_id=$1 AND created_at >= date_trunc('day',now()) GROUP BY operation ORDER BY operation",
        [ownerId],
      ),
      this.pool.query(
        "SELECT coalesce((SELECT requests FROM ai_daily_quotas WHERE owner_id=$1 AND usage_date=CURRENT_DATE),0)::int AS used,(date_trunc('day',now())+interval '1 day') AS resets_at",
        [ownerId],
      ),
    ]);
    return {
      totalRequests: Number(total.rows[0]?.requests ?? 0),
      totalInputTokens: Number(total.rows[0]?.input_tokens ?? 0),
      totalOutputTokens: Number(total.rows[0]?.output_tokens ?? 0),
      dailyLimit,
      remainingRequests: Math.max(
        0,
        dailyLimit - Number(quota.rows[0]?.used ?? 0),
      ),
      resetsAt: DatabaseDateSchema.parse(
        quota.rows[0]?.resets_at,
      ).toISOString(),
      byModel: models.rows.map((row) => ({
        model: row.model,
        requests: row.requests,
        successes: row.successes,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
      })),
      byOperation: operations.rows.map((row) => ({
        operation: row.operation,
        requests: row.requests,
        successes: row.successes,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
      })),
    };
  }

  private toConcept(row: unknown): Concept | undefined {
    if (!row) return undefined;
    const value = z
      .object({
        id: z.string(),
        material_id: z.string(),
        name: z.string(),
        description: z.string(),
        kind: z.string(),
        source_excerpt: z.string(),
        source_offset: z.number().int().nonnegative().nullable().optional(),
        fundamental_premises: z.unknown(),
        edge_cases: z.unknown(),
        study_question: z.unknown().nullable().optional(),
        edge_case_question: z.string().nullable().optional(),
        generated_locale: z.string().optional(),
        prerequisite_ids: z.unknown(),
        next_ids: z.unknown(),
      })
      .parse(row);
    return ConceptSchema.parse({
      id: value.id,
      materialId: value.material_id,
      name: value.name,
      description: value.description,
      kind: value.kind,
      sourceExcerpt: value.source_excerpt,
      sourceOffset: value.source_offset ?? undefined,
      fundamentalPremises: value.fundamental_premises,
      edgeCases: value.edge_cases,
      studyQuestion: value.study_question ?? undefined,
      edgeCaseQuestion: value.edge_case_question ?? undefined,
      generatedLocale: value.generated_locale ?? 'und',
      prerequisiteIds: value.prerequisite_ids,
      nextIds: value.next_ids,
    });
  }
  private toSession(row: unknown): StudySession | undefined {
    if (!row) return undefined;
    const value = z
      .object({
        id: z.string(),
        concept_id: z.string(),
        version: z.number().int(),
        state: z.string(),
        question: z.unknown(),
        stress_test: z.unknown().nullable(),
        edge_case_status: z.string(),
        edge_case_challenge: z.unknown().nullable(),
        attempts: z.unknown(),
        created_at: z.unknown(),
        updated_at: z.unknown(),
      })
      .parse(row);
    return StudySessionSchema.parse({
      id: value.id,
      conceptId: value.concept_id,
      version: value.version,
      state: value.state,
      question: value.question,
      edgeCaseStatus: value.edge_case_status,
      edgeCaseChallenge: value.edge_case_challenge,
      attempts: value.attempts,
      createdAt: DatabaseDateSchema.parse(value.created_at).toISOString(),
      updatedAt: DatabaseDateSchema.parse(value.updated_at).toISOString(),
    });
  }
}
