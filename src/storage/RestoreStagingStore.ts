import type {
  RestoreStagingChunk,
  RestoreStagingEntry,
  RestoreStagingMetadata,
} from '../types/RestoreStaging'

export interface RestoreStagingStore {
  putChunk(chunk: RestoreStagingChunk): Promise<void>
  complete(entry: RestoreStagingMetadata): Promise<void>
  get(jobId: string, path: string): Promise<RestoreStagingEntry | undefined>
  deleteJob(jobId: string): Promise<void>
}

export class MemoryRestoreStagingStore implements RestoreStagingStore {
  private readonly entries = new Map<string, RestoreStagingMetadata>()
  private readonly chunks = new Map<string, RestoreStagingChunk>()

  private key(jobId: string, path: string): string {
    return `${jobId}\0${path}`
  }

  async putChunk(chunk: RestoreStagingChunk): Promise<void> {
    this.chunks.set(`${this.key(chunk.jobId, chunk.path)}\0${chunk.chunkIndex}`, chunk)
  }

  async complete(entry: RestoreStagingMetadata): Promise<void> {
    this.entries.set(this.key(entry.jobId, entry.path), entry)
  }

  async get(jobId: string, path: string): Promise<RestoreStagingEntry | undefined> {
    const entry = this.entries.get(this.key(jobId, path))
    if (!entry) return undefined
    const prefix = `${this.key(jobId, path)}\0`
    const blobs = Array.from(this.chunks.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, chunk]) => chunk)
      .sort((left, right) => left.chunkIndex - right.chunkIndex)
      .map((chunk) => chunk.blob)
    return { ...entry, blob: new Blob(blobs) }
  }

  async deleteJob(jobId: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.jobId === jobId) this.entries.delete(key)
    }
    for (const [key, chunk] of this.chunks) {
      if (chunk.jobId === jobId) this.chunks.delete(key)
    }
  }
}
