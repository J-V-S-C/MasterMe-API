import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import ts from 'typescript';

const dependenciesFor = (source: ts.SourceFile): string[] => {
  const imports: string[] = [];
  const collect = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const dependency = node.moduleReference.expression;
      imports.push(dependency && ts.isStringLiteral(dependency) ? dependency.text : '<dynamic dependency>');
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const dependency = node.arguments[0];
      imports.push(dependency && ts.isStringLiteral(dependency) ? dependency.text : '<dynamic dependency>');
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  return imports;
};

describe('domain boundary', () => {
  test('production files do not import adapters or external libraries', async () => {
    const root = new URL('./domain/', import.meta.url);
    const domainRoot = resolve(root.pathname);
    const visit = async (directory: URL): Promise<URL[]> => {
      const entries = await readdir(directory, { withFileTypes: true });
      const nested = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => visit(new URL(`${entry.name}/`, directory))));
      return [
        ...entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')).map((entry) => new URL(entry.name, directory)),
        ...nested.flat(),
      ];
    };
    const files = await visit(root);
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const parsed = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
      for (const dependency of dependenciesFor(parsed)) {
        const target = resolve(dirname(file.pathname), dependency);
        const withinDomain = dependency.startsWith('.') && !relative(domainRoot, target).startsWith(`..${sep}`) && relative(domainRoot, target) !== '..';
        if (!withinDomain) violations.push(`${relative(domainRoot, file.pathname)}: ${dependency}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

test('application modules depend only on application code and Node built-ins', async () => {
  const applicationRoot = resolve(new URL('./', import.meta.url).pathname);
  const collect = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => collect(resolve(directory, entry.name))));
    return [
      ...entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
        .map((entry) => resolve(directory, entry.name)),
      ...nested.flat(),
    ];
  };
  const files = await collect(applicationRoot);
  const violations: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const dependency of dependenciesFor(source)) {
      if (dependency.startsWith('node:')) continue;
      if (!dependency.startsWith('.') || !resolve(dirname(file), dependency).startsWith(`${applicationRoot}${sep}`)) {
        violations.push(`${relative(applicationRoot, file)}: ${dependency}`);
      }
    }
  }
  expect(violations).toEqual([]);
});

test('named service contracts and repository ports stay in their dedicated locations', async () => {
  const root = resolve(new URL('./', import.meta.url).pathname);
  const serviceFiles = (await readdir(resolve(root, 'services')))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const services = serviceFiles.filter((name) => name.endsWith('.service.ts'));
  const contracts = await readdir(resolve(root, 'contracts'));
  const repositories = await readdir(resolve(root, 'repositories'));
  const ports = await readdir(resolve(root, 'ports'));
  const violations: string[] = [];

  for (const name of serviceFiles) {
    if (!name.endsWith('.service.ts')) violations.push(`unexpected service file: ${name}`);
  }
  for (const name of services) {
    const path = resolve(root, 'services', name);
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        violations.push(`service contract declared in implementation: ${name}`);
      }
    }
  }
  for (const name of contracts) {
    if (!name.endsWith('.service.ts')) violations.push(`unexpected contract file: ${name}`);
    if (!services.includes(name)) violations.push(`contract without service: ${name}`);
    const path = resolve(root, 'contracts', name);
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) {
        violations.push(`runtime declaration in service contract: ${name}`);
      }
    }
  }
  for (const name of repositories) {
    if (!name.endsWith('.repository.ts')) violations.push(`repository contract outside naming convention: ${name}`);
  }
  for (const name of ports) {
    if (!name.endsWith('.gateway.ts')) violations.push(`external gateway outside naming convention: ${name}`);
    const path = resolve(root, 'ports', name);
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text.endsWith('Repository')) {
        violations.push(`repository contract declared in external ports: ${name}`);
      }
    }
  }
  expect(violations).toEqual([]);
});
