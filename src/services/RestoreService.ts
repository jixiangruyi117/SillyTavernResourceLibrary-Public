import { RestoreDuplicateIndex, restoreVersionKey } from '../utils/RestoreIdentity'
import { strFromU8 } from 'fflate'
import { stageArchive } from './ArchiveExtraction'

import type { ArchiveStorageAdapter } from '../storage/ArchiveStorageAdapter'
import {
  materializeStructuredResource,
  type StructuredResource,
  type StructuredSnapshot,
} from './CloudStructuredSnapshot'
import type { GitHubBundleManifest } from './GitHubBackupBundle'
import { MemoryRestoreStagingStore, type RestoreStagingStore } from '../storage/RestoreStagingStore'
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  COMMUNITY_SOURCE_ARCHIVE_PATH,
  type ArchiveManifest,
  type ArchivePortableData,
  type ArchivedResource,
  type PreparedRestore,
  type RestoreReport,
} from '../types/Backup'
import {
  isUserPersonaAvatarAttachment,
  normalizeResourceLinks,
  normalizeResource,
  RESOURCE_TYPE,
  type Category,
  type Resource,
  type ResourceSummary,
  type ResourceType,
} from '../types/Resource'
export { selectPreparedRestore } from './BackupRestoreSelection'
import { createImageThumbnail } from '../utils/createImageThumbnail'
import { isValidFolderCoverDataUrl } from '../utils/FolderCover'
import { isRecord } from '../utils/UnknownValue'
import type { NativeBackedResourceRecord } from '../types/Vault'
import { readNativeRestoredCardMetadata, type NativeRestoreMetadata } from './NativeCloudTransfer'
import {
  parseCommunitySourceBackupData,
  remapCommunitySourceBackupBindings,
} from './CommunitySourceBackupService'
import type { CommunitySourceService } from './CommunitySourceService'
import type { CommunitySourceBackupData } from '../types/CommunitySource'

const RESOURCE_TYPES = new Set<ResourceType>(Object.values(RESOURCE_TYPE))
function structuredPlaceholder(record: StructuredResource): Resource {
  const { object: _object, ...resource } = record
  return { ...resource, originalBlob: new Blob([], { type: resource.mimeType }) }
}

export interface PreparedNativeStructuredRestore extends Omit<
  PreparedRestore,
  'resources' | 'versions'
> {
  resources: NativeBackedResourceRecord[]
  versions: NativeBackedResourceRecord[]
}

function decodeNativeThumbnail(value: NativeRestoreMetadata): Blob | undefined {
  if (!value.thumbnailBase64) return undefined
  const binary = atob(value.thumbnailBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: value.thumbnailMimeType || 'image/png' })
}

function isCategory(value: unknown): value is Category {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    typeof value.name === 'string' &&
    Boolean(value.name.trim()) &&
    typeof value.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value.color) &&
    (value.coverImage === undefined ||
      (typeof value.coverImage === 'string' && isValidFolderCoverDataUrl(value.coverImage))) &&
    (value.hidden === undefined || typeof value.hidden === 'boolean') &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  )
}

function isArchivedResource(value: unknown): value is ArchivedResource {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    typeof value.type === 'string' &&
    RESOURCE_TYPES.has(value.type as ResourceType) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.fileSize === 'number' &&
    value.fileSize >= 0 &&
    typeof value.contentHash === 'string' &&
    /^[0-9a-f]{64}$/i.test(value.contentHash) &&
    typeof value.favorite === 'boolean' &&
    (value.categoryId === null || typeof value.categoryId === 'string') &&
    (value.categoryIds === undefined ||
      (Array.isArray(value.categoryIds) &&
        value.categoryIds.every((categoryId) => typeof categoryId === 'string'))) &&
    (value.relatedResourceIds === undefined ||
      (Array.isArray(value.relatedResourceIds) &&
        value.relatedResourceIds.every((resourceId) => typeof resourceId === 'string'))) &&
    (value.sourceLinks === undefined ||
      (Array.isArray(value.sourceLinks) &&
        normalizeResourceLinks(value.sourceLinks).length === value.sourceLinks.length)) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    isRecord(value.metadata) &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.archivePath === 'string' &&
    (value.archivePath.startsWith('files/') || value.archivePath.startsWith('versions/')) &&
    !value.archivePath.split('/').includes('..')
  )
}

