import type { ResourceParser } from './ResourceParser'
import type { RestoreStagingStore } from '../storage/RestoreStagingStore'
import { stageArchive } from '../services/ArchiveExtraction'
export class PersonalResourceParser implements ResourceParser {
  private readonly staging: RestoreStagingStore
  constructor(staging: RestoreStagingStore) {
    this.staging = staging
  }
  supports(file: File): boolean {
    return /\.zip$/i.test(file.name)
  }
  async parse(file: File) {
    const { readPersonalDocument, personalResourceMetadata } =
      await import('../services/PersonalResourceService')
    const document = await readPersonalDocument(file, this.staging)
    if (document.kind !== 'pocketPhone') throw new Error('压缩个人资源仅支持小手机附件')
    const expected = new Map(document.attachments.map((item) => [item.path, item.size]))
    const job = await stageArchive(file, this.staging, (path) => expected.has(path))
    try {
      for (const [path, size] of expected) {
        const entry = await this.staging.get(job, path)
        if (!entry || entry.size !== size) throw new Error('小手机附件缺失或大小不符')
      }
    } finally {
      await this.staging.deleteJob(job)
    }
    return personalResourceMetadata(document)
  }
}
