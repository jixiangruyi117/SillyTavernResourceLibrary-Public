import type { ParsedResource, VersionMatchKind } from '../types/Import'
import type { ResourceSummary } from '../types/Resource'
import { readStoredFingerprints } from '../utils/CharacterCardFingerprint'

export interface VersionMatchEntry {
  resource: ResourceSummary
  groupResource: ResourceSummary
  historical: boolean
}

export interface VersionCandidate {
  resource: ResourceSummary
  matchedResource: ResourceSummary
  matchedHistorical: boolean
  matchKind: VersionMatchKind
  score: number
  reasons: string[]
}

export interface StoredVersionRecognitionGroup {
  id: string
  resources: ResourceSummary[]
  matchKind: 'containerVariant' | 'version'
  reasons: string[]
  recommendedKeeperId: string
}

export interface StoredVersionRecognitionReport {
  currentResources: number
  historicalVersions: number
  linkedHistoricalVersions: number
  fingerprintedCards: number
  totalCards: number
  candidateGroups: number
  candidateResources: number
  exactDuplicateGroups: number
  equivalentJsonGroups: number
  sameGroupHistoricalFingerprintGroups: number
  removableHistoricalDuplicateGroups: number
  removableHistoricalDuplicates: number
  protectedContainerVariantGroups: number
}

export interface HistoricalDuplicateGroup {
  id: string
  ownerResourceId: string
  ownerName: string
  kind: 'exactFile' | 'equivalentJson' | 'containerVariant'
  keeper: ResourceSummary
  duplicates: ResourceSummary[]
  resources: ResourceSummary[]
  safeToDelete: boolean
  reason: string
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s·・_\-—–()[\]【】（）.]+/g, '')
}

function baseFileName(value: string): string {
  return normalizeText(
    value
      .replace(/\.[^.]+$/u, '')
      .replace(/(?:^|[\s_-])v?\d+(?:\.\d+)*(?:[\s_-]|$)/giu, ' ')
      .replace(/(?:更新|新版|修订|最终版|final|new|latest)/giu, ''),
  )
}

function isJsonCarrier(fileName: string, mimeType = ''): boolean {
  const normalizedFileName = fileName.trim()
  return (
    /\.json$/iu.test(normalizedFileName) ||
    /^json$/iu.test(normalizedFileName) ||
    /(?:application|text)\/(?:[\w.+-]*\+)?json/iu.test(mimeType)
  )
}

function newestFirst(left: ResourceSummary, right: ResourceSummary): number {
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
}

/**
 * 找出已经位于同一条版本时间线里的重复历史项。
 *
 * 当前版本永远优先保留；若桶内全是历史版本则保留最新一项。文件哈希相同、
 * 或 JSON 载体的完整卡指纹相同可以安全删除。PNG 等二进制载体即使完整卡
 * 指纹相同，也可能只是在同一卡数据上更换了立绘，因此只报告、不自动删除。
 */
