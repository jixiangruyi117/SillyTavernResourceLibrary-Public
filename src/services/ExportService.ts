import { includePersonalResource } from './PersonalResourceBackup'
import {
  encodeArchive,
  streamArchive,
  throwIfArchiveAborted,
  type ArchiveEncoding,
  type ArchiveTransferOptions,
} from './ArchiveZipWriter'

import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  COMMUNITY_SOURCE_ARCHIVE_PATH,
  COMMUNITY_SOURCE_ATTACHMENT_ARCHIVE_PREFIX,
  type ArchiveManifest,
  type ArchiveOptions,
  type ArchivedResource,
  type CreatedArchive,
} from '../types/Backup'
import type {
  CommunitySourceAttachmentArchiveEntry,
  CommunitySourceBackupData,
} from '../types/CommunitySource'
import {
  collectCommunitySourceLocalAssetIds,
  sanitizeCommunitySourceAttachmentRefs,
} from './CommunitySourceAttachmentArchive'
import {
  getRelatedResourceIds,
  includeChatCompanionIds,
  getResourceCategoryIds,
  isUserPersonaAvatarAttachment,
  normalizeResourceLinks,
  RESOURCE_TYPE,
  type Category,
  type Resource,
  type ResourceSummary,
} from '../types/Resource'
import {
  createModifiedCharacterResource,
  readCharacterCardOverrides,
} from '../utils/CharacterCardCustomization'

function safeFileName(fileName: string): string {
  const withoutControlCharacters = Array.from(fileName, (character) =>
    character.charCodeAt(0) < 32 ? '_' : character,
  ).join('')
  const sanitized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .trim()
  return sanitized || 'resource.bin'
}

function createArchivePath(resource: Resource, version = false): string {
  return `${version ? 'versions' : 'files'}/${resource.type}/${resource.id}-${safeFileName(resource.fileName)}`
}

function withoutBlobs(
  resource: Resource,
  archivePath: string,
  selectedIds: Set<string>,
  preserveExternalRelatedResourceIds = false,
): ArchivedResource {
  return {
    id: resource.id,
    type: resource.type,
    name: resource.name,
    description: resource.description,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    fileSize: resource.fileSize,
    contentHash: resource.contentHash,
    favorite: resource.favorite,
    categoryId: resource.categoryId,
    categoryIds: getResourceCategoryIds(resource),
    relatedResourceIds: preserveExternalRelatedResourceIds
      ? getRelatedResourceIds(resource)
      : getRelatedResourceIds(resource).filter((id) => selectedIds.has(id)),
    sourceLinks: normalizeResourceLinks(resource.sourceLinks),
    tags: resource.tags,
    metadata: resource.metadata,
    versionGroupId: resource.versionGroupId,
    versionImportedAt: resource.versionImportedAt,
    versionLabel: resource.versionLabel,
    versionNote: resource.versionNote,
    versionCount: resource.versionCount,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    archivePath,
  }
}

function archiveFileName(
  mode: ArchiveOptions['mode'],
  createdAt: Date,
  part?: { index: number; total: number },
): string {
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const suffix = part
    ? `-第${String(part.index).padStart(2, '0')}卷-共${String(part.total).padStart(2, '0')}卷`
    : ''
  return `酒馆资源库-${mode === 'full' ? '完整备份' : '分包'}-${timestamp}${suffix}.zip`
}

