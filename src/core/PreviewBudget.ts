export type PreviewMemoryPressure = 'moderate' | 'critical'

export interface PreviewBudgetCallbacks {
  suspend(): void
  resume(): void
  release(): void
}

export interface PreviewBudgetLease {
  setVisible(visible: boolean): void
  touch(): void
  unregister(): void
}

type PreviewState = 'active' | 'suspended' | 'released'

interface PreviewEntry extends PreviewBudgetCallbacks {
  id: string
  visible: boolean
  state: PreviewState
  lastUsedAt: number
  releaseTimer?: number
}

export class PreviewBudget {
  private readonly entries = new Map<string, PreviewEntry>()
  private readonly maxActive: number
  private readonly hiddenReleaseMs: number

  constructor(maxActive = 3, hiddenReleaseMs = 30_000) {
    this.maxActive = maxActive
    this.hiddenReleaseMs = hiddenReleaseMs
  }

  register(id: string, callbacks: PreviewBudgetCallbacks): PreviewBudgetLease {
    this.entries.get(id)?.release()
    this.entries.delete(id)
    const entry: PreviewEntry = {
      ...callbacks,
      id,
      visible: false,
      state: 'released',
      lastUsedAt: Date.now(),
    }
    this.entries.set(id, entry)
    return {
      setVisible: (visible) => this.setVisible(entry, visible),
      touch: () => {
        entry.lastUsedAt = Date.now()
        if (entry.visible) this.activate(entry)
      },
      unregister: () => this.unregister(entry),
    }
  }

  handleMemoryPressure(level: PreviewMemoryPressure): void {
    const candidates = [...this.entries.values()].sort(
      (left, right) =>
        Number(left.visible) - Number(right.visible) || left.lastUsedAt - right.lastUsedAt,
    )
    for (const entry of candidates) {
      if (level === 'moderate' && entry.visible) continue
      if (level === 'critical' && entry.visible && this.activeCount() <= 1) continue
      this.releaseResources(entry)
    }
    this.rebalance()
  }

  snapshot(): Array<{ id: string; visible: boolean; state: PreviewState }> {
    return [...this.entries.values()].map(({ id, visible, state }) => ({ id, visible, state }))
  }

  private activeCount(): number {
    return [...this.entries.values()].filter((entry) => entry.state === 'active').length
  }

  private clearReleaseTimer(entry: PreviewEntry): void {
    if (entry.releaseTimer !== undefined) window.clearTimeout(entry.releaseTimer)
    entry.releaseTimer = undefined
  }

  private setVisible(entry: PreviewEntry, visible: boolean): void {
    if (!this.entries.has(entry.id) || entry.visible === visible) return
    entry.visible = visible
    entry.lastUsedAt = Date.now()
    this.clearReleaseTimer(entry)
    if (visible) {
      this.activate(entry)
    } else {
      this.suspend(entry)
      entry.releaseTimer = window.setTimeout(
        () => this.releaseResources(entry),
        this.hiddenReleaseMs,
      )
      this.rebalance()
    }
  }

  private activate(entry: PreviewEntry): void {
    if (!entry.visible || entry.state === 'active') return
    while (this.activeCount() >= this.maxActive) {
      const candidate = [...this.entries.values()]
        .filter((item) => item !== entry && item.state === 'active')
        .sort(
          (left, right) =>
            Number(left.visible) - Number(right.visible) || left.lastUsedAt - right.lastUsedAt,
        )[0]
      if (!candidate) break
      this.suspend(candidate)
    }
    entry.state = 'active'
    entry.resume()
  }

  private suspend(entry: PreviewEntry): void {
    if (entry.state !== 'active') return
    entry.state = 'suspended'
    entry.suspend()
  }

  private releaseResources(entry: PreviewEntry): void {
    this.clearReleaseTimer(entry)
    if (entry.state === 'released') return
    entry.state = 'released'
    entry.release()
  }

  private rebalance(): void {
    const waiting = [...this.entries.values()]
      .filter((entry) => entry.visible && entry.state !== 'active')
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
    for (const entry of waiting) {
      if (this.activeCount() >= this.maxActive) break
      this.activate(entry)
    }
  }

  private unregister(entry: PreviewEntry): void {
    if (!this.entries.delete(entry.id)) return
    this.clearReleaseTimer(entry)
    this.releaseResources(entry)
    this.rebalance()
  }
}

export const previewBudget = new PreviewBudget()

if (typeof window !== 'undefined') {
  window.addEventListener('srl:memory-pressure', (event) => {
    const level = event instanceof CustomEvent ? event.detail?.level : undefined
    previewBudget.handleMemoryPressure(level === 'critical' ? 'critical' : 'moderate')
  })
}
