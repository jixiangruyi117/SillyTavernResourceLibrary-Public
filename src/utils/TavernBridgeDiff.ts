import type { TavernResourceItem, TavernResourceKind } from '../services/TavernBridgeProtocol'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

/**
 * 酒馆互传两端差异计算。
 *
 * 双端没有共享的稳定 ID，只能按「类型 + 名称/文件名主体」匹配，
 * 因此标记措辞必须是「可能已存在」而非断言同内容；
 * 该判断只用于筛选与提示，不阻止任何传输。
 */

export function normalizeBridgeName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\.(?:png|json)$/i, '')
    .toLocaleLowerCase()
}

/** SRL 资源类型 → 互传资源种类；与发送逻辑保持同一映射。 */
export function bridgeKindOfResource(resource: ResourceSummary): TavernResourceKind | undefined {
  if (resource.type === RESOURCE_TYPE.CHAT) return 'chat'
  if (resource.type === RESOURCE_TYPE.USER_PERSONA) return 'userPersona'
  if (resource.type === RESOURCE_TYPE.CHARACTER_CARD) return 'character'
  if (resource.type === RESOURCE_TYPE.WORLD_BOOK) return 'worldBook'
  if (resource.type === RESOURCE_TYPE.PRESET) return 'preset'
  if (resource.type === RESOURCE_TYPE.REGEX) {
    if (typeof resource.metadata.extractedFromCharacterId === 'string') return 'regexCharacter'
    if (typeof resource.metadata.extractedFromPresetId === 'string') return 'regexPreset'
    if (resource.metadata.regexScope === 'character') return 'regexCharacter'
    if (resource.metadata.regexScope === 'preset') return 'regexPreset'
    return 'regexGlobal'
  }
  if (resource.type === RESOURCE_TYPE.QUICK_REPLY) return 'quickReply'
  if (resource.type === RESOURCE_TYPE.SCRIPT) return 'scriptGlobal'
  if (
    resource.type === RESOURCE_TYPE.BEAUTIFICATION &&
    resource.metadata.detectedVariant === 'theme'
  ) {
    return 'theme'
  }
  return undefined
}

export type BridgeNameIndex = Map<TavernResourceKind, Set<string>>

function addName(index: BridgeNameIndex, kind: TavernResourceKind, value: string): void {
  const normalized = normalizeBridgeName(value)
  if (!normalized) return
  const bucket = index.get(kind)
  if (bucket) bucket.add(normalized)
  else index.set(kind, new Set([normalized]))
}

export function buildTavernNameIndex(items: TavernResourceItem[]): BridgeNameIndex {
  const index: BridgeNameIndex = new Map()
  for (const item of items) {
    addName(index, item.kind, item.name)
    addName(index, item.kind, item.fileName)
  }
  return index
}

export function buildLocalNameIndex(resources: ResourceSummary[]): BridgeNameIndex {
  const index: BridgeNameIndex = new Map()
  for (const resource of resources) {
    const kind = bridgeKindOfResource(resource)
    if (!kind) continue
    addName(index, kind, resource.name)
    addName(index, kind, resource.fileName)
  }
  return index
}

function existsIn(index: BridgeNameIndex, kind: TavernResourceKind, names: string[]): boolean {
  const bucket = index.get(kind)
  if (!bucket) return false
  return names.some((value) => {
    const normalized = normalizeBridgeName(value)
    return normalized ? bucket.has(normalized) : false
  })
}

export function tavernItemExistsLocally(
  item: TavernResourceItem,
  localIndex: BridgeNameIndex,
): boolean {
  return existsIn(localIndex, item.kind, [item.name, item.fileName])
}

export function localResourceExistsInTavern(
  resource: ResourceSummary,
  tavernIndex: BridgeNameIndex,
): boolean {
  const kind = bridgeKindOfResource(resource)
  if (!kind) return false
  return existsIn(tavernIndex, kind, [resource.name, resource.fileName])
}