function splitResources(resources: Resource[], splitSizeBytes?: number): Resource[][] {
  if (!splitSizeBytes || splitSizeBytes <= 0) return [resources]
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  const consumedAttachmentIds = new Set<string>()
  const units: Resource[][] = []
  for (const resource of resources) {
    if (isUserPersonaAvatarAttachment(resource)) continue
    const attachments =
      resource.type === RESOURCE_TYPE.USER_PERSONA
        ? getRelatedResourceIds(resource).flatMap((resourceId) => {
            const related = resourcesById.get(resourceId)
            if (!related || !isUserPersonaAvatarAttachment(related)) return []
            consumedAttachmentIds.add(related.id)
            return [related]
          })
        : []
    units.push([resource, ...attachments])
  }
  for (const resource of resources) {
    if (isUserPersonaAvatarAttachment(resource) && !consumedAttachmentIds.has(resource.id)) {
      units.push([resource])
    }
  }
  const groups: Resource[][] = []
  let current: Resource[] = []
  let currentSize = 0

  for (const unit of units) {
    const unitSize = unit.reduce((total, resource) => total + resource.fileSize, 0)
    if (current.length && currentSize + unitSize > splitSizeBytes) {
      groups.push(current)
      current = []
      currentSize = 0
    }
    current.push(...unit)
    currentSize += unitSize
  }
  if (current.length) groups.push(current)
  return groups.length ? groups : [[]]
}

function selectResourcesForArchive(resources: Resource[], options: ArchiveOptions): Resource[] {
  if (options.personalResources)
    resources = resources.filter((resource) =>
      includePersonalResource(resource, options.personalResources),
    )
  if (options.mode === 'full' || !options.resourceIds) return resources
  const selectedIds = new Set(options.resourceIds)
  includeChatCompanionIds(resources, selectedIds)
  for (const resource of resources) {
    if (resource.type !== RESOURCE_TYPE.USER_PERSONA || !selectedIds.has(resource.id)) continue
    for (const relatedId of getRelatedResourceIds(resource)) {
      const related = resources.find((candidate) => candidate.id === relatedId)
      if (related && isUserPersonaAvatarAttachment(related)) selectedIds.add(related.id)
    }
  }
  return resources.filter((resource) => selectedIds.has(resource.id))
}

function selectCommunitySourcesForArchive(
  data: CommunitySourceBackupData | undefined,
  resourceIds: Set<string>,
  includeUnbound: boolean,
): CommunitySourceBackupData | undefined {
  if (!data) return undefined
  const bindings = data.bindings.filter((binding) => resourceIds.has(binding.resourceId))
  const boundSourceIds = new Set(bindings.map((binding) => binding.sourceId))
  const allBoundSourceIds = new Set(data.bindings.map((binding) => binding.sourceId))
  const selectedSourceIds = new Set(boundSourceIds)
  if (includeUnbound) {
    for (const source of data.sources) {
      if (!allBoundSourceIds.has(source.id)) selectedSourceIds.add(source.id)
    }
  }
  const sources = data.sources.filter((source) => selectedSourceIds.has(source.id))
  if (!sources.length) return undefined
  const messages = data.messages.filter((message) => selectedSourceIds.has(message.sourceId))
  return {
    version: 1,
    sources: structuredClone(sources),
    messages: structuredClone(messages),
    bindings: structuredClone(bindings),
  }
}

function selectCommunityAttachmentsForArchive(
  data: CommunitySourceBackupData | undefined,
  attachments: readonly CommunitySourceAttachmentArchiveEntry[] | undefined,
): {
  data: CommunitySourceBackupData | undefined
  attachments: CommunitySourceAttachmentArchiveEntry[]
} {
  if (!data) return { data: undefined, attachments: [] }
  const referencedIds = collectCommunitySourceLocalAssetIds(data)
  const selected = new Map<string, CommunitySourceAttachmentArchiveEntry>()
  for (const attachment of attachments ?? []) {
    if (!referencedIds.has(attachment.assetId) || selected.has(attachment.assetId)) continue
    selected.set(attachment.assetId, attachment)
  }
  const availableIds = new Set(selected.keys())
  return {
    data: sanitizeCommunitySourceAttachmentRefs(data, availableIds),
    attachments: [...selected.values()].sort((left, right) =>
      left.assetId.localeCompare(right.assetId),
    ),
  }
}

export interface ArchiveStreamWriter {
  write(chunk: Uint8Array): Promise<void>
  commit(): Promise<void>
  abort(): Promise<void>
}

