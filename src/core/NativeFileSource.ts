import { Capacitor, registerPlugin } from '@capacitor/core'

// Blob identity is deliberately used: slices/transformed bytes must never inherit a stale path.
const sources = new WeakMap<Blob, string>()
const declaredSizes = new WeakMap<Blob, number>()
interface NativeFileOperations {
  hashFile(options: { uri: string; size: number }): Promise<{ hash: string }>
  createThumbnail(options: {
    uri: string
    size: number
    maxEdge: number
    quality: number
  }): Promise<{ uri?: string }>
  releaseThumbnail(options: { uri: string }): Promise<void>
}
const plugin = registerPlugin<NativeFileOperations>('NativeLibrary')
const images = registerPlugin<NativeFileOperations>('NativeImages')

export function rememberNativeFile<T extends Blob>(blob: T, uri: string, declaredSize?: number): T {
  sources.set(blob, uri)
  if (declaredSize !== undefined && Number.isSafeInteger(declaredSize) && declaredSize >= 0)
    declaredSizes.set(blob, declaredSize)
  return blob
}

export function nativeFileSize(blob: Blob): number {
  return declaredSizes.get(blob) ?? blob.size
}

export async function materializeNativeFile(file: File): Promise<File> {
  const uri = nativeFileSource(file)
  const declaredSize = nativeFileSize(file)
  if (!uri || file.size > 0 || declaredSize === 0) return file
  const response = await fetch(Capacitor.convertFileSrc(uri), { cache: 'no-store' })
  if (!response.ok) throw new Error(`读取系统分享暂存文件失败（HTTP ${response.status}）`)
  const blob = await response.blob()
  if (declaredSize > 0 && blob.size !== declaredSize) throw new Error('系统分享暂存文件大小已变化')
  return rememberNativeFile(
    new File([blob], file.name, { type: file.type || blob.type || 'application/octet-stream' }),
    uri,
    declaredSize || blob.size,
  )
}

export function nativeFileSource(blob: Blob): string | undefined {
  return Capacitor.isNativePlatform() ? sources.get(blob) : undefined
}

export async function hashNativeFile(blob: Blob): Promise<string | undefined> {
  const uri = nativeFileSource(blob)
  if (!uri) return undefined
  try {
    return (await plugin.hashFile({ uri, size: nativeFileSize(blob) })).hash
  } catch (error) {
    if ((error as { code?: string }).code === 'UNIMPLEMENTED') return undefined
    throw error
  }
}

export async function thumbnailNativeFile(
  blob: Blob,
  maxEdge: number,
  quality: number,
): Promise<Blob | undefined> {
  const uri = nativeFileSource(blob)
  if (!uri) return undefined
  try {
    const result = await images.createThumbnail({ uri, size: nativeFileSize(blob), maxEdge, quality })
    if (!result.uri) return undefined
    try {
      const response = await fetch(Capacitor.convertFileSrc(result.uri), { cache: 'no-store' })
      if (!response.ok) throw new Error('原生缩略图读取失败')
      return await response.blob()
    } finally {
      await images.releaseThumbnail({ uri: result.uri })
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'UNIMPLEMENTED') return undefined
    throw error
  }
}
