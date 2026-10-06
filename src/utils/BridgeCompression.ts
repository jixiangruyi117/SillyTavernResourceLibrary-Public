import type { TavernResourceKind } from '../services/TavernBridgeProtocol'

/**
 * 互传 gzip 压缩。
 *
 * 仅在对端握手 capabilities 声明 'gzip' 时启用；线上格式保持向后兼容：
 * file-start 的 size 与 sha256 始终描述实际传输的载荷（压缩后），
 * 旧端的分块记账与完整性校验逻辑不变；新增 contentEncoding/rawSize
 * 字段由新端在校验通过后解压还原。PNG 等已压缩格式不重复压缩。
 */

const COMPRESSIBLE_KINDS = new Set<TavernResourceKind>([
  'worldBook',
  'preset',
  'regexGlobal',
  'regexCharacter',
  'regexPreset',
  'quickReply',
  'theme',
  'scriptGlobal',
  'scriptCharacter',
  'scriptPreset',
  'userPersona',
])

/** 小于该字节数的文件压缩收益抵不过往返开销。 */
export const BRIDGE_COMPRESS_MIN_BYTES = 4096

export function isCompressibleKind(kind: TavernResourceKind): boolean {
  return COMPRESSIBLE_KINDS.has(kind)
}

export function supportsBridgeGzip(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

export async function gzipBlob(blob: Blob): Promise<Blob> {
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).blob()
}

export async function gunzipBlob(blob: Blob): Promise<Blob> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).blob()
}
