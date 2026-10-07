import { AsyncLocalStorage } from 'node:async_hooks'

const ownerContext = new AsyncLocalStorage<string>()

export const withAiUsageOwner = <T>(ownerId: string, operation: () => T): T =>
  ownerContext.run(ownerId, operation)

export const currentAiUsageOwner = (): string | undefined => ownerContext.getStore()
