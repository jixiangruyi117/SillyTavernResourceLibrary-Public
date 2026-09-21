/// <reference types="node" />

import { strToU8, Zip, ZipDeflate } from 'fflate'
import { describe, expect, it } from 'vitest'

import type { ArchiveStorageAdapter } from '../storage/ArchiveStorageAdapter'
import type { RestoreStagingStore } from '../storage/RestoreStagingStore'
import type {
  RestoreStagingChunk,
  RestoreStagingEntry,
  RestoreStagingMetadata,
} from '../types/RestoreStaging'
import { ARCHIVE_FORMAT, ARCHIVE_VERSION, type ArchiveManifest } from '../types/Backup'
import { RestoreService } from './RestoreService'
import { RESTORE_STAGING_CHUNK_BYTES } from './ArchiveExtraction'

const BIG_RESTORE_BYTES = 500 * 1024 * 1024
const bigDataIt = process.env.SRL_BIG_DATA_STRESS === '1' ? it : it.skip

class EmptyArchiveStorage implements ArchiveStorageAdapter {
  async restore(): Promise<void> {}
  async replace(): Promise<void> {}
}

class CountingStagingStore implements RestoreStagingStore {
  chunkCount = 0
  totalBytes = 0
  maxChunkBytes = 0
  private readonly metadata = new Map<string, RestoreStagingMetadata>()
  private readonly manifestChunks: RestoreStagingChunk[] = []

  async putChunk(chunk: RestoreStagingChunk): Promise<void> {
    this.chunkCount += 1
    this.totalBytes += chunk.blob.size
    this.maxChunkBytes = Math.max(this.maxChunkBytes, chunk.blob.size)
    if (chunk.path === 'manifest.json') this.manifestChunks.push(chunk)
  }

  async complete(entry: RestoreStagingMetadata): Promise<void> {
    this.metadata.set(`${entry.jobId}\0${entry.path}`, entry)
  }

  async get(jobId: string, path: string): Promise<RestoreStagingEntry | undefined> {
    const metadata = this.metadata.get(`${jobId}\0${path}`)
    if (!metadata || path !== 'manifest.json') return undefined
    const blob = new Blob(
      this.manifestChunks
        .filter((chunk) => chunk.jobId === jobId)
        .sort((left, right) => left.chunkIndex - right.chunkIndex)
        .map((chunk) => chunk.blob),
    )
    return { ...metadata, blob }
  }

  async deleteJob(jobId: string): Promise<void> {
    for (const [key, value] of this.metadata) if (value.jobId === jobId) this.metadata.delete(key)
  }
}

async function createLogicalLargeBackup(size: number): Promise<File> {
  const output: Uint8Array[] = []
  const completed = new Promise<void>((resolve, reject) => {
    const zip = new Zip((error, data, final) => {
      if (error) {
        reject(error)
        return
      }
      const copy = new Uint8Array(data.length)
      copy.set(data)
      output.push(copy)
      if (final) resolve()
    })
    const payload = new ZipDeflate('unreferenced/500mib-zero-fixture.bin', { level: 1 })
    zip.add(payload)
    const block = new Uint8Array(1024 * 1024)
    for (let offset = 0; offset < size; offset += block.length) {
      payload.push(
        block.subarray(0, Math.min(block.length, size - offset)),
        offset + block.length >= size,
      )
    }
    const manifest: ArchiveManifest = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      mode: 'full',
      createdAt: new Date(0).toISOString(),
      resourceCount: 0,
      categoryCount: 0,
      categories: [],
      resources: [],
      versionCount: 0,
      versions: [],
    }
    const manifestEntry = new ZipDeflate('manifest.json', { level: 6 })
    zip.add(manifestEntry)
    manifestEntry.push(strToU8(JSON.stringify(manifest)), true)
    zip.end()
  })
  await completed
  return new File(
    output.map((part) => Uint8Array.from(part).buffer),
    'logical-500mib-backup.zip',
    { type: 'application/zip' },
  )
}

describe('RestoreService 500 MiB staged restore', () => {
  bigDataIt(
    'keeps highly-compressible 500 MiB output in bounded staging chunks',
    async () => {
      const staging = new CountingStagingStore()
      const backup = await createLogicalLargeBackup(BIG_RESTORE_BYTES)
      expect(backup.size).toBeLessThan(8 * 1024 * 1024)

      const prepared = await new RestoreService(new EmptyArchiveStorage(), staging).prepare(
        backup,
        [],
        [],
      )

      expect(prepared.resources).toEqual([])
      expect(staging.totalBytes).toBeGreaterThanOrEqual(BIG_RESTORE_BYTES)
      expect(staging.maxChunkBytes).toBeLessThanOrEqual(RESTORE_STAGING_CHUNK_BYTES)
      expect(staging.chunkCount).toBeGreaterThanOrEqual(500)
    },
    120_000,
  )
})
