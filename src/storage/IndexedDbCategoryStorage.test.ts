import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { RESOURCE_TYPE, type Category, type Resource } from '../types/Resource'
import { IndexedDbCategoryStorage } from './IndexedDbCategoryStorage'

const databaseNames: string[] = []

function createDatabase(): AppDatabase {
  const name = `category-storage-${crypto.randomUUID()}`
  databaseNames.push(name)
  return new AppDatabase(name)
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => indexedDB.deleteDatabase(name)))
})

describe('IndexedDbCategoryStorage', () => {
  it('lists manually ordered folders before legacy creation-order folders', async () => {
    const database = createDatabase()
    const storage = new IndexedDbCategoryStorage(database)
    const orderedCategories: Category[] = [
      { id: 'legacy', name: '旧文件夹', color: '#486b5d', createdAt: 1, updatedAt: 1 },
      {
        id: 'second',
        name: '第二个',
        color: '#486b5d',
        sortOrder: 1,
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: 'first',
        name: '第一个',
        color: '#486b5d',
        sortOrder: 0,
        createdAt: 2,
        updatedAt: 2,
      },
    ]
    await database.categories.bulkPut(orderedCategories)

    expect((await storage.list()).map((category) => category.id)).toEqual([
      'first',
      'second',
      'legacy',
    ])
    database.close()
  })

  it('deletes a category and unassigns its resources in one operation', async () => {
    const database = createDatabase()
    const storage = new IndexedDbCategoryStorage(database)
    const now = Date.now()
    const category: Category = {
      id: 'favorite-lore',
      name: '常用设定',
      color: '#486b5d',
      createdAt: now,
      updatedAt: now,
    }
    const resource: Resource = {
      id: 'atlas',
      type: RESOURCE_TYPE.WORLD_BOOK,
      name: 'Atlas',
      description: '',
      fileName: 'Atlas.json',
      mimeType: 'application/json',
      fileSize: 2,
      contentHash: 'hash',
      favorite: false,
      categoryId: category.id,
      categoryIds: [category.id, 'keep-folder'],
      tags: [],
      metadata: {},
      originalBlob: new Blob(['{}']),
      createdAt: now,
      updatedAt: now,
    }

    await database.categories.put(category)
    await database.resources.put(resource)
    await storage.deleteAndUnassign(category.id)

    expect(await database.categories.get(category.id)).toBeUndefined()
    const updatedResource = await database.resources.get(resource.id)
    expect(
      updatedResource && 'categoryId' in updatedResource ? updatedResource.categoryId : undefined,
    ).toBe('keep-folder')
    expect(
      updatedResource && 'categoryIds' in updatedResource ? updatedResource.categoryIds : undefined,
    ).toEqual(['keep-folder'])
    database.close()
  })
})
