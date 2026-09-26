import { collectCommunitySourceLocalAssetIds } from './CommunitySourceAttachmentArchive'
import type { PreparedRestore } from '../types/Backup'
import type { CloudBackupItem } from '../types/CloudBackup'
import {
  isUserPersonaAvatarAttachment,
  includeChatCompanionIds,
  RESOURCE_TYPE,
  toResourceListSummary,
  type Category,
  type Resource,
  type ResourceListSummary,
  type ResourceSummary,
} from '../types/Resource'
import type { CategoryService } from './CategoryService'
import type { StructuredSnapshot } from './CloudStructuredSnapshot'
import type { ResourceService } from './ResourceService'
import type { RestoreService } from './RestoreService'

/** Duplicate originals need no insertion, but their saved APP data still needs restoration. */
export function canRestoreOnlyPortableData(prepared: PreparedRestore | undefined): boolean {
  return Boolean(
    prepared &&
    prepared.resources.length === 0 &&
    prepared.portableData &&
    Object.entries(prepared.portableData).some(
      ([key, value]) => key !== 'version' && value != null,
    ),
  )
}

/**
 * Limit an already verified restore plan without reopening or reparsing the archive.
 * Selectors use prepared resource IDs, which remain unique after conflict remapping.
 */
export function selectPreparedRestore(
  prepared: PreparedRestore,
  selectors: ReadonlySet<string>,
): PreparedRestore {
  const selectedIds = new Set<string>()
  const withCompanions = new Set(selectors)
  includeChatCompanionIds(prepared.resources, withCompanions)
  const selectedResources: Resource[] = []
  for (const resource of prepared.resources) {
    if (!withCompanions.has(resource.id)) continue
    selectedIds.add(resource.id)
    selectedResources.push(resource)
  }

  for (const resource of selectedResources) {
    if (resource.type !== RESOURCE_TYPE.USER_PERSONA) continue
    for (const relatedId of resource.relatedResourceIds ?? []) {
      const related = prepared.resources.find((candidate) => candidate.id === relatedId)
      if (related && isUserPersonaAvatarAttachment(related) && !selectedIds.has(related.id)) {
        selectedIds.add(related.id)
        selectedResources.push(related)
      }
    }
  }

  const versions = prepared.versions.filter(
    (version) => version.versionGroupId && selectedIds.has(version.versionGroupId),
  )
  const categoryIds = new Set(
    selectedResources.flatMap(
      (resource) => resource.categoryIds ?? (resource.categoryId ? [resource.categoryId] : []),
    ),
  )
  const categories = prepared.categories.filter((category) => categoryIds.has(category.id))
  // A complete restore also includes unbound sources and bindings mapped to existing
  // duplicate resources, which are intentionally absent from prepared.resources.
  const allResourcesSelected = prepared.resources.every((resource) => selectedIds.has(resource.id))
  const communitySourceData =
    prepared.communitySourceData && !allResourcesSelected
      ? (() => {
          const bindings = prepared.communitySourceData!.bindings.filter((binding) =>
            selectedIds.has(binding.resourceId),
          )
          const sourceIds = new Set(bindings.map((binding) => binding.sourceId))
          return {
            ...prepared.communitySourceData!,
            sources: prepared.communitySourceData!.sources.filter((source) =>
              sourceIds.has(source.id),
            ),
            messages: prepared.communitySourceData!.messages.filter((message) =>
              sourceIds.has(message.sourceId),
            ),
            bindings,
          }
        })()
      : prepared.communitySourceData

  const assetIds = communitySourceData
    ? collectCommunitySourceLocalAssetIds(communitySourceData)
    : new Set<string>()
  const communitySourceAttachments = prepared.communitySourceAttachments?.filter((entry) =>
    assetIds.has(entry.assetId),
  )

  return {
    ...prepared,
    forReplacement: undefined,
    resources: selectedResources,
    versions,
    categories,
    communitySourceData,
    communitySourceAttachments,
    preview: {
      ...prepared.preview,
      archiveResourceCount: selectedResources.length,
      resourcesToAdd: selectedResources.length,
      categoriesToCreate: categories.length,
      communitySourceCount: communitySourceData?.sources.length,
      communityMessageCount: communitySourceData?.messages.length,
      communityAttachmentCount: communitySourceAttachments?.length,
    },
  }
}

