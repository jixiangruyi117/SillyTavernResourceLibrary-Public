import type { TavernResourceItem } from '../services/TavernBridgeProtocol'
import { tavernBridgeService, type TavernBridgeState } from '../services/TavernBridgeService'
import { negotiateTavernCapabilities, type TavernCapabilities } from './TavernCapabilities'

export interface TavernConnectionSnapshot extends TavernBridgeState {
  negotiated: TavernCapabilities
  inventory: TavernResourceItem[]
  lastSyncAt?: number
}

export class TavernConnectionStore extends EventTarget {
  private inventory: TavernResourceItem[] = []
  private lastSyncAt?: number

  constructor() {
    super()
    tavernBridgeService.addEventListener('state', this.handleBridgeState)
  }

  getSnapshot(): TavernConnectionSnapshot {
    const state = tavernBridgeService.getState()
    return {
      ...state,
      negotiated: negotiateTavernCapabilities(state.capabilities),
      inventory: this.inventory.map((item) => ({ ...item })),
      lastSyncAt: this.lastSyncAt,
    }
  }

  async refreshInventory(): Promise<TavernResourceItem[]> {
    const inventory = await tavernBridgeService.listResources()
    this.inventory = inventory.map((item) => ({ ...item }))
    this.lastSyncAt = Date.now()
    this.publish()
    return this.inventory.map((item) => ({ ...item }))
  }

  recordSync(inventory?: TavernResourceItem[]): void {
    if (inventory) this.inventory = inventory.map((item) => ({ ...item }))
    this.lastSyncAt = Date.now()
    this.publish()
  }

  clearInventory(): void {
    this.inventory = []
    this.publish()
  }

  private readonly handleBridgeState = (): void => {
    if (tavernBridgeService.getState().status !== 'connected') this.inventory = []
    this.publish()
  }

  private publish(): void {
    this.dispatchEvent(
      new CustomEvent<TavernConnectionSnapshot>('change', { detail: this.getSnapshot() }),
    )
  }
}

export const tavernConnectionStore = new TavernConnectionStore()
