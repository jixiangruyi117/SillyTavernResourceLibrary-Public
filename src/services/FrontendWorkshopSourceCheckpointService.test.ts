/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import {
  FrontendWorkshopSourceCheckpointBudgetError,
  FrontendWorkshopSourceCheckpointService,
  FrontendWorkshopSourceCheckpointStaleError,
} from './FrontendWorkshopSourceCheckpointService'
import { FrontendWorkshopSourceDocumentService } from './FrontendWorkshopSourceDocumentService'
import { FrontendWorkshopSourceHistoryService } from './FrontendWorkshopSourceHistoryService'
import { FrontendWorkshopSourcePatchService } from './FrontendWorkshopSourcePatchService'

const databases: AppDatabase[] = []

function createHarness(
  checkpointOptions: {
    maxEntries?: number
    maxTextUnits?: number
    maxSourceTextUnits?: number
    maxRestoreHistoryTextUnits?: number
  } = {},
) {
  const database = new AppDatabase(`frontend-workshop-source-checkpoint-${crypto.randomUUID()}`)
  databases.push(database)
  const storage = new IndexedDbFrontendWorkshopSourceDocumentStorage(database)
  const sourceService = new FrontendWorkshopSourceDocumentService(storage)
  const patchService = new FrontendWorkshopSourcePatchService(sourceService)
  const historyService = new FrontendWorkshopSourceHistoryService(sourceService, patchService)
  let id = 0
  const checkpointService = new FrontendWorkshopSourceCheckpointService(
    sourceService,
    historyService,
    {
      ...checkpointOptions,
      createCheckpointId: () => `checkpoint-${++id}`,
    },
  )
  return { sourceService, historyService, checkpointService }
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = Array.from(new Set(opened.map((database) => database.name)))
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('FrontendWorkshopSourceCheckpointService', () => {
  it('creates bounded session-local checkpoint metadata without exposing a second current Source', async () => {
    const { sourceService, checkpointService } = createHarness()
    const source = await sourceService.saveAuthorSource(
      'project-checkpoint-basic',
      '<div>one</div>',
      {
        now: 100,
      },
    )

    const checkpoint = await checkpointService.create(source.projectId, {
      label: '  稳定版  ',
      now: 200,
    })

    expect(checkpoint).toMatchObject({
      id: 'checkpoint-1',
      projectId: source.projectId,
      sourceCreatedAt: 100,
      sourceRevision: 1,
      label: '稳定版',
      createdAt: 200,
      textUnits: source.authorSource.length,
    })
    expect(checkpoint.sourceFingerprint).toMatch(/^utf16-\d+-[0-9a-f]{8}$/)
    expect(checkpointService.status(source.projectId)).toMatchObject({
      entryCount: 1,
      latestCheckpointId: checkpoint.id,
      textUnits: source.authorSource.length,
    })
    const listed = checkpointService.list(source.projectId)
    expect(listed).toHaveLength(1)
    expect('authorSource' in listed[0]!).toBe(false)
    expect(await sourceService.get(source.projectId)).toEqual(source)
  })

  it('prunes only the oldest checkpoint anchors when entry retention is exceeded', async () => {
    const { sourceService, checkpointService } = createHarness({
      maxEntries: 2,
      maxTextUnits: 1_000,
      maxSourceTextUnits: 1_000,
    })
    const first = await sourceService.saveAuthorSource('project-checkpoint-prune', 'one', {
      now: 100,
    })
    const a = await checkpointService.create(first.projectId, { now: 110 })
    const second = await sourceService.saveAuthorSourceAtRevision(first.projectId, 1, 'two', {
      now: 120,
    })
    const b = await checkpointService.create(first.projectId, { now: 130 })
    await sourceService.saveAuthorSourceAtRevision(first.projectId, second.revision, 'three', {
      now: 140,
    })
    const c = await checkpointService.create(first.projectId, { now: 150 })

    expect(checkpointService.list(first.projectId).map((item) => item.id)).toEqual([b.id, c.id])
    expect(checkpointService.list(first.projectId).map((item) => item.label)).toEqual([
      '检查点 2',
      '检查点 3',
    ])
    expect(checkpointService.list(first.projectId).some((item) => item.id === a.id)).toBe(false)
  })

  it('restores an older checkpoint through History as a new revision and keeps the restore undoable', async () => {
    const { sourceService, historyService, checkpointService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-checkpoint-restore',
      '<div>one</div>',
      {
        now: 100,
      },
    )
    const checkpoint = await checkpointService.create(first.projectId, {
      label: '可用版本',
      now: 110,
    })
    const second = await sourceService.saveAuthorSourceAtRevision(
      first.projectId,
      first.revision,
      '<div>two</div>',
      { now: 120 },
    )

    const restored = await checkpointService.restore(first.projectId, checkpoint.id)

    expect(restored.changed).toBe(true)
    expect(restored.document).toMatchObject({
      revision: second.revision + 1,
      authorSource: first.authorSource,
      createdAt: first.createdAt,
    })
    expect(historyService.status(first.projectId)).toMatchObject({
      expectedRevision: 3,
      entryCount: 1,
      cursor: 1,
      canUndo: true,
      canRedo: false,
    })
    expect(checkpointService.list(first.projectId)).toHaveLength(1)

    const undoRestore = await historyService.undo(first.projectId, { now: 140 })
    expect(undoRestore).toMatchObject({
      revision: 4,
      authorSource: second.authorSource,
    })
  })

  it('does not advance revision or create history when restoring an already-current checkpoint', async () => {
    const { sourceService, historyService, checkpointService } = createHarness()
    const source = await sourceService.saveAuthorSource(
      'project-checkpoint-noop',
      '<div>same</div>',
    )
    const checkpoint = await checkpointService.create(source.projectId)

    const restored = await checkpointService.restore(source.projectId, checkpoint.id)

    expect(restored.changed).toBe(false)
    expect(restored.document).toEqual(source)
    expect(historyService.status(source.projectId)).toMatchObject({
      entryCount: 0,
      canUndo: false,
    })
  })

  it('keeps checkpoints across ordinary revision changes but rejects a recreated Source lineage', async () => {
    const { sourceService, checkpointService } = createHarness()
    const first = await sourceService.saveAuthorSource('project-checkpoint-lineage', 'first', {
      now: 100,
    })
    const checkpoint = await checkpointService.create(first.projectId)
    await sourceService.saveAuthorSourceAtRevision(first.projectId, first.revision, 'second', {
      now: 200,
    })
    expect(checkpointService.list(first.projectId)).toHaveLength(1)

    await sourceService.delete(first.projectId)
    const recreated = await sourceService.saveAuthorSource(first.projectId, 'replacement', {
      now: 500,
    })
    expect(recreated.createdAt).toBe(500)

    await expect(checkpointService.restore(first.projectId, checkpoint.id)).rejects.toBeInstanceOf(
      FrontendWorkshopSourceCheckpointStaleError,
    )
    expect(checkpointService.list(first.projectId)).toHaveLength(0)
    expect((await sourceService.get(first.projectId))?.authorSource).toBe('replacement')
  })

  it('rejects over-budget checkpoint creation before changing Source or checkpoint state', async () => {
    const { sourceService, checkpointService } = createHarness({
      maxEntries: 4,
      maxTextUnits: 100,
      maxSourceTextUnits: 5,
    })
    const source = await sourceService.saveAuthorSource('project-checkpoint-budget', '123456')

    await expect(checkpointService.create(source.projectId)).rejects.toBeInstanceOf(
      FrontendWorkshopSourceCheckpointBudgetError,
    )
    expect(checkpointService.status(source.projectId).entryCount).toBe(0)
    expect(await sourceService.get(source.projectId)).toEqual(source)
  })

  it('rejects an over-budget undoable restore before mutating current Source', async () => {
    const { sourceService, historyService, checkpointService } = createHarness({
      maxEntries: 4,
      maxTextUnits: 100,
      maxSourceTextUnits: 100,
      maxRestoreHistoryTextUnits: 8,
    })
    const first = await sourceService.saveAuthorSource('project-checkpoint-restore-budget', '12345')
    const checkpoint = await checkpointService.create(first.projectId)
    const second = await sourceService.saveAuthorSourceAtRevision(
      first.projectId,
      first.revision,
      '67890',
    )

    await expect(checkpointService.restore(first.projectId, checkpoint.id)).rejects.toBeInstanceOf(
      FrontendWorkshopSourceCheckpointBudgetError,
    )
    expect(await sourceService.get(first.projectId)).toEqual(second)
    expect(historyService.status(first.projectId).entryCount).toBe(0)
  })
})