export function findHistoricalDuplicateGroups(
  resources: ResourceSummary[],
  versions: ResourceSummary[] = [],
): HistoricalDuplicateGroup[] {
  const currentById = new Map(resources.map((resource) => [resource.id, resource]))
  const linkedVersions = versions.filter(
    (version) => version.versionGroupId && currentById.has(version.versionGroupId),
  )
  const entriesByOwner = new Map<string, ResourceSummary[]>()
  for (const current of resources) entriesByOwner.set(current.id, [current])
  for (const version of linkedVersions) {
    const ownerId = version.versionGroupId!
    entriesByOwner.set(ownerId, [...(entriesByOwner.get(ownerId) ?? []), version])
  }

  const groups: HistoricalDuplicateGroup[] = []
  for (const [ownerResourceId, entries] of entriesByOwner) {
    const owner = currentById.get(ownerResourceId)
    if (!owner || entries.length < 2) continue
    const removedIds = new Set<string>()

    const addSafeBuckets = (
      buckets: Map<string, ResourceSummary[]>,
      kind: 'exactFile' | 'equivalentJson',
      reason: string,
    ): void => {
      for (const bucket of buckets.values()) {
        const available = bucket.filter((resource) => !removedIds.has(resource.id))
        if (available.length < 2) continue
        const keeper =
          available.find((resource) => resource.id === ownerResourceId) ??
          [...available].sort(newestFirst)[0]!
        const duplicates = available.filter(
          (resource) => resource.id !== keeper.id && resource.id !== ownerResourceId,
        )
        if (!duplicates.length) continue
        duplicates.forEach((resource) => removedIds.add(resource.id))
        groups.push({
          id: `${kind}:${ownerResourceId}:${keeper.id}:${duplicates
            .map((resource) => resource.id)
            .sort()
            .join(':')}`,
          ownerResourceId,
          ownerName: owner.name,
          kind,
          keeper,
          duplicates: [...duplicates].sort(newestFirst),
          resources: [keeper, ...duplicates].sort(newestFirst),
          safeToDelete: true,
          reason,
        })
      }
    }

    const exactBuckets = new Map<string, ResourceSummary[]>()
    for (const entry of entries) {
      if (!entry.contentHash) continue
      // 已经属于同一条时间线时，文件 SHA-256 才是是否为同一文件的最终证据。
      // 存量 JSON 可能在解析器升级前被标成 other，升级后当前版变成 characterCard；
      // 若继续把 type 放进桶键，相同文件会因历史分类不同而永远漏过清理。
      const key = entry.contentHash
      exactBuckets.set(key, [...(exactBuckets.get(key) ?? []), entry])
    }
    addSafeBuckets(exactBuckets, 'exactFile', '文件 SHA-256 完全相同，删除历史副本不损失内容')

    const jsonBuckets = new Map<string, ResourceSummary[]>()
    for (const entry of entries) {
      if (removedIds.has(entry.id) || !isJsonCarrier(entry.fileName, entry.mimeType)) continue
      const full = readStoredFingerprints(entry.metadata).full
      if (!full) continue
      const key = full
      jsonBuckets.set(key, [...(jsonBuckets.get(key) ?? []), entry])
    }
    addSafeBuckets(
      jsonBuckets,
      'equivalentJson',
      '完整卡数据相同且都是 JSON，仅格式或外层包装不同，可安全删除历史副本',
    )

    const variantBuckets = new Map<string, ResourceSummary[]>()
    for (const entry of entries) {
      if (removedIds.has(entry.id)) continue
      const full = readStoredFingerprints(entry.metadata).full
      if (!full) continue
      const key = full
      variantBuckets.set(key, [...(variantBuckets.get(key) ?? []), entry])
    }
    for (const bucket of variantBuckets.values()) {
      if (bucket.length < 2) continue
      const contentHashes = new Set(bucket.map((resource) => resource.contentHash))
      const allJson = bucket.every((resource) =>
        isJsonCarrier(resource.fileName, resource.mimeType),
      )
      if (contentHashes.size < 2 || allJson) continue
      const keeper =
        bucket.find((resource) => resource.id === ownerResourceId) ??
        [...bucket].sort(newestFirst)[0]!
      groups.push({
        id: `containerVariant:${ownerResourceId}:${bucket
          .map((resource) => resource.id)
          .sort()
          .join(':')}`,
        ownerResourceId,
        ownerName: owner.name,
        kind: 'containerVariant',
        keeper,
        duplicates: [],
        resources: [...bucket].sort(newestFirst),
        safeToDelete: false,
        reason: '卡数据指纹相同但二进制文件不同，可能是不同立绘或封装，系统不会自动删除',
      })
    }
  }

  return groups.sort(
    (left, right) =>
      Number(right.safeToDelete) - Number(left.safeToDelete) ||
      right.duplicates.length - left.duplicates.length ||
      newestFirst(left.keeper, right.keeper),
  )
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readCreator(metadata: Record<string, unknown>): string {
  const direct = readString(metadata.creator)
  if (direct) return direct
  const card = metadata.card
  if (!card || typeof card !== 'object' || Array.isArray(card)) return ''
  const cardRecord = card as Record<string, unknown>
  const rawData = cardRecord.data ?? cardRecord
  return rawData && typeof rawData === 'object' && !Array.isArray(rawData)
    ? readString((rawData as Record<string, unknown>).creator)
    : ''
}

function stableIdentity(metadata: Record<string, unknown>): string[] {
  const values: string[] = []
  const visit = (record: Record<string, unknown> | undefined): void => {
    if (!record) return
    for (const key of ['uuid', 'character_id', 'characterId', 'source_id', 'sourceId']) {
      const value = readString(record[key])
      if (value) values.push(`${key}:${normalizeText(value)}`)
    }
    const source = record.source
    if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
      values.push(`source:${source.trim().toLocaleLowerCase()}`)
    }
  }
  visit(metadata)
  const card = metadata.card
  if (card && typeof card === 'object' && !Array.isArray(card)) {
    const cardRecord = card as Record<string, unknown>
    visit(cardRecord)
    const data = cardRecord.data
    if (data && typeof data === 'object' && !Array.isArray(data))
      visit(data as Record<string, unknown>)
  }
  return Array.from(new Set(values))
}

