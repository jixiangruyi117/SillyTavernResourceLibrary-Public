/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopProjectStorage } from '../storage/IndexedDbFrontendWorkshopProjectStorage'
import {
  createFrontendWorkshopProject,
  type FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  FRONTEND_WORKSHOP_GREETING_LEGACY_CLEANUP_ID,
  FrontendWorkshopProjectService,
} from './FrontendWorkshopProjectService'

interface TestContext {
  database: AppDatabase
  storage: IndexedDbFrontendWorkshopProjectStorage
  service: FrontendWorkshopProjectService
}

const databases: AppDatabase[] = []

function createContext(): TestContext {
  const database = new AppDatabase(`frontend-workshop-${crypto.randomUUID()}`)
  databases.push(database)
  const storage = new IndexedDbFrontendWorkshopProjectStorage(database)
  return {
    database,
    storage,
    service: new FrontendWorkshopProjectService(storage),
  }
}

function addCurrentText(project: FrontendWorkshopProject, id = 'title'): void {
  project.pages[0]!.nodes.push({
    id,
    layerId: project.pages[0]!.layers[0]!.id,
    kind: 'text',
    label: '标题',
    text: '雾港来信',
    contentSource: { kind: 'manual' },
    style: {},
    children: [],
  })
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = opened.map((database) => database.name)
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('FrontendWorkshopProjectService new-only boundary', () => {
  it('保存并读取当前 greeting，不生成任何旧兼容字段', async () => {
    const { service } = createContext()
    const project = createFrontendWorkshopProject('greeting', 100)
    addCurrentText(project)

    const saved = await service.save(project)
    const [restored] = await service.list()

    expect(saved.id).toBe(project.id)
    expect(restored).toMatchObject({
      id: project.id,
      kind: 'greeting',
      version: 10,
      schemaVersion: 7,
    })
    expect(restored?.pages[0]?.nodes[0]).toMatchObject({ kind: 'text', id: 'title' })
    const raw = restored as unknown as Record<string, unknown>
    expect(raw.advancedSource).toBeUndefined()
    expect(raw.aiCandidates).toBeUndefined()
    expect(raw.migration).toBeUndefined()
    expect(raw.compatibilityMode).toBeUndefined()
    expect(raw.componentPresets).toBeUndefined()
  })

  it('持久化前阻止孤儿 Behavior，不写入无效项目', async () => {
    const { service } = createContext()
    const project = createFrontendWorkshopProject('greeting', 100)
    project.behaviors = [
      {
        id: 'orphan',
        name: '孤儿行为',
        trigger: 'tap',
        targetNodeIds: ['missing-node'],
        conditions: [],
        actions: [{ type: 'openScreen', pageId: 'missing-page' }],
        propagation: 'stop',
      },
    ]

    await expect(service.save(project)).rejects.toThrow('行为 orphan 指向不存在的节点')
    await expect(service.list()).resolves.toEqual([])
  })

  it('以同一事务保留 last_good，并恢复上一份当前格式项目', async () => {
    const { service } = createContext()
    const project = createFrontendWorkshopProject('greeting', 100)
    project.name = '第一版'
    project.document.name = project.name
    await service.save(project)

    project.name = '第二版'
    project.document.name = project.name
    await service.save(project)
    const restored = await service.restoreLastGood(project.id)

    expect(restored?.name).toBe('第一版')
    await expect(service.list()).resolves.toMatchObject([{ id: project.id, name: '第一版' }])
  })

  it('首次读取只清理当前 schema 上残留的旧字段，并写入一次性 marker', async () => {
    const { database, storage, service } = createContext()
    const project = createFrontendWorkshopProject('greeting', 100)
    addCurrentText(project)
    const legacyDecorated = {
      ...project,
      advancedSource: { enabled: false, markup: '<div>old</div>', updatedAt: 1 },
      aiCandidates: [{ id: 'old-ai' }],
      migration: { sourceSchemaVersion: 3, migratedAt: 1, legacySnapshot: { old: true } },
      compatibilityMode: { behaviorEngineV2: true },
      componentPresets: [{ id: 'old-component' }],
    }
    await database.frontendWorkshopProjects.put(legacyDecorated as never)

    const [restored] = await service.list()
    const raw = restored as unknown as Record<string, unknown>

    expect(restored?.pages[0]?.nodes[0]?.id).toBe('title')
    expect(raw.advancedSource).toBeUndefined()
    expect(raw.aiCandidates).toBeUndefined()
    expect(raw.migration).toBeUndefined()
    expect(raw.compatibilityMode).toBeUndefined()
    expect(raw.componentPresets).toBeUndefined()
    await expect(
      storage.hasMaintenanceMarker(FRONTEND_WORKSHOP_GREETING_LEGACY_CLEANUP_ID),
    ).resolves.toBe(true)
    const nextService = new FrontendWorkshopProjectService(storage)
    await expect(nextService.cleanupLegacyGreetingDataOnce()).resolves.toMatchObject({
      skipped: true,
    })
  })

  it('旧 schema 或旧硬节点 greeting 不再迁移：重置结构化壳但保留 projectId 对应 Source', async () => {
    const { database, service } = createContext()
    const current = createFrontendWorkshopProject('greeting', 100)
    current.name = '旧测试草稿'
    current.document.name = current.name
    const rawLegacy = structuredClone(current) as unknown as Record<string, unknown>
    rawLegacy.version = 7
    rawLegacy.schemaVersion = 3
    ;(rawLegacy.pages as Array<Record<string, unknown>>)[0]!.nodes = [
      {
        id: 'legacy-flip',
        kind: 'flip',
        label: '旧翻转卡',
        style: {},
        children: [],
      },
    ]
    await database.frontendWorkshopProjects.put(rawLegacy as never)
    const source = createFrontendWorkshopSourceDocument(
      current.id,
      '<section>new source truth</section>',
      200,
    )
    await database.frontendWorkshopSourceDocuments.put(source)

    const [restored] = await service.list()
    const preservedSource = await database.frontendWorkshopSourceDocuments.get(current.id)

    expect(restored).toMatchObject({
      id: current.id,
      name: '旧测试草稿',
      version: 10,
      schemaVersion: 7,
    })
    expect(restored?.pages).toHaveLength(1)
    expect(restored?.pages[0]?.nodes).toEqual([])
    expect(preservedSource?.authorSource).toBe('<section>new source truth</section>')
    expect(preservedSource?.revision).toBe(1)
  })

  it('升级上一发布版时保留内容与原始快照，重复读取和恢复不重置项目', async () => {
    const { database, storage, service } = createContext()
    const project = createFrontendWorkshopProject('greeting', 100)
    addCurrentText(project)
    project.pages[0]!.nodes[0]!.composition = {
      mode: 'row',
      phoneColumns: 1,
      wideColumns: 2,
      gap: 12,
      align: 'center',
      justify: 'start',
    }
    const previous = { ...project, version: 9, schemaVersion: 6 }
    await database.frontendWorkshopProjects.put(previous as never)
    const [upgraded] = await service.list()
    expect(upgraded).toMatchObject({ version: 10, schemaVersion: 7, pages: project.pages })
    expect((await storage.getLastGood(project.id))?.project).toEqual(previous)
    await service.list()
    expect((await storage.getLastGood(project.id))?.project).toEqual(previous)
    expect(await service.restoreLastGood(project.id)).toMatchObject({
      version: 10,
      pages: project.pages,
    })
  })

  it('上一发布版无法安全升级时保留原始记录，不回退成空白项目', async () => {
    const { database, service } = createContext()
    const project = createFrontendWorkshopProject('greeting', 100)
    addCurrentText(project)
    project.pages[0]!.nodes[0]!.layerId = 'missing-layer'
    const previous = { ...project, version: 9, schemaVersion: 6 }
    await database.frontendWorkshopProjects.put(previous as never)
    await expect(service.list()).rejects.toThrow('原始项目已保留')
    expect(await database.frontendWorkshopProjects.get(project.id)).toEqual(previous)
  })

  it('status 是唯一 legacy island：一次性清理不重写状态栏项目', async () => {
    const { database, service } = createContext()
    const status = createFrontendWorkshopProject('status', 100) as unknown as Record<
      string,
      unknown
    >
    status.version = 2
    status.schemaVersion = 1
    status.advancedSource = { enabled: true, markup: 'legacy status payload', updatedAt: 123 }
    await database.frontendWorkshopProjects.put(status as never)

    const [restored] = await service.list()
    const raw = restored as unknown as Record<string, unknown>
    const stored = (await database.frontendWorkshopProjects.get(
      String(status.id),
    )) as unknown as Record<string, unknown>

    expect(restored?.kind).toBe('status')
    expect(raw.version).toBe(2)
    expect(raw.schemaVersion).toBe(1)
    expect(raw.advancedSource).toEqual(status.advancedSource)
    expect(stored.version).toBe(2)
    expect(stored.schemaVersion).toBe(1)
    expect(stored.advancedSource).toEqual(status.advancedSource)
  })
})
