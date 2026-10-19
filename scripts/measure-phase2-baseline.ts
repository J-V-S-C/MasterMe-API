import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { deriveEditorialUnits } from '../src/infra/parsers/editorial-structure';
import { extractPdfDocument } from '../src/infra/ingestion/ingestion.service';
import { splitMaterialForExtraction } from '../src/infra/llm/gemini.gateway';
import { MAX_MATERIAL_LENGTH } from '../src/application/material-limits';

const fixtures = [
  'simple-article.txt',
  'hierarchical-book.md',
  'procedure.md',
  'homonym-database.md',
  'homonym-business.md',
  'outlined-book.pdf',
  'unstructured.pdf',
] as const;

for (const name of fixtures) {
  const data = await readFile(new URL(`../test-fixtures/phase2/${name}`, import.meta.url));
  const beforeHeap = process.memoryUsage().heapUsed;
  const beforeRss = process.memoryUsage().rss;
  const started = performance.now();
  const result = name.endsWith('.pdf')
    ? await extractPdfDocument(data)
    : (() => {
        const text = data.toString('utf8').trim();
        return {
          text,
          units: deriveEditorialUnits(text, name.endsWith('.md') ? 'MARKDOWN' : 'TXT'),
        };
      })();
  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  const heapDeltaBytes = process.memoryUsage().heapUsed - beforeHeap;
  const rssDeltaBytes = process.memoryUsage().rss - beforeRss;
  const payloadBytes = Buffer.byteLength(JSON.stringify(result));
  const structure = result.units.map((unit) => ({ title: unit.title, provenance: unit.provenance, page: unit.pageNumber ?? null }));
  console.log(JSON.stringify({ fixture: name, inputBytes: data.byteLength, characters: result.text.length, units: result.units.length, durationMs, heapDeltaBytes, rssDeltaBytes, payloadBytes, structure }));
}

const paragraph = (await readFile(new URL('../test-fixtures/phase2/procedure.md', import.meta.url), 'utf8')).trim();
const largeMaterial = Array.from({ length: Math.ceil(MAX_MATERIAL_LENGTH / (paragraph.length + 2)) }, () => paragraph)
  .join('\n\n').slice(0, MAX_MATERIAL_LENGTH);
const beforeHeap = process.memoryUsage().heapUsed;
const beforeRss = process.memoryUsage().rss;
const started = performance.now();
const units = deriveEditorialUnits(largeMaterial, 'MARKDOWN');
const chunks = splitMaterialForExtraction(largeMaterial);
console.log(JSON.stringify({
  fixture: 'synthetic-max-text',
  characters: largeMaterial.length,
  units: units.length,
  chunks: chunks.length,
  durationMs: Math.round((performance.now() - started) * 100) / 100,
  heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap,
  rssDeltaBytes: process.memoryUsage().rss - beforeRss,
  processPeakRssKilobytes: process.resourceUsage().maxRSS,
  payloadBytes: Buffer.byteLength(JSON.stringify({ units, chunks })),
}));