function tokens(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const words = normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []
  return new Set(words.slice(0, 300))
}

function jaccard(left: string, right: string): number {
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  if (!leftTokens.size || !rightTokens.size) return 0
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  return intersection / (leftTokens.size + rightTokens.size - intersection)
}

function matchPriority(kind: VersionMatchKind): number {
  if (kind === 'contentDuplicate') return 4
  if (kind === 'containerVariant') return 3
  if (kind === 'version') return 2
  return 1
}

function preferCandidate(left: VersionCandidate, right: VersionCandidate): VersionCandidate {
  if (left.score !== right.score) return left.score > right.score ? left : right
  const priorityDifference = matchPriority(left.matchKind) - matchPriority(right.matchKind)
  if (priorityDifference !== 0) return priorityDifference > 0 ? left : right
  if (left.matchedHistorical !== right.matchedHistorical) {
    return left.matchedHistorical ? left : right
  }
  return left.matchedResource.updatedAt >= right.matchedResource.updatedAt ? left : right
}

export function createVersionMatchEntries(
  resources: ResourceSummary[],
  versions: ResourceSummary[],
): VersionMatchEntry[] {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  return [
    ...resources.map((resource) => ({
      resource,
      groupResource: resource,
      historical: false,
    })),
    ...versions.flatMap((version): VersionMatchEntry[] => {
      if (!version.versionGroupId) return []
      const groupResource = resourcesById.get(version.versionGroupId)
      return groupResource ? [{ resource: version, groupResource, historical: true }] : []
    }),
  ]
}

export function findVersionCandidates(
  parsed: ParsedResource,
  fileName: string,
  entries: VersionMatchEntry[],
): VersionCandidate[] {
  const incomingName = normalizeText(parsed.name)
  const incomingCreator = normalizeText(readCreator(parsed.metadata))
  const incomingStableIds = new Set(stableIdentity(parsed.metadata))
  const incomingFileBase = baseFileName(fileName)
  const incomingFingerprints = readStoredFingerprints(parsed.metadata)
  const candidatesByGroup = new Map<string, VersionCandidate>()

  for (const entry of entries) {
    const existing = entry.resource
    if (existing.type !== parsed.type) continue

    const reasons: string[] = []
    let score = 0
    let matchKind: VersionMatchKind = 'heuristic'
    const existingStableIds = stableIdentity(existing.metadata)
    const existingFingerprints = readStoredFingerprints(existing.metadata)

    if (incomingFingerprints.full && incomingFingerprints.full === existingFingerprints.full) {
      score = 100
      const bothJson =
        isJsonCarrier(fileName) && isJsonCarrier(existing.fileName, existing.mimeType)
      matchKind = bothJson ? 'contentDuplicate' : 'containerVariant'
      reasons.push(
        bothJson
          ? entry.historical
            ? '与历史版本的卡内数据完全一致'
            : '卡内数据完全一致'
          : entry.historical
            ? '与历史版本卡数据一致，仅立绘或文件封装可能不同'
            : '卡数据一致，仅立绘或文件封装可能不同',
      )
    } else if (
      incomingFingerprints.core &&
      incomingFingerprints.core === existingFingerprints.core
    ) {
      score = 90
      matchKind = 'version'
      reasons.push(entry.historical ? '与历史版本核心内容一致' : '核心内容一致，附加字段不同')
    } else if (existingStableIds.some((value) => incomingStableIds.has(value))) {
      score = 100
      matchKind = 'version'
      reasons.push(entry.historical ? '与历史版本的稳定来源 ID 相同' : '稳定来源 ID 相同')
    } else {
      if (incomingName && incomingName === normalizeText(existing.name)) {
        score += 45
        reasons.push('名称相同')
      }
      const existingCreator = normalizeText(readCreator(existing.metadata))
      if (incomingCreator && incomingCreator === existingCreator) {
        score += 25
        reasons.push('作者相同')
      }
      if (incomingFileBase && incomingFileBase === baseFileName(existing.fileName)) {
        score += 15
        reasons.push('文件名主体相同')
      }
      const descriptionSimilarity = jaccard(parsed.description, existing.description)
      if (descriptionSimilarity >= 0.35) {
        const points = Math.round(descriptionSimilarity * 18)
        score += points
        reasons.push(`内容摘要相似 ${Math.round(descriptionSimilarity * 100)}%`)
      }
    }

    if (score < 60) continue
    const candidate: VersionCandidate = {
      resource: entry.groupResource,
      matchedResource: existing,
      matchedHistorical: entry.historical,
      matchKind,
      score: Math.min(100, score),
      reasons,
    }
    const current = candidatesByGroup.get(entry.groupResource.id)
    candidatesByGroup.set(
      entry.groupResource.id,
      current ? preferCandidate(current, candidate) : candidate,
    )
  }

  return Array.from(candidatesByGroup.values())
    .sort(
      (left, right) =>
        right.score - left.score ||
        matchPriority(right.matchKind) - matchPriority(left.matchKind) ||
        right.resource.updatedAt - left.resource.updatedAt,
    )
    .slice(0, 3)
}

