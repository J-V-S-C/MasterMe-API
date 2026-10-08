import { Pool } from 'pg'
import { z } from 'zod'
import { ConceptConfidenceSchema, ConceptSchema, EvaluationSchema, IsomorphicProblemSchema, MaterialSchema, MaterialSummarySchema, PracticeProjectSchema, StudySessionSchema, type Concept, type ConceptConfidence, type Evaluation, type IsomorphicProblem, type MaterialSummary, type PracticeProject, type StudyMaterial, type StudySession, type SupportedLocale } from '../domain/masterme'
import type { AiUsageEvent } from '../config/llm'
import type { AiUsageSummary, MasterMeRepository } from './masterme.repository'

const DatabaseDateSchema = z.coerce.date()

export class PostgresMasterMeRepository implements MasterMeRepository {
  public constructor(private readonly pool: Pool) {}

  public async saveMaterial(material: StudyMaterial, ownerId: string): Promise<void> {
    await this.pool.query('INSERT INTO study_materials (id, title, content, locale, created_at, owner_id) VALUES ($1, $2, $3, $4, $5, $6)', [material.id, material.title, material.content, material.locale, material.createdAt, ownerId])
  }

  public async findMaterial(id: string): Promise<StudyMaterial | undefined> {
    const result = await this.pool.query('SELECT id, title, content, locale, created_at FROM study_materials WHERE id = $1', [id])
    const row = result.rows[0]
    if (!row) return undefined
    return MaterialSchema.parse({ id: row.id, title: row.title, content: row.content, locale: row.locale, createdAt: DatabaseDateSchema.parse(row.created_at).toISOString() })
  }

  public async findAllMaterials(ownerId: string): Promise<MaterialSummary[]> {
    const result = await this.pool.query('SELECT id, title, locale, created_at FROM study_materials WHERE owner_id=$1 ORDER BY created_at ASC, id ASC', [ownerId])
    return result.rows.map((row) => MaterialSummarySchema.parse({
      id: row.id,
      title: row.title,
      locale: row.locale,
      createdAt: DatabaseDateSchema.parse(row.created_at).toISOString(),
    }))
  }