function parseManifest(manifestBytes: Uint8Array): ArchiveManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(manifestBytes))
  } catch {
    throw new Error('备份清单不是有效 JSON')
  }

  if (!isRecord(parsed) || parsed.format !== ARCHIVE_FORMAT) {
    throw new Error('不是酒馆资源库备份包')
  }
  const archiveVersion = typeof parsed.version === 'number' ? parsed.version : Number.NaN
  if (![1, 2, 3, ARCHIVE_VERSION].includes(archiveVersion)) {
    throw new Error(`暂不支持备份版本 ${String(parsed.version)}`)
  }
  if (parsed.mode !== 'full' && parsed.mode !== 'partial') throw new Error('备份模式无效')
  if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) {
    throw new Error('备份时间无效')
  }
  if (!Array.isArray(parsed.categories) || !parsed.categories.every(isCategory)) {
    throw new Error('备份分类清单无效')
  }
  if (!Array.isArray(parsed.resources) || !parsed.resources.every(isArchivedResource)) {
    throw new Error('备份资源清单无效')
  }
  if (
    archiveVersion >= 3 &&
    (!Array.isArray(parsed.versions) || !parsed.versions.every(isArchivedResource))
  ) {
    throw new Error('备份历史版本清单无效')
  }
  const versions = archiveVersion >= 3 ? (parsed.versions as ArchivedResource[]) : []
  if (parsed.resources.some((resource) => !resource.archivePath.startsWith('files/'))) {
    throw new Error('备份资源路径无效')
  }
  if (versions.some((version) => !version.archivePath.startsWith('versions/'))) {
    throw new Error('备份历史版本路径无效')
  }
  if (
    parsed.categoryCount !== parsed.categories.length ||
    parsed.resourceCount !== parsed.resources.length
  ) {
    throw new Error('备份清单数量不一致')
  }
  if (archiveVersion >= 3 && parsed.versionCount !== versions.length) {
    throw new Error('备份历史版本数量不一致')
  }
  if (
    parsed.portableData !== undefined &&
    (!isRecord(parsed.portableData) || parsed.portableData.version !== 1)
  ) {
    throw new Error('备份中的应用数据格式无效')
  }
  if (parsed.communitySources !== undefined) {
    if (
      !isRecord(parsed.communitySources) ||
      parsed.communitySources.version !== 1 ||
      parsed.communitySources.path !== COMMUNITY_SOURCE_ARCHIVE_PATH ||
      typeof parsed.communitySources.sourceCount !== 'number' ||
      parsed.communitySources.sourceCount < 0 ||
      typeof parsed.communitySources.messageCount !== 'number' ||
      parsed.communitySources.messageCount < 0 ||
      typeof parsed.communitySources.bindingCount !== 'number' ||
      parsed.communitySources.bindingCount < 0
    ) {
      throw new Error('备份中的社区来源清单无效')
    }
  }

  const categoryIds = new Set(parsed.categories.map((category) => category.id))
  const resourceIds = new Set(parsed.resources.map((resource) => resource.id))
  const archivePaths = new Set(parsed.resources.map((resource) => resource.archivePath))
  if (categoryIds.size !== parsed.categories.length) throw new Error('备份中存在重复分类 ID')
  if (resourceIds.size !== parsed.resources.length) throw new Error('备份中存在重复资源 ID')
  if (archivePaths.size !== parsed.resources.length) throw new Error('备份中存在重复文件路径')
  const versionIds = new Set(versions.map((version) => version.id))
  const versionPaths = new Set(versions.map((version) => version.archivePath))
  if (versionIds.size !== versions.length) throw new Error('备份中存在重复历史版本 ID')
  if (versionPaths.size !== versions.length) throw new Error('备份中存在重复历史版本路径')

  return parsed as unknown as ArchiveManifest
}

async function readCommunitySourceSidecar(
  jobId: string,
  manifest: ArchiveManifest,
  staging: RestoreStagingStore,
): Promise<CommunitySourceBackupData | undefined> {
  const descriptor = manifest.communitySources
  if (!descriptor) return undefined
  const entry = await staging.get(jobId, COMMUNITY_SOURCE_ARCHIVE_PATH)
  if (!entry) throw new Error('备份声明包含本地社区正文，但缺少 community-sources.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await entry.blob.text())
  } catch {
    throw new Error('本地社区来源备份不是有效 JSON')
  }
  const data = parseCommunitySourceBackupData(parsed)
  if (
    data.sources.length !== descriptor.sourceCount ||
    data.messages.length !== descriptor.messageCount ||
    data.bindings.length !== descriptor.bindingCount
  ) {
    throw new Error('本地社区来源备份数量与清单不一致')
  }
  return data
}

