const THUMBNAIL_MAX_EDGE = 640

export async function createImageThumbnail(
  source: Blob,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<Blob | undefined> {
  if (typeof createImageBitmap !== 'function') return undefined

  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(source)
    const maxEdge = Math.max(32, Math.min(768, options.maxEdge ?? THUMBNAIL_MAX_EDGE))
    const quality = Math.max(0.5, Math.min(0.95, options.quality ?? 0.82))
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
      return await canvas.convertToBlob({ type: 'image/webp', quality })
    }

    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
      return await new Promise((resolve) =>
        canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/webp', quality),
      )
    }
  } catch {
    return undefined
  } finally {
    bitmap?.close()
  }

  return undefined
}
