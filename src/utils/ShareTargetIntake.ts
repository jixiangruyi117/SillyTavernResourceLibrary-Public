import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * 取回系统分享暂存的文件。
 *
 * 网页由 Service Worker 暂存；APK 由 Android 流式复制到应用私有持久目录。
 * 应用启动后交给常规导入管线，只有数据库导入成功才确认删除；
 * 失败文件保留七天供下次启动重试。文件从不离开本机。
 */

const INTAKE_CACHE = 'srl-share-intake'
const LEGACY_MANIFEST_KEY = '/srl-shared/manifest'

interface SharedFileMeta {
  name: string
  type: string
}

interface NativeSharedFile extends SharedFileMeta {
  /** 0.0.2 及更早原生壳返回 Base64；保留读取能力，避免网页先更新时旧 APK 失效。 */
  data?: string
  /** 新原生壳返回应用私有暂存目录中的 file:// URI，避免 Base64 放大与多次内存复制。 */
  uri?: string
  cleanupToken?: string
}

interface ShareReceiverPlugin {
  getPendingShare(): Promise<{ files: NativeSharedFile[] }>
  cleanupPendingShare(options: { tokens: string[] }): Promise<void>
}

const shareReceiver = registerPlugin<ShareReceiverPlugin>('ShareReceiver')

export interface SharedFileBatch {
  files: File[]
  acknowledge(): Promise<void>
}

function base64File(shared: NativeSharedFile & { data: string }): File {
  const binary = atob(shared.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], shared.name || 'shared-file', {
    type: shared.type || 'application/octet-stream',
  })
}

async function takeNativeSharedFiles(): Promise<SharedFileBatch> {
  if (!Capacitor.isNativePlatform()) return { files: [], acknowledge: async () => undefined }
  const result = await shareReceiver.getPendingShare()
  const files: File[] = []
  const cleanupTokens = (result.files ?? []).flatMap((shared) =>
    shared.cleanupToken ? [shared.cleanupToken] : [],
  )
  for (const shared of result.files ?? []) {
    if (shared.uri) {
      const response = await fetch(Capacitor.convertFileSrc(shared.uri), { cache: 'no-store' })
      if (!response.ok) throw new Error(`读取系统分享暂存文件失败（HTTP ${response.status}）`)
      const blob = await response.blob()
      files.push(
        new File([blob], shared.name || 'shared-file', {
          type: shared.type || blob.type || 'application/octet-stream',
        }),
      )
    } else if (typeof shared.data === 'string') {
      files.push(base64File(shared as NativeSharedFile & { data: string }))
    }
  }
  return {
    files,
    acknowledge: async () => {
      if (cleanupTokens.length) await shareReceiver.cleanupPendingShare({ tokens: cleanupTokens })
    },
  }
}

export async function takeSharedFileBatch(): Promise<SharedFileBatch> {
  const nativeBatch = await takeNativeSharedFiles()
  if (nativeBatch.files.length) return nativeBatch
  if (typeof caches === 'undefined') return { files: [], acknowledge: async () => undefined }
  try {
    const cacheNames = await caches.keys()
    if (!cacheNames.includes(INTAKE_CACHE)) return { files: [], acknowledge: async () => undefined }
    const cache = await caches.open(INTAKE_CACHE)
    const requestedIntakeId = new URLSearchParams(window.location.search).get('share-target')
    const intakeId = requestedIntakeId && requestedIntakeId !== 'received' ? requestedIntakeId : ''
    const prefix = intakeId ? `/srl-shared/${encodeURIComponent(intakeId)}` : '/srl-shared'
    const manifestKey = intakeId ? `${prefix}/manifest` : LEGACY_MANIFEST_KEY
    const manifestResponse = await cache.match(manifestKey)
    if (!manifestResponse) {
      return { files: [], acknowledge: async () => undefined }
    }
    const manifestPayload = (await manifestResponse.json().catch(() => [])) as
      SharedFileMeta[] | { files?: SharedFileMeta[] }
    const manifest = Array.isArray(manifestPayload)
      ? manifestPayload
      : (manifestPayload.files ?? [])
    const files: File[] = []
    const consumedKeys = [manifestKey]
    for (let index = 0; index < manifest.length; index += 1) {
      const key = `${prefix}/${index}`
      const response = await cache.match(key)
      if (!response) continue
      consumedKeys.push(key)
      const blob = await response.blob()
      files.push(
        new File([blob], manifest[index]?.name || `分享文件-${index + 1}`, {
          type: manifest[index]?.type || blob.type,
        }),
      )
    }
    return {
      files,
      acknowledge: async () => {
        await Promise.all(consumedKeys.map((key) => cache.delete(key)))
      },
    }
  } catch {
    return { files: [], acknowledge: async () => undefined }
  }
}

/** 兼容旧调用：读取后立即确认；主应用使用批次 API，在数据库导入完成后才确认。 */
export async function takeSharedFiles(): Promise<File[]> {
  const batch = await takeSharedFileBatch()
  await batch.acknowledge()
  return batch.files
}

/** 清掉分享跳转带来的查询参数，避免刷新时误判为再次分享。 */
export function clearShareTargetQuery(): void {
  if (!new URLSearchParams(window.location.search).has('share-target')) return
  window.history.replaceState(null, '', window.location.pathname)
}