function remapManualBindings(
  metadata: Record<string, unknown>,
  ids: Map<string, string>,
): Record<string, unknown> {
  if (!Array.isArray(metadata.manuallyBoundResourceIds)) return metadata
  return {
    ...metadata,
    manuallyBoundResourceIds: metadata.manuallyBoundResourceIds.flatMap((id) =>
      typeof id === 'string' ? [ids.get(id) ?? id] : [],
    ),
  }
}

export class RestoreService {
  private readonly storage: ArchiveStorageAdapter
  private readonly staging: RestoreStagingStore
  private readonly communitySources?: Pick<CommunitySourceService, 'restoreBackup'>

  constructor(
    storage: ArchiveStorageAdapter,
    staging: RestoreStagingStore = new MemoryRestoreStagingStore(),
    communitySources?: Pick<CommunitySourceService, 'restoreBackup'>,
  ) {
    this.storage = storage
    this.staging = staging
    this.communitySources = communitySources
  }

  canRestoreStructuredNative(): boolean {
    return this.storage.canRestoreNative?.() === true && Boolean(this.storage.restoreNative)
  }

  async prepare(
    file: File,
    existingResources: ResourceSummary[],
    existingCategories: Category[],
    deferFiles = false,
  ): Promise<PreparedRestore> {
    const jobId = await stageArchive(file, this.staging)
    try {
      const manifestEntry = await this.staging.get(jobId, 'manifest.json')
      if (!manifestEntry) throw new Error('备份包缺少 manifest.json')
      const manifest = parseManifest(new Uint8Array(await manifestEntry.blob.arrayBuffer()))
      const communitySourceData = await readCommunitySourceSidecar(jobId, manifest, this.staging)
      const duplicates = new RestoreDuplicateIndex(existingResources, manifest.resources)
      const existingIds = new Set(existingResources.map((resource) => resource.id))
      const resourceIdMap = new Map<string, string>()
      const existingCategoriesById = new Map(
        existingCategories.map((category) => [category.id, category]),
      )
      const existingCategoriesByName = new Map(
        existingCategories.map((category) => [category.name.toLocaleLowerCase(), category]),
      )
      const categoryIdMap = new Map<string, string>()
      const categoriesToCreate: Category[] = []
      let categoriesToReuse = 0

      for (const category of manifest.categories) {
        const sameId = existingCategoriesById.get(category.id)
        const sameName = existingCategoriesByName.get(category.name.toLocaleLowerCase())
        if (sameId && sameId.name === category.name && sameId.color === category.color) {
          categoryIdMap.set(category.id, sameId.id)
          categoriesToReuse += 1
        } else if (sameName) {
          categoryIdMap.set(category.id, sameName.id)
          categoriesToReuse += 1
        } else {
          const restoredCategory = sameId ? { ...category, id: crypto.randomUUID() } : category
          categoryIdMap.set(category.id, restoredCategory.id)
          categoriesToCreate.push(restoredCategory)
        }
      }

      const resourcesToRestore: Resource[] = []
      let duplicatesToSkip = 0
      let conflictsToPreserve = 0

      for (const archived of manifest.resources) {
        const stagedFile = await this.staging.get(jobId, archived.archivePath)
        if (!stagedFile) throw new Error(`备份缺少原始文件：${archived.fileName}`)
        if (stagedFile.size !== archived.fileSize) {
          throw new Error(`文件大小校验失败：${archived.fileName}`)
        }
        const archiveHash = archived.contentHash.toLocaleLowerCase()
        if (stagedFile.sha256 !== archiveHash) {
          throw new Error(`文件完整性校验失败：${archived.fileName}`)
        }
        const isAvatarAttachment = isUserPersonaAvatarAttachment(archived)
        const existingId = duplicates.find(archived)
        if (existingId) {
          resourceIdMap.set(archived.id, existingId)
          duplicatesToSkip += 1
          continue
        }

        let id = archived.id
        if (existingIds.has(id)) {
          id = crypto.randomUUID()
          conflictsToPreserve += 1
        }
        resourceIdMap.set(archived.id, id)
        duplicates.add(archived, id)
        existingIds.add(id)
        const originalBlob = new Blob(deferFiles ? [] : [stagedFile.blob], {
          type: archived.mimeType,
        })
        const thumbnailBlob =
          !deferFiles &&
          (archived.type === RESOURCE_TYPE.CHARACTER_CARD || isAvatarAttachment) &&
          (archived.mimeType === 'image/png' || /\.png$/i.test(archived.fileName))
            ? ((await createImageThumbnail(originalBlob)) ??
              (isAvatarAttachment ? originalBlob : undefined))
            : undefined
        const archivedCategoryIds = Array.isArray(archived.categoryIds)
          ? archived.categoryIds
          : archived.categoryId
            ? [archived.categoryId]
            : []
        const categoryIds = Array.from(
          new Set(
            archivedCategoryIds.flatMap((categoryId) => {
              const mappedId = categoryIdMap.get(categoryId)
              return mappedId ? [mappedId] : []
            }),
          ),
        )
        resourcesToRestore.push({
          id,
          type: archived.type,
          name: archived.name,
          description: archived.description,
          fileName: archived.fileName,
          mimeType: archived.mimeType,
          fileSize: archived.fileSize,
          contentHash: archiveHash,
          favorite: archived.favorite,
          categoryId: categoryIds[0] ?? null,
          categoryIds,
          relatedResourceIds: Array.isArray(archived.relatedResourceIds)
            ? archived.relatedResourceIds
            : [],
          sourceLinks: normalizeResourceLinks(archived.sourceLinks),
          tags: archived.tags,
          metadata: archived.metadata,
          thumbnailBlob,
          originalBlob,
          createdAt: archived.createdAt,
          updatedAt: archived.updatedAt,
        })
      }

      const availableResourceIds = new Set([
        ...existingResources.map((resource) => resource.id),
        ...resourcesToRestore.map((resource) => resource.id),
      ])
      let normalizedResources = resourcesToRestore.map((resource) =>
        normalizeResource({
          ...resource,
          metadata: remapManualBindings(resource.metadata, resourceIdMap),
          relatedResourceIds: (resource.relatedResourceIds ?? [])
            .map((relatedId) => resourceIdMap.get(relatedId) ?? relatedId)
            .filter((relatedId) => availableResourceIds.has(relatedId)),
        }),
      )
      const restoredResourcesById = new Map(
        [...existingResources, ...normalizedResources].map((resource) => [resource.id, resource]),
      )
      normalizedResources = normalizedResources.map((resource) => {
        if (resource.type !== RESOURCE_TYPE.USER_PERSONA) return resource
        const defaultAvatarId =
          typeof resource.metadata.defaultPersonaAvatarId === 'string'
            ? resource.metadata.defaultPersonaAvatarId
            : ''
        const relatedAvatars = (resource.relatedResourceIds ?? [])
          .map((resourceId) => restoredResourcesById.get(resourceId))
          .filter((candidate): candidate is Resource =>
            Boolean(candidate && isUserPersonaAvatarAttachment(candidate)),
          )
        const cover =
          relatedAvatars.find((candidate) => candidate.metadata.avatarId === defaultAvatarId) ??
          relatedAvatars[0]
        return cover?.thumbnailBlob ? { ...resource, thumbnailBlob: cover.thumbnailBlob } : resource
      })

      const versionKeys = new Set(
        existingResources.length ? await this.storage.listRestoreVersionKeys?.() : [],
      )
      const versionsToRestore: Resource[] = []
      for (const archived of manifest.versions ?? []) {
        const stagedFile = await this.staging.get(jobId, archived.archivePath)
        if (!stagedFile) throw new Error(`备份缺少历史版本文件：${archived.fileName}`)
        if (stagedFile.size !== archived.fileSize) {
          throw new Error(`历史版本大小校验失败：${archived.fileName}`)
        }
        const archiveHash = archived.contentHash.toLocaleLowerCase()
        if (stagedFile.sha256 !== archiveHash) {
          throw new Error(`历史版本完整性校验失败：${archived.fileName}`)
        }
        const groupId = archived.versionGroupId
          ? (resourceIdMap.get(archived.versionGroupId) ?? archived.versionGroupId)
          : undefined
        if (!groupId || !availableResourceIds.has(groupId)) continue
        const key = restoreVersionKey(archived, groupId)
        if (versionKeys.has(key)) continue
        versionKeys.add(key)
        const id = crypto.randomUUID()
        existingIds.add(id)
        const originalBlob = new Blob(deferFiles ? [] : [stagedFile.blob], {
          type: archived.mimeType,
        })
        const thumbnailBlob =
          !deferFiles &&
          archived.type === RESOURCE_TYPE.CHARACTER_CARD &&
          (archived.mimeType === 'image/png' || /\.png$/i.test(archived.fileName))
            ? await createImageThumbnail(originalBlob)
            : undefined
        versionsToRestore.push(
          normalizeResource({
            ...archived,
            id,
            versionGroupId: groupId,
            originalBlob,
            thumbnailBlob,
          }),
        )
      }

      const mappedCommunitySourceData = communitySourceData
        ? remapCommunitySourceBackupBindings(communitySourceData, resourceIdMap)
        : undefined

      const files = new Map(
        [...manifest.resources, ...(manifest.versions ?? [])].map((resource) => [
          resource.contentHash.toLowerCase(),
          resource.archivePath,
        ]),
      )
      return {
        openFiles: deferFiles
          ? () => this.openArchiveFiles(file, files, normalizedResources)
          : undefined,
        preview: {
          fileName: file.name,
          mode: manifest.mode,
          createdAt: manifest.createdAt,
          archiveResourceCount: manifest.resourceCount,
          resourcesToAdd: resourcesToRestore.length,
          duplicatesToSkip,
          conflictsToPreserve,
          categoriesToCreate: categoriesToCreate.length,
          categoriesToReuse,
          communitySourceCount: mappedCommunitySourceData?.sources.length,
          communityMessageCount: mappedCommunitySourceData?.messages.length,
          portableSections: [
            manifest.portableData?.appearance ? '外观与 CSS 预设' : '',
            manifest.portableData?.cloudBackup ? '云端备份配置' : '',
            manifest.portableData?.characterDraw ? '抽了么记录' : '',
            manifest.portableData?.generalPreferences ? '常用偏好' : '',
            mappedCommunitySourceData ? '本地社区来源' : '',
          ].filter(Boolean),
        },
        resources: normalizedResources,
        versions: versionsToRestore,
        categories: categoriesToCreate,
        portableData: manifest.portableData,
        communitySourceData: mappedCommunitySourceData,
      }
    } finally {
      await this.staging.deleteJob(jobId)
    }
  }

