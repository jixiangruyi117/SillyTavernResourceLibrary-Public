import type { AppDatabase } from '../database/AppDatabase'
import type {
  FrontendWorkshopProject,
  FrontendWorkshopProjectLastGoodRecord,
} from '../types/FrontendWorkshopProject'
import type { FrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'
import type {
  FrontendWorkshopSourceDocument,
  FrontendWorkshopSourceDocumentLastGoodRecord,
} from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopProjectStorage } from './FrontendWorkshopProjectStorage'

const MAINTENANCE_SETTING_PREFIX = 'frontend-workshop-maintenance:'

function cloneProject(project: FrontendWorkshopProject): FrontendWorkshopProject {
  return structuredClone(project)
}

function currentSourceDocument(
  value: FrontendWorkshopSourceDocument,
): FrontendWorkshopSourceDocument {
  const document = structuredClone(value) as FrontendWorkshopSourceDocument
  const raw = document as unknown as Record<string, unknown>
  if (raw.origin === 'legacy-advanced-source') raw.origin = 'imported'
  return document
}

function currentSourceComponent(
  value: FrontendWorkshopSourceComponent,
): FrontendWorkshopSourceComponent {
  const raw = structuredClone(value) as unknown as Record<string, unknown>
  delete raw.assets
  const component = raw as unknown as FrontendWorkshopSourceComponent
  component.projectIds = Array.from(
    new Set((Array.isArray(component.projectIds) ? component.projectIds : []).filter(Boolean)),
  )
  return component
}

export class IndexedDbFrontendWorkshopProjectStorage implements FrontendWorkshopProjectStorage {
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  async list(): Promise<FrontendWorkshopProject[]> {
    const projects = await this.database.frontendWorkshopProjects
      .orderBy('updatedAt')
      .reverse()
      .toArray()
    return projects.map(cloneProject)
  }

  async get(id: string): Promise<FrontendWorkshopProject | undefined> {
    const project = await this.database.frontendWorkshopProjects.get(id)
    return project ? cloneProject(project) : undefined
  }

  async put(project: FrontendWorkshopProject): Promise<void> {
    await this.database.frontendWorkshopProjects.put(cloneProject(project))
  }

  async putAtomic(
    project: FrontendWorkshopProject,
    lastGood?: FrontendWorkshopProject,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.frontendWorkshopProjects,
      this.database.frontendWorkshopProjectLastGood,
      async () => {
        if (lastGood) {
          const record: FrontendWorkshopProjectLastGoodRecord = {
            id: lastGood.id,
            projectId: lastGood.id,
            project: cloneProject(lastGood),
            savedAt: Date.now(),
          }
          await this.database.frontendWorkshopProjectLastGood.put(record)
        }
        await this.database.frontendWorkshopProjects.put(cloneProject(project))
      },
    )
  }

  async getLastGood(id: string): Promise<FrontendWorkshopProjectLastGoodRecord | undefined> {
    const record = await this.database.frontendWorkshopProjectLastGood.get(id)
    return record ? { ...record, project: cloneProject(record.project) } : undefined
  }

  async hasMaintenanceMarker(id: string): Promise<boolean> {
    const record = await this.database.settings.get(`${MAINTENANCE_SETTING_PREFIX}${id}`)
    return record?.value === true
  }

  async setMaintenanceMarker(id: string): Promise<void> {
    await this.database.settings.put({
      id: `${MAINTENANCE_SETTING_PREFIX}${id}`,
      value: true,
      updatedAt: Date.now(),
    })
  }

  async cleanupLegacyAuxiliaryData(): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.frontendWorkshopSourceDocuments,
      this.database.frontendWorkshopSourceDocumentLastGood,
      this.database.frontendWorkshopSourceComponents,
      async () => {
        const sourceDocuments = await this.database.frontendWorkshopSourceDocuments.toArray()
        for (const sourceDocument of sourceDocuments) {
          const raw = sourceDocument as unknown as Record<string, unknown>
          if (raw.origin !== 'legacy-advanced-source') continue
          await this.database.frontendWorkshopSourceDocuments.put(
            currentSourceDocument(sourceDocument),
          )
        }

        const lastGoodDocuments =
          await this.database.frontendWorkshopSourceDocumentLastGood.toArray()
        for (const record of lastGoodDocuments) {
          const raw = record.document as unknown as Record<string, unknown>
          if (raw.origin !== 'legacy-advanced-source') continue
          const cleanedRecord: FrontendWorkshopSourceDocumentLastGoodRecord = {
            ...record,
            document: currentSourceDocument(record.document),
          }
          await this.database.frontendWorkshopSourceDocumentLastGood.put(cleanedRecord)
        }

        const components = await this.database.frontendWorkshopSourceComponents.toArray()
        for (const component of components) {
          const raw = component as unknown as Record<string, unknown>
          const hadLegacyAssets = Object.hasOwn(raw, 'assets')
          const cleaned = currentSourceComponent(component)
          const existingProjectIds = Array.isArray(component.projectIds) ? component.projectIds : []
          if (
            hadLegacyAssets ||
            cleaned.projectIds.length !== existingProjectIds.length ||
            cleaned.projectIds.some((projectId, index) => projectId !== existingProjectIds[index])
          ) {
            await this.database.frontendWorkshopSourceComponents.put(cleaned)
          }
        }
      },
    )
  }

  /**
   * Project 是 Source Document 的生命周期 owner。删除工程时在同一 Dexie transaction
   * 内清理结构化 current / last_good 与 raw Source current / last_good，避免留下孤儿真源。
   * 只有删除路径发生这种级联；普通 Project save/normalize 仍然不能触碰 Source Document。
   */
  async delete(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.frontendWorkshopProjects,
      this.database.frontendWorkshopProjectLastGood,
      this.database.frontendWorkshopSourceDocuments,
      this.database.frontendWorkshopSourceDocumentLastGood,
      this.database.settings,
      async () => {
        await Promise.all([
          this.database.settings.delete('frontend-workshop-ai-local:session:' + id),
          this.database.frontendWorkshopProjects.delete(id),
          this.database.frontendWorkshopProjectLastGood.delete(id),
          this.database.frontendWorkshopSourceDocuments.delete(id),
          this.database.frontendWorkshopSourceDocumentLastGood.delete(id),
        ])
      },
    )
  }
}
