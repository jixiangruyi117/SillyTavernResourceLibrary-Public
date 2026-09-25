import { getCapacitorPlatform } from '../utils/CapacitorDetection'
import { hashReadableStream } from './HashService'

export const LOCAL_TAVERN_ORIGIN = 'http://127.0.0.1:8000'
const DIRECT_BASE_PATH = '/api/plugins/srl-bridge/direct/sessions/'
const MAX_DIRECT_FILE_BYTES = 256 * 1024 * 1024

export interface LocalTavernDirectSession {
  sessionId: string
  token: string
  origin: string
  maxFileSize: number
}

function directUrl(session: LocalTavernDirectSession): string {
  return new URL(`${DIRECT_BASE_PATH}${encodeURIComponent(session.sessionId)}`, session.origin).href
}

function directHeaders(session: LocalTavernDirectSession): HeadersInit {
  return { 'X-SRL-Direct-Token': session.token }
}

function responseError(action: string, status: number): Error {
  return new Error(`${action}失败（HTTP ${status}）`)
}

/** 只在 Android 上允许用户明确选择的本机 SillyTavern 地址，绝不接受任意内网/回环 URL。 */
export function canUseLocalTavernDirect(): boolean {
  return getCapacitorPlatform() === 'android'
}

export function isTrustedLocalTavernOrigin(value: string): boolean {
  try {
    return new URL(value).origin === LOCAL_TAVERN_ORIGIN
  } catch {
    return false
  }
}

export function createLocalTavernDirectSession(
  value: unknown,
): LocalTavernDirectSession | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  const token = typeof record.token === 'string' ? record.token : ''
  const origin = typeof record.origin === 'string' ? record.origin : ''
  const maxFileSize = typeof record.maxFileSize === 'number' ? record.maxFileSize : 0
  if (
    !/^[A-Za-z0-9_-]{12,}$/u.test(sessionId) ||
    !/^[A-Za-z0-9_-]{32,}$/u.test(token) ||
    !isTrustedLocalTavernOrigin(origin) ||
    !Number.isFinite(maxFileSize) ||
    maxFileSize < 1 ||
    maxFileSize > MAX_DIRECT_FILE_BYTES
  ) {
    return undefined
  }
  return { sessionId, token, origin, maxFileSize }
}

export async function uploadLocalTavernDirectFile(
  session: LocalTavernDirectSession,
  file: Blob,
  name: string,
): Promise<{ size: number; sha256: string }> {
  if (file.size > session.maxFileSize) throw new Error(`${name} 超过本机直传大小限制`)
  const response = await fetch(directUrl(session), {
    method: 'PUT',
    headers: {
      ...directHeaders(session),
      'Content-Type': file.type || 'application/octet-stream',
      // The original name travels in file-start; HTTP headers cannot carry Unicode names.
    },
    body: file,
    cache: 'no-store',
  })
  if (!response.ok) throw responseError('上传到本机酒馆', response.status)
  const result = (await response.json()) as { size?: unknown; sha256?: unknown }
  if (typeof result.size !== 'number' || typeof result.sha256 !== 'string') {
    throw new Error('本机酒馆返回的上传结果无效')
  }
  return { size: result.size, sha256: result.sha256 }
}

export async function downloadLocalTavernDirectFile(
  session: LocalTavernDirectSession,
  name: string,
  mimeType: string,
): Promise<{ file: File; sha256: string }> {
  const response = await fetch(directUrl(session), {
    headers: directHeaders(session),
    cache: 'no-store',
  })
  if (!response.ok) throw responseError('从本机酒馆读取', response.status)
  // Fetch decodes HTTP compression; its Content-Length, if present, describes wire bytes.
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  const length = response.headers.get('content-length')
  const size = length !== null && (!encoding || encoding === 'identity') ? Number(length) : null
  if (
    size !== null &&
    (!/^\d+$/.test(length!) || !Number.isSafeInteger(size) || size > session.maxFileSize)
  ) {
    throw new Error('本机酒馆返回的文件大小无效')
  }
  const sha256 = response.headers.get('x-srl-direct-sha256') ?? ''
  if (!/^[a-f0-9]{64}$/iu.test(sha256)) throw new Error('本机酒馆未返回有效完整性校验')
  if (!response.body) throw new Error('本机酒馆没有返回可读取的文件流')
  const [blobStream, hashStream] = response.body.tee()
  const [blob, actual] = await Promise.all([
    new Response(blobStream, {
      headers: { 'content-type': mimeType || 'application/octet-stream' },
    }).blob(),
    hashReadableStream(hashStream, { maxBytes: session.maxFileSize }),
  ])
  if (blob.size !== actual.size || (size !== null && actual.size !== size))
    throw new Error('本机酒馆返回的文件大小不一致')
  if (actual.hash.toLowerCase() !== sha256.toLowerCase()) {
    throw new Error('本机酒馆返回的文件完整性校验失败')
  }
  return { file: new File([blob], name, { type: mimeType || blob.type }), sha256: actual.hash }
}

export async function removeLocalTavernDirectFile(
  session: LocalTavernDirectSession,
): Promise<void> {
  await fetch(directUrl(session), {
    method: 'DELETE',
    headers: directHeaders(session),
    cache: 'no-store',
  }).catch(() => undefined)
}