  private async openArchiveFiles(
    file: File,
    paths: Map<string, string>,
    resources: Resource[],
  ): Promise<{ hydrate: (resource: Resource) => Promise<Resource>; dispose: () => Promise<void> }> {
    const jobId = await stageArchive(file, this.staging)
    const materialize = async (resource: Resource): Promise<Resource> => {
      const path = paths.get(resource.contentHash.toLowerCase())
      const entry = path ? await this.staging.get(jobId, path) : undefined
      if (
        !entry ||
        entry.size !== resource.fileSize ||
        entry.sha256 !== resource.contentHash.toLowerCase()
      )
        throw new Error(`备份原文件校验失败：${resource.fileName}`)
      const originalBlob = entry.blob.slice(0, entry.blob.size, resource.mimeType)
      const avatar = isUserPersonaAvatarAttachment(resource)
      const thumbnailBlob =
        (resource.type === RESOURCE_TYPE.CHARACTER_CARD || avatar) &&
        (resource.mimeType === 'image/png' || /\.png$/iu.test(resource.fileName))
          ? ((await createImageThumbnail(originalBlob)) ?? (avatar ? originalBlob : undefined))
          : undefined
      return { ...resource, originalBlob, thumbnailBlob }
    }
    return {
      dispose: () => this.staging.deleteJob(jobId),
      hydrate: async (resource) => {
        const ready = await materialize(resource)
        if (resource.type === RESOURCE_TYPE.USER_PERSONA) {
          const avatars = resources.filter(
            (candidate) =>
              resource.relatedResourceIds?.includes(candidate.id) &&
              isUserPersonaAvatarAttachment(candidate),
          )
          const cover =
            avatars.find(
              (avatar) => avatar.metadata.avatarId === resource.metadata.defaultPersonaAvatarId,
            ) ?? avatars[0]
          if (cover) ready.thumbnailBlob = (await materialize(cover)).thumbnailBlob
        }
        return ready
      },
    }
  }

