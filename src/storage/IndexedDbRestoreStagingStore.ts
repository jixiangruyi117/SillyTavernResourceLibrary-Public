import type { AppDatabase } from '../database/AppDatabase'
import type {
  RestoreStagingChunk,
  RestoreStagingEntry,
  RestoreStagingMetadata,
} from '../types/RestoreStaging'
import type { RestoreStagingStore } from './RestoreStagingStore'

export class IndexedDbRestoreStagingStore implements RestoreStagingStore {
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  async putChunk(chunk: RestoreStagingChunk): Promise<void> {
    // iOS WebKit can return IndexedDB-backed Blobs that later fail with
    // "The object can not be found here." Materialize each bounded chunk before
    // persisting it so files rebuilt from staging have stable byte backing.
    const { blob, ...metadata } = chunk
    const data = await blob.arrayBuffer()
    await this.database.restoreStagingChunks.put({ ...metadata, data })
  }

  async complete(entry: RestoreStagingMetadata): Promise<void> {
    await this.database.restoreStaging.put(entry)
  }

  async getMetadata(jobId: string, path: string): Promise<RestoreStagingMetadata | undefined> {
    return this.database.restoreStaging.get([jobId, path])
  }

  async get(jobId: string, path: string): Promise<RestoreStagingEntry | undefined> {
    const entry = await this.database.restoreStaging.get([jobId, path])
    if (!entry) return undefined
    const chunks = await this.database.restoreStagingChunks
      .where('[jobId+path]')
      .equals([jobId, path])
      .sortBy('chunkIndex')
    const parts = chunks.map((chunk) => {
      if (chunk.data) return chunk.data
      if (chunk.blob) return chunk.blob
      throw new Error('压缩包暂存分块缺少内容')
    })
    return {
      ...entry,
      blob: new Blob(parts),
    }
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.restoreStaging,
      this.database.restoreStagingChunks,
      async () => {
        await this.database.restoreStaging.where('jobId').equals(jobId).delete()
        await this.database.restoreStagingChunks.where('jobId').equals(jobId).delete()
      },
    )
  }
}
