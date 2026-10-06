import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbCategoryStorage } from '../storage/IndexedDbCategoryStorage'
import { IndexedDbResourceStorage } from '../storage/IndexedDbResourceStorage'
import { RESOURCE_TYPE, type Category, type Resource } from '../types/Resource'
import {
  isEncryptedCategory,
  isEncryptedResource,
  isEncryptedResourceSummary,
  type NativeBackedResourceRecord,
} from '../types/Vault'
import { VaultService } from './VaultService'

const nativeFiles = vi.hoisted(() => ({ clear: vi.fn(), read: vi.fn() }))
vi.mock('../storage/NativeResourceFileMirror', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/NativeResourceFileMirror')>()),
  clearNativeResourceFiles: nativeFiles.clear,
  readNativeResourceObject: nativeFiles.read,
}))

function createResource(): Resource {
  return {
    id: 'resource',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '秘密角色',
    description: '不应明文保存',
    fileName: 'secret.json',
    mimeType: 'application/json',
    fileSize: 17,
    contentHash: 'a'.repeat(64),
    favorite: true,
    categoryId: 'private',
    categoryIds: ['private', 'secondary'],
    relatedResourceIds: ['companion'],
    tags: ['秘密标签'],
    metadata: { first_mes: '你好' },
    originalBlob: new Blob(['{"secret":true}'], { type: 'application/json' }),
    createdAt: 1,
    updatedAt: 2,
  }
}

const category: Category = {
  id: 'private',
  name: '秘密文件夹',
  color: '#486b5d',
  createdAt: 1,
  updatedAt: 1,
}