  async prepareStructured(
    resources: Resource[],
    versions: Resource[],
    categories: Category[],
    portableData: ArchivePortableData,
    existingResources: ResourceSummary[],
    existingCategories: Category[],
    fileName: string,
  ): Promise<PreparedRestore> {
    const duplicates = new RestoreDuplicateIndex(existingResources, resources)
    const existingIds = new Set(existingResources.map((resource) => resource.id))
    const resourceIdMap = new Map<string, string>()
    const categoriesById = new Map(existingCategories.map((category) => [category.id, category]))
    const categoriesByName = new Map(
      existingCategories.map((category) => [category.name.toLocaleLowerCase(), category]),
    )
    const categoryIdMap = new Map<string, string>()
    const categoriesToCreate: Category[] = []
    let categoriesToReuse = 0
    for (const category of categories) {
      const sameId = categoriesById.get(category.id)
      const sameName = categoriesByName.get(category.name.toLocaleLowerCase())
      if (sameId && sameId.name === category.name && sameId.color === category.color) {
        categoryIdMap.set(category.id, sameId.id)
        categoriesToReuse += 1
      } else if (sameName) {
        categoryIdMap.set(category.id, sameName.id)
        categoriesToReuse += 1
      } else {
        const restored = sameId ? { ...category, id: crypto.randomUUID() } : category
        categoryIdMap.set(category.id, restored.id)
        categoriesToCreate.push(restored)
      }
    }

    const resourcesToRestore: Resource[] = []
    let duplicatesToSkip = 0
    let conflictsToPreserve = 0
    for (const resource of resources) {
      const hash = resource.contentHash.toLocaleLowerCase()
      const isAvatarAttachment = isUserPersonaAvatarAttachment(resource)
      const existingId = duplicates.find(resource)
      if (existingId) {
        resourceIdMap.set(resource.id, existingId)
        duplicatesToSkip += 1
        continue
      }
      let id = resource.id
      if (existingIds.has(id)) {
        id = crypto.randomUUID()
        conflictsToPreserve += 1
      }
      resourceIdMap.set(resource.id, id)
      existingIds.add(id)
      duplicates.add(resource, id)
      const sourceCategoryIds = resource.categoryIds?.length
        ? resource.categoryIds
        : resource.categoryId
          ? [resource.categoryId]
          : []
      const categoryIds = Array.from(
        new Set(sourceCategoryIds.flatMap((value) => categoryIdMap.get(value) ?? [])),
      )
      const thumbnailBlob =
        resource.originalBlob.size > 0 &&
        (resource.type === RESOURCE_TYPE.CHARACTER_CARD || isAvatarAttachment) &&
        (resource.mimeType === 'image/png' || /\.png$/iu.test(resource.fileName))
          ? ((await createImageThumbnail(resource.originalBlob)) ??
            (isAvatarAttachment ? resource.originalBlob : undefined))
          : resource.thumbnailBlob
      resourcesToRestore.push(
        normalizeResource({
          ...resource,
          id,
          contentHash: hash,
          categoryId: categoryIds[0] ?? null,
          categoryIds,
          thumbnailBlob,
        }),
      )
    }

    const availableIds = new Set([
      ...existingResources.map((resource) => resource.id),
      ...resourcesToRestore.map((resource) => resource.id),
    ])
    let normalizedResources = resourcesToRestore.map((resource) =>
      normalizeResource({
        ...resource,
        metadata: remapManualBindings(resource.metadata, resourceIdMap),
        relatedResourceIds: (resource.relatedResourceIds ?? [])
          .map((id) => resourceIdMap.get(id) ?? id)
          .filter((id) => availableIds.has(id)),
      }),
    )
    const allResourcesById = new Map(
      [...existingResources, ...normalizedResources].map((resource) => [resource.id, resource]),
    )
    normalizedResources = normalizedResources.map((resource) => {
      if (resource.type !== RESOURCE_TYPE.USER_PERSONA) return resource
      const defaultAvatarId =
        typeof resource.metadata.defaultPersonaAvatarId === 'string'
          ? resource.metadata.defaultPersonaAvatarId
          : ''
      const relatedAvatars = (resource.relatedResourceIds ?? [])
        .map((id) => allResourcesById.get(id))
        .filter((candidate): candidate is Resource =>
          Boolean(candidate && isUserPersonaAvatarAttachment(candidate)),
        )
      const cover =
        relatedAvatars.find((candidate) => candidate.metadata.avatarId === defaultAvatarId) ??
        relatedAvatars[0]
      return cover?.thumbnailBlob ? { ...resource, thumbnailBlob: cover.thumbnailBlob } : resource
    })

    const versionKeys = new Set(
      existingResources.length ? await this.storage.listRestoreVersionKeys?.() : [],
    )
    const versionsToRestore: Resource[] = []
    for (const version of versions) {
      const groupId = version.versionGroupId
        ? (resourceIdMap.get(version.versionGroupId) ?? version.versionGroupId)
        : undefined
      if (!groupId || !availableIds.has(groupId)) continue
      const key = restoreVersionKey(version, groupId)
      if (versionKeys.has(key)) continue
      versionKeys.add(key)
      const thumbnailBlob =
        version.originalBlob.size > 0 &&
        version.type === RESOURCE_TYPE.CHARACTER_CARD &&
        (version.mimeType === 'image/png' || /\.png$/iu.test(version.fileName))
          ? await createImageThumbnail(version.originalBlob)
          : version.thumbnailBlob
      versionsToRestore.push(
        normalizeResource({
          ...version,
          id: crypto.randomUUID(),
          versionGroupId: groupId,
          thumbnailBlob,
        }),
      )
    }

    return {
      preview: {
        fileName,
        mode: 'full',
        createdAt: new Date().toISOString(),
        archiveResourceCount: resources.length,
        resourcesToAdd: normalizedResources.length,
        duplicatesToSkip,
        conflictsToPreserve,
        categoriesToCreate: categoriesToCreate.length,
        categoriesToReuse,
        portableSections: [
          portableData.appearance ? '外观与 CSS 预设' : '',
          portableData.cloudBackup ? '云端备份配置' : '',
          portableData.characterDraw ? '抽了么记录' : '',
          portableData.generalPreferences ? '常用偏好' : '',
        ].filter(Boolean),
      },
      resources: normalizedResources,
      versions: versionsToRestore,
      categories: categoriesToCreate,
      portableData,
    }
  }

