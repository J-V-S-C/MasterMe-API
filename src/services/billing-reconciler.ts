import type { BillingService } from './billing.service'

type ReconciliationService = Pick<BillingService, 'processPendingWebhooks'>

export class BillingReconciler {
  private active: Promise<void> | undefined
  private requested = false

  public constructor(
    private readonly service: ReconciliationService,
    private readonly batchSize = 5,
  ) {}

  public trigger(): Promise<void> {
    this.requested = true
    if (this.active) return this.active
    const execution = this.drain().finally(() => {
      this.active = undefined
    })
    this.active = execution
    return execution
  }

  public start(intervalMs = 60_000, onError: (error: unknown) => void = () => undefined): () => void {
    const run = (): void => { void this.trigger().catch(onError) }
    const timer = setInterval(run, intervalMs)
    timer.unref()
    run()
    return () => clearInterval(timer)
  }

  private async drain(): Promise<void> {
    while (this.requested) {
      this.requested = false
      let processed: number
      do {
        processed = await this.service.processPendingWebhooks(this.batchSize)
      } while (processed === this.batchSize)
    }
  }
}
