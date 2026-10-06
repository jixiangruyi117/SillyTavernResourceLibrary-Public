/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../database/AppDatabase'
import { FrontendWorkshopAiLocalStorage } from '../storage/FrontendWorkshopAiLocalStorage'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import { IndexedDbFrontendWorkshopProjectStorage } from '../storage/IndexedDbFrontendWorkshopProjectStorage'
import { FrontendWorkshopSourceDocumentService } from './FrontendWorkshopSourceDocumentService'
import { FrontendWorkshopSourcePatchService } from './FrontendWorkshopSourcePatchService'
import { FrontendWorkshopSourceHistoryService } from './FrontendWorkshopSourceHistoryService'
import { FrontendWorkshopSourceCheckpointService } from './FrontendWorkshopSourceCheckpointService'
import { FrontendWorkshopSourceAiApplicationService } from './FrontendWorkshopSourceAiApplicationService'
import { FrontendWorkshopSourceAiSessionService } from './FrontendWorkshopSourceAiSessionService'
import { FrontendWorkshopSourceAiRecovery } from './FrontendWorkshopSourceAiRecovery'
import { buildFrontendWorkshopSourceAiContext } from '../utils/FrontendWorkshopSourceAiContext'
import { parseFrontendWorkshopSourceAiProposal } from '../utils/FrontendWorkshopSourceAiProposal'

const databases: AppDatabase[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete()
})
function harness() {
  const database = new AppDatabase(`ai-recovery-${crypto.randomUUID()}`)
  databases.push(database)
  const source = new FrontendWorkshopSourceDocumentService(
    new IndexedDbFrontendWorkshopSourceDocumentStorage(database),
  )
  const history = new FrontendWorkshopSourceHistoryService(
    source,
    new FrontendWorkshopSourcePatchService(source),
  )
  const storage = new FrontendWorkshopAiLocalStorage(database)
  const restart = () => {
    const checkpoints = new FrontendWorkshopSourceCheckpointService(source, history)
    const recovery = new FrontendWorkshopSourceAiRecovery(storage)
    const session = new FrontendWorkshopSourceAiSessionService(
      new FrontendWorkshopSourceAiApplicationService(source, history),
      checkpoints,
      recovery,
    )
    return { checkpoints, recovery, session }
  }
  return { source, storage, restart, database }
}

