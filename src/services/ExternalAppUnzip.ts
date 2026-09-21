import { Unzip, UnzipInflate } from 'fflate'
import { zipArchiveChunks } from '../utils/ZipArchiveStream'
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024

export const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024

export const MAX_EXTRACTED_FILES = 100

export const MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024

export function requireSafePath(value: string, label: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.includes('//') ||
    normalized.includes(String.fromCharCode(0)) ||
    normalized.split('/').some((segment) => segment === '.' || segment === '..') ||
    /\\/.test(normalized)
  ) {
    throw new Error(`${label}包含不安全路径`)
  }
  return normalized
}

/** Bound actual inflated bytes as well as directory sizes, on both worker and fallback paths. */
export async function boundedUnzipPackage(bytes: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = Object.create(null)
  const paths = new Set<string>()
  let total = 0
  let declared = 0
  let active = 0
  let failure: Error | undefined
  const unzip = new Unzip((entry) => {
    const path = requireSafePath(entry.name, '安装包')
    if (paths.has(path)) throw new Error('安装包包含重复文件')
    paths.add(path)
    if (paths.size > MAX_EXTRACTED_FILES) throw new Error('安装包文件数量超过限制')
    if (entry.compression !== 0 && entry.compression !== 8)
      throw new Error('安装包使用了不支持的压缩算法')
    declared += entry.originalSize ?? 0
    if ((entry.originalSize ?? 0) > MAX_SINGLE_FILE_BYTES || declared > MAX_EXTRACTED_BYTES)
      throw new Error('安装包解压后的内容超过限制')
    let length = 0
    let parts: Uint8Array[] = []
    active++
    entry.ondata = (error, data, final) => {
      if (failure) return
      if (error) {
        failure = error
        return
      }
      length += data.byteLength
      total += data.byteLength
      if (length > MAX_SINGLE_FILE_BYTES || total > MAX_EXTRACTED_BYTES) {
        failure = new Error('安装包解压后的内容超过限制')
        entry.terminate()
        parts = []
        return
      }
      parts.push(data)
      if (final) {
        if (entry.originalSize !== undefined && length !== entry.originalSize) {
          failure = new Error('安装包文件大小与目录不一致')
          return
        }
        const result = new Uint8Array(length)
        let offset = 0
        for (const part of parts) {
          result.set(part, offset)
          offset += part.length
        }
        files[path] = result
        parts = []
        active--
      }
    }
    entry.start()
  })
  unzip.register(UnzipInflate)
  let sinceYield = 0
  for await (const chunk of zipArchiveChunks(new Blob([bytes]))) {
    unzip.push(chunk, false)
    if (failure) throw failure
    sinceYield += chunk.length
    if (sinceYield >= 256 * 1024) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      sinceYield = 0
    }
  }
  unzip.push(new Uint8Array(), true)
  if (failure) throw failure
  if (active) throw new Error('安装包内容不完整')
  if (!paths.size) throw new Error('安装包内容为空')
  return files
}
