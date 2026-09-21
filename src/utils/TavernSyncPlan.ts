import type { TavernResourceItem } from '../services/TavernBridgeProtocol'
import type { ResourceSummary } from '../types/Resource'
import { bridgeKindOfResource, normalizeBridgeName } from './TavernBridgeDiff'

export type TavernSyncStatus =
  'local-only' | 'tavern-only' | 'local-newer' | 'tavern-newer' | 'consistent' | 'unverified-match'

export interface TavernSyncEntry {
  status: TavernSyncStatus
  localId?: string
  tavernId?: string
}

function namesMatch(local: ResourceSummary, remote: TavernResourceItem): boolean {
  const localNames = new Set([normalizeBridgeName(local.name), normalizeBridgeName(local.fileName)])
  return [remote.name, remote.fileName].some((name) => localNames.has(normalizeBridgeName(name)))
}

function compareMatched(local: ResourceSummary, remote: TavernResourceItem): TavernSyncStatus {
  if (remote.contentHash && local.contentHash.toLowerCase() === remote.contentHash.toLowerCase()) {
    return 'consistent'
  }
  if (Number.isFinite(remote.updatedAt) && remote.updatedAt !== local.updatedAt) {
    return local.updatedAt > Number(remote.updatedAt) ? 'local-newer' : 'tavern-newer'
  }
  return 'unverified-match'
}

export function buildTavernSyncPlan(
  localResources: ResourceSummary[],
  tavernResources: TavernResourceItem[],
): TavernSyncEntry[] {
  const unusedRemote = new Set(tavernResources.map(({ id }) => id))
  const remoteById = new Map(tavernResources.map((item) => [item.id, item]))
  const entries: TavernSyncEntry[] = []
  for (const local of localResources) {
    const kind = bridgeKindOfResource(local)
    const remote = tavernResources.find(
      (candidate) =>
        unusedRemote.has(candidate.id) && candidate.kind === kind && namesMatch(local, candidate),
    )
    if (!remote) {
      entries.push({ status: 'local-only', localId: local.id })
      continue
    }
    unusedRemote.delete(remote.id)
    entries.push({
      status: compareMatched(local, remote),
      localId: local.id,
      tavernId: remote.id,
    })
  }
  for (const id of unusedRemote) {
    if (remoteById.has(id)) entries.push({ status: 'tavern-only', tavernId: id })
  }
  return entries
}

export function summarizeTavernSyncPlan(
  entries: TavernSyncEntry[],
): Record<TavernSyncStatus, number> {
  const summary: Record<TavernSyncStatus, number> = {
    'local-only': 0,
    'tavern-only': 0,
    'local-newer': 0,
    'tavern-newer': 0,
    consistent: 0,
    'unverified-match': 0,
  }
  for (const entry of entries) summary[entry.status] += 1
  return summary
}
