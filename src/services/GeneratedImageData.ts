import type {
  FrontendWorkshopImageFormat,
  FrontendWorkshopGeneratedImage,
} from '../types/ImageGeneration'

export const FORMAT_MIME: Record<FrontendWorkshopImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export function asImageDataUrl(value: unknown, mimeType: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (value.startsWith('data:image/')) return value
  return `data:${mimeType};base64,${value}`
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

export function imageFormatFromBytes(
  bytes: Uint8Array,
): { mimeType: string; extension: FrontendWorkshopImageFormat } | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return { mimeType: 'image/png', extension: 'png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mimeType: 'image/jpeg', extension: 'jpeg' }
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return { mimeType: 'image/webp', extension: 'webp' }
  return undefined
}

export function decodeGeneratedImageDataUrl(value: string): Blob {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/u)
  if (!match) throw new Error('生成结果不是可保存的图片格式')
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: match[1] })
}

export async function generatedImageToBlob(
  request: typeof fetch,
  image: FrontendWorkshopGeneratedImage,
): Promise<Blob> {
  if (image.dataUrl) return decodeGeneratedImageDataUrl(image.dataUrl)
  if (image.temporaryUrl?.startsWith('https://')) {
    const response = await request(image.temporaryUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error('无法读取供应商返回的临时图片')
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) throw new Error('生成结果不是图片')
    return blob
  }
  throw new Error('当前没有可保存的生成图片')
}
