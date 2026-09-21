/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { analyzeFrontendWorkshopSource } from '../utils/FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopSourcePatch } from '../utils/FrontendWorkshopSourcePatch'
import { FrontendWorkshopSourceDocumentService } from './FrontendWorkshopSourceDocumentService'
import {
  FrontendWorkshopSourceHistoryBudgetError,
  FrontendWorkshopSourceHistoryService,
  FrontendWorkshopSourceHistoryStaleError,
} from './FrontendWorkshopSourceHistoryService'
import { FrontendWorkshopSourcePatchService } from './FrontendWorkshopSourcePatchService'

const databases: AppDatabase[] = []

function createHarness(options: { maxEntries?: number; maxTextUnits?: number } = {}) {
  const database = new AppDatabase(`frontend-workshop-source-history-${crypto.randomUUID()}`)
  databases.push(database)
  const storage = new IndexedDbFrontendWorkshopSourceDocumentStorage(database)
  const sourceService = new FrontendWorkshopSourceDocumentService(storage)
  const patchService = new FrontendWorkshopSourcePatchService(sourceService)
  let id = 0
  const historyService = new FrontendWorkshopSourceHistoryService(sourceService, patchService, {
    ...options,
    createEntryId: () => `history-${++id}`,
  })
  return { storage, sourceService, patchService, historyService }
}

function exactValueTarget(source: FrontendWorkshopSourceDocument, raw: string) {
  const target = analyzeFrontendWorkshopSource(source).sourceMap.entities.find(
    (candidate) =>
      candidate.semanticKind === 'css.value' &&
      candidate.provenance.kind === 'static-source' &&
      source.authorSource.slice(
        candidate.provenance.anchor.range.start,
        candidate.provenance.anchor.range.end,
      ) === raw,
  )
  if (!target) throw new Error(`missing css.value ${raw}`)
  return target
}

