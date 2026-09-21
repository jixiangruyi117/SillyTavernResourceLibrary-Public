import type { AppDatabase } from '../database/AppDatabase'
import type {
  FrontendWorkshopSourceDocument,
  FrontendWorkshopSourceDocumentLastGoodRecord,
} from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourceDocumentStorage } from './FrontendWorkshopSourceDocumentStorage'

function cloneDocument(document: FrontendWorkshopSourceDocument): FrontendWorkshopSourceDocument {
  return structuredClone(document)
}

export class IndexedDbFrontendWorkshopSourceDocumentStorage implements FrontendWorkshopSourceDocumentStorage {
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  async get(projectId: string): Promise<FrontendWorkshopSourceDocument | undefined> {
    const document = await this.database.frontendWorkshopSourceDocuments.get(projectId)
    return document ? cloneDocument(document) : undefined
  }

  async put(document: FrontendWorkshopSourceDocument): Promise<void> {
    await this.database.frontendWorkshopSourceDocuments.put(cloneDocument(document))
  }

  async putAtomic(
    document: FrontendWorkshopSourceDocument,
    lastGood?: FrontendWorkshopSourceDocument,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.frontendWorkshopSourceDocuments,
      this.database.frontendWorkshopSourceDocumentLastGood,
      async () => {
        if (lastGood) {
          const record: FrontendWorkshopSourceDocumentLastGoodRecord = {
            projectId: lastGood.projectId,
            document: cloneDocument(lastGood),
            savedAt: Date.now(),
          }
          await this.database.frontendWorkshopSourceDocumentLastGood.put(record)
        }
        await this.database.frontendWorkshopSourceDocuments.put(cloneDocument(document))
      },
    )
  }

  async putAtomicIfRevision(
    document: FrontendWorkshopSourceDocument,
    expectedRevision: number,
  ): Promise<boolean> {
    return this.database.transaction(
      'rw',
      this.database.frontendWorkshopSourceDocuments,
      this.database.frontendWorkshopSourceDocumentLastGood,
      async () => {
        const current = await this.database.frontendWorkshopSourceDocuments.get(document.projectId)
        if (expectedRevision === 0) {
          if (current) return false
          await this.database.frontendWorkshopSourceDocuments.add(cloneDocument(document))
          return true
        }
        if (!current || current.revision !== expectedRevision) return false
        const record: FrontendWorkshopSourceDocumentLastGoodRecord = {
          projectId: current.projectId,
          document: cloneDocument(current),
          savedAt: Date.now(),
        }
        await this.database.frontendWorkshopSourceDocumentLastGood.put(record)
        await this.database.frontendWorkshopSourceDocuments.put(cloneDocument(document))
        return true
      },
    )
  }

  async getLastGood(
    projectId: string,
  ): Promise<FrontendWorkshopSourceDocumentLastGoodRecord | undefined> {
    const record = await this.database.frontendWorkshopSourceDocumentLastGood.get(projectId)
    return record ? { ...record, document: cloneDocument(record.document) } : undefined
  }

  async delete(projectId: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.frontendWorkshopSourceDocuments,
      this.database.frontendWorkshopSourceDocumentLastGood,
      async () => {
        await Promise.all([
          this.database.frontendWorkshopSourceDocuments.delete(projectId),
          this.database.frontendWorkshopSourceDocumentLastGood.delete(projectId),
        ])
      },
    )
  }
}
