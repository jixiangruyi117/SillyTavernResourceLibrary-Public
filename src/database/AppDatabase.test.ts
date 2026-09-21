import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

import { AppDatabase } from './AppDatabase'

describe('AppDatabase', () => {
  const schemaV7 = {
    resources:
      'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
    resourceSummaries:
      'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
    resourceVersions: 'id, versionGroupId, contentHash, updatedAt',
    resourceVersionSummaries: 'id, versionGroupId, contentHash, updatedAt',
    categories: 'id, name, createdAt, updatedAt',
    settings: 'id, updatedAt',
    backupRecords: 'id, adapter, createdAt',
    externalApps: 'id, enabled, updatedAt',
    externalAppData: 'id, appId, updatedAt',
  }
  const schemaV12 = {
    ...schemaV7,
    externalAppDrafts: 'id, appId, status, updatedAt',
    externalAppRuntimes: 'id, updatedAt',
    frontendWorkshopProjects: 'id, kind, updatedAt',
  }
  const schemaV14 = {
    ...schemaV12,
    generatedImages: 'id, createdAt, updatedAt, mimeType, category, source, provider, hostedUrl',
    generatedImageFiles: 'id, updatedAt',
  }

  it('migrates a legacy single folder resource to multiple folders without losing tags', async () => {
    const name = `database-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(2).stores({
      resources: 'id, type, name, favorite, categoryId, createdAt, updatedAt, contentHash, *tags',
      categories: 'id, name, createdAt, updatedAt',
      settings: 'id, updatedAt',
      backupRecords: 'id, adapter, createdAt',
    })
    await legacy.table('resources').put({
      id: 'legacy',
      categoryId: 'old-folder',
      tags: ['保留标签'],
    })
    legacy.close()

    const database = new AppDatabase(name)
    const migrated = await database.resources.get('legacy')
    const summary = await database.resourceSummaries.get('legacy')

    expect(migrated && 'categoryIds' in migrated ? migrated.categoryIds : undefined).toEqual([
      'old-folder',
    ])
    expect(
      migrated && 'relatedResourceIds' in migrated ? migrated.relatedResourceIds : undefined,
    ).toEqual([])
    expect(migrated && 'tags' in migrated ? migrated.tags : undefined).toEqual(['保留标签'])
    expect(summary && 'originalBlob' in summary).toBe(false)
    expect(database.tables.map((table) => table.name)).toContain('resourceVersions')
    expect(database.tables.map((table) => table.name)).toContain('resourceVersionSummaries')
    expect(database.tables.map((table) => table.name)).toContain('externalApps')
    expect(database.tables.map((table) => table.name)).toContain('externalAppData')
    expect(summary && 'tags' in summary ? summary.tags : undefined).toEqual(['保留标签'])
    database.close()
    await database.delete()
  })

  it('backfills lightweight summaries for existing historical versions', async () => {
    const name = `database-version-summary-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(5).stores({
      resources:
        'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
      resourceSummaries:
        'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
      resourceVersions: 'id, versionGroupId, contentHash, updatedAt',
      categories: 'id, name, createdAt, updatedAt',
      settings: 'id, updatedAt',
      backupRecords: 'id, adapter, createdAt',
    })
    await legacy.table('resourceVersions').put({
      id: 'historical',
      versionGroupId: 'active',
      contentHash: 'history-hash',
      updatedAt: 2,
      name: '旧版角色',
      metadata: { cardContentHash: 'card-hash' },
    })
    legacy.close()

    const database = new AppDatabase(name)
    const summary = await database.resourceVersionSummaries.get('historical')

    expect(summary).toMatchObject({
      id: 'historical',
      versionGroupId: 'active',
      contentHash: 'history-hash',
    })
    expect(summary && 'originalBlob' in summary).toBe(false)
    database.close()
    await database.delete()
  })

  it('moves installed APP runtime HTML out of the desktop index during the v10 migration', async () => {
    const name = `database-external-app-runtime-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(9).stores({
      resources:
        'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
      resourceSummaries:
        'id, type, name, favorite, categoryId, *categoryIds, createdAt, updatedAt, contentHash, *tags',
      resourceVersions: 'id, versionGroupId, contentHash, updatedAt',
      resourceVersionSummaries: 'id, versionGroupId, contentHash, updatedAt',
      categories: 'id, name, createdAt, updatedAt',
      settings: 'id, updatedAt',
      backupRecords: 'id, adapter, createdAt',
      externalApps: 'id, enabled, updatedAt',
      externalAppData: 'id, appId, updatedAt',
      externalAppDrafts: 'id, appId, status, updatedAt',
    })
    await legacy.table('externalApps').put({
      id: 'com.example.legacy',
      runtimeHtml: '<!doctype html><body>legacy app</body>',
      enabled: true,
      updatedAt: 1,
      installedAt: 1,
      manifest: {
        schemaVersion: 1,
        id: 'com.example.legacy',
        name: '旧 APP',
        version: '1.0.0',
        entry: 'index.html',
      },
    })
    legacy.close()

    const database = new AppDatabase(name)
    const summary = await database.externalApps.get('com.example.legacy')
    const runtime = await database.externalAppRuntimes.get('com.example.legacy')

    expect(summary && 'runtimeHtml' in summary).toBe(false)
    expect(runtime?.runtimeHtml).toContain('legacy app')
    database.close()
    await database.delete()
  })

  it('adds separate metadata and file tables for the generated image album', async () => {
    const name = `database-generated-image-album-${crypto.randomUUID()}`
    const database = new AppDatabase(name)
    await database.generatedImages.put({
      id: 'image-a',
      name: '月下庭院',
      source: 'generated',
      category: '背景',
      mimeType: 'image/png',
      sizeBytes: 3,
      createdAt: 1,
      updatedAt: 1,
    })
    await database.generatedImageFiles.put({
      id: 'image-a',
      originalBlob: new Blob(['png'], { type: 'image/png' }),
      originalMimeType: 'image/png',
      updatedAt: 1,
    })

    const metadata = await database.generatedImages.get('image-a')
    const file = await database.generatedImageFiles.get('image-a')
    expect(metadata && 'originalBlob' in metadata).toBe(false)
    await expect(file?.originalBlob?.text()).resolves.toBe('png')
    database.close()
    await database.delete()
  })

  it('preserves legacy album blobs for the bounded storage migration', async () => {
    const name = `database-generated-image-bytes-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(13).stores({ generatedImageFiles: 'id, updatedAt' })
    await legacy.table('generatedImageFiles').put({
      id: 'legacy-image',
      originalBlob: new Blob(['image'], { type: 'image/png' }),
      thumbnailBlob: new Blob(['thumb'], { type: 'image/webp' }),
      updatedAt: 1,
    })
    legacy.close()

    const database = new AppDatabase(name)
    const file = await database.generatedImageFiles.get('legacy-image')

    await expect(file?.originalBlob?.text()).resolves.toBe('image')
    await expect(file?.thumbnailBlob?.text()).resolves.toBe('thumb')
    database.close()
    await database.delete()
  })

  it.each([
    { version: 7, schema: schemaV7 },
    { version: 12, schema: schemaV12 },
    { version: 14, schema: schemaV14 },
  ])(
    'upgrades v$version fixtures to latest without dropping supported records',
    async ({ version, schema }) => {
      const name = `database-version-${version}-${crypto.randomUUID()}`
      const legacy = new Dexie(name)
      legacy.version(version).stores(schema)
      await legacy.table('settings').put({ id: 'fixture', value: { version }, updatedAt: version })
      await legacy.table('resourceVersions').put({
        id: `history-${version}`,
        versionGroupId: 'active',
        contentHash: `hash-${version}`,
        updatedAt: version,
      })
      if (version >= 12) {
        await legacy.table('frontendWorkshopProjects').put({
          id: `workshop-${version}`,
          kind: 'project',
          name: '迁移工程',
          updatedAt: version,
        })
      }
      if (version >= 14) {
        await legacy.table('generatedImageFiles').put({
          id: `image-${version}`,
          originalBlob: new Blob(['legacy-image'], { type: 'image/png' }),
          updatedAt: version,
        })
      }
      legacy.close()

      const database = new AppDatabase(name)
      await expect(database.settings.get('fixture')).resolves.toMatchObject({ value: { version } })
      await expect(database.resourceVersions.get(`history-${version}`)).resolves.toMatchObject({
        contentHash: `hash-${version}`,
      })
      expect(database.tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          'resourceListSummaries',
          'restoreStagingChunks',
          'frontendWorkshopProjectLastGood',
          'frontendWorkshopSourceComponents',
          'assets',
          'assetFiles',
        ]),
      )
      if (version >= 12) {
        await expect(
          database.frontendWorkshopProjects.get(`workshop-${version}`),
        ).resolves.toMatchObject({ name: '迁移工程' })
      }
      if (version >= 14) {
        const file = await database.generatedImageFiles.get(`image-${version}`)
        await expect(file?.originalBlob?.text()).resolves.toBe('legacy-image')
      }
      database.close()
      await database.delete()
    },
  )

  it('reopens the latest schema without rerunning or losing data', async () => {
    const name = `database-latest-reopen-${crypto.randomUUID()}`
    const first = new AppDatabase(name)
    await first.settings.put({ id: 'latest', value: { stable: true }, updatedAt: 1 })
    await first.assets.put({
      assetId: 'asset-latest',
      contentHash: 'a'.repeat(64),
      mimeType: 'image/png',
      source: 'import',
      createdAt: 1,
      size: 3,
      thumbnailRefs: {},
    })
    first.close()

    const reopened = new AppDatabase(name)
    await expect(reopened.settings.get('latest')).resolves.toMatchObject({
      value: { stable: true },
    })
    await expect(reopened.assets.get('asset-latest')).resolves.toMatchObject({ size: 3 })
    reopened.close()
    await reopened.delete()
  })
})
