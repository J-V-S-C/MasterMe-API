import { describe, expect, test } from 'bun:test'
import { BillingReconciler } from './billing-reconciler'

describe('BillingReconciler', () => {
  test('coalesce rajada de triggers e mantém somente um drain ativo', async () => {
    let active = 0
    let maximumActive = 0
    let calls = 0
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => { releaseFirst = resolve })
    const service = {
      processPendingWebhooks: async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        calls += 1
        if (calls === 1) await first
        active -= 1
        return 0
      },
    }
    const reconciler = new BillingReconciler(service)

    const running = reconciler.trigger()
    const duplicates = Array.from({ length: 20 }, () => reconciler.trigger())
    releaseFirst()
    await Promise.all([running, ...duplicates])

    expect(maximumActive).toBe(1)
    expect(calls).toBe(2)
  })

  test('escoa lotes sequencialmente até encontrar menos que o batch', async () => {
    const seen: number[] = []
    const results = [3, 3, 1]
    const reconciler = new BillingReconciler({ processPendingWebhooks: async (limit) => { seen.push(limit ?? -1); return results.shift() ?? 0 } }, 3)

    await reconciler.trigger()

    expect(seen).toEqual([3, 3, 3])
  })
})
