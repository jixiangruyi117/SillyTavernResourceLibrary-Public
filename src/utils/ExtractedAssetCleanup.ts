/**
 * 「清理拆分副本」扫描逻辑：找出由「拆分配套」从角色卡/预设提取出的、
 * 可以安全删除的独立副本。拆分从不修改原件，只有当溯源资源仍在库中
 * 且其当前版仍内嵌对应资产时，副本才被视为可清理；否则绝不列入，
 * 防止误删唯一数据。
 */

import { isExtractedCharacterAsset, RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import { isRecord } from './UnknownValue'

export interface ExtractedCleanupCandidate {
  resource: ResourceSummary
  source: ResourceSummary
  /** 拆分后疑似被编辑过（updatedAt 明显晚于 createdAt），默认不勾选。 */
  possiblyModified: boolean
}

/** updatedAt 比 createdAt 晚超过这个间隔才视为「可能已修改」。 */
export const EXTRACTED_MODIFIED_GRACE_MS = 60_000

function countEntries(value: unknown): number {
  if (Array.isArray(value)) return value.length
  return isRecord(value) ? Object.keys(value).length : 0
}

export function extractedSourceId(resource: ResourceSummary): string | undefined {
  const { extractedFromCharacterId, extractedFromPresetId, extractedFromResourceId } =
    resource.metadata
  for (const value of [extractedFromCharacterId, extractedFromPresetId, extractedFromResourceId]) {
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

function cardDataLayer(source: ResourceSummary): Record<string, unknown> | undefined {
  const card = source.metadata.card
  if (!isRecord(card)) return undefined
  return isRecord(card.data) ? card.data : card
}

/** 溯源资源当前版是否仍内嵌对应资产。 */
export function sourceStillEmbedsAsset(
  source: ResourceSummary,
  kind: 'worldBook' | 'regex',
): boolean {
  const data = cardDataLayer(source)
  if (kind === 'worldBook') {
    if (!data || !isRecord(data.character_book)) return false
    return countEntries(data.character_book.entries) > 0
  }
  if (data) {
    const extensions = isRecord(data.extensions) ? data.extensions : undefined
    return Array.isArray(extensions?.regex_scripts) && extensions.regex_scripts.length > 0
  }
  // 预设来源没有 metadata.card，用解析时统计的配套正则数量判断
  return (
    source.type === RESOURCE_TYPE.PRESET &&
    typeof source.metadata.presetRegexCount === 'number' &&
    source.metadata.presetRegexCount > 0
  )
}

/**
 * 三个条件同时满足才列为可清理项：
 * ① 资源是拆分产物；② 溯源资源仍在库中；③ 溯源当前版仍内嵌对应资产。
 */
export function listExtractedCleanupCandidates(
  resources: ResourceSummary[],
): ExtractedCleanupCandidate[] {
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  const candidates: ExtractedCleanupCandidate[] = []
  for (const resource of resources) {
    if (!isExtractedCharacterAsset(resource)) continue
    const sourceId = extractedSourceId(resource)
    const source = sourceId ? byId.get(sourceId) : undefined
    if (!source) continue
    const kind = resource.metadata.extractedAssetKind as 'worldBook' | 'regex'
    if (!sourceStillEmbedsAsset(source, kind)) continue
    candidates.push({
      resource,
      source,
      possiblyModified: resource.updatedAt - resource.createdAt >= EXTRACTED_MODIFIED_GRACE_MS,
    })
  }
  return candidates.sort(
    (left, right) =>
      left.source.name.localeCompare(right.source.name, 'zh-CN') ||
      left.resource.name.localeCompare(right.resource.name, 'zh-CN'),
  )
}
