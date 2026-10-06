import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import {
  COMMUNITY_SOURCE_ARCHIVE_PATH,
  COMMUNITY_SOURCE_ATTACHMENT_ARCHIVE_PREFIX,
  type ArchiveManifest,
  type ArchivedResource,
} from '../types/Backup'
import type { Resource } from '../types/Resource'
import type {
  CommunitySourceAttachmentArchiveEntry,
  CommunitySourceBackupData,
} from '../types/CommunitySource'

/** ZIP encoding owns backpressure; selection and resource mutation stay in ExportService. */
export interface ArchiveTransferOptions {
  createdAt?: string
  signal?: AbortSignal
  onProgress?: (progress: { writtenBytes: number; fileName?: string }) => void
}

export function throwIfArchiveAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('归档已取消', 'AbortError')
}

export interface ArchiveEncoding extends ArchiveTransferOptions {
  resources: Resource[]
  versions: Resource[]
  manifest: ArchiveManifest
  communitySourceData?: CommunitySourceBackupData
  communitySourceAttachments: readonly CommunitySourceAttachmentArchiveEntry[]
  path(resource: Resource, historical: boolean): string
  read(resource: Resource, historical: boolean): Promise<Resource>
  describe(resource: Resource, historical: boolean): ArchivedResource
}

export async function encodeArchive(
  options: ArchiveEncoding,
  sink: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>,
): Promise<number> {
  throwIfArchiveAborted(options.signal)
  options.onProgress?.({ writtenBytes: 0 })
  let bytes = 0
  let writtenBytes = 0
  let writeChain = Promise.resolve()
  let encodingError: unknown
  const archive = new Zip((error, data) => {
    if (error) {
      encodingError = error
      return
    }
    const copy = new Uint8Array(data)
    bytes += copy.length
    writeChain = writeChain.then(async () => {
      throwIfArchiveAborted(options.signal)
      await sink(copy)
      writtenBytes += copy.length
      options.onProgress?.({ writtenBytes })
      throwIfArchiveAborted(options.signal)
    })
    void writeChain.catch(() => undefined)
  })
  const push = async (entry: ZipPassThrough | ZipDeflate, blob: Blob) => {
    throwIfArchiveAborted(options.signal)
    archive.add(entry)
    const reader = blob.stream().getReader()
    const abort = (): void => {
      void reader.cancel(options.signal?.reason).catch(() => undefined)
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        throwIfArchiveAborted(options.signal)
        const { done, value } = await reader.read()
        throwIfArchiveAborted(options.signal)
        entry.push(value ?? new Uint8Array(), done)
        await writeChain
        if (encodingError) throw encodingError
        if (done) break
      }
    } catch (error) {
      void reader.cancel(error).catch(() => undefined)
      throw error
    } finally {
      options.signal?.removeEventListener('abort', abort)
      reader.releaseLock()
    }
  }
  try {
    await writeArchiveEntries(options, {
      write: async (path, blob, info) => {
        const entry = info.compress ? new ZipDeflate(path, { level: 1 }) : new ZipPassThrough(path)
        entry.mtime = new Date(info.mtime)
        await push(entry, blob)
      },
    })
    throwIfArchiveAborted(options.signal)
    archive.end()
    await writeChain
    throwIfArchiveAborted(options.signal)
    if (encodingError) throw encodingError
    return bytes
  } catch (error) {
    archive.terminate()
    await writeChain.catch(() => undefined)
    throw error
  }
}

export async function streamArchive(options: ArchiveEncoding): Promise<Blob> {
  // Consume bounded segments in the browser's Blob loader. WebKit can return a Blob
  // whose slices never resolve when one synthetic Response grows beyond 1 GiB.
  const limit = 32 * 1024 * 1024
  const parts: Blob[] = []
  let segmentBytes = 0
  let writer: WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>> | undefined
  let result: Promise<Blob> | undefined
  const flush = async () => {
    if (!writer || !result) return
    await writer.close()
    parts.push(await result)
    writer.releaseLock()
    writer = undefined
    result = undefined
    segmentBytes = 0
  }
  try {
    await encodeArchive(options, async (chunk) => {
      for (let offset = 0; offset < chunk.length;) {
        if (!writer) {
          const stream = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>()
          writer = stream.writable.getWriter()
          result = new Response(stream.readable).blob()
          void result.catch(() => undefined)
        }
        const end = Math.min(chunk.length, offset + limit - segmentBytes)
        await writer.write(chunk.subarray(offset, end))
        segmentBytes += end - offset
        offset = end
        if (segmentBytes === limit) await flush()
      }
    })
    await flush()
    return new Blob(parts, { type: 'application/zip' })
  } catch (error) {
    await writer?.abort(error).catch(() => undefined)
    throw error
  } finally {
    writer?.releaseLock()
  }
}

