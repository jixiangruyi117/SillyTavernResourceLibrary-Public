import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { hashCloudBlob } from './CloudArchiveCodec'

export const GITHUB_BUNDLE_FORMAT = 'srl-github-backup-bundle'
export const GITHUB_BUNDLE_VERSION = 2
const LEGACY_GITHUB_BUNDLE_VERSION = 1
// CF Worker 同源代理 body 上限为 64 MiB，任何内容定义分块都不会超过 32 MiB。
// 平均边界约 16 MiB；文件中间增删数据后会很快重新同步边界，避免后续分卷全部重传。
export const GITHUB_PART_SIZE = 32 * 1024 * 1024
export const GITHUB_MIN_PART_SIZE = 8 * 1024 * 1024
export const GITHUB_AVERAGE_PART_SIZE = 16 * 1024 * 1024

export interface GitHubBundlePart {
  name: string
  /** 逻辑对象在该存储块中的字节数。 */
  size: number
  /** 存储块 SHA-256；普通分块同时也是逻辑片段 SHA-256。 */
  sha256: string
  /** 小对象聚合包中的起始偏移；旧清单和普通分块不设置。 */
  offset?: number
  /** 远端聚合包的完整大小；旧清单和普通分块不设置。 */
  storedSize?: number
  /** V3 transport locator. V1/V2 manifests infer the legacy container. */
  storage?: {
    kind: 'github-release' | 'koofr-path'
    container: string
    objectKey: string
  }
}

export interface GitHubBundleManifest {
  format: typeof GITHUB_BUNDLE_FORMAT
  version: typeof GITHUB_BUNDLE_VERSION | typeof LEGACY_GITHUB_BUNDLE_VERSION
  createdAt: string
  fileName: string
  totalSize: number
  totalSha256: string
  parts: GitHubBundlePart[]
}

export function bundleManifestName(fileName: string): string {
  return `${fileName}.srlbundle.json`
}

const CONTENT_BOUNDARY_MASK = GITHUB_AVERAGE_PART_SIZE - 1
const GEAR_TABLE = (() => {
  const values = new Uint32Array(256)
  let state = 0x9e3779b9
  for (let index = 0; index < values.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    values[index] = state >>> 0
  }
  return values
})()

async function contentDefinedParts(
  blob: Blob,
  computeTotal: boolean,
): Promise<{
  blobs: Blob[]
  parts: GitHubBundlePart[]
  totalSha256?: string
}> {
  const blobs: Blob[] = []
  const parts: GitHubBundlePart[] = []
  let start = 0
  let offset = 0
  let rolling = 0
  let partHash = sha256.create()
  const totalHash = computeTotal ? sha256.create() : undefined
  const reader = blob.stream().getReader()
  let yieldedAt = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalHash?.update(value)
      let segmentStart = 0
      const valueOffset = offset
      for (const byte of value) {
        rolling = (Math.imul(rolling, 2) + (GEAR_TABLE[byte] ?? 0)) >>> 0
        offset += 1
        const size = offset - start
        if (
          size >= GITHUB_MIN_PART_SIZE &&
          ((rolling & CONTENT_BOUNDARY_MASK) === 0 || size >= GITHUB_PART_SIZE)
        ) {
          const segmentEnd = offset - valueOffset
          partHash.update(value.subarray(segmentStart, segmentEnd))
          const hash = bytesToHex(partHash.digest())
          blobs.push(blob.slice(start, offset))
          parts.push({ name: `srl-chunk--sha256-${hash}`, size: offset - start, sha256: hash })
          start = offset
          rolling = 0
          partHash = sha256.create()
          segmentStart = segmentEnd
        }
      }
      partHash.update(value.subarray(segmentStart))
      // Preserve UI opportunities during large-file planning without a second read/hash pass.
      if (offset - yieldedAt >= 1024 * 1024) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        yieldedAt = offset
      }
    }
    if (offset !== blob.size) throw new Error('云备份分块读取长度与原件不一致')
    if (start < offset || !parts.length) {
      const hash = bytesToHex(partHash.digest())
      blobs.push(blob.slice(start, offset))
      parts.push({ name: `srl-chunk--sha256-${hash}`, size: offset - start, sha256: hash })
    }
  } finally {
    reader.releaseLock()
  }
  return { blobs, parts, totalSha256: totalHash ? bytesToHex(totalHash.digest()) : undefined }
}

