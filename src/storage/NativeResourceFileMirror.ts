import { Capacitor, registerPlugin } from '@capacitor/core'

import { transferNativeStream } from '../core/NativeStreamTransfer'
import { isUserPersonaAvatarAttachment, type Resource } from '../types/Resource'

type NativeResourceScope = 'current' | 'versions'

interface NativeLibraryPlugin {
  getStorageInfo(): Promise<NativeResourceStorageInfo>
  inspectRecoveryObject(options: {
    contentHash: string
    size: number
    verify: boolean
  }): Promise<NativeRecoveryMetadata>
  listRecoveryCandidates(options: {
    cursor?: string
    limit: number
    currentIds: string[]
  }): Promise<NativeRecoveryCandidatePage>
  beginWrite(options: {
    scope: NativeResourceScope
    id: string
    fileName: string
    mimeType: string
    resourceType: string
    hiddenFromDocuments: boolean
    contentHash: string
    size: number
    updatedAt: number
  }): Promise<{ alreadyPresent: boolean; token: string }>
  appendWrite(options: { token: string; data: string }): Promise<void>
  commitWrite(options: { token: string }): Promise<void>
  abortWrite(options: { token: string }): Promise<void>
  remove(options: { scope: NativeResourceScope; id: string }): Promise<void>
  clear(): Promise<void>
  clearTemporaryCaches(): Promise<{ clearedBytes: number }>
  getObjectPath(options: {
    contentHash: string
    size: number
  }): Promise<{ path: string; size: number }>
  linkObjects(options: { records: NativeResourceLinkRecord[] }): Promise<{ linked: number }>
  verifyLinkedObjects(options: {
    records: Array<{
      scope: NativeResourceScope
      id: string
      contentHash: string
      size: number
    }>
  }): Promise<{ verified: number }>
  unlinkEntries(options: {
    records: Array<{ scope: NativeResourceScope; id: string; contentHash: string }>
  }): Promise<{ removed: number }>
  reconcileEntries(options: {
    currentIds: string[]
    versionIds: string[]
  }): Promise<{ removedCurrent: number; removedVersions: number }>
}

const nativeLibrary = registerPlugin<NativeLibraryPlugin>('NativeLibrary')

export interface NativeMirrorHandle {
  commit(): Promise<void>
  abort(): Promise<void>
}

export interface NativeResourceStorageInfo {
  storageVersion: number
  recoveryMetadataVersion?: number
  path: string
  currentCount: number
  versionCount: number
  currentManifestHash?: string
  versionManifestHash?: string
  objectCount: number
  objectBytes: number
  appDataBytes: number
  externalDataBytes: number
  totalBytes: number
  availableBytes: number
  /** Subsets of totalBytes. Never add these to totalBytes or objectBytes. */
  webViewBytes?: number
  cacheBytes?: number
  /** Android cache directory; safe to clear manually when no transfer is active. */
  appCacheBytes?: number
  /** Android code cache directory; a disposable subset of cacheBytes. */
  codeCacheBytes?: number
  libraryBytes?: number
  restoreTemporaryBytes?: number
  writeTemporaryBytes?: number
}

export interface NativeRecoveryMetadata {
  kind: 'png' | 'json' | 'css' | 'unknown'
  text?: string
  thumbnailBase64?: string
}

export async function inspectNativeRecoveryObject(
  candidate: { contentHash: string; size: number },
  verify = true,
): Promise<NativeRecoveryMetadata> {
  if (!isAndroidNative()) throw new Error('当前不是 Android 原生资源环境')
  if (!Capacitor.isPluginAvailable('NativeLibrary'))
    throw new Error('需要更新 APK 后再使用原件识别')
  return nativeLibrary.inspectRecoveryObject({ ...candidate, verify })
}

export interface NativeRecoveryCandidate {
  contentHash: string
  size: number
  modifiedAt: number
  nativeId?: string
  nativeScope?: 'current'
  fileName?: string
}

export interface NativeRecoveryCandidatePage {
  candidates: NativeRecoveryCandidate[]
  /** Opaque native cursor; omitted after the final page. */
  nextCursor?: string
  /** Cumulative number of native entries examined in this scan. */
  scanned: number
}

export interface NativeResourceLinkRecord {
  scope: NativeResourceScope
  id: string
  fileName: string
  mimeType: string
  resourceType: string
  hiddenFromDocuments: boolean
  contentHash: string
  size: number
  updatedAt: number
}

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function isAndroidNativeResourceMirrorAvailable(): boolean {
  return isAndroidNative() && Capacitor.isPluginAvailable('NativeLibrary')
}