  async prepareStructuredNative(
    resources: StructuredResource[],
    versions: StructuredResource[],
    categories: Category[],
    portableData: ArchivePortableData,
    existingResources: ResourceSummary[],
    existingCategories: Category[],
    fileName: string,
  ): Promise<PreparedNativeStructuredRestore> {
    const prepared = await this.prepareStructured(
      resources.map(structuredPlaceholder),
      versions.map(structuredPlaceholder),
      categories,
      portableData,
      existingResources,
      existingCategories,
      fileName,
    )
    const nativeRecord = (resource: Resource): NativeBackedResourceRecord => {
      const { originalBlob: _originalBlob, ...record } = resource
      return {
        ...record,
        nativeOriginal: {
          version: 1,
          contentHash: resource.contentHash.toLowerCase(),
          size: resource.fileSize,
        },
      }
    }
    return {
      ...prepared,
      resources: prepared.resources.map(nativeRecord),
      versions: prepared.versions.map(nativeRecord),
    }
  }

  async restoreStructured(
    snapshot: StructuredSnapshot,
    readObject: (object: GitHubBundleManifest) => Promise<Blob>,
    existingResources: ResourceSummary[],
    existingCategories: Category[],
    fileName: string,
  ): Promise<RestoreReport> {
    const prepared = await this.prepareStructured(
      snapshot.resources.map(structuredPlaceholder),
      snapshot.versions.map(structuredPlaceholder),
      snapshot.categories,
      snapshot.portableData,
      existingResources,
      existingCategories,
      fileName,
    )
    const descriptors = new Map(
      [...snapshot.resources, ...snapshot.versions].map((record) => [
        record.contentHash.toLowerCase(),
        record.object,
      ]),
    )
    const plannedById = new Map(prepared.resources.map((record) => [record.id, record]))
    const materialize = async (resource: Resource): Promise<Resource> => {
      const object = descriptors.get(resource.contentHash.toLowerCase())
      if (!object) throw new Error(`备份资源缺少对象描述：${resource.fileName}`)
      const hydrated = await materializeStructuredResource({ ...resource, object }, readObject)
      if (
        (resource.type === RESOURCE_TYPE.CHARACTER_CARD ||
          isUserPersonaAvatarAttachment(resource)) &&
        (resource.mimeType === 'image/png' || /\.png$/iu.test(resource.fileName))
      ) {
        hydrated.thumbnailBlob =
          (await createImageThumbnail(hydrated.originalBlob)) ??
          (isUserPersonaAvatarAttachment(resource) ? hydrated.originalBlob : undefined)
      }
      return hydrated
    }
    return this.restore(prepared, async (resource) => {
      const hydrated = await materialize(resource)
      if (resource.type === RESOURCE_TYPE.USER_PERSONA) {
        const avatars = (resource.relatedResourceIds ?? []).flatMap((id) => {
          const candidate = plannedById.get(id)
          return candidate && isUserPersonaAvatarAttachment(candidate) ? [candidate] : []
        })
        const cover =
          avatars.find(
            (avatar) => avatar.metadata.avatarId === resource.metadata.defaultPersonaAvatarId,
          ) ?? avatars[0]
        if (cover) hydrated.thumbnailBlob = (await materialize(cover)).thumbnailBlob
      }
      return hydrated
    })
  }

