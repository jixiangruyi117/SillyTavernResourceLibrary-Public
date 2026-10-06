import { isResourceGalleryImage } from '../types/ResourceGallery'
import { Capacitor, registerPlugin } from '@capacitor/core'

import { transferNativeStream } from '../core/NativeStreamTransfer'
import { nativeFileSource, rememberNativeFile } from '../core/NativeFileSource'
import { isUserPersonaAvatarAttachment, type Resource } from '../types/Resource'
import type { NativeVersionMatchReference, ParsedResource } from '../types/Import'

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
  appendFile(options: { token: string; uri: string }): Promise<void>
  commitWrite(options: { token: string }): Promise<void>
  abortWrite(options: { token: string }): Promise<void>
  remove(options: { scope: NativeResourceScope; id: string }): Promise<void>
  removeMany(options: { records: Array<{ scope: NativeResourceScope; id: string }> }): Promise<void>
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
  matchCharacterCardCandidates(options: {
    parsedResource: ParsedResource
    fileName: string
    candidates: Array<Record<string, unknown>>
    sameNameCandidates: boolean
  }): Promise<{ candidates: NativeVersionMatchReference[] }>
  beginCharacterCardParse(options: {
    fileName: string
    size: number
  }): Promise<{ token: string; size: number }>
  appendCharacterCardParse(options: { token: string; size: number; data: string }): Promise<void>
  finishCharacterCardParse(options: {
    token: string
    fileName: string
    size: number
  }): Promise<{ token?: string; state: string; parsedResourceUri?: string }>
  parseCharacterCardUri(options: {
    uri: string
    fileName: string
  }): Promise<{ token?: string; state: string; parsedResourceUri?: string }>
  cleanupCharacterCardParse(options: { token: string }): Promise<void>
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
  /** Disjoint directory-based subsets of webViewBytes, available in newer APKs only. */
  webViewBreakdown?: {
    siteDataBytes: number
    cacheBytes: number
    temporaryBlobBytes: number
    otherBytes: number
  }
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
    hiddenFromDocuments:
      isUserPersonaAvatarAttachment(resource) || isResourceGalleryImage(resource),
    contentHash: resource.contentHash,
    size: resource.originalBlob.size,
    updatedAt: resource.updatedAt,
  })
  if (started.alreadyPresent) {
    return { commit: async () => undefined, abort: async () => undefined }
  }

  try {
    const uri = nativeFileSource(resource.originalBlob)
    let copied = false
    if (uri) {
      try {
        await nativeLibrary.appendFile({ token: started.token, uri })
        copied = true
      } catch (error) {
        if ((error as { code?: string }).code !== 'UNIMPLEMENTED') throw error
      }
    }
    if (!copied)
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

export async function removeNativeResourceFiles(
  records: Array<{ scope: NativeResourceScope; id: string }>,
  onProgress?: (completed: number) => void,
): Promise<void> {
  if (!isAndroidNative()) return
  for (let offset = 0; offset < records.length; offset += 128) {
    const batch = records.slice(offset, offset + 128)
    try {
      await nativeLibrary.removeMany({ records: batch })
    } catch (error) {
      // Older installed APKs still expose the single-entry owner.
      if ((error as { code?: string })?.code !== 'UNIMPLEMENTED') throw error
      for (const record of batch) await nativeLibrary.remove(record)
    }
    onProgress?.(offset + batch.length)
  }
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
  return rememberNativeFile(
    blob.type === mimeType ? blob : new Blob([blob], { type: mimeType }),
    result.path,
  )
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

export async function matchNativeCharacterCardCandidates(
  parsedResource: ParsedResource,
  fileName: string,
  candidates: Array<Record<string, unknown>>,
  sameNameCandidates: boolean,
): Promise<NativeVersionMatchReference[] | null> {
  if (!isAndroidNativeResourceMirrorAvailable()) return null
  const matched: NativeVersionMatchReference[] = []
  for (let offset = 0; offset < candidates.length; offset += 200) {
    const result = await nativeLibrary.matchCharacterCardCandidates({
      parsedResource,
      fileName,
      candidates: candidates.slice(offset, offset + 200),
      sameNameCandidates,
    })
    matched.push(...result.candidates)
  }
  return matched
}

/**
 * On APK, parse incoming JSON/PNG cards in Android and return the parsed owner payload.
 * Existing Android-staged files use their URI; ordinary browser File objects stream in bounded chunks.
 */
export async function parseNativeCharacterCardFile(
  file: File,
  signal?: AbortSignal,
): Promise<ParsedResource | undefined> {
  if (!isAndroidNativeResourceMirrorAvailable() || !/\.(json|png)$/i.test(file.name))
    return undefined
  let token: string | undefined
  try {
    const uri = nativeFileSource(file)
    let result: { token?: string; state: string; parsedResourceUri?: string }
    if (uri) {
      result = await nativeLibrary.parseCharacterCardUri({ uri, fileName: file.name })
      token = result.token
    } else {
      const started = await nativeLibrary.beginCharacterCardParse({
        fileName: file.name,
        size: file.size,
      })
      token = started.token
      await transferNativeStream(file, {
        signal,
        totalBytes: file.size,
        chunkBytes: 1024 * 1024,
        append: (data) =>
          nativeLibrary.appendCharacterCardParse({ token: started.token, size: file.size, data }),
      })
      result = await nativeLibrary.finishCharacterCardParse({
        token: started.token,
        fileName: file.name,
        size: file.size,
      })
      token = result.token
    }
    if (result.state !== 'parsed' || !result.parsedResourceUri) return undefined
    const response = await fetch(Capacitor.convertFileSrc(result.parsedResourceUri), {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Android 原生角色卡解析结果读取失败（${response.status}）`)
    const parsed = (await response.json()) as ParsedResource
    if (
      parsed.type !== 'characterCard' ||
      !parsed.metadata ||
      !parsed.metadata.card ||
      typeof parsed.metadata.card !== 'object'
    ) {
      throw new Error('Android 原生角色卡解析结果格式无效')
    }
    return parsed
  } catch (error) {
    if ((error as { code?: string })?.code === 'UNIMPLEMENTED') return undefined
    throw error
  } finally {
    if (token) await nativeLibrary.cleanupCharacterCardParse({ token }).catch(() => undefined)
  }
}
