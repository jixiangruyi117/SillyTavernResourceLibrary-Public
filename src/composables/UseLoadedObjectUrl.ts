import { onScopeDispose, ref, type Ref } from 'vue'

export interface LoadedObjectUrl {
  previewUrl: Ref<string>
  replacePreview: (url: string) => void
  confirmPreviewLoaded: () => void
  releasePreview: () => void
}

/**
 * 保留旧 Object URL，直到浏览器确认新图片加载完成，避免 Safari 提前释放后显示裂图。
 */
export function useLoadedObjectUrl(): LoadedObjectUrl {
  const previewUrl = ref('')
  const obsoletePreviewUrls = new Set<string>()

  function revokeObsoletePreviews(): void {
    for (const url of obsoletePreviewUrls) URL.revokeObjectURL(url)
    obsoletePreviewUrls.clear()
  }

  function releasePreview(): void {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
    revokeObsoletePreviews()
  }

  function replacePreview(url: string): void {
    const previousUrl = previewUrl.value
    previewUrl.value = url
    if (!previousUrl || previousUrl === url) return
    if (!url) {
      URL.revokeObjectURL(previousUrl)
      obsoletePreviewUrls.delete(previousUrl)
      return
    }
    obsoletePreviewUrls.add(previousUrl)
  }

  function confirmPreviewLoaded(): void {
    revokeObsoletePreviews()
  }

  onScopeDispose(releasePreview)

  return { previewUrl, replacePreview, confirmPreviewLoaded, releasePreview }
}
