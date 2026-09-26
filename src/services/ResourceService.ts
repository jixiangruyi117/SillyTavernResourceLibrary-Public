import * as versionOperations from './ResourceVersionOperations'
import { JSON_RESOURCE_PARSER_VERSION } from '../parser/JsonResourceParser'
import type { ResourceParserRegistry } from '../parser/ResourceParser'
import type { ResourceStorageAdapter } from '../storage/ResourceStorageAdapter'
import type { ImportResult, ParsedResource } from '../types/Import'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'
import {
  getResourceLinkRiskBadges,
  getRelatedResourceIds,
  normalizeResourceLinks,
  normalizeResource,
  RESOURCE_INSTALL_TARGET,
  RESOURCE_TYPE,
  isUserPersonaAvatarAttachment,
  toResourceListSummary,
  toResourceSummary,
  type Resource,
  type ResourceBackupDescriptor,
  type ResourceListSummary,
  type ResourceLink,
  type ResourceReference,
  type ResourceSummary,
  type ResourceType,
} from '../types/Resource'
import {
  CHARACTER_CARD_FINGERPRINT_VERSION,
  computeCardFingerprints,
} from '../utils/CharacterCardFingerprint'
import { createImageThumbnail } from '../utils/createImageThumbnail'
import { hashFile } from './HashService'
import { importPipeline, type ImportFileContext } from './ImportPipeline'
import {
  inspectGitHubResource,
  type GitHubResourceInspection,
  type GitHubResourceInspector,
} from './GitHubResourceInspector'
import {
  createCharacterCardArtworkFile,
  type CharacterCardOverrides,
} from '../utils/CharacterCardCustomization'
import {
  createVersionMatchEntries,
  findVersionCandidates,
  type VersionMatchEntry,
} from './ResourceVersionMatcher'
import {
  resourceVersionLabel,
  countResourceLogicalVersions,
  findManualTypeOverride,
} from './ResourceVersionIdentity'
import {
  normalizeTags,
  safeLinkFileName,
  linkResourceType,
  linkResourceName,
  linkResourceDescription,
  linkResourceTags,
  createResourceLinkDraftFromUrl,
} from './ResourceLinkImport'
import { collectEmbeddedAssets } from './ResourceEmbeddedAssets'
import {
  type ImportOptions,
  type PreparedFileImportOptions,
  type ResourceVersionView,
  type CharacterAssetExtractionReport,
  type ExternalAppResourceUpdate,
  type AiTagMutationEntry,
  type AiTagMutationResult,
} from '../types/ResourceOperations'
import * as operationsResourceOrganizationOperations from './ResourceOrganizationOperations'

export {
  type ImportOptions,
  type PreparedFileImportOptions,
  type ResourceVersionView,
  type CharacterAssetExtractionReport,
  type ExternalAppResourceUpdate,
  type AiTagMutationEntry,
  type AiTagMutationResult,
} from '../types/ResourceOperations'

export { resourceLogicalVersionKey, countResourceLogicalVersions } from './ResourceVersionIdentity'

export interface ParsedCharacterTagCandidate {
  resource: ResourceSummary
  tags: string[]
}

export interface ParsedCharacterTagRemoval {
  resourceId: string
  tags: string[]
}

export interface ParsedTagProgress {
  completed: number
  total: number
  resourceName: string
  failed: number
}

async function createContentHash(file: File): Promise<string> {
  return hashFile(file)
}

export class ResourceService {
  private readonly storage: ResourceStorageAdapter
  private readonly parserRegistry: ResourceParserRegistry
  private readonly linkInspector: GitHubResourceInspector
  // Only names and hashes from the current scan; never retain original files here.
  private readonly parsedTagCache = new Map<string, { hash: string; tags: string[] }>()

  constructor(
    storage: ResourceStorageAdapter,
    parserRegistry: ResourceParserRegistry,
    linkInspector: GitHubResourceInspector = inspectGitHubResource,
  ) {
    this.storage = storage
    this.parserRegistry = parserRegistry
    this.linkInspector = linkInspector
  }

  findByContentHash(hash: string): Promise<Resource | undefined> {
    return this.storage.findByHash(hash)
  }

  list(): Promise<Resource[]> {
    return this.storage.list()
  }

  listSummaries(): Promise<ResourceSummary[]> {
    return this.storage.listSummaries()
  }

  async listResourceListSummaries(): Promise<ResourceListSummary[]> {
    if (this.storage.listResourceListSummaries) {
      return this.storage.listResourceListSummaries()
    }
    return (await this.storage.listSummaries()).map(toResourceListSummary)
  }

  repairThumbnailAssets(): Promise<number> {
    return this.storage.repairThumbnailAssets?.() ?? Promise.resolve(0)
  }

  listAllVersions(): Promise<Resource[]> {
    return this.storage.listAllVersions()
  }

  listVersionSummaries(light = false): Promise<ResourceSummary[]> {
    return light && this.storage.listVersionListSummaries
      ? this.storage.listVersionListSummaries()
      : this.storage.listVersionSummaries()
  }

  get(id: string): Promise<Resource | undefined> {
    return this.storage.get(id)
  }

