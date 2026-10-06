/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { analyzeFrontendWorkshopSource } from '../utils/FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopExactSourceWriteTarget } from '../utils/FrontendWorkshopSourceWriteback'
import {
  FrontendWorkshopSourceDocumentService,
  FrontendWorkshopSourceRevisionConflictError,
} from './FrontendWorkshopSourceDocumentService'
import { FrontendWorkshopSourcePatchService } from './FrontendWorkshopSourcePatchService'

const databases: AppDatabase[] = []

function createHarness() {
  const database = new AppDatabase(`frontend-workshop-source-patch-${crypto.randomUUID()}`)
  databases.push(database)
  const storage = new IndexedDbFrontendWorkshopSourceDocumentStorage(database)
  const sourceService = new FrontendWorkshopSourceDocumentService(storage)
  const patchService = new FrontendWorkshopSourcePatchService(sourceService)
  return { storage, sourceService, patchService }
}

function exactEntityByRaw(
  source: FrontendWorkshopSourceDocument,
  semanticKind: string,
  raw: string,
): FrontendWorkshopExactSourceWriteTarget {
  const entity = analyzeFrontendWorkshopSource(source).sourceMap.entities.find(
    (candidate) =>
      candidate.semanticKind === semanticKind &&
      candidate.provenance.kind === 'static-source' &&
      source.authorSource.slice(
        candidate.provenance.anchor.range.start,
        candidate.provenance.anchor.range.end,
      ) === raw,
  )
  if (!entity) throw new Error(`missing ${semanticKind}: ${raw}`)
  return entity
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = Array.from(new Set(opened.map((database) => database.name)))
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('FrontendWorkshopSourcePatchService', () => {
  it('commits several exact ranges as one revision and keeps the whole previous Source as last_good', async () => {
    const { storage, sourceService, patchService } = createHarness()
    const raw = '<div id="hero" style="left:10px;top:20px;color:red"></div>'
    const first = await sourceService.saveAuthorSource('project-patch', raw, { now: 100 })
    const left = exactEntityByRaw(first, 'css.value', '10px')
    const top = exactEntityByRaw(first, 'css.value', '20px')

    const saved = await patchService.applyAtRevision(
      {
        projectId: first.projectId,
        sourceRevision: first.revision,
        edits: [
          { target: left, expectedText: '10px', replacement: '42px' },
          { target: top, expectedText: '20px', replacement: '77px' },
        ],
      },
      { now: 200 },
    )

    expect(saved).toMatchObject({ revision: 2, createdAt: 100, updatedAt: 200 })
    expect(saved.authorSource).toBe('<div id="hero" style="left:42px;top:77px;color:red"></div>')
    expect((await storage.getLastGood(first.projectId))?.document).toMatchObject({
      revision: 1,
      authorSource: raw,
    })
  })

  it('never leaves a mixed half-Patch when two multi-range Patches race on one revision', async () => {
    const { sourceService, patchService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-patch-race',
      '<div style="left:10px;top:20px"></div>',
      { now: 100 },
    )
    const left = exactEntityByRaw(first, 'css.value', '10px')
    const top = exactEntityByRaw(first, 'css.value', '20px')

    const patch = (leftValue: string, topValue: string) => ({
      projectId: first.projectId,
      sourceRevision: first.revision,
      edits: [
        { target: left, expectedText: '10px', replacement: leftValue },
        { target: top, expectedText: '20px', replacement: topValue },
      ],
    })
    const results = await Promise.allSettled([
      patchService.applyAtRevision(patch('11px', '21px'), { now: 200 }),
      patchService.applyAtRevision(patch('12px', '22px'), { now: 201 }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(FrontendWorkshopSourceRevisionConflictError)

    const current = await sourceService.get(first.projectId)
    expect(current?.revision).toBe(2)
    expect([
      '<div style="left:11px;top:21px"></div>',
      '<div style="left:12px;top:22px"></div>',
    ]).toContain(current?.authorSource)
    expect(current?.authorSource).not.toBe('<div style="left:11px;top:22px"></div>')
    expect(current?.authorSource).not.toBe('<div style="left:12px;top:21px"></div>')
  })

  it('rejects an invalid overlapping Patch before touching current or last_good', async () => {
    const { storage, sourceService, patchService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-patch-overlap',
      '<div id="hero" style="left:10px"></div>',
      { now: 100 },
    )
    const startTag = exactEntityByRaw(first, 'html.start-tag', '<div id="hero" style="left:10px">')
    const idAttribute = exactEntityByRaw(first, 'html.attribute', 'id="hero"')

    await expect(
      patchService.applyAtRevision({
        projectId: first.projectId,
        sourceRevision: first.revision,
        edits: [
          {
            target: startTag,
            expectedText: '<div id="hero" style="left:10px">',
            replacement: '<section id="hero" style="left:10px">',
          },
          { target: idAttribute, expectedText: 'id="hero"', replacement: 'id="next"' },
        ],
      }),
    ).rejects.toThrow(/重叠|重复/u)

    expect(await sourceService.get(first.projectId)).toEqual(first)
    expect(await storage.getLastGood(first.projectId)).toBeUndefined()
  })

  it('rejects an expected-text mismatch before touching current Source', async () => {
    const { sourceService, patchService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-patch-expected',
      '<div style="left:10px;top:20px"></div>',
      { now: 100 },
    )
    const left = exactEntityByRaw(first, 'css.value', '10px')
    const top = exactEntityByRaw(first, 'css.value', '20px')

    await expect(
      patchService.applyAtRevision({
        projectId: first.projectId,
        sourceRevision: first.revision,
        edits: [
          { target: left, expectedText: '10px', replacement: '11px' },
          { target: top, expectedText: '999px', replacement: '21px' },
        ],
      }),
    ).rejects.toThrow(/expectedText/u)
    expect(await sourceService.get(first.projectId)).toEqual(first)
  })

  it('rejects a stale Patch revision without rewriting the newer Source', async () => {
    const { sourceService, patchService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-patch-stale',
      '<div style="left:10px"></div>',
      { now: 100 },
    )
    const left = exactEntityByRaw(first, 'css.value', '10px')
    const second = await sourceService.saveAuthorSourceAtRevision(
      first.projectId,
      first.revision,
      '<div style="left:20px"></div>',
      { now: 200 },
    )

    await expect(
      patchService.applyAtRevision({
        projectId: first.projectId,
        sourceRevision: first.revision,
        edits: [{ target: left, expectedText: '10px', replacement: '30px' }],
      }),
    ).rejects.toMatchObject({
      name: 'FrontendWorkshopSourceRevisionConflictError',
      expectedRevision: 1,
      actualRevision: 2,
    })
    expect(await sourceService.get(first.projectId)).toEqual(second)
  })
})
