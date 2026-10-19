import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { getEnvironment } from '../src/config/environment';
import { withAiUsageOwner } from '../src/infra/context/ai-usage-context';
import { GeminiStructuredClient } from '../src/infra/llm/gemini-structured.client';
import { GeminiMasterMeGateway } from '../src/infra/llm/gemini.gateway';
import { extractPdfDocument } from '../src/infra/ingestion/ingestion.service';
import type { AiUsageEvent } from '../src/application/ports/llm.gateway';

if (process.env.PHASE2_LIVE_BENCHMARK !== '1')
  throw new Error('Set PHASE2_LIVE_BENCHMARK=1 to run bounded provider calls.');

const environment = getEnvironment();
const usage: AiUsageEvent[] = [];
const client = new GeminiStructuredClient(
  { ...environment, GEMINI_MODEL_FALLBACKS: [] },
  async (event) => { usage.push(event); },
);
const gateway = new GeminiMasterMeGateway(client, environment.EXTRACTION_MAX_CONCEPTS);
const names = [
  'simple-article.txt', 'hierarchical-book.md', 'procedure.md',
  'homonym-database.md', 'homonym-business.md',
  'outlined-book.pdf', 'unstructured.pdf',
] as const;
const offset = Number(process.env.PHASE2_FIXTURE_OFFSET ?? 0);
if (!Number.isInteger(offset) || offset < 0 || offset >= names.length)
  throw new Error('PHASE2_FIXTURE_OFFSET must be between 0 and 6.');
const limit = Number(process.env.PHASE2_FIXTURE_LIMIT ?? names.length - offset);
if (!Number.isInteger(limit) || limit < 1 || limit > names.length - offset)
  throw new Error('PHASE2_FIXTURE_LIMIT must be between 1 and 7.');

for (const name of names.slice(offset, offset + limit)) {
  const data = await readFile(new URL(`../test-fixtures/phase2/${name}`, import.meta.url));
  const content = name.endsWith('.pdf') ? (await extractPdfDocument(data)).text : data.toString('utf8').trim();
  const beforeUsage = usage.length;
  const started = performance.now();
  try {
    const result = await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () => gateway.extractKnowledge({
      id: '22222222-2222-4222-8222-222222222222',
      title: name,
      content,
      locale: 'en-US',
      createdAt: '2026-10-19T00:00:00.000Z',
    }));
    const sourceAnchored = result.fragments.every((fragment) => content.includes(fragment.sourceExcerpt)) &&
      (result.relations ?? []).every((relation) => content.includes(relation.sourceExcerpt));
    console.log(JSON.stringify({
      fixture: name,
      durationMs: Math.round(performance.now() - started),
      fragments: result.fragments.length,
      conceptNames: result.fragments.map((fragment) => fragment.name),
      questionCoverage: result.fragments.filter((fragment) => fragment.studyQuestion).length,
      questions: result.fragments.map((fragment) => fragment.studyQuestion?.text ?? null),
      relations: result.relations?.length ?? 0,
      relationTypes: result.relations?.map((relation) => relation.relationType) ?? [],
      relationStatements: result.relations?.map((relation) => relation.statement) ?? [],
      sourceAnchored,
      usage: usage.slice(beforeUsage),
    }));
  } catch (error: unknown) {
    console.log(JSON.stringify({ fixture: name, durationMs: Math.round(performance.now() - started), errorCode: error instanceof Error ? error.name : 'UNKNOWN', usage: usage.slice(beforeUsage) }));
  }
}