describe('AI durable recovery and real Source application', () => {
  it('continues from manual edits after an AI result while rejecting changes made during a request', async () => {
    const { source, restart } = harness()
    await source.saveAuthorSource('p', '<p>hello</p>', { now: 100 })
    const { session, checkpoints, recovery } = restart()
    async function request(before: string, after: string) {
      const handle = await session.beginRequest('p', '只改文字')
      const base = checkpoints.read('p', handle.baseCheckpointId)
      const bundle = buildFrontendWorkshopSourceAiContext({
        source: base,
        mode: 'edit',
        instruction: '只改文字',
        writeScope: { kind: 'whole-source' },
      })
      session.completeRequest(
        'p',
        handle.requestId,
        bundle,
        parseFrontendWorkshopSourceAiProposal(
          JSON.stringify({
            kind: 'source-ai-proposal',
            projectId: 'p',
            sourceRevision: base.revision,
            edits: [{ expectedText: before, replacement: after }],
          }),
          base,
          bundle,
        ),
      )
      return { handle, base }
    }
    const first = await request('hello', 'AI one')
    await session.applyGeneration('p', first.handle.generationId)
    await source.saveAuthorSourceAtRevision('p', 2, '<p>manual</p><img src="new.png">')
    const next = await request('manual', 'AI two')
    expect(next.base.authorSource).toBe('<p>manual</p><img src="new.png">')
    await session.applyGeneration('p', next.handle.generationId)
    expect((await source.get('p'))?.authorSource).toBe('<p>AI two</p><img src="new.png">')
    const stale = await request('AI two', 'stale')
    await source.saveAuthorSourceAtRevision('p', 4, '<p>newer manual</p>')
    await expect(session.applyGeneration('p', stale.handle.generationId)).rejects.toThrow(
      '当前 Source 已变化',
    )
    expect((await source.get('p'))?.authorSource).toBe('<p>newer manual</p>')
    await recovery.flush('p')
  })
  it('retains the reply in memory and reports storage failure without losing provider text', async () => {
    const { source, storage, restart } = harness()
    const document = await source.saveAuthorSource('p', '<p>hello</p>', { now: 100 })
    const { session, recovery } = restart()
    const handle = await session.beginRequest('p', '修改')
    await recovery.flush('p')
    vi.spyOn(storage, 'write').mockRejectedValue(new Error('本机存储空间不足'))
    session.recordReceipt(
      'p',
      handle.requestId,
      { id: 'r', rawText: '{ received', status: 'invalid' },
      buildFrontendWorkshopSourceAiContext({
        source: document,
        mode: 'edit',
        instruction: '修改',
        writeScope: { kind: 'whole-source' },
      }),
    )
    await recovery.flush('p')
    expect(session.snapshot('p')).toMatchObject({
      error: '本机存储空间不足',
      generations: [{ receipts: [{ rawText: '{ received' }] }],
    })
  })

  it('deletes project recovery with the project and rejects a late journal write', async () => {
    const { source, storage, restart, database } = harness()
    const document = await source.saveAuthorSource('p', '<p>hello</p>', { now: 100 })
    const { session, recovery } = restart()
    const handle = await session.beginRequest('p', '修改')
    await recovery.flush('p')
    await new IndexedDbFrontendWorkshopProjectStorage(database).delete('p')
    session.recordReceipt(
      'p',
      handle.requestId,
      { id: 'r', rawText: 'late text', status: 'complete' },
      buildFrontendWorkshopSourceAiContext({
        source: document,
        mode: 'edit',
        instruction: '修改',
        writeScope: { kind: 'whole-source' },
      }),
    )
    await recovery.flush('p')
    expect(await storage.read('session:p')).toBeUndefined()
    expect(session.snapshot('p').error).toContain('作品已删除')
  })
  it('restores a pending reply without restarting AI or applying Source, rejects late callbacks and clears durably', async () => {
    const { source, restart } = harness()
    const document = await source.saveAuthorSource('p', '<p>hello</p>', { now: 100 })
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: document,
      mode: 'edit',
      instruction: '改字',
      writeScope: { kind: 'whole-source' },
    })
    const first = restart()
    const handle = await first.session.beginRequest('p', '改字')
    first.session.recordReceipt(
      'p',
      handle.requestId,
      { id: 'receipt', rawText: '{partial', status: 'receiving' },
      bundle,
    )
    await first.recovery.flush('p')
    const second = restart()
    await second.session.restore('p')
    expect(second.session.snapshot('p')).toMatchObject({
      pending: false,
      generations: [
        { status: 'failed', receipts: [{ rawText: '{partial', status: 'interrupted' }] },
      ],
    })
    expect((await source.get('p'))?.authorSource).toBe('<p>hello</p>')
    second.session.recordReceipt(
      'p',
      handle.requestId,
      { id: 'receipt', rawText: 'late', status: 'complete' },
      bundle,
    )
    expect(second.session.snapshot('p').generations[0]?.receipts?.[0]?.rawText).toBe('{partial')
    second.session.clear('p')
    await second.recovery.flush('p')
    const third = restart()
    await third.session.restore('p')
    expect(third.session.snapshot('p').generations).toEqual([])
  })

  it('opening another page does not replace an active owner journal or block its completed reply', async () => {
    const { source, storage, restart } = harness()
    const document = await source.saveAuthorSource('p', '<p>hello</p>')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: document,
      mode: 'edit',
      instruction: '改字',
      writeScope: { kind: 'whole-source' },
    })
    const owner = restart()
    const handle = await owner.session.beginRequest('p', '改字')
    await owner.recovery.flush('p')
    const before = await storage.read('session:p')
    const reader = restart()
    await reader.session.restore('p')
    await reader.recovery.flush('p')
    expect(await storage.read('session:p')).toEqual(before)
    owner.session.recordReceipt(
      'p',
      handle.requestId,
      {
        id: 'receipt',
        rawText: 'complete paid reply',
        status: 'complete',
      },
      bundle,
    )
    await owner.recovery.flush('p')
    expect(owner.session.snapshot('p').error).toBeNull()
    const reopened = restart()
    await reopened.session.restore('p')
    expect(reopened.session.snapshot('p').generations[0]?.receipts?.[0]?.rawText).toBe(
      'complete paid reply',
    )
    await reader.session.beginRequest('p', 'stale reader edit')
    await reader.recovery.flush('p')
    expect(reader.session.snapshot('p').error).toContain('另一页面')
  })

  it('restores an unapplied proposal and applies through the original Source/History owner', async () => {
    const { source, restart } = harness()
    const document = await source.saveAuthorSource('p', '<p>hello</p>', { now: 100 })
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: document,
      mode: 'edit',
      instruction: '改字',
      writeScope: { kind: 'whole-source' },
    })
    const first = restart()
    const handle = await first.session.beginRequest('p', '改字')
    const proposal = parseFrontendWorkshopSourceAiProposal(
      JSON.stringify({
        kind: 'source-ai-proposal',
        projectId: 'p',
        sourceRevision: 1,
        edits: [{ expectedText: 'hello', replacement: 'world' }],
      }),
      document,
      bundle,
    )
    first.session.completeRequest('p', handle.requestId, bundle, proposal)
    await first.recovery.flush('p')
    const second = restart()
    await second.session.restore('p')
    expect((await source.get('p'))?.revision).toBe(1)
    await second.session.applyGeneration('p', handle.generationId)
    expect((await source.get('p'))?.authorSource).toBe('<p>world</p>')
    expect((await source.get('p'))?.revision).toBe(2)
    await second.recovery.flush('p')
  })

  it('does not overwrite a newer Source after refreshing and preserves the proposal', async () => {
    const { source, restart } = harness()
    const document = await source.saveAuthorSource('p', '<p>hello</p>', { now: 100 })
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: document,
      mode: 'edit',
      instruction: '改字',
      writeScope: { kind: 'whole-source' },
    })
    const first = restart()
    const handle = await first.session.beginRequest('p', '改字')
    first.session.completeRequest(
      'p',
      handle.requestId,
      bundle,
      parseFrontendWorkshopSourceAiProposal(
        JSON.stringify({
          kind: 'source-ai-proposal',
          projectId: 'p',
          sourceRevision: 1,
          edits: [{ expectedText: 'hello', replacement: 'world' }],
        }),
        document,
        bundle,
      ),
    )
    await first.recovery.flush('p')
    await source.saveAuthorSourceAtRevision('p', 1, '<p>user edit</p>')
    const second = restart()
    await second.session.restore('p')
    await expect(second.session.applyGeneration('p', handle.generationId)).rejects.toThrow()
    expect((await source.get('p'))?.authorSource).toBe('<p>user edit</p>')
    expect(second.session.snapshot('p').generations[0]?.proposal?.edits[0]?.replacement).toBe(
      'world',
    )
    await second.recovery.flush('p')
  })

  it('uses atomic CAS across pages and does not silently replace another page recovery', async () => {
    const { storage, source } = harness()
    await source.saveAuthorSource('p', '<p>base</p>', { now: 100 })
    await storage.write('session:p', { reply: 'first' }, 0)
    await expect(storage.write('session:p', { reply: 'lost' }, 0)).rejects.toThrow(/另一页面/)
    expect((await storage.read('session:p'))?.data).toEqual({ reply: 'first' })
  })
})