  private async validateSecrets(
    resources: Array<Resource | NativeBackedResourceRecord>,
  ): Promise<void> {
    const secrets = resources.filter((resource) => resource.type === RESOURCE_TYPE.SECRET)
    if (!secrets.length) return
    const { validateSecretResource } = await import('./PersonalResourceImport')
    const { readNativeResourceObject } = await import('../storage/NativeResourceFileMirror')
    for (const resource of secrets) {
      if (resource.fileSize > 2 * 1024 * 1024) throw new Error('密钥资源超过大小限制')
      const blob =
        'originalBlob' in resource
          ? resource.originalBlob
          : await readNativeResourceObject(
              resource.contentHash,
              resource.fileSize,
              resource.mimeType,
            )
      await validateSecretResource(blob)
    }
  }

  async restore(
    prepared: PreparedRestore,
    hydrate?: (resource: Resource) => Promise<Resource>,
  ): Promise<RestoreReport> {
    const session = await prepared.openFiles?.()
    hydrate ??= session?.hydrate
    try {
      if (!hydrate) await this.validateSecrets([...prepared.resources, ...prepared.versions])
      await this.storage.restore(
        prepared.categories,
        prepared.resources,
        prepared.versions,
        hydrate
          ? async (resource) => {
              const ready = await hydrate(resource)
              await this.validateSecrets([ready])
              return ready
            }
          : undefined,
      )
    } finally {
      await session?.dispose()
    }
    if (prepared.communitySourceData && this.communitySources) {
      await this.communitySources.restoreBackup(prepared.communitySourceData, 'merge')
    }
    return {
      restoredResources: prepared.resources.length,
      restoredVersions: prepared.versions.length,
      skippedDuplicates: prepared.preview.duplicatesToSkip,
      preservedConflicts: prepared.preview.conflictsToPreserve,
      createdCategories: prepared.categories.length,
      reusedCategories: prepared.preview.categoriesToReuse,
      restoredCommunitySources: prepared.communitySourceData?.sources.length,
      restoredCommunityMessages: prepared.communitySourceData?.messages.length,
    }
  }

