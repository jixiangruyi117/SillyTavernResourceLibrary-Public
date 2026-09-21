import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { ResourceParserRegistry } from '../parser/ResourceParser'
import { IndexedDbArchiveStorage } from '../storage/IndexedDbArchiveStorage'
import { IndexedDbCategoryStorage } from '../storage/IndexedDbCategoryStorage'
import { IndexedDbResourceStorage } from '../storage/IndexedDbResourceStorage'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { CategoryService } from './CategoryService'
import { ExportService } from './ExportService'
import { ResourceService } from './ResourceService'
import { RestoreService } from './RestoreService'
import { VaultService } from './VaultService'
import { RecycleBinService } from './RecycleBinService'

const databases: AppDatabase[] = []

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close()
      await database.delete()
    }),
  )
})

async function createResource(
  id: string,
  name: string,
  content: string,
  relatedResourceIds: string[] = [],
): Promise<Resource> {
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const contentHash = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('')
  return {
    id,
    type: RESOURCE_TYPE.WORLD_BOOK,
    name,
    description: '',
    fileName: `${name}.json`,
    mimeType: 'application/json',
    fileSize: bytes.byteLength,
    contentHash,
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds,
    tags: [],
    metadata: {},
    originalBlob: new Blob([content], { type: 'application/json' }),
    createdAt: 1,
    updatedAt: 1,
  }
}

async function createServices() {
  const database = new AppDatabase(`recycle-bin-${crypto.randomUUID()}`)
  databases.push(database)
  const vault = new VaultService(database)
  await vault.initialize()
  const resourceStorage = new IndexedDbResourceStorage(database, vault)
  const resourceService = new ResourceService(resourceStorage, new ResourceParserRegistry([]))
  const categoryService = new CategoryService(new IndexedDbCategoryStorage(database, vault))
  const restoreService = new RestoreService(new IndexedDbArchiveStorage(database, vault))
  const recycleBin = new RecycleBinService(
    database,
    resourceService,
    categoryService,
    new ExportService(),
    restoreService,
    vault,
  )
  return { database, recycleBin, resourceService, resourceStorage, vault }
}

describe('RecycleBinService', () => {
  it('stores only selected resources and their versions, then restores links', async () => {
    const { database, recycleBin, resourceService, resourceStorage } = await createServices()
    const atlas = await createResource('atlas', 'Atlas', '{"name":"Atlas"}', ['companion'])
    const atlasVersion = {
      ...(await createResource('atlas-version', 'Atlas', '{"name":"Atlas v1"}', ['companion'])),
      versionGroupId: atlas.id,
      versionImportedAt: 0,
      versionLabel: 'v1',
    }
    const companion = await createResource('companion', 'Companion', '{"name":"Companion"}', [
      atlas.id,
    ])
    const untouched = await createResource('untouched', 'Untouched', '{"name":"Untouched"}')
    await resourceStorage.saveMany([atlas, companion, untouched])
    await resourceStorage.saveVersion(atlasVersion)

    const entry = await recycleBin.moveToRecycleBin([atlas.id])

    expect(entry.resourceCount).toBe(1)
    expect(await resourceService.get(atlas.id)).toBeUndefined()
    expect(await database.resourceVersions.get(atlasVersion.id)).toBeUndefined()
    expect(await resourceService.get(untouched.id)).toBeTruthy()
    expect((await resourceService.get(companion.id))?.relatedResourceIds).toEqual([])

    await recycleBin.restore(entry.id)

    expect(await resourceService.get(atlas.id)).toMatchObject({ name: 'Atlas' })
    const restoredVersions = (await resourceService.listVersions(atlas.id)).flatMap(
      (view) => view.carriers ?? [view.resource],
    )
    expect(restoredVersions).toHaveLength(2)
    expect(restoredVersions.map((resource) => resource.contentHash)).toContain(
      atlasVersion.contentHash,
    )
    expect((await resourceService.get(companion.id))?.relatedResourceIds).toEqual([atlas.id])
    expect(await recycleBin.list()).toEqual([])
  })

  it('protects recycle archives when the local vault is enabled', async () => {
    const { database, recycleBin, resourceService, resourceStorage, vault } = await createServices()
    const resource = await createResource('sealed', 'Sealed', '{"name":"Sealed"}')
    await resourceStorage.save(resource)
    await vault.enable('correct horse battery staple')

    const entry = await recycleBin.moveToRecycleBin([resource.id])

    expect(entry.encrypted).toBe(true)
    expect(entry.encryptionIv).toBeTruthy()
    expect((await database.backupRecords.get(entry.id))?.encrypted).toBe(true)
    await recycleBin.restore(entry.id)
    expect(await resourceService.get(resource.id)).toMatchObject({ name: 'Sealed' })
  })
})
