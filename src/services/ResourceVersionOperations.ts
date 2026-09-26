import { hashFile } from './HashService'
import { isPersonalResourceType } from '../types/PersonalResource'
import type { ParsedResource } from '../types/Import'
import { RESOURCE_TYPE } from '../types/Resource'
import type { ResourceStorageAdapter } from '../storage/ResourceStorageAdapter'
import type { Resource } from '../types/Resource'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'
import type { ResourceVersionView } from '../types/ResourceOperations'
import {
  resourceLogicalVersionKey,
  countResourceLogicalVersions,
  resourceVersionLabel,
} from './ResourceVersionIdentity'

export async function listVersions(
  storage: ResourceStorageAdapter,
  resourceId: string,
): Promise<ResourceVersionView[]> {
  const current = await storage.get(resourceId)
  if (!current) return []
  const versions = await storage.listVersions(resourceId)
  const all = [current, ...versions]
  const groups = new Map<string, Resource[]>()
  for (const resource of all) {
    const key = resourceLogicalVersionKey(resource)
    groups.set(key, [...(groups.get(key) ?? []), resource])
  }
  return Array.from(groups.values())
    .map((carriers): ResourceVersionView => {
      const ordered = [...carriers].sort(
        (left, right) =>
          Number(right.id === current.id) - Number(left.id === current.id) ||
          (right.versionImportedAt ?? right.createdAt) - (left.versionImportedAt ?? left.createdAt),
      )
      return {
        resource: ordered[0]!,
        active: ordered.some((resource) => resource.id === current.id),
        carriers: ordered,
      }
    })
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        (right.resource.versionImportedAt ?? right.resource.createdAt) -
          (left.resource.versionImportedAt ?? left.resource.createdAt),
    )
}

export type VersionImportRequest = [
  file: File,
  resourceId: string,
  activate: boolean,
  note?: string,
  variantKind?: 'container',
  metadataPatch?: Record<string, unknown>,
  allowIndependentDuplicate?: boolean,
  preservePreviousVersion?: boolean,
  characterContentEdits?: CharacterCardContentEdit[],
]

export async function importAsVersion(
  storage: ResourceStorageAdapter,
  createImportedResource: (file: File) => Promise<Resource>,
  ...[
    file,
    resourceId,
    activate,
    note = '',
    variantKind,
    metadataPatch = {},
    allowIndependentDuplicate = false,
    preservePreviousVersion = true,
    characterContentEdits,
  ]: VersionImportRequest
): Promise<Resource> {
  const current = await storage.get(resourceId)
  if (!current) throw new Error('要更新的资源已经不存在')
  const version = await createImportedResource(file)
  if (version.type !== current.type) throw new Error('不同资源类型不能合并为历史版本')
  const existingVersions = await storage.listVersions(resourceId)
  const alreadyInThisCard = [current, ...existingVersions].some(
    (item) => item.contentHash === version.contentHash,
  )
  const duplicate =
    (await storage.findByHash(version.contentHash)) ??
    (await storage.findVersionByHash(version.contentHash))
  if (alreadyInThisCard || (duplicate && !allowIndependentDuplicate))
    throw new Error('这个文件已经存在于资源或历史版本中')

  version.versionNote = note.trim()
  if (variantKind) {
    version.metadata = { ...version.metadata, versionVariantKind: variantKind, ...metadataPatch }
    version.versionNote ||= '同内容，不同立绘或文件封装'
  }
  const count = countResourceLogicalVersions([
    ...(!activate || preservePreviousVersion ? [current] : []),
    ...existingVersions,
    version,
  ])
  if (!activate) {
    await storage.saveVersion({
      ...version,
      versionGroupId: current.id,
      versionCount: count,
    })
    await storage.update(current.id, { versionCount: count, updatedAt: Date.now() })
    return (await storage.get(current.id)) ?? current
  }

  if (preservePreviousVersion) {
    await storage.saveVersion({
      ...current,
      id: crypto.randomUUID(),
      versionGroupId: current.id,
      versionImportedAt: current.versionImportedAt ?? current.createdAt,
      versionLabel: current.versionLabel ?? resourceVersionLabel(current),
      versionCount: count,
    })
  }
  await storage.update(current.id, {
    type: version.type,
    name: version.name,
    description: version.description,
    fileName: version.fileName,
    mimeType: version.mimeType,
    fileSize: version.fileSize,
    contentHash: version.contentHash,
    metadata: {
      ...version.metadata,
      authorNote: current.metadata.authorNote,
      manuallyBoundResourceIds: current.metadata.manuallyBoundResourceIds,
      ...(characterContentEdits ? { characterContentEdits } : {}),
    },
    thumbnailBlob: version.thumbnailBlob,
    originalBlob: version.originalBlob,
    versionImportedAt: version.versionImportedAt,
    versionLabel: version.versionLabel,
    versionNote: version.versionNote,
    versionCount: count,
    updatedAt: Date.now(),
  })
  return (await storage.get(current.id)) ?? current
}