export async function stageNativeResourceFile(
  resource: Resource,
  scope: NativeResourceScope,
): Promise<NativeMirrorHandle> {
  if (!isAndroidNative()) return { commit: async () => undefined, abort: async () => undefined }
  const started = await nativeLibrary.beginWrite({
    scope,
    id: resource.id,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    resourceType: resource.type,
    hiddenFromDocuments: isUserPersonaAvatarAttachment(resource),
    contentHash: resource.contentHash,
    size: resource.originalBlob.size,
    updatedAt: resource.updatedAt,
  })
  if (started.alreadyPresent) {
    return { commit: async () => undefined, abort: async () => undefined }
  }

  try {
    await transferNativeStream(resource.originalBlob, {
      append: (data) => nativeLibrary.appendWrite({ token: started.token, data }),
    })
  } catch (error) {
    await nativeLibrary.abortWrite({ token: started.token }).catch(() => undefined)
    throw error
  }

  let settled = false
  return {
    async commit(): Promise<void> {
      if (settled) return
      await nativeLibrary.commitWrite({ token: started.token })
      settled = true
    },
    async abort(): Promise<void> {
      if (settled) return
      settled = true
      await nativeLibrary.abortWrite({ token: started.token }).catch(() => undefined)
    },
  }
}

export async function mirrorNativeResourceFile(
  resource: Resource,
  scope: NativeResourceScope,
): Promise<void> {
  const handle = await stageNativeResourceFile(resource, scope)
  await handle.commit()
}

export async function removeNativeResourceFile(
  id: string,
  scope: NativeResourceScope,
): Promise<void> {
  if (!isAndroidNative()) return
  await nativeLibrary.remove({ scope, id })
}

export async function clearNativeResourceFiles(): Promise<void> {
  if (!isAndroidNative()) return
  await nativeLibrary.clear()
}

export async function clearNativeTemporaryCaches(): Promise<number> {
  if (!isAndroidNative()) return 0
  const result = await nativeLibrary.clearTemporaryCaches()
  return result.clearedBytes
}

export async function getNativeResourceStorageInfo(): Promise<NativeResourceStorageInfo | null> {
  if (!isAndroidNative()) return null
  return nativeLibrary.getStorageInfo()
}

export async function listNativeRecoveryCandidates(
  cursor: string | undefined,
  limit = 100,
  currentIds: string[] = [],
): Promise<NativeRecoveryCandidatePage | null> {
  if (!isAndroidNative()) return null
  return nativeLibrary.listRecoveryCandidates({
    ...(cursor ? { cursor } : {}),
    limit: Math.max(1, Math.min(200, Math.trunc(limit))),
    currentIds,
  })
}

export async function readNativeResourceObject(
  contentHash: string,
  size: number,
  mimeType: string,
): Promise<Blob> {
  if (!isAndroidNative()) throw new Error('当前不是 Android 原生资源环境')
  const result = await nativeLibrary.getObjectPath({ contentHash, size })
  if (result.size !== size) throw new Error('Android 原生资源大小与索引不一致')
  const response = await fetch(Capacitor.convertFileSrc(result.path), { cache: 'no-store' })
  if (!response.ok) throw new Error(`Android 原生资源读取失败（${response.status}）`)
  const blob = await response.blob()
  if (blob.size !== size) throw new Error('Android 原生资源读取不完整')
  return blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })
}

export async function linkNativeResourceObjects(
  records: NativeResourceLinkRecord[],
): Promise<number> {
  if (!records.length || !isAndroidNative()) return 0
  const result = await nativeLibrary.linkObjects({ records })
  return result.linked
}

/**
 * Verify that a native entry still points at the declared, SHA-256-checked object.
 * This is intentionally a precondition for dropping an IndexedDB mirror Blob.
 */
export async function verifyNativeResourceLinks(
  records: Array<{
    scope: NativeResourceScope
    id: string
    contentHash: string
    size: number
  }>,
): Promise<number> {
  if (!records.length) return 0
  if (!isAndroidNative()) throw new Error('当前不是 Android 原生资源环境')
  const result = await nativeLibrary.verifyLinkedObjects({ records })
  return result.verified
}

export async function unlinkNativeResourceEntries(
  records: Array<{ scope: NativeResourceScope; id: string; contentHash: string }>,
): Promise<number> {
  if (!records.length || !isAndroidNative()) return 0
  const result = await nativeLibrary.unlinkEntries({ records })
  return result.removed
}

export async function reconcileNativeResourceEntries(
  currentIds: string[],
  versionIds: string[],
): Promise<{ removedCurrent: number; removedVersions: number }> {
  if (!isAndroidNative()) return { removedCurrent: 0, removedVersions: 0 }
  return nativeLibrary.reconcileEntries({ currentIds, versionIds })
}
