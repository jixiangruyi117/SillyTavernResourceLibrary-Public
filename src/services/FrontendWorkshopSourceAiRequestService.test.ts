/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { buildFrontendWorkshopSourceAiContext } from '../utils/FrontendWorkshopSourceAiContext'
import {
  FrontendWorkshopSourceAiRequestService,
  type FrontendWorkshopSourceAiHostReferenceRequester,
  type FrontendWorkshopSourceAiSharedSession,
} from './FrontendWorkshopSourceAiRequestService'
import type {
  FrontendWorkshopSourceAiGeneration,
  FrontendWorkshopSourceAiSessionSnapshot,
} from './FrontendWorkshopSourceAiSessionService'

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'provider' as const }

function emptySnapshot(projectId = 'project'): FrontendWorkshopSourceAiSessionSnapshot {
  return {
    projectId,
    turns: [],
    generations: [],
    activeGenerationId: null,
    materializedGenerationId: null,
    pending: false,
    applying: false,
    error: null,
  }
}

function noContinuationResolver() {
  return vi.fn(async () => ({ resolvedReferences: [], unresolvedRequests: [] }))
}

function requestHandle(baseCheckpointId = 'base') {
  return {
    requestId: 'request',
    turnId: 'turn',
    generationId: 'generation',
    baseCheckpointId,
    conversation: [],
    referenceImages: [],
    signal: new AbortController().signal,
  }
}

function completedHost(): FrontendWorkshopSourceAiHostReferenceRequester {
  return {
    resolveRequestedReferences: noContinuationResolver(),
    request: vi.fn(async (input) => ({
      status: 'completed' as const,
      resolvedReferences: input.hostReferences ?? [],
      attempts: [
        {
          bundle: buildFrontendWorkshopSourceAiContext(input),
          result: {
            rawText: '{}',
            usage,
            proposal: {
              kind: 'source-ai-proposal' as const,
              projectId: input.source.projectId,
              sourceRevision: input.source.revision,
              summary: '完成',
              edits: [],
              hostReferenceRequests: [],
              warnings: [],
            },
          },
        },
      ],
    })),
  }
}