export function findStoredVersionGroups(
  resources: ResourceSummary[],
  versions: ResourceSummary[] = [],
): StoredVersionRecognitionGroup[] {
  interface StoredEvidence {
    resource: ResourceSummary
    ownerIndex: number
    historical: boolean
  }
  const parent = resources.map((_resource, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!
      index = parent[index]!
    }
    return index
  }
  const union = (left: number, right: number): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }
  const edgeKinds = new Map<string, 'containerVariant' | 'version'>()
  const edgeReasons = new Map<string, string>()
  const edgeKey = (left: number, right: number): string =>
    left < right ? `${left}:${right}` : `${right}:${left}`
  const connect = (
    left: StoredEvidence,
    right: StoredEvidence,
    kind: 'containerVariant' | 'version',
    reason: string,
  ): void => {
    if (left.ownerIndex === right.ownerIndex) return
    if (
      left.resource.contentHash === right.resource.contentHash &&
      !left.historical &&
      !right.historical
    )
      return
    union(left.ownerIndex, right.ownerIndex)
    const key = edgeKey(left.ownerIndex, right.ownerIndex)
    if (edgeKinds.get(key) !== 'version') edgeKinds.set(key, kind)
    edgeReasons.set(key, left.historical || right.historical ? `${reason}（命中历史版本）` : reason)
  }
  const fullBuckets = new Map<string, StoredEvidence[]>()
  const coreBuckets = new Map<string, StoredEvidence[]>()
  const identityBuckets = new Map<string, StoredEvidence[]>()
  const contentBuckets = new Map<string, StoredEvidence[]>()

  const addEvidence = (evidence: StoredEvidence): void => {
    const { resource } = evidence
    if (resource.contentHash) {
      const key = `${resource.type}:${resource.contentHash}`
      contentBuckets.set(key, [...(contentBuckets.get(key) ?? []), evidence])
    }
    const fingerprints = readStoredFingerprints(resource.metadata)
    if (fingerprints.full) {
      const key = `${resource.type}:${fingerprints.full}`
      fullBuckets.set(key, [...(fullBuckets.get(key) ?? []), evidence])
    }
    if (fingerprints.core) {
      const key = `${resource.type}:${fingerprints.core}`
      coreBuckets.set(key, [...(coreBuckets.get(key) ?? []), evidence])
    }
    for (const identity of stableIdentity(resource.metadata)) {
      const key = `${resource.type}:${identity}`
      identityBuckets.set(key, [...(identityBuckets.get(key) ?? []), evidence])
    }
  }
  resources.forEach((resource, ownerIndex) => {
    addEvidence({ resource, ownerIndex, historical: false })
  })
  const ownerIndices = new Map(resources.map((resource, index) => [resource.id, index]))
  for (const version of versions) {
    if (!version.versionGroupId) continue
    const ownerIndex = ownerIndices.get(version.versionGroupId)
    if (ownerIndex === undefined) continue
    addEvidence({ resource: version, ownerIndex, historical: true })
  }

  for (const evidence of contentBuckets.values()) {
    for (let left = 0; left < evidence.length; left += 1) {
      for (let right = left + 1; right < evidence.length; right += 1) {
        const leftEvidence = evidence[left]!
        const rightEvidence = evidence[right]!
        if (!leftEvidence.historical && !rightEvidence.historical) continue
        connect(leftEvidence, rightEvidence, 'version', '同一文件出现在不同资源组的历史时间线中')
      }
    }
  }

  for (const evidence of fullBuckets.values()) {
    for (let left = 0; left < evidence.length; left += 1) {
      for (let right = left + 1; right < evidence.length; right += 1) {
        const leftEvidence = evidence[left]!
        const rightEvidence = evidence[right]!
        const leftResource = leftEvidence.resource
        const rightResource = rightEvidence.resource
        const bothJson =
          isJsonCarrier(leftResource.fileName, leftResource.mimeType) &&
          isJsonCarrier(rightResource.fileName, rightResource.mimeType)
        if (bothJson) {
          if (!leftEvidence.historical && !rightEvidence.historical) continue
          connect(
            leftEvidence,
            rightEvidence,
            'version',
            '等价 JSON 卡数据出现在不同资源组的历史时间线中',
          )
          continue
        }
        connect(
          leftEvidence,
          rightEvidence,
          'containerVariant',
          '卡内数据完全一致，仅立绘或文件封装不同',
        )
      }
    }
  }

  for (const evidence of coreBuckets.values()) {
    for (let left = 0; left < evidence.length; left += 1) {
      for (let right = left + 1; right < evidence.length; right += 1) {
        const leftEvidence = evidence[left]!
        const rightEvidence = evidence[right]!
        const leftFingerprints = readStoredFingerprints(leftEvidence.resource.metadata)
        const rightFingerprints = readStoredFingerprints(rightEvidence.resource.metadata)
        if (
          !leftFingerprints.full ||
          !rightFingerprints.full ||
          leftFingerprints.full === rightFingerprints.full
        )
          continue
        connect(leftEvidence, rightEvidence, 'version', '核心内容一致，附加字段或版本内容不同')
      }
    }
  }

  for (const evidence of identityBuckets.values()) {
    for (let left = 0; left < evidence.length; left += 1) {
      for (let right = left + 1; right < evidence.length; right += 1) {
        connect(evidence[left]!, evidence[right]!, 'version', '稳定来源 ID 相同')
      }
    }
  }

  const components = new Map<number, number[]>()
  resources.forEach((_resource, index) => {
    const root = find(index)
    components.set(root, [...(components.get(root) ?? []), index])
  })

  return Array.from(components.values())
    .filter((indices) => indices.length > 1)
    .map((indices): StoredVersionRecognitionGroup => {
      const reasons = new Set<string>()
      let matchKind: 'containerVariant' | 'version' = 'containerVariant'
      for (let left = 0; left < indices.length; left += 1) {
        for (let right = left + 1; right < indices.length; right += 1) {
          const key = edgeKey(indices[left]!, indices[right]!)
          const kind = edgeKinds.get(key)
          if (kind === 'version') matchKind = 'version'
          const reason = edgeReasons.get(key)
          if (reason) reasons.add(reason)
        }
      }
      const membersByContentHash = new Map<string, ResourceSummary>()
      for (const index of indices) {
        const resource = resources[index]!
        const current = membersByContentHash.get(resource.contentHash)
        if (!current || resource.updatedAt > current.updatedAt)
          membersByContentHash.set(resource.contentHash, resource)
      }
      const members = Array.from(membersByContentHash.values()).sort(
        (left, right) => right.updatedAt - left.updatedAt,
      )
      const recommended =
        matchKind === 'containerVariant'
          ? members.find(
              (resource) =>
                !isJsonCarrier(resource.fileName, resource.mimeType) &&
                (/^image\//i.test(resource.mimeType) || /\.png$/i.test(resource.fileName)),
            )
          : members[0]
      return {
        id: members
          .map((resource) => resource.id)
          .sort()
          .join(':'),
        resources: members,
        matchKind,
        reasons: Array.from(reasons),
        recommendedKeeperId: (recommended ?? members[0]!).id,
      }
    })
    .filter((group) => group.resources.length > 1)
    .sort(
      (left, right) =>
        right.resources.length - left.resources.length ||
        right.resources[0]!.updatedAt - left.resources[0]!.updatedAt,
    )
}

