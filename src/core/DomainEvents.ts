export interface DomainEventMap {
  ResourceImported: { resourceIds: string[]; operationId: string }
  ResourceUpdated: { resourceIds: string[]; operationId: string }
  ResourceDeleted: { resourceIds: string[]; operationId: string }
  AssetChanged: { assetIds: string[]; operationId: string }
  TavernConnected: { mode: string }
  BackupCompleted: { backupId: string; operationId: string }
  SettingsChanged: { keys: string[] }
}

type DomainEventName = keyof DomainEventMap
type Listener<K extends DomainEventName> = (payload: DomainEventMap[K]) => void

export class DomainEventBus {
  private readonly listeners = new Map<DomainEventName, Set<(payload: never) => void>>()

  on<K extends DomainEventName>(name: K, listener: Listener<K>): () => void {
    const listeners = this.listeners.get(name) ?? new Set()
    listeners.add(listener as (payload: never) => void)
    this.listeners.set(name, listeners)
    return () => listeners.delete(listener as (payload: never) => void)
  }

  emit<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): void {
    for (const listener of this.listeners.get(name) ?? []) listener(payload as never)
  }
}

export const domainEvents = new DomainEventBus()
