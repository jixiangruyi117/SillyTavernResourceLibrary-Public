export type DirtyStateDecision = 'save' | 'discard'

export interface DirtyStateRegistration {
  featureId: string
  label: string
  isDirty: () => boolean
  save: () => Promise<void>
  discard: () => Promise<void> | void
}

export class DirtyStateRegistry {
  private readonly entries = new Map<string, DirtyStateRegistration>()
  private readonly listeners = new Set<() => void>()

  register(entry: DirtyStateRegistration): () => void {
    this.entries.set(entry.featureId, entry)
    this.publish()
    return () => {
      if (this.entries.get(entry.featureId) === entry) {
        this.entries.delete(entry.featureId)
        this.publish()
      }
    }
  }

  changed(): void {
    this.publish()
  }

  dirtyEntries(): DirtyStateRegistration[] {
    return [...this.entries.values()].filter((entry) => entry.isDirty())
  }

  hasDirtyState(featureId?: string): boolean {
    return featureId
      ? Boolean(this.entries.get(featureId)?.isDirty())
      : this.dirtyEntries().length > 0
  }

  async resolve(featureId: string, decision: DirtyStateDecision): Promise<boolean> {
    const entry = this.entries.get(featureId)
    if (!entry || !entry.isDirty()) return true
    if (decision === 'save') await entry.save()
    else await entry.discard()
    this.publish()
    return !entry.isDirty()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

export const dirtyStateRegistry = new DirtyStateRegistry()