export function selectStructuredSnapshot(
  snapshot: StructuredSnapshot,
  selectors: ReadonlySet<string>,
): StructuredSnapshot {
  const selectedIds = new Set<string>()
  const withCompanions = new Set(selectors)
  includeChatCompanionIds(snapshot.resources, withCompanions)
  const resources = snapshot.resources.filter((resource) => {
    if (!withCompanions.has(resource.id)) return false
    selectedIds.add(resource.id)
    return true
  })
  for (const resource of resources) {
    if (resource.type !== RESOURCE_TYPE.USER_PERSONA) continue
    for (const relatedId of resource.relatedResourceIds ?? []) {
      const related = snapshot.resources.find((candidate) => candidate.id === relatedId)
      if (related && isUserPersonaAvatarAttachment(related)) {
        selectedIds.add(related.id)
        if (!resources.some((candidate) => candidate.id === related.id)) resources.push(related)
      }
    }
  }
  const versions = snapshot.versions.filter(
    (version) => version.versionGroupId && selectedIds.has(version.versionGroupId),
  )
  const categoryIds = new Set(
    resources.flatMap(
      (resource) => resource.categoryIds ?? (resource.categoryId ? [resource.categoryId] : []),
    ),
  )
  return {
    ...snapshot,
    resources,
    versions,
    categories: snapshot.categories.filter((category) => categoryIds.has(category.id)),
  }
}

export function listStructuredBackupResources(snapshot: StructuredSnapshot): ResourceSummary[] {
  const versionCounts = new Map<string, number>()
  for (const version of snapshot.versions) {
    if (version.versionGroupId) {
      versionCounts.set(
        version.versionGroupId,
        (versionCounts.get(version.versionGroupId) ?? 0) + 1,
      )
    }
  }
  return snapshot.resources.map(({ object: _object, ...resource }) => ({
    ...resource,
    versionCount: versionCounts.get(resource.id) ?? 0,
  }))
}

export async function listBackupResourceSummaries(
  item: CloudBackupItem,
  readStructuredSnapshot: () => Promise<StructuredSnapshot>,
  downloadBackup: () => Promise<Blob>,
  resourceService: Pick<ResourceService, 'listResourceListSummaries'>,
  categoryService: Pick<CategoryService, 'list'>,
  restoreService: Pick<RestoreService, 'prepare'>,
): Promise<ResourceSummary[]> {
  if (item.kind === 'githubSnapshot' || item.kind === 'webdavSnapshot') {
    return listStructuredBackupResources(await readStructuredSnapshot())
  }
  return listArchiveBackupResources(
    item,
    downloadBackup,
    resourceService,
    categoryService,
    restoreService,
  )
}

export async function listArchiveBackupResources(
  item: Pick<CloudBackupItem, 'archiveName' | 'objectKey'>,
  downloadBackup: () => Promise<Blob>,
  resourceService: Pick<ResourceService, 'listResourceListSummaries'>,
  categoryService: Pick<CategoryService, 'list'>,
  restoreService: Pick<RestoreService, 'prepare'>,
): Promise<ResourceListSummary[]> {
  const blob = await downloadBackup()
  const [resources, categories] = await Promise.all([
    resourceService.listResourceListSummaries(),
    categoryService.list(),
  ])
  const prepared = await restoreService.prepare(
    new File([blob], item.archiveName ?? item.objectKey, { type: 'application/zip' }),
    resources,
    categories as Category[],
    true,
  )
  try {
    return prepared.resources.map((resource) => toResourceListSummary(resource))
  } finally {
    await prepared.dispose?.()
  }
}