export interface StreamedArchive {
  fileName: string
  manifest: ArchiveManifest
  bytes: number
}

/** Summaries plan selection; read loads exactly one complete resource at a time. */
export interface ArchiveSource {
  resources: ResourceSummary[]
  versions: ResourceSummary[]
  read(resource: ResourceSummary, historical: boolean): Promise<Resource>
}

export async function createResourceArchiveSource(
  service: import('./ResourceService').ResourceService,
): Promise<ArchiveSource> {
  return {
    resources: await service.listResourceListSummaries(),
    versions: await service.listVersionSummaries(true),
    read: async (summary, historical) => {
      const resource = historical
        ? await service.getVersion(summary.id)
        : await service.get(summary.id)
      if (!resource) throw new Error(`导出资源已不存在：${summary.fileName}`)
      return resource
    },
  }
}

type ArchiveWriterFactory = (
  fileName: string,
  manifest: ArchiveManifest,
) => Promise<ArchiveStreamWriter>

type CommunitySourceExportProvider = () => Promise<CommunitySourceBackupData>
type CommunitySourceAttachmentExportProvider = () => Promise<
  CommunitySourceAttachmentArchiveEntry[]
>

interface InternalCreatedArchive extends CreatedArchive {
  streamedBytes?: number
}

export class ExportService {
  private readonly communitySourceExportProvider?: CommunitySourceExportProvider
  private readonly communitySourceAttachmentExportProvider?: CommunitySourceAttachmentExportProvider

  constructor(
    communitySourceExportProvider?: CommunitySourceExportProvider,
    communitySourceAttachmentExportProvider?: CommunitySourceAttachmentExportProvider,
  ) {
    this.communitySourceExportProvider = communitySourceExportProvider
    this.communitySourceAttachmentExportProvider = communitySourceAttachmentExportProvider
  }

  private async prepareOptions(options: ArchiveOptions): Promise<ArchiveOptions> {
    if (!options.portableSelection?.communitySources) return options
    const communitySourceData =
      options.communitySourceData ?? (await this.communitySourceExportProvider?.())
    if (!communitySourceData) return options
    const communitySourceAttachments =
      options.communitySourceAttachments ??
      (await this.communitySourceAttachmentExportProvider?.()) ??
      []
    return {
      ...options,
      communitySourceData,
      communitySourceAttachments,
    }
  }

  async createArchive(
    resources: Resource[],
    categories: Category[],
    options: ArchiveOptions,
    versions: Resource[] = [],
    transfer?: ArchiveTransferOptions,
  ): Promise<CreatedArchive> {
    const preparedOptions = await this.prepareOptions(options)
    return this.createSingleArchive(
      resources,
      categories,
      {
        ...preparedOptions,
        splitSizeBytes: undefined,
      },
      undefined,
      versions,
      resources,
      undefined,
      undefined,
      transfer,
    )
  }

  async createArchives(
    resources: Resource[],
    categories: Category[],
    options: ArchiveOptions,
    versions: Resource[] = [],
  ): Promise<CreatedArchive[]> {
    return this.createArchivesInternal(
      resources,
      categories,
      await this.prepareOptions(options),
      versions,
    )
  }

  async createArchivesToSinks(
    resources: Resource[],
    categories: Category[],
    options: ArchiveOptions,
    versions: Resource[],
    writerFactory: ArchiveWriterFactory,
  ): Promise<StreamedArchive[]> {
    const archives = await this.createArchivesInternal(
      resources,
      categories,
      await this.prepareOptions(options),
      versions,
      writerFactory,
    )
    return archives.map((archive) => ({
      fileName: archive.fileName,
      manifest: archive.manifest,
      bytes: archive.streamedBytes ?? 0,
    }))
  }

