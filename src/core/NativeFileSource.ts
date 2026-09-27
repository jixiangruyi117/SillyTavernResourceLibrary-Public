import { Capacitor, registerPlugin } from '@capacitor/core'

// Blob identity is deliberately used: slices/transformed bytes must never inherit a stale path.
const sources = new WeakMap<Blob, string>()
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

export function rememberNativeFile<T extends Blob>(blob: T, uri: string): T {
  sources.set(blob, uri)
  return blob
}

export function nativeFileSource(blob: Blob): string | undefined {
  return Capacitor.isNativePlatform() ? sources.get(blob) : undefined
}

export async function hashNativeFile(blob: Blob): Promise<string | undefined> {
  const uri = nativeFileSource(blob)
  if (!uri) return undefined
  try {
    return (await plugin.hashFile({ uri, size: blob.size })).hash
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
    const result = await images.createThumbnail({ uri, size: blob.size, maxEdge, quality })
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