export async function createGitHubBundle(
  blob: Blob,
  fileName: string,
  partSize?: number,
  knownTotalSha256?: string,
): Promise<{ manifest: GitHubBundleManifest; blobs: Blob[] }> {
  if (partSize !== undefined && (!Number.isFinite(partSize) || partSize <= 0))
    throw new Error('GitHub 分包大小无效')
  if (knownTotalSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(knownTotalSha256))
    throw new Error('云备份总哈希无效')
  const streamed =
    partSize === undefined
      ? await contentDefinedParts(blob, knownTotalSha256 === undefined)
      : undefined
  const blobs =
    streamed?.blobs ??
    Array.from({ length: Math.max(1, Math.ceil(blob.size / partSize!)) }, (_, index) =>
      blob.slice(index * partSize!, Math.min(blob.size, (index + 1) * partSize!)),
    )
  const parts: GitHubBundlePart[] = streamed?.parts ?? []
  if (!streamed) {
    for (const part of blobs) {
      const hash = await hashCloudBlob(part)
      parts.push({ name: `srl-chunk--sha256-${hash}`, size: part.size, sha256: hash })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }

  return {
    blobs,
    manifest: {
      format: GITHUB_BUNDLE_FORMAT,
      version: GITHUB_BUNDLE_VERSION,
      createdAt: new Date().toISOString(),
      fileName,
      totalSize: blob.size,
      totalSha256: knownTotalSha256 ?? streamed?.totalSha256 ?? (await hashCloudBlob(blob)),
      parts,
    },
  }
}

export function parseGitHubBundleManifest(value: unknown): GitHubBundleManifest {
  if (!value || typeof value !== 'object') throw new Error('GitHub 分包清单无效')
  const manifest = value as Partial<GitHubBundleManifest>
  if (
    manifest.format !== GITHUB_BUNDLE_FORMAT ||
    ![LEGACY_GITHUB_BUNDLE_VERSION, GITHUB_BUNDLE_VERSION].includes(manifest.version ?? 0) ||
    typeof manifest.createdAt !== 'string' ||
    Number.isNaN(Date.parse(manifest.createdAt)) ||
    typeof manifest.fileName !== 'string' ||
    !manifest.fileName ||
    typeof manifest.totalSize !== 'number' ||
    !Number.isFinite(manifest.totalSize) ||
    manifest.totalSize < 0 ||
    !/^[a-f0-9]{64}$/i.test(manifest.totalSha256 ?? '') ||
    !Array.isArray(manifest.parts) ||
    !manifest.parts.length
  ) {
    throw new Error('GitHub 分包清单格式不受支持')
  }
  const names = new Set<string>()
  let summedSize = 0
  for (const part of manifest.parts) {
    if (
      !part ||
      typeof part.name !== 'string' ||
      (manifest.version === LEGACY_GITHUB_BUNDLE_VERSION
        ? !part.name.startsWith(`${manifest.fileName}.part-`)
        : part.name !== `srl-chunk--sha256-${part.sha256}`) ||
      typeof part.size !== 'number' ||
      !Number.isFinite(part.size) ||
      part.size < 0 ||
      !/^[a-f0-9]{64}$/i.test(part.sha256) ||
      (part.offset !== undefined && (!Number.isSafeInteger(part.offset) || part.offset < 0)) ||
      (part.storedSize !== undefined &&
        (!Number.isSafeInteger(part.storedSize) ||
          part.storedSize < part.size ||
          part.storedSize < (part.offset ?? 0) + part.size)) ||
      (part.offset === undefined) !== (part.storedSize === undefined) ||
      (part.storage !== undefined &&
        (!['github-release', 'koofr-path'].includes(part.storage.kind) ||
          typeof part.storage.container !== 'string' ||
          !part.storage.container ||
          typeof part.storage.objectKey !== 'string' ||
          !part.storage.objectKey))
    ) {
      throw new Error('GitHub 分包清单包含无效分卷')
    }
    if (manifest.version === LEGACY_GITHUB_BUNDLE_VERSION && names.has(part.name))
      throw new Error('GitHub 分包清单包含重复分卷')
    names.add(part.name)
    summedSize += part.size
  }
  if (summedSize !== manifest.totalSize) throw new Error('GitHub 分包清单总大小不一致')
  return manifest as GitHubBundleManifest
}