  async createArchivesFromSource(
    source: ArchiveSource,
    categories: Category[],
    options: ArchiveOptions,
    writerFactory?: (fileName: string) => Promise<ArchiveStreamWriter>,
    transfer?: ArchiveTransferOptions,
  ): Promise<Array<Omit<InternalCreatedArchive, 'manifest'> & { resourceCount: number }>> {
    throwIfArchiveAborted(transfer?.signal)
    const placeholder = (resource: ResourceSummary): Resource => ({
      ...resource,
      originalBlob: new Blob(),
    })
    const archives = await this.createArchivesInternal(
      source.resources.map(placeholder),
      categories,
      await this.prepareOptions(options),
      source.versions.map(placeholder),
      writerFactory,
      source,
      transfer,
    )
    return archives.map(({ manifest, ...archive }) => ({
      ...archive,
      resourceCount: manifest.resourceCount,
    }))
  }

  private async createArchivesInternal(
    resources: Resource[],
    categories: Category[],
    options: ArchiveOptions,
    versions: Resource[] = [],
    writerFactory?: ArchiveWriterFactory,
    source?: ArchiveSource,
    transfer?: ArchiveTransferOptions,
  ): Promise<InternalCreatedArchive[]> {
    throwIfArchiveAborted(transfer?.signal)
    const selectedResources = selectResourcesForArchive(resources, options)

    if (options.mode === 'partial' && selectedResources.length === 0) {
      throw new Error('请至少选择一项资源')
    }

    const groups = splitResources(selectedResources, options.splitSizeBytes)
    const archives: InternalCreatedArchive[] = []
    for (const [index, group] of groups.entries()) {
      archives.push(
        await this.createSingleArchive(
          group,
          categories,
          {
            ...options,
            resourceIds: group.map((resource) => resource.id),
            splitSizeBytes: undefined,
          },
          groups.length > 1 ? { index: index + 1, total: groups.length } : undefined,
          versions.filter((version) =>
            group.some((resource) => resource.id === version.versionGroupId),
          ),
          resources,
          writerFactory,
          source,
          transfer,
        ),
      )
    }
    return archives
  }

