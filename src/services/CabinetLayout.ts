import type { CabinetLayoutEntry } from './BrowserStorageService'

export type CabinetLayoutIdentity = Pick<CabinetLayoutEntry, 'kind' | 'id'>

function cabinetLayoutKey(entry: CabinetLayoutIdentity): string {
  return `${entry.kind}:${entry.id}`
}

export function sortCabinetLayout(layout: CabinetLayoutEntry[]): CabinetLayoutEntry[] {
  return layout.slice().sort((left, right) => left.slot - right.slot)
}

export function cabinetLayoutSignature(layout: CabinetLayoutEntry[]): string {
  return layout
    .map((entry) => `${entry.kind}:${entry.id}:${entry.slot}:${entry.columnSpan}:${entry.rowSpan}`)
    .join('|')
}

export function getCabinetFolderOrder(layout: CabinetLayoutEntry[]): string[] {
  return sortCabinetLayout(layout)
    .filter((entry) => entry.kind === 'folder')
    .map((entry) => entry.id)
}

export function moveCabinetLayoutEntry(
  layout: CabinetLayoutEntry[],
  identity: CabinetLayoutIdentity,
  targetSlot: number,
): CabinetLayoutEntry[] | undefined {
  if (!Number.isInteger(targetSlot) || targetSlot < 0) return undefined
  const source = layout.find((entry) => entry.kind === identity.kind && entry.id === identity.id)
  if (!source || source.slot === targetSlot) return undefined

  const sourceSlot = source.slot
  const targetOccupied = layout.some((entry) => entry.slot === targetSlot)
  return sortCabinetLayout(
    layout.map((entry) => {
      if (entry.kind === identity.kind && entry.id === identity.id) {
        return { ...entry, slot: targetSlot }
      }
      if (!targetOccupied) return entry
      if (sourceSlot < targetSlot && entry.slot > sourceSlot && entry.slot <= targetSlot) {
        return { ...entry, slot: entry.slot - 1 }
      }
      if (sourceSlot > targetSlot && entry.slot >= targetSlot && entry.slot < sourceSlot) {
        return { ...entry, slot: entry.slot + 1 }
      }
      return entry
    }),
  )
}

export function reconcileCabinetLayout(
  storedLayout: CabinetLayoutEntry[],
  validEntries: CabinetLayoutIdentity[],
): CabinetLayoutEntry[] {
  const validKeys = new Set(validEntries.map(cabinetLayoutKey))
  const layout = storedLayout.filter((entry) => validKeys.has(cabinetLayoutKey(entry)))
  const presentKeys = new Set(layout.map(cabinetLayoutKey))
  const usedSlots = new Set(layout.map((entry) => entry.slot))

  for (const entry of validEntries) {
    const key = cabinetLayoutKey(entry)
    if (presentKeys.has(key)) continue
    let slot = 0
    while (usedSlots.has(slot)) slot += 1
    usedSlots.add(slot)
    presentKeys.add(key)
    layout.push({ ...entry, slot, columnSpan: 1, rowSpan: 1 })
  }

  return sortCabinetLayout(layout)
}