  async getVersion(id: string): Promise<Resource | undefined> {
    if (this.storage.getVersion) return this.storage.getVersion(id)
    return (await this.storage.listAllVersions()).find((version) => version.id === id)
  }

  updateBackupDescriptor(
    id: string,
    descriptor: ResourceBackupDescriptor,
    historical = false,
  ): Promise<void> {
    return historical
      ? this.storage.updateVersion(id, { backupDescriptor: descriptor })
      : this.storage.update(id, { backupDescriptor: descriptor })
  }

  async importPreparedFile(
    file: File,
    parsed: ParsedResource,
    options: PreparedFileImportOptions = {},
  ): Promise<ImportResult> {
    try {
      const context = importPipeline.intake<ParsedResource>(file)
      const contentHash = await context.hash()
      if (!options.allowContentDuplicate) {
        const duplicate =
          (await this.storage.findByHash(contentHash)) ??
          (await this.storage.findVersionByHash(contentHash))
        if (duplicate) {
          return {
            status: 'duplicate',
            fileName: file.name,
            message: '相同文件已经存在于资源库中',
            resource: duplicate,
            reclassified: false,
          }
        }
      }
      const resource = await this.createImportedResource(file, parsed, contentHash, context)
      await this.storage.save(resource)
      context.mark('commit')
      return { status: 'imported', fileName: file.name, resource }
    } catch (error) {
      return {
        status: 'failed',
        fileName: file.name,
        message: error instanceof Error ? error.message : '资源保存失败',
      }
    }
  }

