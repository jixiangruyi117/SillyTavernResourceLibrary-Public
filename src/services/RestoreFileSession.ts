import { COMMUNITY_SOURCE_ARCHIVE_PATH, type ArchiveManifest } from '../types/Backup'
import type { CommunitySourceBackupData } from '../types/CommunitySource'
import { parseCommunitySourceBackupData } from './CommunitySourceBackupService'
import type { RestoreStagingStore } from '../storage/RestoreStagingStore'
import { isUserPersonaAvatarAttachment, RESOURCE_TYPE, type Resource } from '../types/Resource'
import { nativeFileSource, rememberNativeFile } from '../core/NativeFileSource'
import { createImageThumbnail } from '../utils/createImageThumbnail'

/** Hydrates one verified entry and its thumbnail; planning and commit remain in RestoreService. */
export async function openArchiveFiles(
  staging: RestoreStagingStore,
  jobId: string,
  paths: Map<string, string>,
  resources: Resource[],
): Promise<{ hydrate: (resource: Resource) => Promise<Resource>; dispose: () => Promise<void> }> {
  const materialize = async (resource: Resource): Promise<Resource> => {
    const path = paths.get(resource.contentHash.toLowerCase())
    const entry = path ? await staging.get(jobId, path) : undefined
    if (
      !entry ||
      entry.size !== resource.fileSize ||
      entry.sha256 !== resource.contentHash.toLowerCase()
    )
      throw new Error(`备份原文件校验失败：${resource.fileName}`)
    const originalBlob = entry.blob.slice(0, entry.blob.size, resource.mimeType)
    const nativeUri = nativeFileSource(entry.blob)
    if (nativeUri) rememberNativeFile(originalBlob, nativeUri)
    const avatar = isUserPersonaAvatarAttachment(resource)
    const thumbnailBlob =
      (resource.type === RESOURCE_TYPE.CHARACTER_CARD || avatar) &&
      (resource.mimeType === 'image/png' || /\.png$/iu.test(resource.fileName))
        ? ((await createImageThumbnail(originalBlob)) ?? (avatar ? originalBlob : undefined))
        : undefined
    return { ...resource, originalBlob, thumbnailBlob }
  }
  return {
    dispose: () => staging.deleteJob(jobId),
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

export async function readCommunitySourceSidecar(
  jobId: string,
  manifest: ArchiveManifest,
  staging: RestoreStagingStore,
): Promise<CommunitySourceBackupData | undefined> {
  const descriptor = manifest.communitySources
  if (!descriptor) return undefined
  const entry = await staging.get(jobId, COMMUNITY_SOURCE_ARCHIVE_PATH)
  if (!entry) throw new Error('备份声明包含 Discord 正文，但缺少 community-sources.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await entry.blob.text())
  } catch {
    throw new Error('Discord 社区来源备份不是有效 JSON')
  }
  const data = parseCommunitySourceBackupData(parsed)
  if (
    data.sources.length !== descriptor.sourceCount ||
    data.messages.length !== descriptor.messageCount ||
    data.bindings.length !== descriptor.bindingCount
  ) {
    throw new Error('Discord 社区来源备份数量与清单不一致')
  }
  return data
}
