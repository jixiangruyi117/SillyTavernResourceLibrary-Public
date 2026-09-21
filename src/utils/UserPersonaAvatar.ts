const AVATAR_MAX_SOURCE_BYTES = 12 * 1024 * 1024
const AVATAR_MAX_URL_LENGTH = 2048
const AVATAR_MAX_ID_LENGTH = 180
const AVATAR_MAX_EDGE = 8192
const AVATAR_MAX_PIXELS = 33_554_432
const AVATAR_CONVERTED_MAX_EDGE = 2048
const AVATAR_FETCH_TIMEOUT_MS = 20_000

type AvatarFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface FetchedUserPersonaAvatar {
  file: File
  sourceUrl: string
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  return signature.every((value, index) => bytes[index] === value)
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
}

function validateDimensions(width: number, height: number): void {
  if (!width || !height) throw new Error('头像图片尺寸无效')
  if (width > AVATAR_MAX_EDGE || height > AVATAR_MAX_EDGE || width * height > AVATAR_MAX_PIXELS) {
    throw new Error('头像图片尺寸过大，请使用边长不超过 8192px 的图片')
  }
}

function validatePng(bytes: Uint8Array): void {
  if (bytes.length < 45 || !isPng(bytes)) throw new Error('头像内容不是有效 PNG 图片')
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
    throw new Error('头像 PNG 缺少有效 IHDR 数据块')
  }
  if (String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4)) !== 'IEND') {
    throw new Error('头像 PNG 缺少结束数据块')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  validateDimensions(view.getUint32(16), view.getUint32(20))
}

function outputDimensions(width: number, height: number): { width: number; height: number } {
  validateDimensions(width, height)
  const scale = Math.min(1, AVATAR_CONVERTED_MAX_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function canvasToPng(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('头像转换为 PNG 失败'))),
      'image/png',
    ),
  )
}

async function convertWithBitmap(source: Blob): Promise<Blob | undefined> {
  if (typeof createImageBitmap !== 'function') return undefined
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(source)
    const dimensions = outputDimensions(bitmap.width, bitmap.height)
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(dimensions.width, dimensions.height)
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height)
      return await canvasToPng(canvas)
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = dimensions.width
      canvas.height = dimensions.height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height)
      return await canvasToPng(canvas)
    }
  } catch {
    throw new Error('头像图片无法解码')
  } finally {
    bitmap?.close()
  }
  return undefined
}

function convertWithImageElement(source: Blob): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.reject(new Error('当前环境无法把这张头像转换为 PNG'))
  }
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(source)
    const image = new Image()
    image.addEventListener('load', () => {
      try {
        const dimensions = outputDimensions(image.naturalWidth, image.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = dimensions.width
        canvas.height = dimensions.height
        canvas.getContext('2d')?.drawImage(image, 0, 0, dimensions.width, dimensions.height)
        void canvasToPng(canvas).then(resolve, reject)
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    })
    image.addEventListener('error', () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('头像图片无法解码'))
    })
    image.src = objectUrl
  })
}

async function convertRasterToPng(source: Blob): Promise<Blob> {
  const converted = (await convertWithBitmap(source)) ?? (await convertWithImageElement(source))
  if (!converted.size) throw new Error('转换后的头像为空')
  if (converted.size > AVATAR_MAX_SOURCE_BYTES) throw new Error('转换后的头像不能超过 12 MB')
  return converted
}

export function normalizeUserPersonaAvatarId(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('头像文件名不能为空')
  if (normalized.length > AVATAR_MAX_ID_LENGTH) throw new Error('头像文件名过长')
  const containsControlCharacter = Array.from(normalized).some(
    (character) => character.charCodeAt(0) < 32,
  )
  if (
    /[/\\]/u.test(normalized) ||
    containsControlCharacter ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new Error('头像 ID 必须是文件名，不能包含路径或控制字符')
  }
  if (!normalized.toLocaleLowerCase().endsWith('.png')) {
    throw new Error('头像文件名必须以 .png 结尾')
  }
  return normalized
}

export function normalizeUserPersonaAvatarUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('请输入头像图片直链')
  if (normalized.length > AVATAR_MAX_URL_LENGTH) throw new Error('头像图片直链过长')
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('头像图片直链格式无效')
  }
  if (url.protocol !== 'https:') throw new Error('头像图片直链必须使用 HTTPS')
  if (url.username || url.password) throw new Error('头像图片直链不能包含账号信息')
  return url.href
}

export async function prepareUserPersonaAvatar(source: Blob, avatarId: string): Promise<File> {
  const normalizedId = normalizeUserPersonaAvatarId(avatarId)
  if (!source.size) throw new Error('头像图片为空')
  if (source.size > AVATAR_MAX_SOURCE_BYTES) throw new Error('头像原图不能超过 12 MB')
  const bytes = new Uint8Array(await source.arrayBuffer())
  if (isPng(bytes)) {
    validatePng(bytes)
    return new File([bytes], normalizedId, { type: 'image/png' })
  }
  if (!isJpeg(bytes) && !isWebp(bytes)) {
    throw new Error('头像仅支持 PNG、JPG 或 WebP 图片')
  }
  const converted = await convertRasterToPng(source)
  return new File([converted], normalizedId, { type: 'image/png' })
}

export async function fetchUserPersonaAvatar(
  value: string,
  avatarId: string,
  fetcher: AvatarFetch = fetch,
): Promise<FetchedUserPersonaAvatar> {
  const sourceUrl = normalizeUserPersonaAvatarUrl(value)
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetcher(sourceUrl, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('头像直链下载超时', { cause: error })
    throw new Error(
      `头像直链无法跨域下载，请先把图片保存到本地再选择：${error instanceof Error ? error.message : '网络请求失败'}`,
      { cause: error },
    )
  } finally {
    globalThis.clearTimeout(timeout)
  }
  if (!response.ok) throw new Error(`头像直链返回 HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > AVATAR_MAX_SOURCE_BYTES) throw new Error('头像原图不能超过 12 MB')
  const blob = await response.blob()
  return { file: await prepareUserPersonaAvatar(blob, avatarId), sourceUrl }
}
