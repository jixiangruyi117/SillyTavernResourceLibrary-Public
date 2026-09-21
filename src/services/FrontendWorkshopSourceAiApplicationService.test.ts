/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  buildFrontendWorkshopSourceAiContext,
  type FrontendWorkshopSourceAiContextBundle,
} from '../utils/FrontendWorkshopSourceAiContext'
import {
  parseFrontendWorkshopSourceAiProposal,
  type FrontendWorkshopSourceAiProposal,
} from '../utils/FrontendWorkshopSourceAiProposal'
import {
  FrontendWorkshopSourceAiApplicationService,
  FrontendWorkshopSourceAiHostReferencePendingError,
} from './FrontendWorkshopSourceAiApplicationService'
import { FrontendWorkshopSourceDocumentService } from './FrontendWorkshopSourceDocumentService'
import { FrontendWorkshopSourceHistoryService } from './FrontendWorkshopSourceHistoryService'
import { FrontendWorkshopSourcePatchService } from './FrontendWorkshopSourcePatchService'

const databases: AppDatabase[] = []

function createHarness() {
  const database = new AppDatabase(`frontend-workshop-source-ai-application-${crypto.randomUUID()}`)
  databases.push(database)
  const storage = new IndexedDbFrontendWorkshopSourceDocumentStorage(database)
  const sourceService = new FrontendWorkshopSourceDocumentService(storage)
  const patchService = new FrontendWorkshopSourcePatchService(sourceService)
  const historyService = new FrontendWorkshopSourceHistoryService(sourceService, patchService)
  const applicationService = new FrontendWorkshopSourceAiApplicationService(
    sourceService,
    historyService,
  )
  return { sourceService, historyService, applicationService }
}

