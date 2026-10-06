import type { AppDatabase } from '../database/AppDatabase'
import type { FrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'
import type { FrontendWorkshopSourceComponentStorage } from './FrontendWorkshopSourceComponentStorage'

function cloneComponent(
  component: FrontendWorkshopSourceComponent,
): FrontendWorkshopSourceComponent {
  const clone = structuredClone(component)
  clone.projectIds = Array.from(
    new Set((Array.isArray(clone.projectIds) ? clone.projectIds : []).filter(Boolean)),
  )
  return clone
}

export class IndexedDbFrontendWorkshopSourceComponentStorage implements FrontendWorkshopSourceComponentStorage {
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  async list(): Promise<FrontendWorkshopSourceComponent[]> {
    const components = await this.database.frontendWorkshopSourceComponents
      .orderBy('updatedAt')
      .reverse()
      .toArray()
    return components.map(cloneComponent)
  }

  async get(id: string): Promise<FrontendWorkshopSourceComponent | undefined> {
    const component = await this.database.frontendWorkshopSourceComponents.get(id)
    return component ? cloneComponent(component) : undefined
  }

  async putIfRevision(
    component: FrontendWorkshopSourceComponent,
    expectedRevision: number,
  ): Promise<boolean> {
    return this.database.transaction(
      'rw',
      this.database.frontendWorkshopSourceComponents,
      async () => {
        const current = await this.database.frontendWorkshopSourceComponents.get(component.id)
        if (expectedRevision === 0) {
          if (current) return false
          await this.database.frontendWorkshopSourceComponents.add(cloneComponent(component))
          return true
        }
        if (!current || current.revision !== expectedRevision) return false
        await this.database.frontendWorkshopSourceComponents.put(cloneComponent(component))
        return true
      },
    )
  }

  async setProjectAssociation(
    id: string,
    projectId: string,
    associated: boolean,
  ): Promise<FrontendWorkshopSourceComponent | undefined> {
    return this.database.transaction(
      'rw',
      this.database.frontendWorkshopSourceComponents,
      async () => {
        const stored = await this.database.frontendWorkshopSourceComponents.get(id)
        if (!stored) return undefined
        const component = cloneComponent(stored)
        const projectIds = new Set(component.projectIds)
        if (associated) projectIds.add(projectId)
        else projectIds.delete(projectId)
        component.projectIds = [...projectIds]
        await this.database.frontendWorkshopSourceComponents.put(component)
        return cloneComponent(component)
      },
    )
  }

  async delete(id: string): Promise<void> {
    await this.database.frontendWorkshopSourceComponents.delete(id)
  }
}
