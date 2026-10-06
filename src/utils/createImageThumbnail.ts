import { thumbnailNativeFile } from '../core/NativeFileSource'

const THUMBNAIL_MAX_EDGE = 640

export async function createImageThumbnail(
  source: Blob,
  options: { maxEdge?: number; quality?: number; allowImageElement?: boolean } = {},
): Promise<Blob | undefined> {
  let bitmap: ImageBitmap | undefined
  let image: HTMLImageElement | undefined
  let objectUrl: string | undefined
  try {
    const maxEdge = Math.max(32, Math.min(768, options.maxEdge ?? THUMBNAIL_MAX_EDGE))
    const quality = Math.max(0.5, Math.min(0.95, options.quality ?? 0.82))
    const nativeThumbnail = await thumbnailNativeFile(source, maxEdge, quality)
    if (nativeThumbnail) return nativeThumbnail
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(source)
      } catch {
        /* Safari format support differs from Image. */
      }
    }
    if (!bitmap && options.allowImageElement && typeof Image !== 'undefined') {
      image = new Image()
      objectUrl = URL.createObjectURL(source)
      const loaded = new Promise<void>((resolve, reject) => {
        image!.onload = () => resolve()
        image!.onerror = () => reject(new Error('图片无法解码'))
      })
      image.src = objectUrl
      await loaded
    }
    const decoded = bitmap ?? image
    const sourceWidth = bitmap?.width ?? image?.naturalWidth ?? 0
    const sourceHeight = bitmap?.height ?? image?.naturalHeight ?? 0
    if (!decoded || !sourceWidth || !sourceHeight) return undefined
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      canvas.getContext('2d')?.drawImage(decoded, 0, 0, width, height)
      return await canvas.convertToBlob({ type: 'image/webp', quality })
    }

    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')?.drawImage(decoded, 0, 0, width, height)
      return await new Promise((resolve) =>
        canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/webp', quality),
      )
    }
  } catch {
    return undefined
  } finally {
    bitmap?.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }

  return undefined
}
