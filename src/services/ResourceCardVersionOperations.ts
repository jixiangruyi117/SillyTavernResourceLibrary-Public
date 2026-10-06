import type { ResourceStorageAdapter } from '../storage/ResourceStorageAdapter'
import type { ParsedResource } from '../types/Import'
import { RESOURCE_TYPE, toResourceSummary, type ResourceSummary } from '../types/Resource'
import {
  CHARACTER_CARD_FINGERPRINT_VERSION,
  canonicalizeCharacterCardContent,
  canonicalizeCharacterCardCore,
  computeCardFingerprints,
} from '../utils/CharacterCardFingerprint'
import {
  createVersionMatchEntries,
  findVersionCandidates,
  type VersionCandidate,
} from './ResourceVersionMatcher'

export async function ensureParsedCardFingerprints(parsed: ParsedResource): Promise<void> {
  if (parsed.type !== RESOURCE_TYPE.CHARACTER_CARD) return
  if (
    typeof parsed.metadata.cardContentHash === 'string' &&
    parsed.metadata.cardFingerprintVersion === CHARACTER_CARD_FINGERPRINT_VERSION
  )
    return
  const fingerprints = await computeCardFingerprints(parsed.metadata)
  if (fingerprints) {
    parsed.metadata.cardContentHash = fingerprints.full
    parsed.metadata.cardCoreHash = fingerprints.core
    parsed.metadata.cardFingerprintVersion = CHARACTER_CARD_FINGERPRINT_VERSION
  }
}

export async function findVersionCandidateForGroup(
  storage: ResourceStorageAdapter,
  previewImportFile: (file: File) => Promise<ParsedResource>,
  file: File,
  resourceId: string,
  options: { sameNameVersionCandidates?: boolean } = {},
): Promise<VersionCandidate | undefined> {
  const current = await storage.get(resourceId)
  if (!current) return undefined

  const parsed = await previewImportFile(file)
  const fingerprintSummary = async (resource: ResourceSummary): Promise<ResourceSummary> => {
    if (
      resource.type !== RESOURCE_TYPE.CHARACTER_CARD ||
      (resource.metadata.cardFingerprintVersion === CHARACTER_CARD_FINGERPRINT_VERSION &&
        typeof resource.metadata.cardContentHash === 'string' &&
        typeof resource.metadata.cardCoreHash === 'string')
    )
      return resource
    const fingerprints = await computeCardFingerprints(resource.metadata)
    if (!fingerprints) return resource
    return {
      ...resource,
      metadata: {
        ...resource.metadata,
        cardContentHash: fingerprints.full,
        cardCoreHash: fingerprints.core,
        cardFingerprintVersion: CHARACTER_CARD_FINGERPRINT_VERSION,
      },
    }
  }
  const summaries = await Promise.all([
    fingerprintSummary(toResourceSummary(current)),
    ...(await storage.listVersionSummaries())
      .filter((version) => version.versionGroupId === resourceId)
      .map(fingerprintSummary),
  ])
  const candidates = findVersionCandidates(
    parsed,
    file.name,
    createVersionMatchEntries([summaries[0]!], summaries.slice(1)),
    options,
  )
  await refineCardVersionCandidates(storage, parsed, file.name, candidates)
  return candidates.find((candidate) => candidate.resource.id === resourceId)
}

export async function refineCardVersionCandidates(
  storage: ResourceStorageAdapter,
  parsed: ParsedResource,
  fileName: string,
  candidates: VersionCandidate[],
): Promise<void> {
  if (parsed.type !== RESOURCE_TYPE.CHARACTER_CARD || !candidates.length) return
  const incomingContent = canonicalizeCharacterCardContent(parsed.metadata)
  const incomingCore = canonicalizeCharacterCardCore(parsed.metadata)
  if (incomingContent === undefined) return

  const incomingIsJson = /\.json$/iu.test(fileName)
  for (const candidate of candidates) {
    const stored = candidate.matchedHistorical
      ? await storage.getVersion?.(candidate.matchedResource.id)
      : await storage.get(candidate.matchedResource.id)
    if (!stored) continue
    const existingContent = canonicalizeCharacterCardContent(stored.metadata)
    if (existingContent === undefined) continue
    candidate.matchedResource = toResourceSummary(stored)

    if (incomingContent === existingContent) {
      const existingIsJson = /\.json$/iu.test(stored.fileName) || /json/iu.test(stored.mimeType)
      candidate.matchKind =
        incomingIsJson && existingIsJson ? 'contentDuplicate' : 'containerVariant'
      candidate.score = 100
      candidate.reasons = [
        candidate.matchKind === 'contentDuplicate'
          ? candidate.matchedHistorical
            ? '与历史版本的卡内数据完全一致'
            : '卡内数据完全一致'
          : candidate.matchedHistorical
            ? '与历史版本卡数据一致，仅立绘或文件封装可能不同'
            : '卡数据一致，仅立绘或文件封装可能不同',
      ]
    } else if (
      incomingCore !== undefined &&
      canonicalizeCharacterCardCore(stored.metadata) === incomingCore
    ) {
      candidate.matchKind = 'version'
      candidate.score = 90
      candidate.reasons = [
        candidate.matchedHistorical
          ? '与历史版本核心设定一致，其他卡内字段不同'
          : '核心设定一致，其他卡内字段不同',
      ]
    } else if (
      candidate.score === 100 &&
      (candidate.matchKind === 'contentDuplicate' || candidate.matchKind === 'containerVariant')
    ) {
      candidate.matchKind = 'heuristic'
      candidate.score = 60
      candidate.reasons = ['指纹候选的卡内数据不同，请人工确认']
    }
  }

  const matchPriority = (kind: VersionCandidate['matchKind']): number =>
    kind === 'contentDuplicate' ? 4 : kind === 'containerVariant' ? 3 : kind === 'version' ? 2 : 1
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      matchPriority(right.matchKind) - matchPriority(left.matchKind) ||
      Number(left.matchedHistorical) - Number(right.matchedHistorical) ||
      right.resource.updatedAt - left.resource.updatedAt,
  )
}
