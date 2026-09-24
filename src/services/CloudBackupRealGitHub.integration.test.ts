import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import type { GitHubBackupConfig } from '../types/CloudBackup'
import type { CategoryService } from './CategoryService'
import { CloudBackupService } from './CloudBackupService'
import type { ExportService } from './ExportService'
import type { ResourceService } from './ResourceService'
import type { RestoreService } from './RestoreService'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const enabled = process.env.SRL_REAL_CLOUD_E2E === '1'
const owner = process.env.SRL_REAL_CLOUD_GITHUB_OWNER ?? 'jixiangruyi117'
const repository = process.env.SRL_REAL_CLOUD_GITHUB_REPOSITORY ?? 'srl-cloud-v3-e2e'
const token = process.env.SRL_REAL_CLOUD_GITHUB_TOKEN ?? ''
const mode = process.env.SRL_REAL_CLOUD_MODE ?? 'web-upload'
const marker = process.env.SRL_REAL_CLOUD_MARKER ?? `srl-web-e2e-${Date.now()}`

function config(): GitHubBackupConfig {
  return {
    provider: 'github',
    owner,
    repository,
    retention: 7,
    autoBackup: false,
  }
}

async function resource(value: string): Promise<Resource> {
  const originalBlob = new Blob([value], { type: 'application/json' })
  const digest = await crypto.subtle.digest('SHA-256', await originalBlob.arrayBuffer())
  const contentHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return {
    id: `real-cloud-${value}`,
    type: RESOURCE_TYPE.OTHER,
    name: value,
    description: 'Cloud Backup V3 real-provider verification fixture',
    fileName: `${value}.json`,
    mimeType: originalBlob.type,
    fileSize: originalBlob.size,
    contentHash,
    favorite: false,
    categoryId: null,
    tags: ['cloud-v3-e2e'],
    metadata: {},
    originalBlob,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

async function createService(value?: string) {
  const fixture = value ? await resource(value) : undefined
  let restoredTexts: string[] = []
  const resourceService = {
    listSummaries: async () => (fixture ? [fixture] : []),
    listVersionSummaries: async () => [],
    get: async (id: string) => (fixture?.id === id ? fixture : undefined),
    listVersions: async () => [],
    updateBackupDescriptor: async () => undefined,
  } as unknown as ResourceService
  const categoryService = { list: async () => [] } as unknown as CategoryService
  const restoreService = {
    prepareStructured: async (resources: Resource[]) => {
      restoredTexts = await Promise.all(resources.map((resource) => resource.originalBlob.text()))
      return { resources, portableData: undefined }
    },
    restore: async (prepared: { resources: Resource[] }) => ({
      restoredResources: prepared.resources.length,
    }),
  } as unknown as RestoreService
  const service = new CloudBackupService(
    resourceService,
    categoryService,
    {} as ExportService,
    restoreService,
  )
  return { service, restoredTexts: () => restoredTexts }
}

describe.runIf(enabled)('Cloud Backup V3 real GitHub provider', () => {
  it('round-trips a Web snapshot or restores the latest Android snapshot', async () => {
    expect(token, 'SRL_REAL_CLOUD_GITHUB_TOKEN is required').not.toBe('')
    globalThis.localStorage = new MemoryStorage()
    globalThis.sessionStorage = new MemoryStorage()
    globalThis.indexedDB = new IDBFactory()

    const harness = await createService(mode === 'web-upload' ? marker : undefined)
    await harness.service.saveConfig(config(), token)

    if (mode === 'web-upload') {
      const uploaded = await harness.service.createBackup(config(), token)
      expect(uploaded.kind).toBe('githubSnapshot')
      const listed = await harness.service.listBackups(config(), token)
      const remote = listed.find((item) => item.objectKey === uploaded.objectKey)
      expect(remote).toBeDefined()
      expect(await harness.service.restoreBackup(remote!)).toBe(1)
      expect(harness.restoredTexts()).toContain(marker)
      console.info(`REAL_GITHUB_WEB_SNAPSHOT=${uploaded.objectKey}`)
      return
    }

    const listed = await harness.service.listBackups(config(), token)
    expect(listed.length).toBeGreaterThan(0)
    expect(await harness.service.restoreBackup(listed[0]!)).toBeGreaterThan(0)
    expect(harness.restoredTexts()).toContain(marker)
    console.info(`REAL_GITHUB_ANDROID_SNAPSHOT=${listed[0]!.objectKey}`)
  }, 120_000)
})