/**
 * 给批量重识别界面使用的可解释扫描摘要。
 *
 * 这里把“没有成为历史版本候选”的两类常见情况也单独统计出来：
 * 完全相同的文件，以及两个卡数据等价的 JSON。它们应该进入重复清理，
 * 不能为了让结果看起来更多而伪装成版本。
 */
export function buildStoredVersionRecognitionReport(
  resources: ResourceSummary[],
  versions: ResourceSummary[] = [],
  groups = findStoredVersionGroups(resources, versions),
  historicalDuplicateGroups = findHistoricalDuplicateGroups(resources, versions),
): StoredVersionRecognitionReport {
  const currentIds = new Set(resources.map((resource) => resource.id))
  const linkedVersions = versions.filter(
    (version) => version.versionGroupId && currentIds.has(version.versionGroupId),
  )
  const cardResources = [...resources, ...linkedVersions].filter(
    (resource) => resource.type === 'characterCard',
  )
  const fingerprintedCards = cardResources.filter((resource) => {
    const fingerprints = readStoredFingerprints(resource.metadata)
    return Boolean(fingerprints.full || fingerprints.core)
  }).length

  const exactBuckets = new Map<string, number>()
  for (const resource of resources) {
    if (!resource.contentHash) continue
    const key = `${resource.type}:${resource.contentHash}`
    exactBuckets.set(key, (exactBuckets.get(key) ?? 0) + 1)
  }

  const jsonFingerprintBuckets = new Map<string, ResourceSummary[]>()
  for (const resource of resources) {
    if (!isJsonCarrier(resource.fileName, resource.mimeType)) continue
    const full = readStoredFingerprints(resource.metadata).full
    if (!full) continue
    const key = `${resource.type}:${full}`
    jsonFingerprintBuckets.set(key, [...(jsonFingerprintBuckets.get(key) ?? []), resource])
  }
  const sameGroupHistoricalFingerprints = new Map<string, number>()
  for (const version of linkedVersions) {
    const full = readStoredFingerprints(version.metadata).full
    if (!full || !version.versionGroupId) continue
    const key = `${version.versionGroupId}:${full}`
    sameGroupHistoricalFingerprints.set(key, (sameGroupHistoricalFingerprints.get(key) ?? 0) + 1)
  }
  const removableHistoricalGroups = historicalDuplicateGroups.filter((group) => group.safeToDelete)

  return {
    currentResources: resources.length,
    historicalVersions: versions.length,
    linkedHistoricalVersions: linkedVersions.length,
    fingerprintedCards,
    totalCards: cardResources.length,
    candidateGroups: groups.length,
    candidateResources: groups.reduce((total, group) => total + group.resources.length, 0),
    exactDuplicateGroups: Array.from(exactBuckets.values()).filter((count) => count > 1).length,
    equivalentJsonGroups: Array.from(jsonFingerprintBuckets.values()).filter(
      (bucket) =>
        bucket.length > 1 && new Set(bucket.map((resource) => resource.contentHash)).size > 1,
    ).length,
    sameGroupHistoricalFingerprintGroups: Array.from(
      sameGroupHistoricalFingerprints.values(),
    ).filter((count) => count > 1).length,
    removableHistoricalDuplicateGroups: removableHistoricalGroups.length,
    removableHistoricalDuplicates: removableHistoricalGroups.reduce(
      (total, group) => total + group.duplicates.length,
      0,
    ),
    protectedContainerVariantGroups: historicalDuplicateGroups.filter(
      (group) => !group.safeToDelete,
    ).length,
  }
}
