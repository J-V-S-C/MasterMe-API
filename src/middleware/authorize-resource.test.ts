import { describe, expect, test } from 'bun:test'
import type { NextFunction, Request, Response } from 'express'
import type { Pool } from 'pg'
import { authorizeResource } from './authorize-resource'
import { NotFoundError } from '../services/errors'

const materialId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'

describe('authorizeResource', () => {
  test('autoriza somente quando o recurso pertence ao usuário autenticado', async () => {
    const calls: unknown[][] = []
    const pool = { query: async (_sql: string, values: unknown[]) => { calls.push(values); return { rows: [{ exists: true }] } } } as unknown as Pool
    const middleware = authorizeResource(pool)
    let error: unknown
    await middleware({ path: `/materials/${materialId}` } as Request, { locals: { userId: ownerId } } as Response, ((value?: unknown) => { error = value }) as NextFunction)
    expect(error).toBeUndefined()
    expect(calls).toEqual([[materialId, ownerId]])
  })

  test('responde como não encontrado para recurso de outro usuário', async () => {
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool
    const middleware = authorizeResource(pool)
    let error: unknown
    await middleware({ path: `/sessions/${materialId}` } as Request, { locals: { userId: ownerId } } as Response, ((value?: unknown) => { error = value }) as NextFunction)
    expect(error).toBeInstanceOf(NotFoundError)
  })
})