function replaceValuePatch(
  source: FrontendWorkshopSourceDocument,
  expectedText: string,
  replacement: string,
): FrontendWorkshopSourcePatch {
  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    edits: [{ target: exactValueTarget(source, expectedText), expectedText, replacement }],
  }
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = Array.from(new Set(opened.map((database) => database.name)))
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('FrontendWorkshopSourceHistoryService', () => {
  it('Undo and Redo create new revisions instead of moving the Source revision backward', async () => {
    const { sourceService, historyService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-history-basic',
      '<div style="left:10px"></div>',
      { now: 100 },
    )

    const forward = await historyService.applyAndRecord(replaceValuePatch(first, '10px', '42px'), {
      label: '移动 X',
      save: { now: 200 },
    })
    expect(forward.document).toMatchObject({ revision: 2 })
    expect(forward.document.authorSource).toContain('left:42px')
    expect(historyService.status(first.projectId)).toMatchObject({
      expectedRevision: 2,
      entryCount: 1,
      cursor: 1,
      canUndo: true,
      canRedo: false,
    })

    const undone = await historyService.undo(first.projectId, { now: 300 })
    expect(undone).toMatchObject({ revision: 3, authorSource: first.authorSource })
    expect(historyService.status(first.projectId)).toMatchObject({
      expectedRevision: 3,
      cursor: 0,
      canUndo: false,
      canRedo: true,
    })

    const redone = await historyService.redo(first.projectId, { now: 400 })
    expect(redone).toMatchObject({ revision: 4, authorSource: forward.document.authorSource })
    expect(historyService.status(first.projectId)).toMatchObject({
      expectedRevision: 4,
      cursor: 1,
      canUndo: true,
      canRedo: false,
    })
  })

  it('keeps canonical ranges valid across two edits with length changes and multi-step Undo/Redo', async () => {
    const { sourceService, historyService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-history-chain',
      '<div style="left:10px;top:20px"></div>',
      { now: 100 },
    )
    const a = await historyService.applyAndRecord(replaceValuePatch(first, '10px', '123.5px'), {
      label: 'A',
    })
    const b = await historyService.applyAndRecord(replaceValuePatch(a.document, '20px', '0px'), {
      label: 'B',
    })
    expect(b.document.authorSource).toBe('<div style="left:123.5px;top:0px"></div>')

    const undoB = await historyService.undo(first.projectId)
    expect(undoB?.authorSource).toBe(a.document.authorSource)
    const undoA = await historyService.undo(first.projectId)
    expect(undoA?.authorSource).toBe(first.authorSource)

    const redoA = await historyService.redo(first.projectId)
    expect(redoA?.authorSource).toBe(a.document.authorSource)
    const redoB = await historyService.redo(first.projectId)
    expect(redoB?.authorSource).toBe(b.document.authorSource)
    expect(redoB?.revision).toBe(7)
  })

  it('truncates the redo branch when a new edit is recorded after Undo', async () => {
    const { sourceService, historyService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-history-branch',
      '<div style="left:10px;top:20px"></div>',
    )
    const a = await historyService.applyAndRecord(replaceValuePatch(first, '10px', '11px'))
    await historyService.applyAndRecord(replaceValuePatch(a.document, '20px', '21px'))
    const afterUndo = await historyService.undo(first.projectId)
    if (!afterUndo) throw new Error('missing Undo result')

    const c = await historyService.applyAndRecord(replaceValuePatch(afterUndo, '20px', '99px'))
    expect(c.document.authorSource).toBe('<div style="left:11px;top:99px"></div>')
    expect(historyService.status(first.projectId)).toMatchObject({
      entryCount: 2,
      cursor: 2,
      canRedo: false,
    })
    expect(await historyService.redo(first.projectId)).toBeUndefined()
  })

  it('invalidates history when Source revision advances outside the History service', async () => {
    const { sourceService, historyService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-history-stale',
      '<div style="left:10px"></div>',
    )
    const applied = await historyService.applyAndRecord(replaceValuePatch(first, '10px', '20px'))
    await sourceService.saveAuthorSourceAtRevision(
      first.projectId,
      applied.document.revision,
      '<div style="left:30px"></div>',
    )

    await expect(historyService.undo(first.projectId)).rejects.toBeInstanceOf(
      FrontendWorkshopSourceHistoryStaleError,
    )
    expect(historyService.status(first.projectId)).toMatchObject({
      entryCount: 0,
      cursor: 0,
      canUndo: false,
      canRedo: false,
    })
    expect((await sourceService.get(first.projectId))?.authorSource).toContain('left:30px')
  })

  it('rejects an over-budget reversible edit before mutating Source', async () => {
    const { sourceService, historyService } = createHarness({ maxTextUnits: 8 })
    const first = await sourceService.saveAuthorSource(
      'project-history-budget',
      '<div style="left:10px"></div>',
    )

    await expect(
      historyService.applyAndRecord(replaceValuePatch(first, '10px', '123.5px')),
    ).rejects.toBeInstanceOf(FrontendWorkshopSourceHistoryBudgetError)
    expect(await sourceService.get(first.projectId)).toEqual(first)
    expect(historyService.status(first.projectId).entryCount).toBe(0)
  })

  it('keeps only the most recent bounded undo window when old entries are pruned', async () => {
    const { sourceService, historyService } = createHarness({
      maxEntries: 2,
      maxTextUnits: 1_000,
    })
    const first = await sourceService.saveAuthorSource(
      'project-history-prune',
      '<div style="left:10px"></div>',
    )
    const a = await historyService.applyAndRecord(replaceValuePatch(first, '10px', '11px'))
    const b = await historyService.applyAndRecord(replaceValuePatch(a.document, '11px', '12px'))
    const c = await historyService.applyAndRecord(replaceValuePatch(b.document, '12px', '13px'))
    expect(c.document.authorSource).toContain('left:13px')
    expect(historyService.status(first.projectId)).toMatchObject({ entryCount: 2, cursor: 2 })

    expect((await historyService.undo(first.projectId))?.authorSource).toContain('left:12px')
    expect((await historyService.undo(first.projectId))?.authorSource).toContain('left:11px')
    expect(await historyService.undo(first.projectId)).toBeUndefined()
  })
})
