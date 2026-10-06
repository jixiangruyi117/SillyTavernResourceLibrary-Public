import type { AppDatabase } from '../database/AppDatabase'
import type { VaultService } from '../services/VaultService'
import {
  getResourceCategoryIds,
  normalizeResource,
  toResourceSummary,
  type Category,
  type Resource,
} from '../types/Resource'
import {
  isEncryptedResource,
  isNativeBackedResource,
  type StoredResource,
  type StoredResourceSummary,
} from '../types/Vault'
import type { CategoryStorageAdapter } from './CategoryStorageAdapter'

export class IndexedDbCategoryStorage implements CategoryStorageAdapter {
  private readonly database: AppDatabase
  private readonly vault?: VaultService

  constructor(database: AppDatabase, vault?: VaultService) {
    this.database = database
    this.vault = vault
  }

  async list(): Promise<Category[]> {
    const stored = await this.database.categories.toArray()
    const categories = await Promise.all(
      stored.map((category) =>
        this.vault ? this.vault.decodeCategory(category) : (category as Category),
      ),
    )
    return categories.sort((left, right) => {
      const leftOrder = Number.isFinite(left.sortOrder) ? (left.sortOrder ?? 0) : undefined
      const rightOrder = Number.isFinite(right.sortOrder) ? (right.sortOrder ?? 0) : undefined
      if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }
      if (leftOrder !== undefined) return -1
      if (rightOrder !== undefined) return 1
      return left.createdAt - right.createdAt
    })
  }

  async save(category: Category): Promise<void> {
    await this.database.categories.put(
      this.vault ? await this.vault.encodeCategory(category) : category,
    )
  }

  async update(id: string, changes: Partial<Category>): Promise<void> {
    const stored = await this.database.categories.get(id)
    if (!stored) return
    const category = this.vault ? await this.vault.decodeCategory(stored) : (stored as Category)
    const updated = { ...category, ...changes }
    await this.database.categories.put(
      this.vault ? await this.vault.encodeCategory(updated) : updated,
    )
  }

  async deleteAndUnassign(id: string): Promise<void> {
    const updatedAt = Date.now()
    const storedResources = await this.database.resources.toArray()
    const changedResources: StoredResource[] = []
    for (const stored of storedResources) {
      if (isNativeBackedResource(stored)) {
        const categoryIds = getResourceCategoryIds(stored)
        if (categoryIds.includes(id)) {
          changedResources.push({
            ...stored,
            categoryIds: categoryIds.filter((categoryId) => categoryId !== id),
            categoryId: null,
            updatedAt,
          })
        }
        continue
      }
      const resource = this.vault ? await this.vault.decodeResource(stored) : (stored as Resource)
      const categoryIds = getResourceCategoryIds(resource)
      if (categoryIds.includes(id)) {
        const updated = normalizeResource({
          ...resource,
          categoryIds: categoryIds.filter((categoryId) => categoryId !== id),
          categoryId: null,
          updatedAt,
        })
        changedResources.push(this.vault ? await this.vault.encodeResource(updated) : updated)
      }
    }
    const changedSummaries = changedResources.map((resource): StoredResourceSummary => {
      if (isNativeBackedResource(resource)) {
        const { nativeOriginal: _nativeOriginal, ...summary } = resource
        return summary
      }
      if (!isEncryptedResource(resource)) return toResourceSummary(resource)
      return {
        id: resource.id,
        contentHash: resource.contentHash,
        updatedAt: resource.updatedAt,
        encrypted: true,
        payload: resource.payload,
        thumbnail: resource.thumbnail,
      }
    })

    await this.database.transaction(
      'rw',
      this.database.categories,
      this.database.resources,
      this.database.resourceSummaries,
      async () => {
        if (changedResources.length) await this.database.resources.bulkPut(changedResources)
        if (changedSummaries.length) {
          await this.database.resourceSummaries.bulkPut(changedSummaries)
        }
        await this.database.categories.delete(id)
      },
    )
  }
}
