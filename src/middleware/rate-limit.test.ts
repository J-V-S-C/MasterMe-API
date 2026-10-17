import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { NextFunction, Request, Response } from 'express'
import { uploadConcurrencyLimit } from './rate-limit'

const invoke = (ip: string, userId: string) => {
  const response = new EventEmitter() as unknown as Response
  response.locals = { userId }
  let error: unknown
  uploadConcurrencyLimit({ ip } as Request, response, ((value?: unknown) => { error = value }) as NextFunction)
  return { response, error }
}

describe('uploadConcurrencyLimit', () => {
  test('limits by IP, user and global capacity and releases on completion', () => {
    const first = invoke('203.0.113.1', 'user-a')
    expect(first.error).toBeUndefined()

    const sameIp = invoke('203.0.113.1', 'user-b')
    expect(sameIp.error).toMatchObject({ code: 'UPLOAD_CONCURRENCY_LIMIT' })

    const sameUser = invoke('203.0.113.2', 'user-a')
    expect(sameUser.error).toMatchObject({ code: 'UPLOAD_CONCURRENCY_LIMIT' })

    const second = invoke('203.0.113.2', 'user-b')
    expect(second.error).toBeUndefined()
    const globalLimit = invoke('203.0.113.3', 'user-c')
    expect(globalLimit.error).toMatchObject({ code: 'UPLOAD_CONCURRENCY_LIMIT' })

    first.response.emit('finish')
    const afterRelease = invoke('203.0.113.3', 'user-c')
    expect(afterRelease.error).toBeUndefined()

    second.response.emit('close')
    afterRelease.response.emit('finish')
  })
})
