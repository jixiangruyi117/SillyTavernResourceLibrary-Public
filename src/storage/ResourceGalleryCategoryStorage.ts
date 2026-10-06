import type { AppDatabase } from '../database/AppDatabase'
import { RESOURCE_TYPE, type ResourceType } from '../types/Resource'

import type { GalleryCategoryCatalog } from '../types/ResourceGallery'
export interface ResourceGalleryCategoryStorage {
  list(type: ResourceType): Promise<string[]>
  change(type: ResourceType, edit: (names: string[]) => string[]): Promise<void>
  export(): Promise<GalleryCategoryCatalog>
  import(value: unknown): Promise<void>
}
const prefix = 'resource-gallery-categories:'
function names(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim().slice(0, 60))
            .filter(Boolean),
        ),
      ]
    : []
}

/** Empty categories live in the existing settings table and portable gallery scope. */
export class IndexedDbResourceGalleryCategoryStorage implements ResourceGalleryCategoryStorage {
  private readonly database: AppDatabase
  constructor(database: AppDatabase) {
    this.database = database
  }
  async list(type: ResourceType): Promise<string[]> {
    return names((await this.database.settings.get(prefix + type))?.value)
  }
  async change(type: ResourceType, edit: (values: string[]) => string[]): Promise<void> {
    await this.database.transaction('rw', this.database.settings, async () => {
      await this.database.settings.put({
        id: prefix + type,
        value: names(edit(await this.list(type))),
        updatedAt: Date.now(),
      })
    })
  }
  async export(): Promise<GalleryCategoryCatalog> {
    const result: GalleryCategoryCatalog = {}
    for (const type of Object.values(RESOURCE_TYPE)) {
      const values = await this.list(type)
      if (values.length) result[type] = values
    }
    return result
  }
  async import(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const type of Object.values(RESOURCE_TYPE)) {
      const incoming = names((value as Record<string, unknown>)[type])
      if (incoming.length) await this.change(type, (current) => [...current, ...incoming])
    }
  }
}