  public async saveConcepts(concepts: Concept[]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const concept of concepts) {
        await client.query('INSERT INTO concepts (id, material_id, name, description, kind, source_excerpt, fundamental_premises, edge_cases, study_question, edge_case_question, generated_locale, prerequisite_ids, next_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [concept.id, concept.materialId, concept.name, concept.description, concept.kind, concept.sourceExcerpt, JSON.stringify(concept.fundamentalPremises), JSON.stringify(concept.edgeCases), JSON.stringify(concept.studyQuestion ?? null), concept.edgeCaseQuestion ?? null, concept.generatedLocale, JSON.stringify(concept.prerequisiteIds), JSON.stringify(concept.nextIds)])
      }
      await client.query('COMMIT')
    } catch (error: unknown) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  public async saveConceptLocalizations(materialId: string, locale: SupportedLocale, concepts: Concept[]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const concept of concepts) {
        await client.query(
          'UPDATE concepts SET name=$1,description=$2,fundamental_premises=$3,edge_cases=$4,study_question=$5,edge_case_question=$6,generated_locale=$7 WHERE id=$8 AND material_id=$9',
          [concept.name, concept.description, JSON.stringify(concept.fundamentalPremises), JSON.stringify(concept.edgeCases), JSON.stringify(concept.studyQuestion ?? null), concept.edgeCaseQuestion ?? null, locale, concept.id, materialId],
        )
      }
      await client.query('UPDATE study_materials SET locale=$1 WHERE id=$2', [locale, materialId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  public async findConcept(id: string): Promise<Concept | undefined> { const result = await this.pool.query('SELECT * FROM concepts WHERE id=$1', [id]); return this.toConcept(result.rows[0]) }
  public async findConceptsByMaterial(materialId: string): Promise<Concept[]> { const result = await this.pool.query('SELECT * FROM concepts WHERE material_id=$1', [materialId]); return result.rows.flatMap((row) => { const concept = this.toConcept(row); return concept ? [concept] : [] }) }
  public async saveSession(session: StudySession): Promise<void> { await this.pool.query('INSERT INTO study_sessions (id,concept_id,state,question,stress_test,edge_case_status,edge_case_challenge,attempts,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [session.id,session.conceptId,session.state,JSON.stringify(session.question),null,session.edgeCaseStatus,JSON.stringify(session.edgeCaseChallenge),JSON.stringify(session.attempts),session.createdAt,session.updatedAt]) }
  public async findSession(id: string): Promise<StudySession | undefined> { const result = await this.pool.query('SELECT * FROM study_sessions WHERE id=$1',[id]); return this.toSession(result.rows[0]) }
  public async findSessionsByConceptIds(conceptIds: string[]): Promise<StudySession[]> { if (conceptIds.length === 0) return []; const result = await this.pool.query('SELECT * FROM study_sessions WHERE concept_id = ANY($1::uuid[])',[conceptIds]); return result.rows.flatMap((row) => { const session = this.toSession(row); return session ? [session] : [] }) }
  public async replaceSession(session: StudySession, expectedState: StudySession['state']): Promise<boolean> { const result = await this.pool.query('UPDATE study_sessions SET state=$1, edge_case_status=$2, edge_case_challenge=$3, attempts=$4, updated_at=$5 WHERE id=$6 AND state=$7',[session.state,session.edgeCaseStatus,JSON.stringify(session.edgeCaseChallenge),JSON.stringify(session.attempts),session.updatedAt,session.id,expectedState]); return result.rowCount === 1 }
  public async findValidatedConceptIds(): Promise<Set<string>> { const result = await this.pool.query("SELECT DISTINCT concept_id FROM study_sessions WHERE state = 'EXPLANATION_PASSED'"); return new Set(result.rows.map((row) => z.string().uuid().parse(row.concept_id))) }
  public async saveConfidence(confidence: ConceptConfidence): Promise<void> { await this.pool.query('INSERT INTO concept_confidences (concept_id,value) VALUES ($1,$2) ON CONFLICT (concept_id) DO UPDATE SET value=EXCLUDED.value,updated_at=now()', [confidence.conceptId, confidence.value]) }
  public async deleteConfidence(conceptId: string): Promise<void> { await this.pool.query('DELETE FROM concept_confidences WHERE concept_id=$1', [conceptId]) }
  public async findConfidencesByConceptIds(conceptIds: string[]): Promise<ConceptConfidence[]> { if (!conceptIds.length) return []; const result = await this.pool.query('SELECT concept_id,value,created_at,updated_at FROM concept_confidences WHERE concept_id = ANY($1::uuid[])', [conceptIds]); return result.rows.map((row) => ConceptConfidenceSchema.parse({ conceptId: row.concept_id, value: row.value, createdAt: DatabaseDateSchema.parse(row.created_at).toISOString(), updatedAt: DatabaseDateSchema.parse(row.updated_at).toISOString() })) }
  public async updateConceptEdgeCaseQuestion(conceptId: string, question: string): Promise<void> { await this.pool.query('UPDATE concepts SET edge_case_question=$1 WHERE id=$2', [question, conceptId]) }
  public async findPracticeProjectByHash(inputHash: string): Promise<PracticeProject | undefined> { const result = await this.pool.query('SELECT payload FROM practice_projects WHERE input_hash=$1', [inputHash]); return result.rows[0] ? PracticeProjectSchema.parse(result.rows[0].payload) : undefined }
  public async findPracticeProject(id: string): Promise<PracticeProject | undefined> { const result = await this.pool.query('SELECT payload FROM practice_projects WHERE id=$1', [id]); return result.rows[0] ? PracticeProjectSchema.parse(result.rows[0].payload) : undefined }
  public async findPracticeProjectsByMaterial(materialId: string): Promise<PracticeProject[]> { const result = await this.pool.query('SELECT payload FROM practice_projects WHERE material_id=$1 ORDER BY created_at DESC,id DESC', [materialId]); return result.rows.map((row) => PracticeProjectSchema.parse(row.payload)) }
  public async savePracticeProject(project: PracticeProject, inputHash: string): Promise<void> { await this.pool.query('INSERT INTO practice_projects (id,material_id,input_hash,focus_mode,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (input_hash) DO NOTHING', [project.id,project.materialId,inputHash,project.focusMode,JSON.stringify(project),project.createdAt]) }
  public async findEvaluation(requestHash: string): Promise<Evaluation | undefined> { const result = await this.pool.query('SELECT evaluation FROM ai_evaluation_cache WHERE request_hash=$1', [requestHash]); return result.rows[0] ? EvaluationSchema.parse(result.rows[0].evaluation) : undefined }
  public async saveEvaluation(requestHash: string, evaluation: Evaluation): Promise<void> { await this.pool.query('INSERT INTO ai_evaluation_cache (request_hash,evaluation) VALUES ($1,$2) ON CONFLICT (request_hash) DO NOTHING', [requestHash, JSON.stringify(evaluation)]) }
  public async findIsomorphicProblem(inputHash: string): Promise<IsomorphicProblem | undefined> { const result = await this.pool.query("SELECT payload FROM generated_artifacts WHERE kind='ISOMORPHIC_PROBLEM' AND input_hash=$1", [inputHash]); return result.rows[0] ? IsomorphicProblemSchema.parse(result.rows[0].payload) : undefined }
  public async saveIsomorphicProblem(materialId: string, inputHash: string, problem: IsomorphicProblem): Promise<void> { await this.pool.query("INSERT INTO generated_artifacts (material_id,kind,input_hash,payload) VALUES ($1,'ISOMORPHIC_PROBLEM',$2,$3) ON CONFLICT (kind,input_hash) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()", [materialId, inputHash, JSON.stringify(problem)]) }
  public async consumeAiRequest(ownerId: string, dailyLimit: number): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO ai_daily_quotas (owner_id,usage_date,requests) VALUES ($1,CURRENT_DATE,1)
       ON CONFLICT (owner_id,usage_date) DO UPDATE SET requests=ai_daily_quotas.requests+1
       WHERE ai_daily_quotas.requests < $2 RETURNING requests`,
      [ownerId, dailyLimit],
    )
    if (result.rows[0]) return Number(result.rows[0].requests)
    const current = await this.pool.query('SELECT requests FROM ai_daily_quotas WHERE owner_id=$1 AND usage_date=CURRENT_DATE', [ownerId])
    return Math.max(dailyLimit + 1, Number(current.rows[0]?.requests ?? dailyLimit) + 1)
  }
  public async recordAiUsage(event: AiUsageEvent, ownerId: string): Promise<void> { await this.pool.query('INSERT INTO ai_usage_events (operation,model,success,input_tokens,output_tokens,error_code,owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [event.operation,event.model,event.success,event.inputTokens,event.outputTokens,event.errorCode,ownerId]) }
  public async getAiUsageToday(ownerId: string, dailyLimit: number): Promise<AiUsageSummary> {
    const [total, models, operations, quota] = await Promise.all([
      this.pool.query("SELECT count(*)::int AS requests,coalesce(sum(input_tokens),0)::int AS input_tokens,coalesce(sum(output_tokens),0)::int AS output_tokens FROM ai_usage_events WHERE owner_id=$1 AND created_at >= date_trunc('day',now())", [ownerId]),
      this.pool.query("SELECT model,count(*)::int AS requests,count(*) FILTER (WHERE success)::int AS successes,coalesce(sum(input_tokens),0)::int AS input_tokens,coalesce(sum(output_tokens),0)::int AS output_tokens FROM ai_usage_events WHERE owner_id=$1 AND created_at >= date_trunc('day',now()) GROUP BY model ORDER BY model", [ownerId]),
      this.pool.query("SELECT operation,count(*)::int AS requests,count(*) FILTER (WHERE success)::int AS successes,coalesce(sum(input_tokens),0)::int AS input_tokens,coalesce(sum(output_tokens),0)::int AS output_tokens FROM ai_usage_events WHERE owner_id=$1 AND created_at >= date_trunc('day',now()) GROUP BY operation ORDER BY operation", [ownerId]),
      this.pool.query("SELECT coalesce((SELECT requests FROM ai_daily_quotas WHERE owner_id=$1 AND usage_date=CURRENT_DATE),0)::int AS used,(date_trunc('day',now())+interval '1 day') AS resets_at", [ownerId]),
    ])
    return {
      totalRequests: Number(total.rows[0]?.requests ?? 0),
      totalInputTokens: Number(total.rows[0]?.input_tokens ?? 0),
      totalOutputTokens: Number(total.rows[0]?.output_tokens ?? 0),
      dailyLimit,
      remainingRequests: Math.max(0, dailyLimit - Number(quota.rows[0]?.used ?? 0)),
      resetsAt: DatabaseDateSchema.parse(quota.rows[0]?.resets_at).toISOString(),
      byModel: models.rows.map((row) => ({ model: row.model, requests: row.requests, successes: row.successes, inputTokens: row.input_tokens, outputTokens: row.output_tokens })),
      byOperation: operations.rows.map((row) => ({ operation: row.operation, requests: row.requests, successes: row.successes, inputTokens: row.input_tokens, outputTokens: row.output_tokens })),
    }
  }

  private toConcept(row: unknown): Concept | undefined { if (!row) return undefined; const value = z.object({ id:z.string(), material_id:z.string(), name:z.string(), description:z.string(), kind:z.string(), source_excerpt:z.string(), fundamental_premises:z.unknown(), edge_cases:z.unknown(), study_question:z.unknown().nullable().optional(), edge_case_question:z.string().nullable().optional(), generated_locale:z.string().optional(), prerequisite_ids:z.unknown(), next_ids:z.unknown() }).parse(row); return ConceptSchema.parse({ id:value.id, materialId:value.material_id, name:value.name, description:value.description, kind:value.kind, sourceExcerpt:value.source_excerpt, fundamentalPremises:value.fundamental_premises, edgeCases:value.edge_cases, studyQuestion:value.study_question ?? undefined, edgeCaseQuestion:value.edge_case_question ?? undefined, generatedLocale:value.generated_locale ?? 'und', prerequisiteIds:value.prerequisite_ids, nextIds:value.next_ids }) }
  private toSession(row: unknown): StudySession | undefined { if (!row) return undefined; const value = z.object({ id:z.string(), concept_id:z.string(), state:z.string(), question:z.unknown(), stress_test:z.unknown().nullable(), edge_case_status:z.string(), edge_case_challenge:z.unknown().nullable(), attempts:z.unknown(), created_at:z.unknown(), updated_at:z.unknown() }).parse(row); return StudySessionSchema.parse({ id:value.id, conceptId:value.concept_id, state:value.state, question:value.question, edgeCaseStatus:value.edge_case_status, edgeCaseChallenge:value.edge_case_challenge, attempts:value.attempts, createdAt:DatabaseDateSchema.parse(value.created_at).toISOString(), updatedAt:DatabaseDateSchema.parse(value.updated_at).toISOString() }) }
}
