/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import { analyzeFrontendWorkshopSource } from '../utils/FrontendWorkshopSourceAnalysis'
import { applyFrontendWorkshopExactSourceWriteback } from '../utils/FrontendWorkshopSourceWriteback'
import {
  FrontendWorkshopSourceDocumentService,
  FrontendWorkshopSourceRevisionConflictError,
} from './FrontendWorkshopSourceDocumentService'

const databases: AppDatabase[] = []

function createHarness() {
  const database = new AppDatabase(`frontend-workshop-source-writeback-${crypto.randomUUID()}`)
  databases.push(database)
  const storage = new IndexedDbFrontendWorkshopSourceDocumentStorage(database)
  const service = new FrontendWorkshopSourceDocumentService(storage)
  return { storage, service }
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = Array.from(new Set(opened.map((database) => database.name)))
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('FrontendWorkshop Source exact writeback integration', () => {
  it('persists one exact S3 range as the next revision and keeps the actual previous Source as last_good', async () => {
    const { storage, service } = createHarness()
    const raw = '😀\r\n<div data-state="old"> keep  </div>\r\n<script>window.x = "  raw  "</script>'
    const source = await service.saveAuthorSource('project-writeback', raw, { now: 100 })
    const analysis = analyzeFrontendWorkshopSource(source)
    const target = analysis.sourceMap.entities.find(
      (entity) =>
        entity.semanticKind === 'html.attribute-value' &&
        entity.provenance.kind === 'static-source' &&
        source.authorSource.slice(
          entity.provenance.anchor.range.start,
          entity.provenance.anchor.range.end,
        ) === 'old',
    )
    if (!target) throw new Error('missing exact Source target')

    const nextSource = applyFrontendWorkshopExactSourceWriteback(source, target, 'next')
    const saved = await service.saveAuthorSourceAtRevision(
      source.projectId,
      source.revision,
      nextSource,
      { now: 200 },
    )

    expect(saved).toMatchObject({ revision: 2, createdAt: 100, updatedAt: 200 })
    expect(saved.authorSource).toBe(
      '😀\r\n<div data-state="next"> keep  </div>\r\n<script>window.x = "  raw  "</script>',
    )
    expect((await storage.getLastGood(source.projectId))?.document).toMatchObject({
      revision: 1,
      authorSource: raw,
    })
  })

  it('rejects a stale revision without modifying the current Source', async () => {
    const { service } = createHarness()
    const first = await service.saveAuthorSource('project-stale', '<div>one</div>', { now: 100 })
    const second = await service.saveAuthorSourceAtRevision(
      first.projectId,
      first.revision,
      '<div>two</div>',
      { now: 200 },
    )

    await expect(
      service.saveAuthorSourceAtRevision(first.projectId, first.revision, '<div>stale</div>', {
        now: 300,
      }),
    ).rejects.toMatchObject({
      name: 'FrontendWorkshopSourceRevisionConflictError',
      projectId: first.projectId,
      expectedRevision: 1,
      actualRevision: 2,
    })
    expect(await service.get(first.projectId)).toEqual(second)
  })

  it('allows exactly one of two concurrent exact writes based on the same revision to win', async () => {
    const { storage, service } = createHarness()
    const first = await service.saveAuthorSource('project-race', '<div>base</div>', { now: 100 })

    const results = await Promise.allSettled([
      service.saveAuthorSourceAtRevision(first.projectId, first.revision, '<div>alpha</div>', {
        now: 200,
      }),
      service.saveAuthorSourceAtRevision(first.projectId, first.revision, '<div>beta</div>', {
        now: 201,
      }),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(FrontendWorkshopSourceRevisionConflictError)

    const current = await service.get(first.projectId)
    expect(current?.revision).toBe(2)
    expect(['<div>alpha</div>', '<div>beta</div>']).toContain(current?.authorSource)
    expect((await storage.getLastGood(first.projectId))?.document).toMatchObject({
      revision: 1,
      authorSource: '<div>base</div>',
    })
  })

  it('prevents the general full-Source save path from racing past an S4 revision write', async () => {
    const { service } = createHarness()
    const first = await service.saveAuthorSource('project-cross-race', '<div>base</div>', {
      now: 100,
    })

    const results = await Promise.allSettled([
      service.saveAuthorSource(first.projectId, '<div>general</div>', { now: 200 }),
      service.saveAuthorSourceAtRevision(first.projectId, first.revision, '<div>exact</div>', {
        now: 201,
      }),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(FrontendWorkshopSourceRevisionConflictError)
    const current = await service.get(first.projectId)
    expect(current?.revision).toBe(2)
    expect(['<div>general</div>', '<div>exact</div>']).toContain(current?.authorSource)
  })

  it('does not create a missing Source Document through the revision writeback path', async () => {
    const { service } = createHarness()

    await expect(
      service.saveAuthorSourceAtRevision('project-missing', 1, '<div>new</div>'),
    ).rejects.toBeInstanceOf(FrontendWorkshopSourceRevisionConflictError)
    expect(await service.get('project-missing')).toBeUndefined()
  })
})