describe('FrontendWorkshopSourceAiRequestService S7R', () => {
  it.each([false, true])('修复携带原文与原范围且不增加调用预算，过期=%s', async (stale) => {
    const source = createFrontendWorkshopSourceDocument('project', '<div>hello</div>', 100)
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit-selection',
      instruction: '只改文字',
      hostResearch: {
        maxAdditionalRequests: 1,
        tavernHelperVersion: '4.9.3',
        sillyTavernVersion: '1.18.0',
      },
      writeScope: { kind: 'ranges', ranges: [{ start: 5, end: 10 }] },
    })
    const original: FrontendWorkshopSourceAiGeneration = {
      id: 'failed',
      turnId: 'turn',
      ordinal: 1,
      status: 'failed',
      assistantContent: '解析失败',
      summary: '',
      bundle,
      proposal: null,
      unresolvedHostReferenceRequests: [],
      diagnostics: null,
      createdAt: 1,
      receipts: [
        {
          id: 'raw',
          status: 'invalid',
          rawText: '{broken original design',
          error: 'expectedText 已失效',
        },
      ],
    }
    const snapshot = {
      ...emptySnapshot(),
      generations: [original],
      turns: [
        {
          id: 'turn',
          content: '只改文字',
          referenceImages: [],
          baseCheckpointId: 'base',
          generationIds: ['failed'],
          createdAt: 1,
        },
      ],
    }
    const session: FrontendWorkshopSourceAiSharedSession = {
      snapshot: () => snapshot,
      beginRequest: vi.fn(async () => requestHandle()),
      completeRequest: vi.fn(() => 'repaired'),
      failRequest: vi.fn(() => true),
    }
    const host = completedHost()
    const service = new FrontendWorkshopSourceAiRequestService(
      { get: async () => (stale ? { ...source, revision: 2 } : source) },
      session,
      host,
      { read: () => source },
    )
    const result = service.request({
      projectId: 'project',
      mode: 'edit',
      instruction: '不应扩大范围',
      writeScope: { kind: 'whole-source' },
      session: { kind: 'repair', generationId: 'failed' },
      hostResearch: {
        maxAdditionalRequests: 2,
        tavernHelperVersion: '4.9.3',
        sillyTavernVersion: '1.18.0',
      },
    })
    if (stale) {
      await expect(result).rejects.toThrow('作品已变化')
      expect(host.request).not.toHaveBeenCalled()
    } else {
      await expect(result).resolves.toMatchObject({ accepted: true, generationId: 'repaired' })
      expect(host.request).toHaveBeenCalledTimes(1)
      expect(host.request).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'edit-selection',
          instruction: '只改文字',
          writeScope: { kind: 'ranges', ranges: [{ start: 5, end: 10 }] },
          replyRepair: expect.objectContaining({
            rawText: '{broken original design',
            error: 'expectedText 已失效',
          }),
          hostResearch: expect.objectContaining({ maxAdditionalRequests: 0 }),
        }),
        undefined,
        expect.anything(),
      )
      const context = buildFrontendWorkshopSourceAiContext(
        vi.mocked(host.request).mock.calls[0]![0],
      )
      expect(context.messages[1]?.content).toContain('{broken original design')
      expect(context.messages[0]?.content).not.toContain('{broken original design')
    }
    expect(original.receipts?.[0]?.rawText).toBe('{broken original design')
  })

  it('没有失败原文时拒绝修复且不创建请求', async () => {
    const session: FrontendWorkshopSourceAiSharedSession = {
      snapshot: () => emptySnapshot(),
      beginRequest: vi.fn(),
      completeRequest: vi.fn(),
      failRequest: vi.fn(),
    }
    const host = completedHost()
    const service = new FrontendWorkshopSourceAiRequestService({ get: vi.fn() }, session, host, {
      read: vi.fn(),
    })
    await expect(
      service.request({
        projectId: 'project',
        mode: 'edit',
        instruction: '修复',
        session: { kind: 'repair', generationId: 'missing' },
      }),
    ).rejects.toThrow('没有可修复')
    expect(session.beginRequest).not.toHaveBeenCalled()
    expect(host.request).not.toHaveBeenCalled()
  })

  it('范围被确认后 Source 更新时，在 Provider 请求前拒绝过期范围', async () => {
    const source = createFrontendWorkshopSourceDocument('project', '<div>current</div>', 100)
    const session: FrontendWorkshopSourceAiSharedSession = {
      snapshot: vi.fn(() => emptySnapshot()),
      beginRequest: vi.fn(async () => requestHandle()),
      completeRequest: vi.fn(() => 'generation'),
      failRequest: vi.fn(() => true),
    }
    const host = completedHost()
    const service = new FrontendWorkshopSourceAiRequestService(
      { get: vi.fn(async () => ({ ...source, revision: 2 })) },
      session,
      host,
      { read: vi.fn(() => source) },
    )
    await expect(
      service.request({
        projectId: 'project',
        mode: 'edit',
        instruction: '修改所选',
        expectedSource: { revision: 1, createdAt: 100 },
        writeScope: { kind: 'ranges', ranges: [{ start: 0, end: 5 }] },
      }),
    ).rejects.toThrow('Source 已变化')
    expect(host.request).not.toHaveBeenCalled()
    expect(session.completeRequest).not.toHaveBeenCalled()
  })

  it('从 generation 的共享 checkpoint 基线请求并只传当前 branch conversation', async () => {
    const current = {
      ...createFrontendWorkshopSourceDocument('project', '<div>current</div>', 100),
      revision: 3,
    }
    const base = createFrontendWorkshopSourceDocument('project', '<div>base</div>', 100)
    const referenceImages = [
      {
        id: 'image-1',
        name: 'reference.png',
        mimeType: 'image/png' as const,
        dataUrl: 'data:image/png;base64,AA==',
        size: 1,
      },
    ]
    const session: FrontendWorkshopSourceAiSharedSession = {
      snapshot: vi.fn(() => emptySnapshot()),
      beginRequest: vi.fn(async () => ({
        ...requestHandle('base-1'),
        requestId: 'request-1',
        turnId: 'turn-1',
        generationId: 'generation-2',
        conversation: [
          { role: 'user' as const, content: '先前问题' },
          { role: 'assistant' as const, content: '先前回答' },
        ],
        referenceImages,
      })),
      completeRequest: vi.fn(() => 'generation-2'),
      failRequest: vi.fn(() => true),
    }
    const host = completedHost()
    const service = new FrontendWorkshopSourceAiRequestService(
      { get: vi.fn(async () => current) },
      session,
      host,
      { read: vi.fn(() => base) },
    )

    const result = await service.request({
      projectId: 'project',
      mode: 'explain',
      instruction: '继续',
      writeScope: { kind: 'read-only' },
      referenceImages,
      session: { kind: 'regenerate', generationId: 'generation-1' },
    })

    expect(result).toMatchObject({ accepted: true, generationId: 'generation-2' })
    expect(session.beginRequest).toHaveBeenCalledWith('project', '继续', {
      kind: 'regenerate',
      generationId: 'generation-1',
      referenceImages,
    })
    expect(vi.mocked(host.request).mock.calls[0]?.[0]).toMatchObject({
      source: base,
      conversation: [
        { role: 'user', content: '先前问题' },
        { role: 'assistant', content: '先前回答' },
      ],
      referenceImages,
    })
    expect(host.resolveRequestedReferences).not.toHaveBeenCalled()
  })

  it('只有用户重新生成被 Host Reference 阻塞的 generation 才补资料并额外发起一次 provider request', async () => {
    const source = createFrontendWorkshopSourceDocument('project', '<main>fixture</main>', 100)
    const blocked: FrontendWorkshopSourceAiGeneration = {
      id: 'blocked-generation',
      turnId: 'blocked-turn',
      ordinal: 1,
      status: 'needs-host-reference',
      assistantContent: '需要资料',
      summary: '需要资料',
      bundle: null,
      proposal: null,
      unresolvedHostReferenceRequests: ['worldbook'],
      blockedReason: 'additional-provider-consent-required',
      diagnostics: null,
      createdAt: 100,
    }
    const session: FrontendWorkshopSourceAiSharedSession = {
      snapshot: vi.fn(() => ({ ...emptySnapshot(), generations: [blocked] })),
      beginRequest: vi.fn(async () => requestHandle()),
      completeRequest: vi.fn(() => 'generation'),
      failRequest: vi.fn(() => true),
    }
    const resolveRequestedReferences = vi.fn(async () => ({
      resolvedReferences: [
        { id: 'fixture:worldbook', title: 'Worldbook fixture', content: 'local fixture reference' },
      ],
      unresolvedRequests: [],
    }))
    const host = completedHost()
    host.resolveRequestedReferences = resolveRequestedReferences
    const service = new FrontendWorkshopSourceAiRequestService(
      { get: vi.fn(async () => source) },
      session,
      host,
      { read: vi.fn(() => source) },
    )

    await service.request({
      projectId: 'project',
      mode: 'edit',
      instruction: '继续完成',
      writeScope: { kind: 'whole-source' },
      session: { kind: 'regenerate', generationId: 'blocked-generation' },
    })

    expect(resolveRequestedReferences).toHaveBeenCalledTimes(1)
    expect(resolveRequestedReferences).toHaveBeenCalledWith(['worldbook'], {
      signal: expect.any(AbortSignal),
    })
    expect(host.request).toHaveBeenCalledTimes(1)
    expect(vi.mocked(host.request).mock.calls[0]?.[0].hostReferences).toEqual([
      { id: 'fixture:worldbook', title: 'Worldbook fixture', content: 'local fixture reference' },
    ])
  })

  it('基线 lineage 与 authoritative Source 不一致时 fail closed', async () => {
    const current = createFrontendWorkshopSourceDocument('project', 'current', 200)
    const base = createFrontendWorkshopSourceDocument('project', 'base', 100)
    const session: FrontendWorkshopSourceAiSharedSession = {
      snapshot: vi.fn(() => emptySnapshot()),
      beginRequest: vi.fn(async () => requestHandle()),
      completeRequest: vi.fn(),
      failRequest: vi.fn(() => true),
    }
    const host = completedHost()
    const service = new FrontendWorkshopSourceAiRequestService(
      { get: vi.fn(async () => current) },
      session,
      host,
      { read: vi.fn(() => base) },
    )

    await expect(
      service.request({
        projectId: 'project',
        mode: 'edit',
        instruction: '改',
        writeScope: { kind: 'whole-source' },
      }),
    ).rejects.toThrow('lineage 已失效')
    expect(host.request).not.toHaveBeenCalled()
    expect(session.failRequest).toHaveBeenCalled()
  })

  it('把 runtime-fix 的真实 error 与 Diagnostics 连同 checkpoint Source 交给唯一 Host Reference 链', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'project',
      '<script>refresh()</script>',
      100,
    )
    const session: FrontendWorkshopSourceAiSharedSession = {
      snapshot: vi.fn(() => emptySnapshot()),
      beginRequest: vi.fn(async () => requestHandle('base-runtime')),
      completeRequest: vi.fn(() => 'generation'),
      failRequest: vi.fn(() => true),
    }
    const host = completedHost()
    const service = new FrontendWorkshopSourceAiRequestService(
      { get: vi.fn(async () => source) },
      session,
      host,
      { read: vi.fn(() => source) },
    )

    await service.request({
      projectId: 'project',
      mode: 'runtime-fix',
      instruction: '修复当前运行错误，并保持现有功能与视觉不变。',
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

    expect(host.request).toHaveBeenCalledWith(
      expect.objectContaining({
        source,
        mode: 'runtime-fix',
        runtimeError: { kind: 'script-error', message: 'refresh is not defined' },
        runtimeDiagnostics: [expect.objectContaining({ category: 'runtime' })],
      }),
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