export interface ArchiveEntryInfo {
  mtime: number
  compress: boolean
  descriptor?: ArchivedResource
}
export interface ArchiveEntryWriter {
  cached?(path: string): Promise<ArchivedResource | undefined>
  write(path: string, blob: Blob, info: ArchiveEntryInfo): Promise<void>
}

/** Both native checkpoint compression and web ZIP encoding use the same manifest traversal. */
export async function writeArchiveEntries(
  options: ArchiveEncoding,
  writer: ArchiveEntryWriter,
): Promise<string[]> {
  const paths: string[] = []
  const emit = async (path: string, blob: Blob, info: ArchiveEntryInfo) => {
    throwIfArchiveAborted(options.signal)
    await writer.write(path, blob, info)
    throwIfArchiveAborted(options.signal)
    paths.push(path)
  }
  const descriptors = [new Map<string, Blob>(), new Map<string, Blob>()] as const
  const entries: [Resource, boolean][] = [
    ...options.resources.map((resource): [Resource, boolean] => [resource, false]),
    ...options.versions.map((resource): [Resource, boolean] => [resource, true]),
  ]
  entries.sort(([a, av], [b, bv]) => options.path(a, av).localeCompare(options.path(b, bv)))
  for (const [planned, historical] of entries) {
    throwIfArchiveAborted(options.signal)
    const path = options.path(planned, historical)
    const cached = await writer.cached?.(path)
    if (cached) {
      descriptors[historical ? 1 : 0].set(planned.id, new Blob([JSON.stringify(cached)]))
      paths.push(path)
      continue
    }
    const resource = await options.read(planned, historical)
    throwIfArchiveAborted(options.signal)
    const descriptor = options.describe(resource, historical)
    const compress = !(
      /^(image\/(png|jpeg|webp|gif)|audio\/|video\/)/i.test(resource.mimeType) ||
      /\.(png|jpe?g|webp|gif|zip|gz|7z|rar|mp[34]|ogg|webm)$/i.test(resource.fileName)
    )
    const mtime = Number.isFinite(resource.updatedAt)
      ? Math.min(Date.UTC(2107, 11, 31), Math.max(Date.UTC(1980, 0, 1), resource.updatedAt))
      : Date.UTC(1980, 0, 1)
    await emit(path, resource.originalBlob, { compress, mtime, descriptor })
    descriptors[historical ? 1 : 0].set(resource.id, new Blob([JSON.stringify(descriptor)]))
  }
  for (const attachment of options.communitySourceAttachments) {
    await emit(COMMUNITY_SOURCE_ATTACHMENT_ARCHIVE_PREFIX + attachment.assetId, attachment.blob, {
      compress: false,
      mtime: Date.parse(options.manifest.createdAt),
    })
  }
  if (options.communitySourceData)
    await emit(
      COMMUNITY_SOURCE_ARCHIVE_PATH,
      new Blob([JSON.stringify(options.communitySourceData)]),
      { compress: true, mtime: Date.parse(options.manifest.createdAt) },
    )
  const { resources: _resources, versions: _versions, ...header } = options.manifest
  const parts: BlobPart[] = [JSON.stringify(header).slice(0, -1)]
  for (const [index, key] of ['resources', 'versions'].entries()) {
    parts.push(`,"${key}":[`)
    for (const [position, resource] of (index ? options.versions : options.resources).entries()) {
      const descriptor = descriptors[index]!.get(resource.id)!
      if (position) parts.push(',')
      parts.push(descriptor)
    }
    parts.push(']')
  }
  parts.push('}')
  await emit('manifest.json', new Blob(parts), {
    compress: true,
    mtime: Date.parse(options.manifest.createdAt),
  })
  return paths
}
