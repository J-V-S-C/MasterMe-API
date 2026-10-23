import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { deriveEditorialUnits } from './editorial-structure';
import { extractPdfDocument } from '../ingestion/ingestion.service';

const fixture = (name: string) => new URL(`../../../test-fixtures/phase2/${name}`, import.meta.url);

test('reference book keeps its author supplied Markdown order', async () => {
  const text = (await readFile(fixture('hierarchical-book.md'), 'utf8')).trim();
  expect(deriveEditorialUnits(text, 'MARKDOWN').map((unit) => unit.title)).toEqual([
    'Building a Query Engine', 'Chapter 1: Parse', 'Section 1.1: Predicates',
    'Chapter 2: Plan', 'Section 2.1: Index access',
  ]);
});

test('reference PDFs distinguish an actual outline from unstructured text', async () => {
  const outlined = await extractPdfDocument(await readFile(fixture('outlined-book.pdf')));
  expect(outlined.units.map((unit) => [unit.title, unit.provenance, unit.pageNumber ?? null])).toEqual([
    [null, 'UNSTRUCTURED', null],
    ['Chapter One', 'PDF_OUTLINE', 2],
    ['Chapter Two', 'PDF_OUTLINE', 3],
  ]);
  const unstructured = await extractPdfDocument(await readFile(fixture('unstructured.pdf')));
  expect(unstructured.units).toHaveLength(1);
  expect(unstructured.units[0]?.provenance).toBe('UNSTRUCTURED');
}, 15_000);

test('homonymous terms stay in their separate source fixtures', async () => {
  const database = await readFile(fixture('homonym-database.md'), 'utf8');
  const business = await readFile(fixture('homonym-business.md'), 'utf8');
  expect(database).toContain('transaction');
  expect(business).toContain('transaction');
  expect(database).not.toContain('exchange between two parties');
  expect(business).not.toContain('Isolation controls');
});
