import type { Notification, Pool, PoolClient } from 'pg'

type ActivityListener = () => void

/** One PostgreSQL LISTEN connection fans durable activity notifications out to SSE clients. */
export class ActivityEventHub {
  private readonly listeners = new Map<string, Set<ActivityListener>>()
  private client: PoolClient | undefined
  private connecting: Promise<void> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined

  public constructor(private readonly pool: Pool) {}

  public async subscribe(ownerId: string, listener: ActivityListener): Promise<() => void> {
    const ownerListeners = this.listeners.get(ownerId) ?? new Set<ActivityListener>()
    ownerListeners.add(listener)
    this.listeners.set(ownerId, ownerListeners)
    try { await this.ensureConnected() } catch (error) {
      ownerListeners.delete(listener)
      if (!ownerListeners.size) this.listeners.delete(ownerId)
      throw error
    }
    return () => {
      ownerListeners.delete(listener)
      if (!ownerListeners.size) this.listeners.delete(ownerId)
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return
    if (this.connecting) return this.connecting
    this.connecting = this.connect().finally(() => { this.connecting = undefined })
    return this.connecting
  }

  private async connect(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('LISTEN masterme_activity')
      this.client = client
      client.on('notification', this.onNotification)
      client.once('error', this.onConnectionLost)
      client.once('end', this.onConnectionLost)
    } catch (error) {
      client.release(true)
      throw error
    }
  }

  private readonly onNotification = (notification: Notification): void => {
    if (notification.channel !== 'masterme_activity' || !notification.payload) return
    for (const listener of this.listeners.get(notification.payload) ?? []) listener()
  }

  private readonly onConnectionLost = (): void => {
    const client = this.client
    this.client = undefined
    if (client) {
      client.off('notification', this.onNotification)
      client.release(true)
    }
    if (!this.listeners.size || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.ensureConnected()
        .then(() => { for (const listeners of this.listeners.values()) for (const listener of listeners) listener() })
        .catch((error) => {
          console.error(JSON.stringify({ level: 'error', operation: 'activity-listen-reconnect', error: String(error) }))
          this.onConnectionLost()
        })
    }, 1_000)
    this.reconnectTimer.unref?.()
  }
}