describe('VaultService', () => {
  beforeEach(() => {
    nativeFiles.clear.mockReset().mockResolvedValue(undefined)
    nativeFiles.read.mockReset()
  })

  it('encrypts native-only current and historical originals before removing native plaintext', async () => {
    const database = new AppDatabase(`vault-native-${crypto.randomUUID()}`)
    const { originalBlob, ...metadata } = createResource()
    const nativeOriginal = {
      version: 1 as const,
      contentHash: metadata.contentHash,
      size: originalBlob.size,
    }
    const current: NativeBackedResourceRecord = { ...metadata, nativeOriginal }
    const historical: NativeBackedResourceRecord = {
      ...metadata,
      id: 'old-resource',
      versionGroupId: metadata.id,
      nativeOriginal,
    }
    await database.resources.put(current)
    await database.resourceVersions.put(historical)
    nativeFiles.read.mockResolvedValue(originalBlob)
    nativeFiles.clear.mockImplementation(async () => {
      expect(await database.resources.filter(isEncryptedResource).count()).toBe(1)
      expect(await database.resourceVersions.filter(isEncryptedResource).count()).toBe(1)
      expect(nativeFiles.read).toHaveBeenCalledTimes(2)
    })
    const vault = new VaultService(database)
    try {
      await vault.initialize()
      await vault.enable('correct-password')
      expect(nativeFiles.clear).toHaveBeenCalledOnce()
      const restored = await vault.decodeResource((await database.resources.get(metadata.id))!)
      expect(await restored.originalBlob.text()).toBe(await originalBlob.text())
      const old = await vault.decodeResource((await database.resourceVersions.get('old-resource'))!)
      expect(await old.originalBlob.text()).toBe(await originalBlob.text())
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('retains native originals when migration fails and finishes safely after restart', async () => {
    const database = new AppDatabase(`vault-native-resume-${crypto.randomUUID()}`)
    const { originalBlob, ...metadata } = createResource()
    const nativeOriginal = {
      version: 1 as const,
      contentHash: metadata.contentHash,
      size: originalBlob.size,
    }
    const current: NativeBackedResourceRecord = { ...metadata, nativeOriginal }
    const historical: NativeBackedResourceRecord = {
      ...metadata,
      id: 'old-resource',
      versionGroupId: metadata.id,
      nativeOriginal,
    }
    await database.resources.put(current)
    await database.resourceVersions.put(historical)
    nativeFiles.read
      .mockResolvedValueOnce(originalBlob)
      .mockRejectedValueOnce(new Error('native read interrupted'))
    const vault = new VaultService(database)
    try {
      await vault.initialize()
      await expect(vault.enable('correct-password')).rejects.toThrow('native read interrupted')
      expect(nativeFiles.clear).not.toHaveBeenCalled()
      expect(await database.resourceVersions.get('old-resource')).toHaveProperty('nativeOriginal')
      nativeFiles.read.mockResolvedValue(originalBlob)
      const restarted = new VaultService(database)
      await restarted.initialize()
      await restarted.unlock('correct-password')
      expect(nativeFiles.clear).toHaveBeenCalledOnce()
      expect(await restarted.getMigrationStatus()).toBeUndefined()
      const old = await restarted.decodeResource(
        (await database.resourceVersions.get('old-resource'))!,
      )
      expect(await old.originalBlob.text()).toBe(await originalBlob.text())
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('retains a retryable job when plaintext cleanup fails after encryption', async () => {
    const database = new AppDatabase(`vault-native-cleanup-${crypto.randomUUID()}`)
    await database.resources.put(createResource())
    nativeFiles.clear.mockRejectedValueOnce(new Error('native cleanup interrupted'))
    const vault = new VaultService(database)
    try {
      await vault.initialize()
      await expect(vault.enable('correct-password')).rejects.toThrow('native cleanup interrupted')
      expect(isEncryptedResource((await database.resources.get('resource'))!)).toBe(true)
      expect(await vault.getMigrationStatus()).toMatchObject({
        status: 'failed',
        targetMode: 'encrypted',
      })
      const restarted = new VaultService(database)
      await restarted.initialize()
      await restarted.unlock('correct-password')
      expect(nativeFiles.clear).toHaveBeenCalledTimes(2)
      expect(await restarted.getMigrationStatus()).toBeUndefined()
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('does not enable an in-memory vault or remove originals when initial config persistence fails', async () => {
    const database = new AppDatabase(`vault-config-failure-${crypto.randomUUID()}`)
    await database.resources.put(createResource())
    const vault = new VaultService(database)
    try {
      await vault.initialize()
      vi.spyOn(database.settings, 'put').mockRejectedValueOnce(new Error('quota exceeded'))
      await expect(vault.enable('correct-password')).rejects.toThrow('quota exceeded')
      expect(vault.getStatus()).toEqual({ enabled: false, locked: false })
      expect(await database.settings.get('local-vault')).toBeUndefined()
      expect(await database.resources.get('resource')).toHaveProperty('originalBlob')
      expect(nativeFiles.clear).not.toHaveBeenCalled()
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('persists a batch checkpoint and resumes encryption after restart', async () => {
    const database = new AppDatabase(`vault-resume-${crypto.randomUUID()}`)
    await database.resources.bulkPut(
      Array.from({ length: 25 }, (_, index) => ({
        ...createResource(),
        id: `resource-${index.toString().padStart(2, '0')}`,
      })),
    )
    const vault = new VaultService(database)
    await vault.initialize()
    const internal = vault as unknown as {
      encryptResourceWithKey(resource: Resource, key: CryptoKey): Promise<unknown>
    }
    const encrypt = internal.encryptResourceWithKey.bind(vault)
    let calls = 0
    vi.spyOn(internal, 'encryptResourceWithKey').mockImplementation(async (resource, key) => {
      calls += 1
      if (calls === 12) throw new Error('simulated process interruption')
      return encrypt(resource, key)
    })

    await expect(vault.enable('correct-password')).rejects.toThrow('simulated process interruption')
    await expect(vault.getMigrationStatus()).resolves.toMatchObject({
      targetMode: 'encrypted',
      status: 'failed',
      lastPrimaryKey: 'resource-09',
      processed: 10,
    })

    const restarted = new VaultService(database)
    await restarted.initialize()
    await restarted.unlock('correct-password')
    expect(await database.resources.filter(isEncryptedResource).count()).toBe(25)
    await expect(restarted.getMigrationStatus()).resolves.toBeUndefined()

    database.close()
    await database.delete()
  })

  it('encrypts local records, requires unlock, and safely decrypts them when disabled', async () => {
    const database = new AppDatabase(`vault-${crypto.randomUUID()}`)
    await database.resources.put(createResource())
    const historicalResource: Resource = {
      ...createResource(),
      id: 'historical-resource',
      versionGroupId: 'resource',
      versionLabel: '第一版',
    }
    await database.resourceVersions.put(historicalResource)
    await database.categories.put(category)
    await database.backupRecords.put({
      id: 'snapshot',
      adapter: 'local-history',
      objectKey: 'snapshot.zip',
      resourceCount: 1,
      createdAt: 1,
      blob: new Blob(['backup']),
    })
    const vault = new VaultService(database)
    await vault.initialize()

    await vault.enable('correct-password')

    const encryptedResource = await database.resources.get('resource')
    const encryptedSummary = await database.resourceSummaries.get('resource')
    const encryptedVersionSummary =
      await database.resourceVersionSummaries.get('historical-resource')
    const encryptedCategory = await database.categories.get('private')
    const encryptedSnapshot = await database.backupRecords.get('snapshot')
    expect(encryptedResource && isEncryptedResource(encryptedResource)).toBe(true)
    expect(encryptedResource && 'name' in encryptedResource).toBe(false)
    expect(encryptedSummary && isEncryptedResourceSummary(encryptedSummary)).toBe(true)
    expect(encryptedVersionSummary && isEncryptedResourceSummary(encryptedVersionSummary)).toBe(
      true,
    )
    expect(encryptedVersionSummary?.versionGroupId).toBe('resource')
    expect(encryptedSummary && 'name' in encryptedSummary).toBe(false)
    expect(encryptedCategory && isEncryptedCategory(encryptedCategory)).toBe(true)
    expect(encryptedSnapshot?.encrypted).toBe(true)
    const resourceStorage = new IndexedDbResourceStorage(database, vault)
    const categoryStorage = new IndexedDbCategoryStorage(database, vault)
    expect((await resourceStorage.list())[0]?.name).toBe('秘密角色')
    expect((await resourceStorage.listSummaries())[0]?.name).toBe('秘密角色')
    expect((await resourceStorage.listVersionSummaries())[0]).toMatchObject({
      name: '秘密角色',
      versionGroupId: 'resource',
    })
    expect((await categoryStorage.list())[0]?.name).toBe('秘密文件夹')

    vault.lock()
    await expect(resourceStorage.list()).rejects.toThrow('已锁定')
    await expect(vault.unlock('wrong-password')).rejects.toThrow('密码不正确')
    await vault.unlock('correct-password')
    expect((await resourceStorage.list())[0]?.tags).toEqual(['秘密标签'])
    expect((await resourceStorage.list())[0]?.categoryIds).toEqual(['private', 'secondary'])
    expect((await resourceStorage.list())[0]?.relatedResourceIds).toEqual(['companion'])

    await vault.disable()
    const plainResource = await database.resources.get('resource')
    const plainSummary = await database.resourceSummaries.get('resource')
    const plainVersionSummary = await database.resourceVersionSummaries.get('historical-resource')
    const plainSnapshot = await database.backupRecords.get('snapshot')
    expect(plainResource && 'name' in plainResource ? plainResource.name : undefined).toBe(
      '秘密角色',
    )
    expect(
      plainResource && 'categoryIds' in plainResource ? plainResource.categoryIds : undefined,
    ).toEqual(['private', 'secondary'])
    expect(plainSnapshot?.encrypted).toBe(false)
    expect(plainSummary && 'name' in plainSummary ? plainSummary.name : undefined).toBe('秘密角色')
    expect(plainSummary && 'originalBlob' in plainSummary).toBe(false)
    expect(
      plainVersionSummary && 'versionGroupId' in plainVersionSummary
        ? plainVersionSummary.versionGroupId
        : undefined,
    ).toBe('resource')
    expect(plainVersionSummary && 'originalBlob' in plainVersionSummary).toBe(false)
    expect(await plainSnapshot?.blob?.text()).toBe('backup')
    database.close()
    await database.delete()
  })
})
