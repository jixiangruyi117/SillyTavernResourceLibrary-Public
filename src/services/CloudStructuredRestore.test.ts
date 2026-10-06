import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbArchiveStorage } from '../storage/IndexedDbArchiveStorage'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { isEncryptedResource, isEncryptedResourceSummary } from '../types/Vault'
import { RestoreService } from './RestoreService'
import { CommunitySourceRestoreService } from './CommunitySourceRestoreService'
import { MemoryRestoreStagingStore } from '../storage/RestoreStagingStore'
import { VaultService } from './VaultService'
import { createStructuredSnapshot } from './CloudStructuredSnapshot'
import { hashCloudBlob } from './CloudArchiveCodec'
import { createGitHubObjectReader } from './CloudBackupGitHubTransport'
import { createWebDavObjectReader } from './CloudBackupWebDavTransport'
import type { CloudBackupTransportContext } from './CloudBackupTransportContext'
import type { GitHubBundleManifest } from './GitHubBackupBundle'

async function resource(id: string): Promise<Resource> {
  const blob = new Blob([
    JSON.stringify({ spec: 'chara_card_v2', data: { name: id, description: id.repeat(1000) } }),
  ])
  return {
    id,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: id,
    description: '',
    fileName: `${id}.json`,
    mimeType: 'application/json',
    fileSize: blob.size,
    contentHash: await hashCloudBlob(blob),
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    originalBlob: blob,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('structured cloud restore', () => {
  it('preserves the cloud hydration callback through the production CommunitySource restore owner', async () => {
    const database = new AppDatabase(`structured-production-owner-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const service = new CommunitySourceRestoreService(storage, new MemoryRestoreStagingStore(), {
      restoreBackup: vi.fn(),
      replaceAll: vi.fn(),
    })
    const source = await resource('production-owner')
    const snapshot = (await createStructuredSnapshot([source], [], [], { version: 1 })).snapshot
    const reader = vi.fn(async () => source.originalBlob)
    try {
      await service.restoreStructured(snapshot, reader, [], [], 'snapshot')
      expect(reader).toHaveBeenCalledTimes(1)
      const restored = (await database.resources.get(source.id))!
      expect(isEncryptedResource(restored)).toBe(false)
      if (!isEncryptedResource(restored) && 'originalBlob' in restored) {
        expect(await restored.originalBlob.text()).toBe(await source.originalBlob.text())
        expect(restored.originalBlob.size).toBe(source.fileSize)
        expect(restored.metadata).toHaveProperty('card.data.name', source.id)
      }
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('does not commit placeholders or erase existing resources when the cloud reader fails', async () => {
    const database = new AppDatabase(`structured-owner-failure-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const sourceOwner = { restoreBackup: vi.fn(), replaceAll: vi.fn() }
    const service = new CommunitySourceRestoreService(
      storage,
      new MemoryRestoreStagingStore(),
      sourceOwner,
    )
    const existing = await resource('existing-local')
    const source = await resource('remote-candidate')
    await storage.restore([], [existing])
    const snapshot = (await createStructuredSnapshot([source], [], [], { version: 1 })).snapshot
    try {
      await expect(
        service.restoreStructured(
          snapshot,
          async () => {
            throw new Error('download interrupted')
          },
          [existing],
          [],
          'snapshot',
        ),
      ).rejects.toThrow('download interrupted')
      expect(await database.resources.count()).toBe(1)
      expect(await database.resources.get(source.id)).toBeUndefined()
      const retained = (await database.resources.get(existing.id))!
      expect(isEncryptedResource(retained)).toBe(false)
      if ('originalBlob' in retained)
        expect(await retained.originalBlob.text()).toBe(await existing.originalBlob.text())
      expect(await database.restoreStaging.count()).toBe(0)
      expect(sourceOwner.restoreBackup).not.toHaveBeenCalled()
      expect(sourceOwner.replaceAll).not.toHaveBeenCalled()
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('hydrates and stages current/history records serially, skips duplicates and preserves remapped history', async () => {
    const database = new AppDatabase(`structured-serial-${crypto.randomUUID()}`)
    const storage = new IndexedDbArchiveStorage(database)
    const service = new RestoreService(storage)
    const a = await resource('a'),
      b = await resource('b')
    const version = { ...(await resource('old-b')), versionGroupId: b.id }
    const snapshot = (await createStructuredSnapshot([a, b], [version], [], { version: 1 }))
      .snapshot
    const blobs = new Map(
      [a, b, version].map((record) => [record.contentHash, record.originalBlob]),
    )
    await storage.restore([], [{ ...a, id: 'existing-a' }])
    let reads = 0
    const reader = vi.fn(async (object: GitHubBundleManifest) => {
      expect(await database.resources.count()).toBe(1)
      expect(await database.restoreStaging.count()).toBe(reads++)
      return blobs.get(object.totalSha256)!
    })
    try {
      const report = await service.restoreStructured(
        snapshot,
        reader,
        [{ ...a, id: 'existing-a' }],
        [],
        'snapshot',
      )
      expect(report).toMatchObject({
        restoredResources: 1,
        restoredVersions: 1,
        skippedDuplicates: 1,
      })
      expect(reader).toHaveBeenCalledTimes(2)
      expect(await database.resources.get('b')).toHaveProperty('metadata.card.data.name', 'b')
      const history = await database.resourceVersions.toArray()
      expect(history[0]).toMatchObject({
        versionGroupId: 'b',
        metadata: { card: { data: { name: 'old-b' } } },
      })
      expect(await database.restoreStaging.count()).toBe(0)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('never stages plaintext Web records when the local vault is enabled', async () => {
    const database = new AppDatabase(`structured-encrypted-${crypto.randomUUID()}`)
    const vault = new VaultService(database)
    await vault.initialize()
    await vault.enable('test-password')
    const storage = new IndexedDbArchiveStorage(database, vault)
    const source = await resource('private')
    let staged = 0
    database.restoreStaging.hook('creating', (_key, entry) => {
      staged++
      expect(isEncryptedResource(entry.record!.resource)).toBe(true)
      expect(entry.record).not.toHaveProperty('summary')
      expect(isEncryptedResourceSummary(entry.record!.listSummary)).toBe(true)
      expect(entry.record!.resource).not.toHaveProperty('metadata')
    })
    try {
      await storage.restore([], [{ ...source, originalBlob: new Blob([]) }], [], async () => source)
      expect(staged).toBe(1)
      const stored = (await database.resources.get(source.id))!
      expect(await (await vault.decodeResource(stored)).originalBlob.text()).toBe(
        await source.originalBlob.text(),
      )
    } finally {
      database.close()
      await database.delete()
    }
  })

  it.each(['github', 'webdav'] as const)(
    '%s keeps only the most recent downloaded part and still checks hashes',
    async (provider) => {
      const a = await resource('a'),
        b = await resource('b')
      const snapshot = (await createStructuredSnapshot([a, b], [], [], { version: 1 })).snapshot
      const calls = vi.fn(
        async (key: string) => new Response(key.includes('101') ? a.originalBlob : b.originalBlob),
      )
      const context = {
        getGitHubRelease: async () => ({ id: 1 }),
        listGitHubAssets: async () =>
          snapshot.resources.map((r, i) => ({
            id: 101 + i,
            name: r.object.parts[0]!.name,
            size: r.fileSize,
          })),
        githubFetch: (_config: unknown, _secret: string, url: string) => calls(url),
        cloudFetch: (url: string) => calls(url.includes(a.contentHash) ? '101' : '102'),
        readResponseBlob: (response: Response) => response.blob(),
      } as unknown as CloudBackupTransportContext
      const reader =
        provider === 'github'
          ? await createGitHubObjectReader(
              context,
              { provider, owner: 'owner', repository: 'repo', retention: 2, autoBackup: false },
              'token',
            )
          : createWebDavObjectReader(
              context,
              {
                provider,
                baseUrl: 'https://app.koofr.net/dav/Koofr',
                folder: 'test',
                username: 'test',
                retention: 2,
                autoBackup: false,
              },
              'token',
            )
      const first = snapshot.resources[0]!.object,
        second = snapshot.resources[1]!.object
      await reader(first)
      await reader(first)
      expect(calls).toHaveBeenCalledTimes(1)
      await reader(second)
      expect(await (await reader(first)).text()).toBe(await a.originalBlob.text())
      expect(calls).toHaveBeenCalledTimes(3)
      await expect(reader({ ...second, totalSha256: '0'.repeat(64) })).rejects.toThrow(
        '完整性校验失败',
      )
    },
  )
})
