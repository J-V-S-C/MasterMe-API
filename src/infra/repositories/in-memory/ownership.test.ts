import { describe, expect, test } from 'bun:test';
import { InMemoryMasterMeRepository } from './in-memory.masterme.repository';

describe('material ownership', () => {
  test('does not list materials owned by another account', async () => {
    const repository = new InMemoryMasterMeRepository();
    const material = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Privado',
      content: 'Conteúdo privado suficiente.',
      locale: 'pt-BR' as const,
      createdAt: new Date().toISOString(),
    };
    await repository.saveMaterial(
      material,
      '22222222-2222-4222-8222-222222222222',
    );
    expect(
      await repository.findAllMaterials('22222222-2222-4222-8222-222222222222'),
    ).toEqual([
      {
        id: material.id,
        title: material.title,
        locale: material.locale,
        createdAt: material.createdAt,
      },
    ]);
    expect(
      await repository.findAllMaterials('33333333-3333-4333-8333-333333333333'),
    ).toEqual([]);
    expect(repository.updateMaterialKind(material.id, '33333333-3333-4333-8333-333333333333', 'BOOK')).toBeUndefined();
    expect(repository.findMaterial(material.id)?.materialKind).toBeUndefined();
    expect(repository.updateMaterialKind(material.id, '22222222-2222-4222-8222-222222222222', 'BOOK')?.materialKind).toBe('BOOK');
  });

  test('isolates metrics and AI quota across accounts', async () => {
    const repository = new InMemoryMasterMeRepository();
    const firstOwner = '11111111-1111-4111-8111-111111111111';
    const secondOwner = '22222222-2222-4222-8222-222222222222';
    expect(await repository.consumeAiRequest(firstOwner, 2)).toBe(1);
    await repository.recordAiUsage(
      {
        operation: 'EXTRACTION',
        model: 'gemini',
        success: true,
        inputTokens: 10,
        outputTokens: 5,
        errorCode: null,
      },
      firstOwner,
    );

    expect(await repository.getAiUsageToday(firstOwner, 2)).toMatchObject({
      totalRequests: 1,
      remainingRequests: 1,
      dailyLimit: 2,
    });
    expect(await repository.getAiUsageToday(secondOwner, 2)).toMatchObject({
      totalRequests: 0,
      remainingRequests: 2,
      dailyLimit: 2,
    });
    expect(await repository.consumeAiRequest(firstOwner, 2)).toBe(2);
    expect(await repository.consumeAiRequest(firstOwner, 2)).toBe(3);
  });
});
