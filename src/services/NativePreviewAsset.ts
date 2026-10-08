import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativePreviewAssetPlugin {
  prepare(options: { sessionId: string; urls: string[] }): Promise<void>
  release(options: { sessionId: string }): Promise<void>
  cancel(options: { requestId: string }): Promise<void>
  download(options: { url: string; maxBytes: number; requestId: string }): Promise<{
    path: string
    resolvedUrl: string
    contentType: string
    size: number
    text?: string
    cached: boolean
  }>
}

const nativePreviewAsset = registerPlugin<NativePreviewAssetPlugin>('NativePreviewAsset')

export interface NativePreviewAssetResult {
  resourceUrl: string
  resolvedUrl: string
  contentType: string
  size: number
  text?: string
  cached: boolean
}

export function isNativePreviewAssetAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function downloadNativePreviewAsset(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<NativePreviewAssetResult> {
  if (!isNativePreviewAssetAvailable()) throw new Error('当前不是 Android 原生预览环境')
  if (signal?.aborted) throw new DOMException('资源预下载已取消', 'AbortError')
  const requestId = crypto.randomUUID()
  const abort = () => void nativePreviewAsset.cancel({ requestId }).catch(() => undefined)
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await nativePreviewAsset.download({ url, maxBytes, requestId })
    if (signal?.aborted) throw new DOMException('资源预下载已取消', 'AbortError')
    return {
      ...result,
      resourceUrl: Capacitor.convertFileSrc(result.path),
    }
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

/** Register only this preview's public display URLs; downloading follows WebView demand. */
export async function prepareNativePreviewAssets(
  urls: string[],
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return
  const sessionId = crypto.randomUUID()
  const release = () => void nativePreviewAsset.release({ sessionId }).catch(() => undefined)
  signal.addEventListener('abort', release, { once: true })
  try {
    await nativePreviewAsset.prepare({ sessionId, urls })
    // An abort can arrive before the bridge registers the session.
    if (signal.aborted) release()
  } catch (error) {
    signal.removeEventListener('abort', release)
    release()
    throw error
  }
}
