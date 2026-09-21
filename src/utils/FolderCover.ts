const FOLDER_COVER_MAX_SOURCE_BYTES = 12 * 1024 * 1024
const FOLDER_COVER_MAX_DATA_URL_LENGTH = 480_000
const FOLDER_COVER_MAX_EDGE = 480
const FOLDER_COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const FOLDER_COVER_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i
const FOLDER_COVER_MAX_REMOTE_URL_LENGTH = 2048

export function isValidFolderCoverDataUrl(value: string): boolean {
  return value.length <= FOLDER_COVER_MAX_DATA_URL_LENGTH && FOLDER_COVER_DATA_URL.test(value)
}

export function normalizeFolderCoverUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('请输入封面图片直链')
  if (normalized.length > FOLDER_COVER_MAX_REMOTE_URL_LENGTH) throw new Error('封面直链过长')
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('封面直链格式无效')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('封面直链必须是无账号信息的 HTTPS 地址')
  }
  return url.href
}

export function isValidFolderCoverImage(value: string): boolean {
  if (isValidFolderCoverDataUrl(value)) return true
  try {
    return normalizeFolderCoverUrl(value) === value
  } catch {
    return false
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('封面读取失败')),
    )
    reader.addEventListener('error', () => reject(new Error('封面读取失败')))
    reader.readAsDataURL(blob)
  })
}

async function createCompactCover(source: Blob): Promise<Blob | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return undefined
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(source)
    const scale = Math.min(1, FOLDER_COVER_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
    return await new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/webp', 0.78),
    )
  } catch {
    return undefined
  } finally {
    bitmap?.close()
  }
}

export async function createFolderCoverDataUrl(file: File): Promise<string> {
  if (!FOLDER_COVER_TYPES.has(file.type)) throw new Error('封面仅支持 JPG、PNG 或 WebP 图片')
  if (!file.size) throw new Error('封面图片为空')
  if (file.size > FOLDER_COVER_MAX_SOURCE_BYTES) throw new Error('封面原图不能超过 12 MB')

  const compact = await createCompactCover(file)
  const prepared = compact ?? (file.size <= 320_000 ? file : undefined)
  if (!prepared) throw new Error('当前浏览器无法压缩这张封面，请换一张较小的图片')
  const dataUrl = await readBlobAsDataUrl(prepared)
  if (!isValidFolderCoverDataUrl(dataUrl)) throw new Error('压缩后的封面仍然过大，请换一张图片')
  return dataUrl
}
