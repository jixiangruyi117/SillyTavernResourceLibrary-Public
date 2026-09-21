import { Unzip, UnzipInflate } from 'fflate'
import { zipArchiveChunks } from '../utils/ZipArchiveStream'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { RestoreStagingStore } from '../storage/RestoreStagingStore'

export const RESTORE_STAGING_CHUNK_BYTES = 1024 * 1024

function isSafeArchivePath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith('/') &&
    !path.startsWith('\\') &&
    !/^[a-z]:/iu.test(path) &&
    !path.split(/[\\/]/u).includes('..')
  )
}

export async function stageArchive(
  file: File,
  staging: RestoreStagingStore,
  selectEntry: (path: string) => boolean = () => true,
): Promise<string> {
  const jobId = crypto.randomUUID()
  const entries: Promise<void>[] = []
  const pendingWrites = new Set<Promise<void>>()
  const paths = new Set<string>()
  let archiveSize = 0
  let failure: unknown
  const archive = new Unzip((entry) => {
    if (!isSafeArchivePath(entry.name) || paths.has(entry.name)) {
      throw new Error(`备份包含不安全或重复的路径：${entry.name}`)
    }
    paths.add(entry.name)
    if (paths.size > 100_000) throw new Error('备份文件数量超过限制')
    if (!selectEntry(entry.name)) return
    const completion = new Promise<void>((resolve, reject) => {
      let totalLength = 0
      let chunkIndex = 0
      let writeChain = Promise.resolve()
      const hash = sha256.create()
      let buffered: BlobPart[] = []
      let bufferedBytes = 0
      const flush = () => {
        if (!bufferedBytes) return
        const blob = new Blob(buffered)
        buffered = []
        bufferedBytes = 0
        const index = chunkIndex++
        const operation = writeChain.then(() =>
          staging.putChunk({
            jobId,
            path: entry.name,
            chunkIndex: index,
            blob,
            updatedAt: Date.now(),
          }),
        )
        writeChain = operation
        pendingWrites.add(operation)
        void operation.then(
          () => pendingWrites.delete(operation),
          () => pendingWrites.delete(operation),
        )
      }
      entry.ondata = (error, data, final) => {
        if (error) {
          reject(error)
          return
        }
        totalLength += data.length
        archiveSize += data.length
        if (totalLength > 2 * 1024 * 1024 * 1024 || archiveSize > 4 * 1024 * 1024 * 1024) {
          reject(new Error('备份解压后超过支持的大小限制'))
          return
        }
        hash.update(data)
        if (final && entry.originalSize !== undefined && totalLength !== entry.originalSize) {
          reject(new Error('ZIP 条目大小与目录不一致'))
          return
        }
        for (let offset = 0; offset < data.length;) {
          const end = Math.min(data.length, offset + RESTORE_STAGING_CHUNK_BYTES - bufferedBytes)
          buffered.push(new Uint8Array(data.subarray(offset, end)))
          bufferedBytes += end - offset
          offset = end
          if (bufferedBytes === RESTORE_STAGING_CHUNK_BYTES) flush()
        }
        if (!final) return
        flush()
        writeChain
          .then(() =>
            staging.complete({
              jobId,
              path: entry.name,
              size: totalLength,
              sha256: bytesToHex(hash.digest()),
              updatedAt: Date.now(),
            }),
          )
          .then(resolve, reject)
      }
      entry.start()
    })
    entries.push(completion)
    void completion.catch((error) => {
      failure = error
    })
  })
  archive.register(UnzipInflate)

  try {
    for await (const chunk of zipArchiveChunks(file)) {
      archive.push(chunk, false)
      if (pendingWrites.size) await Promise.all(Array.from(pendingWrites))
      if (failure) throw failure
    }
    archive.push(new Uint8Array(), true)
    await Promise.all(entries)
    return jobId
  } catch (error) {
    await Promise.allSettled([...pendingWrites])
    await staging.deleteJob(jobId)
    if (error instanceof Error && error.message.startsWith('备份包含')) throw error
    throw new Error('ZIP 文件损坏或无法解压', { cause: error })
  }
}