  /** 角色卡写入与封装无关的内容指纹，供版本匹配与「同卡不同封装」查重使用。 */
  private async ensureParsedFingerprints(parsed: ParsedResource): Promise<void> {
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

  private async createVersionMatchIndex(
    resources: ResourceSummary[],
    versions: ResourceSummary[],
  ): Promise<VersionMatchEntry[]> {
    const withFingerprints = async (resource: ResourceSummary): Promise<ResourceSummary> => {
      if (
        resource.type !== RESOURCE_TYPE.CHARACTER_CARD ||
        (typeof resource.metadata.cardContentHash === 'string' &&
          resource.metadata.cardFingerprintVersion === CHARACTER_CARD_FINGERPRINT_VERSION)
      ) {
        return resource
      }
      const fingerprints = await computeCardFingerprints(resource.metadata)
      return fingerprints
        ? {
            ...resource,
            metadata: {
              ...resource.metadata,
              cardContentHash: fingerprints.full,
              cardCoreHash: fingerprints.core,
              cardFingerprintVersion: CHARACTER_CARD_FINGERPRINT_VERSION,
            },
          }
        : resource
    }
    const [activeResources, historicalVersions] = await Promise.all([
      Promise.all(resources.map(withFingerprints)),
      Promise.all(versions.map(withFingerprints)),
    ])
    return createVersionMatchEntries(activeResources, historicalVersions)
  }

  private async createImportedResource(
    file: File,
    parsedResource?: ParsedResource,
    knownHash?: string,
    context?: ImportFileContext<ParsedResource>,
  ): Promise<Resource> {
    const importContext = context ?? importPipeline.intake<ParsedResource>(file)
    const parsed =
      parsedResource ?? (await importContext.parse((source) => this.parserRegistry.parse(source)))
    await this.ensureParsedFingerprints(parsed)
    const now = Date.now()
    const isAvatarAttachment = isUserPersonaAvatarAttachment(parsed)
    const thumbnailBlob =
      (parsed.type === RESOURCE_TYPE.CHARACTER_CARD || isAvatarAttachment) &&
      (file.type === 'image/png' || /\.png$/i.test(file.name))
        ? ((await importContext.remember('thumbnail:preview', () => createImageThumbnail(file))) ??
          (isAvatarAttachment ? file : undefined))
        : parsed.thumbnailBlob
    const resource: Resource = {
      id: crypto.randomUUID(),
      ...parsed,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      contentHash: knownHash ?? (await importContext.hash()),
      favorite: false,
      categoryId: null,
      categoryIds: [],
      relatedResourceIds: [],
      tags: parsed.tags ?? [],
      thumbnailBlob,
      originalBlob: file,
      versionImportedAt: now,
      versionCount: 1,
      createdAt: now,
      updatedAt: now,
    }
    resource.versionLabel = resourceVersionLabel(resource)
    return resource
  }

  async listVersions(resourceId: string): Promise<ResourceVersionView[]> {
    return versionOperations.listVersions(this.storage, resourceId)
  }

  async updatePersonalContent(
    file: File,
    parsed: ParsedResource,
    resourceId: string,
  ): Promise<Resource> {
    return versionOperations.updatePersonalContent(this.storage, file, parsed, resourceId)
  }

  async updatePersonalMetadata(current: Resource, parsed: ParsedResource): Promise<Resource> {
    if (current.type !== RESOURCE_TYPE.POCKET_PHONE || parsed.type !== current.type)
      throw new Error('只能更新小手机资料')
    if (!this.storage.updateMetadata) throw new Error('当前存储不支持局部更新')
    const summary = await this.storage.updateMetadata(
      current.id,
      {
        name: parsed.name,
        description: parsed.description,
        metadata: parsed.metadata,
        thumbnailBlob: parsed.thumbnailBlob,
        backupDescriptor: undefined,
        updatedAt: Date.now(),
      },
      JSON.stringify(current.metadata.personalDocument ?? null),
    )
    return { ...summary, originalBlob: current.originalBlob, thumbnailBlob: parsed.thumbnailBlob }
  }

  async importAsVersion(...request: versionOperations.VersionImportRequest): Promise<Resource> {
    return versionOperations.importAsVersion(
      this.storage,
      (source) => this.createImportedResource(source),
      ...request,
    )
  }

  async replaceCharacterCardArtwork(resourceId: string, artwork: File): Promise<Resource> {
    const current = await this.storage.get(resourceId)
    if (!current) throw new Error('要更换卡面的角色卡已经不存在')
    const file = await createCharacterCardArtworkFile(current, artwork)
    return this.importAsVersion(file, resourceId, true, '用户自定义卡面', 'container', {
      artworkVariantKind: 'custom',
      artworkSourceFileName: artwork.name,
    })
  }

  async activateVersion(resourceId: string, versionId: string): Promise<Resource> {
    return versionOperations.activateVersion(this.storage, resourceId, versionId)
  }

  async deleteVersion(resourceId: string, versionId: string): Promise<void> {
    await this.deleteVersions(resourceId, [versionId])
  }

  async deleteVersions(resourceId: string, versionIds: string[]): Promise<number> {
    return versionOperations.deleteVersions(this.storage, resourceId, versionIds)
  }

  async updateVersionNote(resourceId: string, versionId: string, note: string): Promise<void> {
    return versionOperations.updateVersionNote(this.storage, resourceId, versionId, note)
  }

  async mergeExistingResourceAsVersion(
    resourceId: string,
    sourceResourceId: string,
    note = '',
  ): Promise<Resource> {
    return versionOperations.mergeExistingResourceAsVersion(
      this.storage,
      (id) => this.delete(id),
      resourceId,
      sourceResourceId,
      note,
    )
  }

  async mergeDuplicates(keepId: string, removeIds: string[]): Promise<number> {
    return operationsResourceOrganizationOperations.mergeDuplicates(
      this.storage,
      (id) => this.delete(id),
      keepId,
      removeIds,
    )
  }

  /** 把新资源与来源资源建立双向关联；来源已删除的 id 会被静默跳过。 */
  private async linkRelatedResources(resourceId: string, relatedIds: string[]): Promise<string[]> {
    const now = Date.now()
    const targets = (
      await Promise.all(
        Array.from(new Set(relatedIds))
          .filter((id) => id && id !== resourceId)
          .map((id) => this.storage.get(id)),
      )
    ).flatMap((resource) => (resource ? [resource] : []))
    if (targets.length) {
      await this.storage.saveMany(
        targets.map((target) =>
          normalizeResource({
            ...target,
            relatedResourceIds: Array.from(new Set([...getRelatedResourceIds(target), resourceId])),
            updatedAt: now,
          }),
        ),
      )
    }
    return targets.map((target) => target.id)
  }

  /** 把两个或更多已入库资源设为双向关联，供成套但仍保持原生格式的资源使用。 */
  async linkResources(resourceIds: string[]): Promise<void> {
    const ids = Array.from(new Set(resourceIds.filter(Boolean)))
    if (ids.length < 2) return

    const source = await this.storage.get(ids[0]!)
    if (!source) throw new Error('无法关联：主资源不存在或已被删除')

    const linkedIds = await this.linkRelatedResources(source.id, ids.slice(1))
    await this.storage.update(source.id, {
      relatedResourceIds: Array.from(
        new Set([...getRelatedResourceIds(source), ...linkedIds]),
      ).filter((id) => id !== source.id),
      updatedAt: Date.now(),
    })
  }

  /**
   * 「缝了么」产物入库：写入 stitchedFrom 溯源与来源双向关联。
   * asVersionOf 存在时作为该资源的新版本入库（重缝场景），否则新建资源。
   */
  async importStitchedPreset(
    file: File,
    options: {
      stitchedFrom: unknown[]
      baseResourceId?: string
      relatedResourceIds: string[]
      asVersionOf?: string
      versionNote?: string
    },
  ): Promise<Resource> {
    let resource: Resource
    if (options.asVersionOf) {
      resource = await this.importAsVersion(
        file,
        options.asVersionOf,
        true,
        options.versionNote ?? '',
      )
    } else {
      const contentHash = await createContentHash(file)
      const duplicate =
        (await this.storage.findByHash(contentHash)) ??
        (await this.storage.findVersionByHash(contentHash))
      if (duplicate) throw new Error(`缝合结果与「${duplicate.name}」内容完全相同，无需重复入库`)
      resource = await this.createImportedResource(file, undefined, contentHash)
      await this.storage.save(resource)
    }
    const linkedIds = await this.linkRelatedResources(resource.id, options.relatedResourceIds)
    await this.storage.update(resource.id, {
      relatedResourceIds: Array.from(
        new Set([...getRelatedResourceIds(resource), ...linkedIds]),
      ).filter((id) => id !== resource.id),
      metadata: {
        ...resource.metadata,
        stitchedFrom: options.stitchedFrom,
        ...(options.baseResourceId ? { stitchedBaseId: options.baseResourceId } : {}),
      },
      updatedAt: Date.now(),
    })
    return (await this.storage.get(resource.id)) ?? resource
  }

  private async upgradeJsonResource(resource: Resource): Promise<Resource | undefined> {
    const isJson = resource.fileName.toLocaleLowerCase().endsWith('.json')
    if (!isJson || resource.metadata.parserVersion === JSON_RESOURCE_PARSER_VERSION) {
      return undefined
    }

    try {
      const file = new File([resource.originalBlob], resource.fileName, {
        type: resource.mimeType,
      })
      const parsed = await this.parserRegistry.parse(file)
      const manualTypeOverride = findManualTypeOverride(resource)
      const changes: Partial<Resource> = {
        type: manualTypeOverride ?? parsed.type,
        name: parsed.name,
        description: parsed.description,
        tags: normalizeTags([...resource.tags, ...(parsed.tags ?? [])]),
        metadata: {
          ...parsed.metadata,
          ...(manualTypeOverride ? { manualTypeOverride } : {}),
          authorNote: resource.metadata.authorNote,
        },
      }
      await this.storage.update(resource.id, changes)
      return { ...resource, ...changes }
    } catch {
      return undefined
    }
  }

  async upgradeLegacyJsonResources(
    checkpoint = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  ): Promise<number> {
    await checkpoint()
    const resources = await this.storage.listSummaries()
    let upgradedCount = 0

    let processed = 0
    for (const summary of resources) {
      if (++processed % 32 === 0) await checkpoint()
      const legacyGlobalRegexName = summary.fileName.replace(/\.json$/i, '').trim()
      if (
        summary.fileName.toLocaleLowerCase().endsWith('.json') &&
        summary.metadata.parserVersion === JSON_RESOURCE_PARSER_VERSION &&
        summary.metadata.detectedVariant === 'regexCollection' &&
        summary.metadata.regexScope === 'global' &&
        summary.metadata.itemCount === 1 &&
        summary.metadata.sourceName === '全局正则' &&
        summary.metadata.legacyGlobalRegexNameRepaired !== true &&
        summary.name === '全局正则' &&
        legacyGlobalRegexName !== '全局正则' &&
        legacyGlobalRegexName
      ) {
        await this.storage.update(summary.id, {
          name: legacyGlobalRegexName,
          metadata: { ...summary.metadata, legacyGlobalRegexNameRepaired: true },
        })
        upgradedCount += 1
        continue
      }
      const isLegacyJson =
        summary.fileName.toLocaleLowerCase().endsWith('.json') &&
        summary.metadata.parserVersion !== JSON_RESOURCE_PARSER_VERSION
      if (!isLegacyJson) continue
      const resource = await this.storage.get(summary.id)
      if (resource && (await this.upgradeJsonResource(resource))) upgradedCount += 1
    }

    return upgradedCount
  }

  /**
   * 为存量角色卡回填内容指纹。
   *
   * 指纹从 metadata.card 计算并写回 metadata，不触碰卡数据与原文件；
   * 已有指纹的资源跳过，因此只有首次升级时有一次性开销。
   */
  async backfillCardFingerprints(
    checkpoint = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  ): Promise<number> {
    await checkpoint()
    const [summaries, versionSummaries] = await Promise.all([
      this.storage.listSummaries(),
      this.storage.listVersionSummaries(),
    ])
    let backfilled = 0
    let processed = 0
    for (const summary of summaries) {
      if (++processed % 32 === 0) await checkpoint()
      if (summary.type !== RESOURCE_TYPE.CHARACTER_CARD) continue
      if (
        typeof summary.metadata.cardContentHash === 'string' &&
        summary.metadata.cardFingerprintVersion === CHARACTER_CARD_FINGERPRINT_VERSION
      )
        continue
      const fingerprints = await computeCardFingerprints(summary.metadata)
      if (!fingerprints) continue
      const changes = {
        metadata: {
          ...summary.metadata,
          cardContentHash: fingerprints.full,
          cardCoreHash: fingerprints.core,
          cardFingerprintVersion: CHARACTER_CARD_FINGERPRINT_VERSION,
        },
      }
      await this.storage.update(summary.id, changes)
      summary.metadata = changes.metadata
      backfilled += 1
    }
    for (const summary of versionSummaries) {
      if (++processed % 32 === 0) await checkpoint()
      if (summary.type !== RESOURCE_TYPE.CHARACTER_CARD) continue
      if (
        typeof summary.metadata.cardContentHash === 'string' &&
        summary.metadata.cardFingerprintVersion === CHARACTER_CARD_FINGERPRINT_VERSION
      )
        continue
      const fingerprints = await computeCardFingerprints(summary.metadata)
      if (!fingerprints) continue
      const changes = {
        metadata: {
          ...summary.metadata,
          cardContentHash: fingerprints.full,
          cardCoreHash: fingerprints.core,
          cardFingerprintVersion: CHARACTER_CARD_FINGERPRINT_VERSION,
        },
      }
      await this.storage.updateVersion(summary.id, changes)
      summary.metadata = changes.metadata
      backfilled += 1
    }
    const versionsByOwner = new Map<string, ResourceSummary[]>()
    for (const version of versionSummaries) {
      if (++processed % 32 === 0) await checkpoint()
      if (!version.versionGroupId) continue
      versionsByOwner.set(version.versionGroupId, [
        ...(versionsByOwner.get(version.versionGroupId) ?? []),
        version,
      ])
    }
    for (const resource of summaries) {
      if (++processed % 32 === 0) await checkpoint()
      const versionCount = countResourceLogicalVersions([
        resource,
        ...(versionsByOwner.get(resource.id) ?? []),
      ])
      if (resource.versionCount !== versionCount) {
        await this.storage.update(resource.id, { versionCount })
      }
    }
    return backfilled
  }

  private async extractEmbeddedAssets(
    source: Resource,
  ): Promise<{ resource: Resource; created: Resource[]; assetCount: number }> {
    const candidates = await collectEmbeddedAssets(source)
    if (!candidates.length) return { resource: source, created: [], assetCount: 0 }

    const now = Date.now()
    const created: Resource[] = []
    const related = new Map<string, Resource>()

    for (const candidate of candidates) {
      const contentHash = await createContentHash(candidate.file)
      const duplicate = await this.storage.findByHash(contentHash)
      if (duplicate) {
        related.set(duplicate.id, {
          ...duplicate,
          relatedResourceIds: Array.from(new Set([...getRelatedResourceIds(duplicate), source.id])),
          updatedAt: now,
        })
        continue
      }

      const parsed = await this.parserRegistry.parse(candidate.file)
      const resource: Resource = {
        id: crypto.randomUUID(),
        ...parsed,
        type: candidate.type,
        fileName: candidate.file.name,
        mimeType: 'application/json',
        fileSize: candidate.file.size,
        contentHash,
        favorite: false,
        categoryId: null,
        categoryIds: [],
        relatedResourceIds: [source.id],
        tags: normalizeTags([
          ...(parsed.tags ?? []),
          source.type === RESOURCE_TYPE.PRESET ? '预设配套' : '角色卡配套',
        ]),
        metadata: {
          ...parsed.metadata,
          extractedFromResourceId: source.id,
          extractedFromResourceName: source.name,
          extractedFromResourceType: source.type,
          ...(source.type === RESOURCE_TYPE.CHARACTER_CARD
            ? {
                extractedFromCharacterId: source.id,
                extractedFromCharacterName: source.name,
                regexScope: candidate.kind === 'regex' ? 'character' : undefined,
              }
            : {
                extractedFromPresetId: source.id,
                extractedFromPresetName: source.name,
                regexScope: candidate.kind === 'regex' ? 'preset' : undefined,
              }),
          sourceName: source.name,
          extractedAssetKind: candidate.kind,
        },
        originalBlob: candidate.file,
        createdAt: now,
        updatedAt: now,
      }
      created.push(resource)
      related.set(resource.id, resource)
    }

    const updatedSource: Resource = {
      ...source,
      relatedResourceIds: Array.from(
        new Set([...getRelatedResourceIds(source), ...related.keys()]),
      ),
      updatedAt: now,
    }
    await this.storage.saveMany([updatedSource, ...related.values()])
    return { resource: updatedSource, created, assetCount: candidates.length }
  }

  async extractCharacterAssetsMany(ids: string[]): Promise<CharacterAssetExtractionReport> {
    const uniqueIds = Array.from(new Set(ids))
    let characterCount = 0
    let presetCount = 0
    let assetCount = 0
    let createdCount = 0

    for (const id of uniqueIds) {
      const resource = await this.storage.get(id)
      if (
        !resource ||
        (resource.type !== RESOURCE_TYPE.CHARACTER_CARD && resource.type !== RESOURCE_TYPE.PRESET)
      )
        continue
      if (resource.type === RESOURCE_TYPE.CHARACTER_CARD) characterCount += 1
      else presetCount += 1
      const extracted = await this.extractEmbeddedAssets(resource)
      assetCount += extracted.assetCount
      createdCount += extracted.created.length
    }

    return {
      selectedCount: uniqueIds.length,
      characterCount,
      presetCount,
      assetCount,
      createdCount,
    }
  }

  async importLinks(urls: string[]): Promise<ImportResult[]> {
    const results: ImportResult[] = []
    const knownResources = await this.storage.list()

    for (const rawUrl of urls) {
      const displayUrl = rawUrl.trim() || '空链接'
      try {
        const now = Date.now()
        const linkDraft = createResourceLinkDraftFromUrl(rawUrl, now)
        if (!linkDraft) throw new Error('资源链接仅支持 http/https 地址')

        const duplicate = knownResources.find((resource) =>
          normalizeResourceLinks(resource.sourceLinks).some(
            (sourceLink) =>
              sourceLink.url.toLocaleLowerCase() === linkDraft.url.toLocaleLowerCase(),
          ),
        )
        if (duplicate) {
          results.push({
            status: 'duplicate',
            fileName: linkDraft.url,
            message: `已存在相同链接：${duplicate.name}`,
            resource: duplicate,
            reclassified: false,
          })
          continue
        }

        const inspection = await this.linkInspector(linkDraft).catch(
          (): GitHubResourceInspection | undefined => undefined,
        )
        const link = normalizeResourceLinks([
          {
            ...linkDraft,
            ...(inspection && inspection.status !== 'unavailable'
              ? {
                  installTarget:
                    inspection.installTarget !== RESOURCE_INSTALL_TARGET.NONE
                      ? inspection.installTarget
                      : linkDraft.installTarget,
                  trustMode: inspection.trustMode,
                }
              : {}),
          },
        ])[0]
        if (!link) throw new Error('资源链接结构无效')

        const type = linkResourceType(link)
        const name = linkResourceName(link, inspection)
        const descriptor = {
          format: 'srl-link-resource',
          url: link.url,
          label: link.label,
          type: link.type,
          purpose: link.purpose,
          installTarget: link.installTarget,
          trustMode: link.trustMode,
          versionRef: link.versionRef,
          github: link.github,
          riskBadges: getResourceLinkRiskBadges(link),
          inspection,
          createdAt: now,
          safety: {
            linkOnly: true,
            downloadsContent: false,
            installsExtension: false,
            executesScript: false,
          },
        }
        const blob = new Blob([JSON.stringify(descriptor, null, 2)], {
          type: 'application/srl-link+json',
        })
        const file = new File([blob], safeLinkFileName(name), {
          type: 'application/srl-link+json',
        })
        const contentHash = await createContentHash(file)
        const resource: Resource = {
          id: crypto.randomUUID(),
          type,
          name,
          description: linkResourceDescription(link, inspection),
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          contentHash,
          favorite: false,
          categoryId: null,
          categoryIds: [],
          relatedResourceIds: [],
          sourceLinks: [link],
          tags: linkResourceTags(link, inspection),
          metadata: {
            format: 'link',
            parserVersion: 1,
            detectedVariant: 'externalLink',
            linkImport: descriptor,
            rootKeys: Object.keys(descriptor),
            itemCount: 1,
          },
          versionImportedAt: now,
          versionCount: 1,
          originalBlob: file,
          createdAt: now,
          updatedAt: now,
        }
        resource.versionLabel = resourceVersionLabel(resource)
        const normalizedResource = normalizeResource(resource)
        await this.storage.save(normalizedResource)
        knownResources.push(normalizedResource)
        results.push({
          status: 'imported',
          fileName: link.url,
          resource: normalizedResource,
        })
      } catch (error) {
        results.push({
          status: 'failed',
          fileName: displayUrl,
          message: error instanceof Error ? error.message : '链接导入失败',
        })
      }
    }

    return results
  }

  async importFiles(files: File[], options: ImportOptions = {}): Promise<ImportResult[]> {
    const results: ImportResult[] = []
    const detectVersions =
      options.detectVersions !== false && files.some((file) => !/\.srlchat$/i.test(file.name))
    const knownResources = !detectVersions ? [] : await this.storage.listSummaries()
    const knownVersions = !detectVersions ? [] : await this.storage.listVersionSummaries()
    const versionMatchIndex = !detectVersions
      ? []
      : await this.createVersionMatchIndex(knownResources, knownVersions)

    for (const [fileIndex, file] of files.entries()) {
      const reportProgress = (phase: string, completed = fileIndex): void =>
        options.onProgress?.({
          completed,
          total: files.length,
          fileName: file.name,
          phase,
        })
      try {
        reportProgress('正在准备文件')
        if (/\.srlchat$/i.test(file.name)) {
          const { importTavernChat } = await import('./TavernChatImport')
          results.push(await importTavernChat(file, this, this.parserRegistry, options))
          continue
        }
        const context = importPipeline.intake<ParsedResource>(file)
        reportProgress('正在读取并计算校验值')
        const contentHash = await context.hash()
        reportProgress('正在检查重复资源')
        const activeDuplicate = await this.storage.findByHash(contentHash)
        const versionDuplicate = activeDuplicate
          ? undefined
          : await this.storage.findVersionByHash(contentHash)
        const duplicate = activeDuplicate ?? versionDuplicate

        if (duplicate) {
          const duplicateResource = versionDuplicate?.versionGroupId
            ? ((await this.storage.get(versionDuplicate.versionGroupId)) ?? versionDuplicate)
            : duplicate
          const upgraded = activeDuplicate
            ? await this.upgradeJsonResource(duplicateResource)
            : undefined
          const current = upgraded ?? duplicateResource
          const extracted = options.extractCharacterAssets
            ? await this.extractEmbeddedAssets(current)
            : { resource: current, created: [], assetCount: 0 }
          results.push({
            status: 'duplicate',
            fileName: file.name,
            message: versionDuplicate?.versionGroupId
              ? `与「${duplicateResource.name}」的历史版本文件完全相同`
              : `与「${duplicateResource.name}」文件内容完全相同`,
            resource: extracted.resource,
            reclassified: Boolean(upgraded),
            extractedResources: extracted.created,
          })
          continue
        }

        reportProgress('正在解析资源内容')
        const parsed = await context.parse((source) => this.parserRegistry.parse(source))
        await this.ensureParsedFingerprints(parsed)
        if (options.detectVersions !== false) {
          const candidates = findVersionCandidates(parsed, file.name, versionMatchIndex)
          const exactContentMatches = candidates.filter(
            (candidate) => candidate.matchKind === 'contentDuplicate',
          )
          if (exactContentMatches.length === 1) {
            const candidate = exactContentMatches[0]
            const duplicateResource = await this.storage.get(candidate.resource.id)
            if (duplicateResource) {
              const extracted = options.extractCharacterAssets
                ? await this.extractEmbeddedAssets(duplicateResource)
                : { resource: duplicateResource, created: [], assetCount: 0 }
              results.push({
                status: 'duplicate',
                fileName: file.name,
                message: candidate.matchedHistorical
                  ? `与「${candidate.resource.name}」的历史版本卡内数据完全一致`
                  : `与「${candidate.resource.name}」卡内数据完全一致`,
                resource: extracted.resource,
                reclassified: false,
                extractedResources: extracted.created,
              })
              continue
            }
          }
          if (candidates.length) {
            results.push({ status: 'versionCandidate', fileName: file.name, file, candidates })
            continue
          }
        }
        let resource = await this.createImportedResource(file, parsed, contentHash, context)

        reportProgress('正在写入资源库')
        await this.storage.save(resource)
        context.mark('commit')
        const summary = toResourceSummary(resource)
        knownResources.push(summary)
        versionMatchIndex.push({
          resource: summary,
          groupResource: summary,
          historical: false,
        })
        const extracted = options.extractCharacterAssets
          ? await this.extractEmbeddedAssets(resource)
          : { resource, created: [], assetCount: 0 }
        resource = extracted.resource
        results.push({
          status: 'imported',
          fileName: file.name,
          resource,
          extractedResources: extracted.created,
        })
      } catch (error) {
        results.push({
          status: 'failed',
          fileName: file.name,
          message: error instanceof Error ? error.message : '导入失败',
        })
      } finally {
        reportProgress(`已处理 ${fileIndex + 1}/${files.length}`, fileIndex + 1)
      }
    }

    return results
  }

  async setFavorite(resource: ResourceReference, favorite: boolean): Promise<void> {
    await this.storage.update(resource.id, { favorite, updatedAt: Date.now() })
  }

  async setFavoriteMany(ids: string[], favorite: boolean): Promise<void> {
    if (!ids.length) return
    await this.storage.updateMany(ids, { favorite, updatedAt: Date.now() })
  }

  async updateThumbnail(resourceId: string, thumbnailBlob?: Blob): Promise<Resource> {
    const resource = await this.storage.get(resourceId)
    if (!resource) throw new Error('要更新封面的资源不存在')
    await this.storage.update(resourceId, { thumbnailBlob, updatedAt: Date.now() })
    const updated = await this.storage.get(resourceId)
    if (!updated) throw new Error('资源封面更新失败')
    return updated
  }

  async updateOrganization(
    resource: Resource,
    categoryIds: string[],
    tags: string[],
  ): Promise<void> {
    const normalizedCategoryIds = Array.from(new Set(categoryIds.filter(Boolean)))
    await this.storage.update(resource.id, {
      categoryId: normalizedCategoryIds[0] ?? null,
      categoryIds: normalizedCategoryIds,
      tags: normalizeTags(tags),
      updatedAt: Date.now(),
    })
  }

  clearParsedCharacterTagScan(): void {
    this.parsedTagCache.clear()
  }

  private async originalCharacterTags(
    summary: ResourceSummary,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const cached = this.parsedTagCache.get(summary.id)
    if (cached && summary.contentHash && cached.hash === summary.contentHash) return cached.tags
    const resource = await this.storage.get(summary.id)
    if (!resource || resource.contentHash !== summary.contentHash)
      throw new Error('资源已变化，请重新扫描')
    const parsed = await this.parserRegistry.parse(
      new File([resource.originalBlob], resource.fileName, { type: resource.mimeType }),
    )
    const tags = normalizeTags(parsed.tags ?? [])
    if (!signal?.aborted) this.parsedTagCache.set(summary.id, { hash: summary.contentHash, tags })
    return tags
  }

  /** Parse each unchanged original once; scans use lightweight current tags and hashes. */
  async findParsedCharacterTags(
    onProgress?: (progress: ParsedTagProgress) => void,
    signal?: AbortSignal,
  ): Promise<ParsedCharacterTagCandidate[]> {
    const summaries = (await this.listResourceListSummaries()).filter(
      (item) => item.type === RESOURCE_TYPE.CHARACTER_CARD && item.tags.length,
    )
    const liveIds = new Set(summaries.map((item) => item.id))
    for (const id of this.parsedTagCache.keys())
      if (!liveIds.has(id)) this.parsedTagCache.delete(id)
    const candidates: ParsedCharacterTagCandidate[] = []
    let completed = 0
    let failed = 0
    onProgress?.({ completed, total: summaries.length, resourceName: '', failed })
    for (const summary of summaries) {
      signal?.throwIfAborted()
      try {
        const parsedTags = await this.originalCharacterTags(summary, signal)
        const current = new Set(summary.tags.map((tag) => tag.toLocaleLowerCase()))
        const tags = parsedTags.filter((tag) => current.has(tag.toLocaleLowerCase()))
        if (tags.length) candidates.push({ resource: summary, tags })
      } catch {
        failed += 1
      }
      completed += 1
      onProgress?.({ completed, total: summaries.length, resourceName: summary.name, failed })
      if (completed % 32 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return candidates
  }

  /** Changed originals are parsed again; unchanged files never need another binary read/write. */
  async removeParsedCharacterTags(
    removals: ParsedCharacterTagRemoval[],
    onProgress?: (progress: ParsedTagProgress) => void,
  ): Promise<{
    resourceCount: number
    tagCount: number
    entries: Array<{ resourceId: string; resourceName: string; tags: string[] }>
    failed: number
  }> {
    const selected = new Map(
      removals.map((item) => [
        item.resourceId,
        new Set(item.tags.map((tag) => tag.toLocaleLowerCase())),
      ]),
    )
    const summaries = new Map(
      (await this.listResourceListSummaries()).map((item) => [item.id, item]),
    )
    const entries: Array<{ resourceId: string; resourceName: string; tags: string[] }> = []
    let completed = 0
    let failed = 0
    onProgress?.({ completed, total: selected.size, resourceName: '', failed })
    for (const [id, selectedTags] of selected) {
      const resource = summaries.get(id)
      try {
        if (!resource || resource.type !== RESOURCE_TYPE.CHARACTER_CARD) continue
        const parsedTags = new Set(
          (await this.originalCharacterTags(resource)).map((tag) => tag.toLocaleLowerCase()),
        )
        const removed = resource.tags.filter(
          (tag) =>
            parsedTags.has(tag.toLocaleLowerCase()) && selectedTags.has(tag.toLocaleLowerCase()),
        )
        if (!removed.length) continue
        const removedKeys = new Set(removed.map((tag) => tag.toLocaleLowerCase()))
        await this.storage.update(resource.id, {
          tags: resource.tags.filter((tag) => !removedKeys.has(tag.toLocaleLowerCase())),
          updatedAt: Date.now(),
        })
        entries.push({ resourceId: resource.id, resourceName: resource.name, tags: removed })
      } catch {
        failed += 1
      } finally {
        completed += 1
        onProgress?.({
          completed,
          total: selected.size,
          resourceName: resource?.name ?? id,
          failed,
        })
      }
    }
    return {
      failed,
      resourceCount: entries.length,
      tagCount: entries.reduce((count, entry) => count + entry.tags.length, 0),
      entries,
    }
  }

  restoreParsedCharacterTags(entries: ParsedCharacterTagRemoval[]): Promise<AiTagMutationResult> {
    // Undo must preserve original long tags, unlike newly suggested AI tags.
    return operationsResourceOrganizationOperations.addTagsPerResource(this.storage, entries, true)
  }

  async updateExternalAppResource(update: ExternalAppResourceUpdate): Promise<Resource> {
    return operationsResourceOrganizationOperations.updateExternalAppResource(this.storage, update)
  }

  async updateMetadata(resourceId: string, patch: Record<string, unknown>): Promise<Resource> {
    const resource = await this.storage.get(resourceId)
    if (!resource) throw new Error('要更新的资源已经不存在')
    const metadata = { ...resource.metadata, ...patch }
    await this.storage.update(resourceId, { metadata, updatedAt: Date.now() })
    return (await this.storage.get(resourceId)) ?? { ...resource, metadata }
  }

  async updateDetails(
    resource: Resource,
    details: {
      name: string
      authorNote?: string
      description: string
      type: ResourceType
      categoryIds: string[]
      relatedResourceIds: string[]
      tags: string[]
      sourceLinks?: ResourceLink[]
      characterOverrides?: CharacterCardOverrides
      characterContentEdits?: CharacterCardContentEdit[]
    },
  ): Promise<void> {
    return operationsResourceOrganizationOperations.updateDetails(this.storage, resource, details)
  }

  async restoreRelatedLinks(resources: Resource[]): Promise<void> {
    return operationsResourceOrganizationOperations.restoreRelatedLinks(this.storage, resources)
  }

  async moveManyToCategory(ids: string[], categoryId: string | null): Promise<void> {
    return operationsResourceOrganizationOperations.moveManyToCategory(
      this.storage,
      ids,
      categoryId,
    )
  }

  async updateTagsMany(ids: string[], tag: string, action: 'add' | 'remove'): Promise<void> {
    return operationsResourceOrganizationOperations.updateTagsMany(this.storage, ids, tag, action)
  }

  async addTagsPerResource(
    suggestions: Array<{ resourceId: string; tags: string[] }>,
  ): Promise<AiTagMutationResult> {
    return operationsResourceOrganizationOperations.addTagsPerResource(this.storage, suggestions)
  }

  async undoAddedTags(entries: AiTagMutationEntry[]): Promise<AiTagMutationResult> {
    return operationsResourceOrganizationOperations.undoAddedTags(this.storage, entries)
  }

  async delete(id: string): Promise<void> {
    return operationsResourceOrganizationOperations.deleteResource(this.storage, id)
  }

  async deleteMany(
    ids: string[],
    onProgress?: (progress: { completed: number; total: number }) => void,
  ): Promise<void> {
    return operationsResourceOrganizationOperations.deleteMany(this.storage, ids, onProgress)
  }
}
