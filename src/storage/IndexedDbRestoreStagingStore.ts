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
    await this.database.restoreStagingChunks.put(chunk)
  }

  async complete(entry: RestoreStagingMetadata): Promise<void> {
    await this.database.restoreStaging.put(entry)
  }

  async get(jobId: string, path: string): Promise<RestoreStagingEntry | undefined> {
    const entry = await this.database.restoreStaging.get([jobId, path])
    if (!entry) return undefined
    const chunks = await this.database.restoreStagingChunks
      .where('[jobId+path]')
      .equals([jobId, path])
      .sortBy('chunkIndex')
    return { ...entry, blob: new Blob(chunks.map((chunk) => chunk.blob)) }
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
