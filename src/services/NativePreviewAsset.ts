import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativePreviewAssetPlugin {
  download(options: { url: string; maxBytes: number }): Promise<{
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
): Promise<NativePreviewAssetResult> {
  if (!isNativePreviewAssetAvailable()) throw new Error('当前不是 Android 原生预览环境')
  const result = await nativePreviewAsset.download({ url, maxBytes })
  return {
    ...result,
    resourceUrl: Capacitor.convertFileSrc(result.path),
  }
}