  async restoreNative(
    prepared: PreparedNativeStructuredRestore,
    readMetadata: (resource: NativeBackedResourceRecord) => Promise<NativeRestoreMetadata> = (
      resource,
    ) =>
      readNativeRestoredCardMetadata({
        hash: resource.nativeOriginal.contentHash,
        size: resource.nativeOriginal.size,
        fileName: resource.fileName,
      }),
  ): Promise<RestoreReport> {
    await this.validateSecrets([...prepared.resources, ...prepared.versions])
    if (!this.storage.restoreNative) throw new Error('当前存储不支持 Android 原生恢复引用')
    await this.storage.restoreNative(
      prepared.categories,
      prepared.resources,
      prepared.versions,
      async (resource) => {
        if (resource.type !== RESOURCE_TYPE.CHARACTER_CARD) return resource
        const recovered = await readMetadata(resource)
        if (
          recovered.hash.toLowerCase() !== resource.contentHash.toLowerCase() ||
          !isRecord(recovered.card)
        ) {
          throw new Error(`无法从已校验原文件重建角色卡清单：${resource.fileName}`)
        }
        return {
          ...resource,
          metadata: {
            ...resource.metadata,
            card: isRecord(resource.metadata.card) ? resource.metadata.card : recovered.card,
          },
          thumbnailBlob: decodeNativeThumbnail(recovered),
        }
      },
    )
    if (prepared.communitySourceData && this.communitySources) {
      await this.communitySources.restoreBackup(prepared.communitySourceData, 'merge')
    }
    return {
      restoredResources: prepared.resources.length,
      restoredVersions: prepared.versions.length,
      skippedDuplicates: prepared.preview.duplicatesToSkip,
      preservedConflicts: prepared.preview.conflictsToPreserve,
      createdCategories: prepared.categories.length,
      reusedCategories: prepared.preview.categoriesToReuse,
      restoredCommunitySources: prepared.communitySourceData?.sources.length,
      restoredCommunityMessages: prepared.communitySourceData?.messages.length,
    }
  }

  async replace(prepared: PreparedRestore): Promise<RestoreReport> {
    const session = await prepared.openFiles?.()
    try {
      if (!session) await this.validateSecrets([...prepared.resources, ...prepared.versions])
      await this.storage.replace(
        prepared.categories,
        prepared.resources,
        prepared.versions,
        session
          ? async (resource) => {
              const ready = await session.hydrate(resource)
              await this.validateSecrets([ready])
              return ready
            }
          : undefined,
      )
    } finally {
      await session?.dispose()
    }
    if (prepared.communitySourceData && this.communitySources) {
      await this.communitySources.restoreBackup(prepared.communitySourceData, 'replace')
    }
    return {
      restoredResources: prepared.resources.length,
      restoredVersions: prepared.versions.length,
      skippedDuplicates: 0,
      preservedConflicts: 0,
      createdCategories: prepared.categories.length,
      reusedCategories: 0,
      restoredCommunitySources: prepared.communitySourceData?.sources.length,
      restoredCommunityMessages: prepared.communitySourceData?.messages.length,
    }
  }
}