  private async createSingleArchive(
    resources: Resource[],
    categories: Category[],
    options: ArchiveOptions,
    part?: { index: number; total: number },
    versions: Resource[] = [],
    replacementResources: Resource[] = resources,
    writerFactory?: ArchiveWriterFactory,
    source?: ArchiveSource,
    transfer?: ArchiveTransferOptions,
  ): Promise<InternalCreatedArchive> {
    throwIfArchiveAborted(transfer?.signal)
    const selectedResources = selectResourcesForArchive(resources, options)

    if (options.mode === 'partial' && selectedResources.length === 0) {
      throw new Error('请至少选择一项资源')
    }

    const exportedResources = selectedResources
    const referencedCategoryIds = new Set(exportedResources.flatMap(getResourceCategoryIds))
    const selectedCategories =
      options.mode === 'full' || options.includeAllCategories
        ? categories
        : categories.filter((category) => referencedCategoryIds.has(category.id))
    const archivedResources: ArchivedResource[] = []
    const archivedResourceIds = new Set(exportedResources.map((resource) => resource.id))

    for (const resource of exportedResources) {
      const archivePath = createArchivePath(resource)
      archivedResources.push(
        withoutBlobs(
          resource,
          archivePath,
          archivedResourceIds,
          options.preserveExternalRelatedResourceIds,
        ),
      )
    }
    const selectedVersions = versions.filter((version) =>
      archivedResourceIds.has(version.versionGroupId ?? ''),
    )
    const exportedVersions = selectedVersions
    const archivedVersions = exportedVersions.map((version) =>
      withoutBlobs(
        version,
        createArchivePath(version, true),
        archivedResourceIds,
        options.preserveExternalRelatedResourceIds,
      ),
    )

    const selectedCommunitySourceData = selectCommunitySourcesForArchive(
      options.communitySourceData,
      archivedResourceIds,
      options.mode === 'full' && (!part || part.index === 1),
    )
    const selectedCommunity = selectCommunityAttachmentsForArchive(
      selectedCommunitySourceData,
      options.communitySourceAttachments,
    )
    const communitySourceData = selectedCommunity.data
    const communitySourceAttachments = selectedCommunity.attachments
    const createdAt = new Date()
    const manifest: ArchiveManifest = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      mode: options.mode,
      resourceContent: options.resourceContent ?? 'original',
      createdAt: createdAt.toISOString(),
      resourceCount: archivedResources.length,
      categoryCount: selectedCategories.length,
      categories: selectedCategories,
      resources: archivedResources,
      versionCount: archivedVersions.length,
      versions: archivedVersions,
      portableData: options.portableData
        ? {
            ...options.portableData,
            ...(options.portableData.plaintextSecretCopies
              ? {
                  plaintextSecretCopies: options.portableData.plaintextSecretCopies.filter((copy) =>
                    archivedResources.some((resource) => resource.contentHash === copy.contentHash),
                  ),
                }
              : {}),
          }
        : undefined,
      ...(communitySourceData
        ? {
            communitySources: {
              version: 1 as const,
              path: COMMUNITY_SOURCE_ARCHIVE_PATH,
              sourceCount: communitySourceData.sources.length,
              messageCount: communitySourceData.messages.length,
              bindingCount: communitySourceData.bindings.length,
              attachmentCount: communitySourceAttachments.length,
              attachmentPathPrefix: COMMUNITY_SOURCE_ATTACHMENT_ARCHIVE_PREFIX,
            },
          }
        : {}),
    }
    const fileName = archiveFileName(options.mode, createdAt, part)
    const encoding: ArchiveEncoding = {
      signal: transfer?.signal,
      onProgress: ({ writtenBytes }) => transfer?.onProgress?.({ writtenBytes, fileName }),
      resources: exportedResources,
      versions: exportedVersions,
      manifest,
      communitySourceData,
      communitySourceAttachments,
      path: createArchivePath,
      read: async (planned, historical) => {
        let resource = source ? await source.read(planned, historical) : planned
        if (
          resource.id !== planned.id ||
          resource.contentHash !== planned.contentHash ||
          resource.updatedAt !== planned.updatedAt
        )
          throw new Error(`导出期间资源发生变化，请重新导出：${planned.fileName}`)
        if (options.resourceContent === 'modified') {
          const overrides = readCharacterCardOverrides(resource.metadata)
          const related = source ? [] : replacementResources
          if (source) {
            for (const id of new Set([
              overrides.worldBookResourceId,
              overrides.greetingResourceId,
            ])) {
              const summary = source.resources.find((candidate) => candidate.id === id)
              if (summary) related.push(await source.read(summary, false))
            }
          }
          resource = await createModifiedCharacterResource(resource, related)
        }
        return resource
      },
      describe: (resource, historical) => {
        const descriptor = withoutBlobs(
          resource,
          createArchivePath(resource, historical),
          archivedResourceIds,
          options.preserveExternalRelatedResourceIds,
        )
        // Eager API callers retain the complete manifest. Lazy export callers receive only
        // the file/result; the complete on-disk manifest is serialized one record at a time.
        if (!source) {
          const records = historical ? archivedVersions : archivedResources
          records[records.findIndex((record) => record.id === resource.id)] = descriptor
        }
        return descriptor
      },
    }
    if (writerFactory) {
      const writer = await writerFactory(fileName, manifest)
      try {
        const streamedBytes = await encodeArchive(encoding, writer.write)
        throwIfArchiveAborted(transfer?.signal)
        await writer.commit()
        return {
          blob: new Blob([], { type: 'application/zip' }),
          fileName,
          manifest,
          streamedBytes,
        }
      } catch (error) {
        await writer.abort().catch(() => undefined)
        throw error
      }
    }

    const blob = await streamArchive(encoding)

    return {
      blob,
      fileName,
      manifest,
    }
  }
}