function validatedProposal(
  source: FrontendWorkshopSourceDocument,
  bundle: FrontendWorkshopSourceAiContextBundle,
  input: {
    summary?: string
    edits?: Array<{
      start: number
      end: number
      expectedText: string
      replacement: string
      reason?: string
    }>
    hostReferenceRequests?: string[]
    warnings?: string[]
  },
): FrontendWorkshopSourceAiProposal {
  return parseFrontendWorkshopSourceAiProposal(
    JSON.stringify({
      kind: 'source-ai-proposal',
      projectId: source.projectId,
      sourceRevision: source.revision,
      summary: input.summary ?? '应用 AI 修改',
      edits: (input.edits ?? []).map((edit) => ({
        ...edit,
        reason: edit.reason ?? '按请求修改',
      })),
      hostReferenceRequests: input.hostReferenceRequests ?? [],
      warnings: input.warnings ?? [],
    }),
    source,
    bundle,
  )
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = Array.from(new Set(opened.map((database) => database.name)))
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('FrontendWorkshopSourceAiApplicationService', () => {
  it('materializes a generation candidate from its immutable base through one current History/CAS patch', async () => {
    const { sourceService, historyService, applicationService } = createHarness()
    const base = await sourceService.saveAuthorSource(
      'project-ai-generation-materialize',
      '<div>hello</div>',
      { now: 100 },
    )
    const start = base.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: base,
      mode: 'edit',
      instruction: '把 hello 改成 world。',
      writeScope: { kind: 'whole-source' },
    })
    const proposal = validatedProposal(base, bundle, {
      edits: [{ start, end: start + 5, expectedText: 'hello', replacement: 'world' }],
    })

    const applied = await applicationService.applyValidatedProposalFromBase(
      base,
      base,
      bundle,
      proposal,
      { save: { now: 200 } },
    )

    expect(applied?.document.authorSource).toBe('<div>world</div>')
    expect(applied?.document.revision).toBe(2)
    expect(historyService.status(base.projectId)).toMatchObject({ entryCount: 1, canUndo: true })
  })

  it('fails closed when authoritative Source differs from the expected materialized generation', async () => {
    const { sourceService, historyService, applicationService } = createHarness()
    const base = await sourceService.saveAuthorSource(
      'project-ai-generation-stale',
      '<div>hello</div>',
      { now: 100 },
    )
    const start = base.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: base,
      mode: 'edit',
      instruction: '把 hello 改成 world。',
      writeScope: { kind: 'whole-source' },
    })
    const proposal = validatedProposal(base, bundle, {
      edits: [{ start, end: start + 5, expectedText: 'hello', replacement: 'world' }],
    })
    const newer = await sourceService.saveAuthorSourceAtRevision(
      base.projectId,
      base.revision,
      '<div>external</div>',
      { now: 150 },
    )

    await expect(
      applicationService.applyValidatedProposalFromBase(base, base, bundle, proposal),
    ).rejects.toThrow('当前 Source 已变化')
    expect(await sourceService.get(base.projectId)).toEqual(newer)
    expect(historyService.status(base.projectId).entryCount).toBe(0)
  })

  it('revalidates and applies several AI edits through one History/Patch/CAS revision that Undo can reverse', async () => {
    const { sourceService, historyService, applicationService } = createHarness()
    const raw = '<div class="card">hello <span>red</span></div>'
    const source = await sourceService.saveAuthorSource('project-ai-application', raw, { now: 100 })
    const helloStart = source.authorSource.indexOf('hello')
    const redStart = source.authorSource.indexOf('red')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '把 hello 改成 hi，并把 red 改成 blue。',
      writeScope: {
        kind: 'ranges',
        ranges: [
          { start: helloStart, end: helloStart + 5 },
          { start: redStart, end: redStart + 3 },
        ],
      },
    })
    const proposal = validatedProposal(source, bundle, {
      edits: [
        {
          start: helloStart,
          end: helloStart + 5,
          expectedText: 'hello',
          replacement: 'hi',
        },
        {
          start: redStart,
          end: redStart + 3,
          expectedText: 'red',
          replacement: 'blue',
        },
      ],
    })

    const applied = await applicationService.applyValidatedProposal(bundle, proposal, {
      save: { now: 200 },
    })

    expect(applied.document).toMatchObject({ revision: 2, createdAt: 100, updatedAt: 200 })
    expect(applied.document.authorSource).toBe('<div class="card">hi <span>blue</span></div>')
    expect(applied.receipt).toMatchObject({
      projectId: source.projectId,
      fromRevision: 1,
      toRevision: 2,
    })
    expect(applied.receipt.changes).toHaveLength(2)
    expect(historyService.status(source.projectId)).toMatchObject({
      expectedRevision: 2,
      entryCount: 1,
      cursor: 1,
      canUndo: true,
      canRedo: false,
    })

    const undone = await historyService.undo(source.projectId, { now: 300 })
    expect(undone).toMatchObject({ revision: 3, createdAt: 100, updatedAt: 300 })
    expect(undone?.authorSource).toBe(raw)
  })

  it('fails closed when the authoritative Source revision advanced after proposal validation', async () => {
    const { sourceService, historyService, applicationService } = createHarness()
    const source = await sourceService.saveAuthorSource(
      'project-ai-application-stale',
      '<div>hello</div>',
      { now: 100 },
    )
    const start = source.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '把 hello 改成 world。',
      writeScope: { kind: 'ranges', ranges: [{ start, end: start + 5 }] },
    })
    const proposal = validatedProposal(source, bundle, {
      edits: [{ start, end: start + 5, expectedText: 'hello', replacement: 'world' }],
    })
    const newer = await sourceService.saveAuthorSourceAtRevision(
      source.projectId,
      source.revision,
      '<div>newer</div>',
      { now: 200 },
    )

    const applying = applicationService.applyValidatedProposal(bundle, proposal)
    await expect(applying).rejects.toThrow(/Context Bundle 已失效|sourceRevision 已失效/)
    expect(await sourceService.get(source.projectId)).toEqual(newer)
    expect(historyService.status(source.projectId).entryCount).toBe(0)
  })

  it('rechecks Write Scope at application time instead of trusting a mutated validated proposal', async () => {
    const { sourceService, historyService, applicationService } = createHarness()
    const source = await sourceService.saveAuthorSource(
      'project-ai-application-scope',
      '<div>hello world</div>',
      { now: 100 },
    )
    const helloStart = source.authorSource.indexOf('hello')
    const worldStart = source.authorSource.indexOf('world')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit-selection',
      instruction: '只改 hello。',
      writeScope: {
        kind: 'ranges',
        ranges: [{ start: helloStart, end: helloStart + 5 }],
      },
    })
    const proposal = validatedProposal(source, bundle, {
      edits: [
        {
          start: helloStart,
          end: helloStart + 5,
          expectedText: 'hello',
          replacement: 'hi',
        },
      ],
    })
    const tampered: FrontendWorkshopSourceAiProposal = {
      ...proposal,
      edits: [
        {
          ...proposal.edits[0]!,
          start: worldStart,
          end: worldStart + 5,
          expectedText: 'world',
          replacement: 'earth',
        },
      ],
    }

    const applying = applicationService.applyValidatedProposal(bundle, tampered)
    await expect(applying).rejects.toThrow(/超出当前 Write Scope/)
    expect((await sourceService.get(source.projectId))?.authorSource).toBe(source.authorSource)
    expect(historyService.status(source.projectId).entryCount).toBe(0)
  })

  it('refuses application while Host Reference evidence is still pending', async () => {
    const { sourceService, historyService, applicationService } = createHarness()
    const source = await sourceService.saveAuthorSource(
      'project-ai-application-host-reference',
      '<script>refresh()</script>',
      { now: 100 },
    )
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'runtime-fix',
      instruction: '确认宿主刷新 API 后再修改。',
      writeScope: { kind: 'whole-source' },
      runtimeError: { kind: 'script-error', message: 'refresh is not defined' },
      runtimeDiagnostics: [
        {
          category: 'runtime',
          severity: 'error',
          title: 'Runtime 错误',
          message: 'refresh is not defined',
        },
      ],
    })
    const proposal = validatedProposal(source, bundle, {
      edits: [],
      hostReferenceRequests: ['TavernHelper 消息刷新 API'],
    })

    const applying = applicationService.applyValidatedProposal(bundle, proposal)
    await expect(applying).rejects.toBeInstanceOf(FrontendWorkshopSourceAiHostReferencePendingError)
    expect(await sourceService.get(source.projectId)).toEqual(source)
    expect(historyService.status(source.projectId).entryCount).toBe(0)
  })

  it('does not create a History entry for a proposal with no applicable edits', async () => {
    const { sourceService, historyService, applicationService } = createHarness()
    const source = await sourceService.saveAuthorSource(
      'project-ai-application-empty',
      '<div>hello</div>',
      { now: 100 },
    )
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'explain',
      instruction: '解释当前 Source。',
      writeScope: { kind: 'read-only' },
    })
    const proposal = validatedProposal(source, bundle, { edits: [] })

    const applying = applicationService.applyValidatedProposal(bundle, proposal)
    await expect(applying).rejects.toThrow(/没有可应用的 edits/)
    expect(historyService.status(source.projectId).entryCount).toBe(0)
  })
})
