import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
import { ResourceGalleryService } from './ResourceGalleryService'
import { JsonResourceParser } from '../parser/JsonResourceParser'
import { UserPersonaService } from './UserPersonaService'
import type { UserPersonaDraft } from '../types/UserPersona'

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
  const resourceService = new ResourceService(
    resourceStorage,
    new ResourceParserRegistry([new JsonResourceParser()]),
  )
  const userPersonaService = new UserPersonaService(resourceService)
  const categoryService = new CategoryService(new IndexedDbCategoryStorage(database, vault))
  const restoreService = new RestoreService(new IndexedDbArchiveStorage(database, vault))
  const recycleBin = new RecycleBinService(
    database,
    resourceService,
    categoryService,
    new ExportService(),
    restoreService,
    vault,
    userPersonaService,
  )
  return { database, recycleBin, resourceService, resourceStorage, vault, userPersonaService }
}

describe('RecycleBinService', () => {
  it('moves a nested persona version to recycle bin and restores it without resource history snapshots', async () => {
    const { recycleBin, resourceService, userPersonaService } = await createServices()
    const draft: UserPersonaDraft = {
      avatarId: 'me.png',
      name: '同一个我',
      title: '',
      description: '全局人设',
      position: 0,
      depth: 2,
      role: 0,
      lorebook: '',
      connections: [],
      characterBindings: {},
      profile: {
        version: 1,
        sections: [{ id: 'base', name: '基础设定', text: '全局人设' }],
        variants: {
          'detective.png': {
            defaultVersionId: 'v1',
            chatVersions: { chatA: 'v1', chatB: 'v2' },
            versions: {
              v1: { name: '初遇', overrides: {}, addition: '初遇补充' },
              v2: { name: '重逢', overrides: {}, addition: '重逢补充' },
            },
          },
        },
      },
    }
    const resource = await userPersonaService.create(draft)

    const recycled = await recycleBin.movePersonaVersionToRecycleBin({
      resourceId: resource.id,
      avatarId: draft.avatarId,
      characterId: 'detective.png',
      characterName: '雨夜侦探',
      versionId: 'v1',
    })

    expect(recycled.itemKind).toBe('persona-version')
    expect(recycled.reason).toContain('雨夜侦探')
    expect(await resourceService.listVersions(resource.id)).toHaveLength(1)
    let current = await userPersonaService.load(resource.id)
    expect(current.view.entries[0]?.profile.variants['detective.png']?.versions).toEqual({
      v2: { name: '重逢', overrides: {}, addition: '重逢补充' },
    })
    expect((await recycleBin.list()).map((entry) => entry.id)).toContain(recycled.id)

    await recycleBin.restore(recycled.id)

    current = await userPersonaService.load(resource.id)
    expect(current.view.entries[0]?.profile.variants['detective.png']).toMatchObject({
      defaultVersionId: 'v1',
      chatVersions: { chatA: 'v1', chatB: 'v2' },
      versions: {
        v1: { name: '初遇', addition: '初遇补充' },
        v2: { name: '重逢', addition: '重逢补充' },
      },
    })
    expect(await resourceService.listVersions(resource.id)).toHaveLength(1)
    expect(await recycleBin.list()).toEqual([])
  })

  it('moves a whole character persona and all its versions to recycle bin without resource history snapshots', async () => {
    const { recycleBin, resourceService, userPersonaService } = await createServices()
    const draft: UserPersonaDraft = {
      avatarId: 'me.png',
      name: '同一个我',
      title: '',
      description: '全局人设',
      position: 0,
      depth: 2,
      role: 0,
      lorebook: '',
      connections: [],
      characterBindings: {},
      profile: {
        version: 1,
        sections: [{ id: 'base', name: '基础设定', text: '全局人设' }],
        variants: {
          'detective.png': {
            defaultVersionId: 'v1',
            chatVersions: { chatA: 'v1', chatB: 'v2' },
            versions: {
              v1: { name: '初遇', overrides: {}, addition: '初遇补充' },
              v2: { name: '重逢', overrides: {}, addition: '重逢补充' },
            },
          },
        },
      },
    }
    const resource = await userPersonaService.create(draft)

    const recycled = await recycleBin.movePersonaCharacterToRecycleBin({
      resourceId: resource.id,
      avatarId: draft.avatarId,
      characterId: 'detective.png',
      characterName: '雨夜侦探',
    })

    expect(recycled.itemKind).toBe('persona-character')
    expect(await resourceService.listVersions(resource.id)).toHaveLength(1)
    let current = await userPersonaService.load(resource.id)
    expect(current.view.entries[0]?.profile.variants['detective.png']).toBeUndefined()
    expect((await recycleBin.list()).map((entry) => entry.id)).toContain(recycled.id)

    await recycleBin.restore(recycled.id)

    current = await userPersonaService.load(resource.id)
    expect(current.view.entries[0]?.profile.variants['detective.png']).toEqual(
      draft.profile.variants['detective.png'],
    )
    expect(await resourceService.listVersions(resource.id)).toHaveLength(1)
    expect(await recycleBin.list()).toEqual([])
  })

  it('restores gallery categories and custom cover together with the deleted resource', async () => {
    const { recycleBin, resourceStorage, resourceService } = await createServices()
    const owner = await createResource('gallery-owner', '图库资源', '{}')
    await resourceStorage.save(owner)
    const gallery = new ResourceGalleryService(resourceStorage)
    const image = await gallery.addUrl(owner.id, 'https://example.com/preview.png', false, ['预览'])
    await gallery.setCover(owner.id, image.id)
    const entry = await recycleBin.moveToRecycleBin([owner.id])
    expect(await resourceStorage.get(image.id)).toBeUndefined()
    await recycleBin.restore(entry.id)
    const restoredOwner = (await resourceService.get(owner.id))!
    expect(restoredOwner.metadata.resourceCoverId).toBe(image.id)
    expect((await gallery.list(owner.id)).items[0]?.tags).toEqual(['预览'])
  })
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

    const eagerVersions = vi
      .spyOn(resourceService, 'listVersions')
      .mockRejectedValue(new Error('must not load all originals'))
    const entry = await recycleBin.moveToRecycleBin([atlas.id])
    expect(eagerVersions).not.toHaveBeenCalled()
    eagerVersions.mockRestore()

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