export async function activateVersion(
  storage: ResourceStorageAdapter,
  resourceId: string,
  versionId: string,
): Promise<Resource> {
  const current = await storage.get(resourceId)
  const selected = (await storage.listVersions(resourceId)).find(
    (version) => version.id === versionId,
  )
  if (!current || !selected) throw new Error('历史版本已经不存在')
  const allVersions = await storage.listVersions(resourceId)
  const count = countResourceLogicalVersions([current, ...allVersions])
  await storage.saveVersion({
    ...current,
    id: crypto.randomUUID(),
    versionGroupId: current.id,
    versionImportedAt: current.versionImportedAt ?? current.createdAt,
    versionLabel: current.versionLabel ?? resourceVersionLabel(current),
    versionCount: count,
  })
  await storage.update(current.id, {
    type: selected.type,
    name: selected.name,
    description: selected.description,
    fileName: selected.fileName,
    mimeType: selected.mimeType,
    fileSize: selected.fileSize,
    contentHash: selected.contentHash,
    metadata: {
      ...selected.metadata,
      authorNote: current.metadata.authorNote,
      manuallyBoundResourceIds: current.metadata.manuallyBoundResourceIds,
    },
    thumbnailBlob: selected.thumbnailBlob,
    originalBlob: selected.originalBlob,
    versionImportedAt: selected.versionImportedAt,
    versionLabel: selected.versionLabel,
    versionNote: selected.versionNote,
    versionCount: count,
    updatedAt: Date.now(),
  })
  await storage.deleteVersion(versionId)
  const activated = await storage.get(current.id)
  if (!activated) throw new Error('历史版本切换失败')
  return activated
}

export async function deleteVersions(
  storage: ResourceStorageAdapter,
  resourceId: string,
  versionIds: string[],
): Promise<number> {
  const current = await storage.get(resourceId)
  if (!current) throw new Error('当前资源已经不存在')
  const requestedIds = new Set(versionIds.filter((id) => id && id !== resourceId))
  const versions = await storage.listVersions(resourceId)
  const targets = versions.filter((version) => requestedIds.has(version.id))
  if (!targets.length) return 0

  for (const target of targets) await storage.deleteVersion(target.id)
  const remainingVersions = await storage.listVersions(resourceId)
  const remainingIds = new Set(remainingVersions.map((version) => version.id))
  const undeleted = targets.filter((target) => remainingIds.has(target.id))
  if (undeleted.length) {
    throw new Error(`历史版本删除后校验失败：仍有 ${undeleted.length} 项存在，请刷新后重试`)
  }
  await storage.update(resourceId, {
    versionCount: countResourceLogicalVersions([current, ...remainingVersions]),
    updatedAt: Date.now(),
  })
  return targets.length
}

export async function updateVersionNote(
  storage: ResourceStorageAdapter,
  resourceId: string,
  versionId: string,
  note: string,
): Promise<void> {
  const normalizedNote = note.trim().slice(0, 240)
  if (versionId === resourceId) {
    if (!(await storage.get(resourceId))) throw new Error('当前版本已经不存在')
    await storage.update(resourceId, { versionNote: normalizedNote, updatedAt: Date.now() })
    return
  }
  const selected = (await storage.listVersions(resourceId)).find(
    (version) => version.id === versionId,
  )
  if (!selected) throw new Error('历史版本已经不存在')
  await storage.saveVersion({ ...selected, versionNote: normalizedNote })
}

export async function mergeExistingResourceAsVersion(
  storage: ResourceStorageAdapter,
  deleteResource: (id: string) => Promise<void>,
  resourceId: string,
  sourceResourceId: string,
  note = '',
): Promise<Resource> {
  if (resourceId === sourceResourceId) throw new Error('不能把当前资源合并到自己')
  const current = await storage.get(resourceId)
  const source = await storage.get(sourceResourceId)
  if (!current || !source) throw new Error('要合并的资源已经不存在')
  if (source.type !== current.type) throw new Error('不同资源类型不能合并为历史版本')

  const currentVersions = await storage.listVersions(resourceId)
  const now = Date.now()
  const sourceVersions = await storage.listVersions(sourceResourceId)
  const knownHashes = new Set(
    [current, ...currentVersions].map((resource) => resource.contentHash).filter(Boolean),
  )
  const uniqueIncoming = [source, ...sourceVersions].filter((resource) => {
    if (!resource.contentHash || knownHashes.has(resource.contentHash)) return false
    knownHashes.add(resource.contentHash)
    return true
  })
  const versionCount = countResourceLogicalVersions([
    current,
    ...currentVersions,
    ...uniqueIncoming,
  ])
  for (const [index, version] of uniqueIncoming.entries()) {
    await storage.saveVersion({
      ...version,
      versionGroupId: current.id,
      versionImportedAt: version.versionImportedAt ?? version.createdAt,
      versionLabel: version.versionLabel ?? resourceVersionLabel(version),
      versionNote:
        index === 0 && version.id === source.id ? note.trim().slice(0, 240) : version.versionNote,
      versionCount,
      updatedAt: now,
    })
  }
  await storage.update(current.id, { versionCount, updatedAt: now })
  await deleteResource(sourceResourceId)
  const updated = await storage.get(current.id)
  if (!updated) throw new Error('手动版本合并失败')
  return updated
}

/** Routine personal-resource edits replace current bytes without creating history. */
export async function updatePersonalContent(
  storage: ResourceStorageAdapter,
  file: File,
  parsed: ParsedResource,
  resourceId: string,
): Promise<Resource> {
  const current = await storage.get(resourceId)
  if (!current) throw new Error('资源已经不存在')
  if (!isPersonalResourceType(current.type) || current.type !== parsed.type)
    throw new Error('只能更新同类型的个人资源')
  const contentHash = await hashFile(file)
  await storage.update(resourceId, {
    name: parsed.name,
    description: parsed.description,
    metadata: { ...current.metadata, ...parsed.metadata },
    originalBlob: file,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    contentHash,
    ...(parsed.type === RESOURCE_TYPE.POCKET_PHONE ? { thumbnailBlob: parsed.thumbnailBlob } : {}),
    backupDescriptor: undefined,
    updatedAt: Date.now(),
  })
  const updated = await storage.get(resourceId)
  if (!updated) throw new Error('资源更新失败')
  return updated
}
