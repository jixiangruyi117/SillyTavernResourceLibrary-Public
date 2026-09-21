import { describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourceAiHostReference } from '../utils/FrontendWorkshopSourceAiContext'
import type { FrontendWorkshopSourceAiTransportResult } from './FrontendWorkshopSourceAiTransportService'
import {
  FrontendWorkshopSourceAiHostReferenceService,
  type FrontendWorkshopSourceAiHostReferenceResolver,
} from './FrontendWorkshopSourceAiHostReferenceService'

function sourceDocument(authorSource = '<div>hello</div>') {
  return createFrontendWorkshopSourceDocument('project-ai-host-ref', authorSource, 100)
}

function result(
  source: ReturnType<typeof sourceDocument>,
  hostReferenceRequests: readonly string[] = [],
): FrontendWorkshopSourceAiTransportResult {
  return {
    rawText: '{}',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      source: 'estimated',
    },
    proposal: {
      kind: 'source-ai-proposal',
      projectId: source.projectId,
      sourceRevision: source.revision,
      summary: hostReferenceRequests.length ? '需要宿主证据' : '完成',
      edits: [],
      hostReferenceRequests,
      warnings: [],
    },
  }
}

function reference(id: string, content = `${id} evidence`): FrontendWorkshopSourceAiHostReference {
  return { id, title: `${id} title`, content }
}

function input(source = sourceDocument()) {
  return {
    source,
    mode: 'edit' as const,
    instruction: '按已验证的宿主能力修改。',
    writeScope: { kind: 'whole-source' as const },
  }
}

describe('FrontendWorkshopSourceAiHostReferenceService', () => {
  it('does not block a read-only plan or spend another provider request on implementation references', async () => {
    const source = sourceDocument()
    const requestProposal = vi.fn().mockResolvedValue(result(source, ['getChatMessages']))
    const resolve = vi.fn()
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )
    const output = await service.request({
      ...input(source),
      mode: 'plan',
      instruction: '设计开场白跳转方案',
      hostResearch: {
        maxAdditionalRequests: 2,
        tavernHelperVersion: '4.9.3',
        sillyTavernVersion: '1.18.0',
      },
    })
    expect(output.status).toBe('completed')
    expect(requestProposal).toHaveBeenCalledOnce()
    expect(resolve).not.toHaveBeenCalled()
    expect(requestProposal.mock.calls[0]![1].writeScope.kind).toBe('read-only')
  })
  const hostResearch = {
    maxAdditionalRequests: 1 as const,
    tavernHelperVersion: '4.9.3',
    sillyTavernVersion: '1.18.0',
  }

  it('accepts a user budget above two and stops at exactly that additional-call count', async () => {
    const source = sourceDocument()
    let call = 0
    const requestProposal = vi
      .fn()
      .mockImplementation(async () => result(source, [`feature-${++call}`]))
    const resolve = vi
      .fn()
      .mockImplementation(async (requests: string[]) =>
        requests.map((request) => ({ request, references: [reference(`online:${request}`)] })),
      )
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )
    const output = await service.request({
      ...input(source),
      hostResearch: { ...hostResearch, maxAdditionalRequests: 5 },
    })
    expect(requestProposal).toHaveBeenCalledTimes(6)
    expect(output).toMatchObject({ blockedReason: 'research-budget-exhausted' })
  })
  it.each([-1, 1.5, NaN, Infinity])(
    'rejects invalid budget %s before calling the provider',
    async (maxAdditionalRequests) => {
      const requestProposal = vi.fn()
      const service = new FrontendWorkshopSourceAiHostReferenceService(
        { requestProposal },
        { resolve: vi.fn() },
      )
      await expect(
        service.request({ ...input(), hostResearch: { ...hostResearch, maxAdditionalRequests } }),
      ).rejects.toThrow('正整数')
      expect(requestProposal).not.toHaveBeenCalled()
    },
  )

  it('continues with evidence only within the explicitly selected budget and same Source', async () => {
    const source = sourceDocument()
    const requestProposal = vi
      .fn()
      .mockResolvedValueOnce(result(source, ['discoverNovelFeature']))
      .mockResolvedValueOnce(result(source))
    const resolve = vi
      .fn()
      .mockResolvedValue([
        { request: 'discoverNovelFeature', references: [reference('online:new')] },
      ])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )
    const output = await service.request({ ...input(source), hostResearch })
    expect(output.status).toBe('completed')
    expect(output.attempts).toHaveLength(2)
    expect(resolve).toHaveBeenCalledWith(['discoverNovelFeature'], {
      signal: undefined,
      online: hostResearch,
    })
    expect(requestProposal.mock.calls[1]![0]).toEqual(source)
    expect(requestProposal.mock.calls[1]![1].messages[1].content).toContain('online:new evidence')
    expect(requestProposal.mock.calls[1]![1].messages[1].content).toContain('discoverNovelFeature')
  })

  it('stops before reading more files when the additional-call budget is exhausted', async () => {
    const source = sourceDocument()
    const requestProposal = vi
      .fn()
      .mockResolvedValueOnce(result(source, ['first']))
      .mockResolvedValueOnce(result(source, ['second']))
    const resolve = vi
      .fn()
      .mockResolvedValue([{ request: 'first', references: [reference('online:first')] }])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )
    const output = await service.request({ ...input(source), hostResearch })
    expect(output).toMatchObject({
      status: 'needs-host-reference',
      blockedReason: 'research-budget-exhausted',
      unresolvedRequests: ['second'],
    })
    expect(requestProposal).toHaveBeenCalledTimes(2)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(output.attempts).toHaveLength(2)
  })

  it('stops repeated model requests without spending the remaining budget', async () => {
    const source = sourceDocument()
    const requestProposal = vi.fn().mockResolvedValue(result(source, ['same']))
    const resolve = vi
      .fn()
      .mockResolvedValue([{ request: 'same', references: [reference('online:same')] }])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )
    const output = await service.request({
      ...input(source),
      hostResearch: { ...hostResearch, maxAdditionalRequests: 2 },
    })
    expect(output).toMatchObject({ blockedReason: 'research-no-progress' })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(requestProposal).toHaveBeenCalledTimes(2)
  })

  it.each(['network', 'provider'])(
    'retains the previous reply after a %s failure',
    async (failure) => {
      const source = sourceDocument()
      const original = result(source, ['api'])
      original.rawText = 'already received'
      const requestProposal = vi
        .fn()
        .mockResolvedValueOnce(original)
        .mockRejectedValueOnce(new Error('failed'))
      const resolve = vi.fn()
      if (failure === 'network') resolve.mockRejectedValue(new Error('offline'))
      else resolve.mockResolvedValue([{ request: 'api', references: [reference('online:api')] }])
      const service = new FrontendWorkshopSourceAiHostReferenceService(
        { requestProposal },
        { resolve },
      )
      const output = await service.request({ ...input(source), hostResearch })
      expect(output).toMatchObject({ blockedReason: 'research-failed' })
      expect(output.attempts[0]!.result.rawText).toBe('already received')
      expect(output.attempts).toHaveLength(1)
    },
  )

  it('does not mix the old catalog into a different requested host version', async () => {
    const source = sourceDocument('getVariables()')
    const requestProposal = vi.fn().mockResolvedValue(result(source))
    const resolve = vi.fn()
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )
    await service.request({
      ...input(source),
      hostResearch: { ...hostResearch, tavernHelperVersion: '4.9.5' },
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('cancels between lookup and follow-up without another provider call', async () => {
    const source = sourceDocument()
    const controller = new AbortController()
    const requestProposal = vi.fn().mockResolvedValue(result(source, ['api']))
    const resolve = vi.fn(async () => {
      controller.abort()
      return [{ request: 'api', references: [reference('online:api')] }]
    })
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )
    await expect(
      service.request({ ...input(source), hostResearch }, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestProposal).toHaveBeenCalledOnce()
  })

  it('returns the first validated proposal directly when no Host Reference is requested', async () => {
    const source = sourceDocument()
    const requestProposal = vi.fn().mockResolvedValue(result(source))
    const resolver: FrontendWorkshopSourceAiHostReferenceResolver = {
      resolve: vi.fn(),
    }
    const service = new FrontendWorkshopSourceAiHostReferenceService({ requestProposal }, resolver)

    const output = await service.request(input(source))

    expect(output.status).toBe('completed')
    expect(output.attempts).toHaveLength(1)
    expect(output.resolvedReferences).toEqual([])
    expect(resolver.resolve).not.toHaveBeenCalled()
    expect(requestProposal).toHaveBeenCalledTimes(1)
  })

  it('resolves requested references locally and waits for explicit consent before another provider request', async () => {
    const source = sourceDocument()
    const requestProposal = vi
      .fn()
      .mockResolvedValueOnce(result(source, ['TavernHelper setChatMessages signature']))
      .mockResolvedValueOnce(result(source))
    const resolve = vi.fn().mockResolvedValue([
      {
        request: 'TavernHelper setChatMessages signature',
        references: [reference('th:set-chat', 'verified setChatMessages excerpt')],
      },
    ])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )
    const original = input(source)

    const output = await service.request(original)

    expect(output).toMatchObject({
      status: 'needs-host-reference',
      unresolvedRequests: ['TavernHelper setChatMessages signature'],
      retryExhausted: false,
      blockedReason: 'additional-provider-consent-required',
    })
    expect(output.attempts).toHaveLength(1)
    expect(output.resolvedReferences.map((item) => item.id)).toEqual(['th:set-chat'])
    expect(requestProposal).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith(['TavernHelper setChatMessages signature'], {
      signal: undefined,
    })
    expect(original).not.toHaveProperty('hostReferences')
  })

  it('does not spend a second provider request when any requested reference is unresolved', async () => {
    const source = sourceDocument()
    const requestProposal = vi
      .fn()
      .mockResolvedValue(result(source, ['known request', 'missing request']))
    const resolve = vi.fn().mockResolvedValue([
      { request: 'known request', references: [reference('known')] },
      { request: 'missing request', references: [] },
    ])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )

    const output = await service.request(input(source))

    expect(output).toMatchObject({
      status: 'needs-host-reference',
      unresolvedRequests: ['missing request'],
      retryExhausted: false,
      blockedReason: 'additional-provider-consent-required',
    })
    expect(output.attempts).toHaveLength(1)
    expect(output.resolvedReferences.map((item) => item.id)).toEqual(['known'])
    expect(requestProposal).toHaveBeenCalledTimes(1)
  })

  it('does not call the provider when locally prefetched evidence exceeds the prompt budget', async () => {
    const source = sourceDocument()
    const requestProposal = vi.fn().mockResolvedValue(result(source))
    const resolve = vi.fn().mockResolvedValue([
      {
        request: 'worldbook',
        references: [reference('large', 'X'.repeat(100))],
      },
    ])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )

    const output = await service.request({
      ...input(source),
      instruction: '请读取 worldbook 后修改。',
      options: { maxHostReferenceTextUnits: 10 },
    })

    expect(output).toMatchObject({
      status: 'needs-host-reference',
      unresolvedRequests: ['worldbook'],
      retryExhausted: false,
      blockedReason: 'context-truncated',
    })
    expect(output.attempts).toHaveLength(0)
    expect(output.resolvedReferences.map((item) => item.id)).toEqual(['large'])
    expect(requestProposal).not.toHaveBeenCalled()
  })

  it('never performs an automatic second provider request', async () => {
    const source = sourceDocument()
    const requestProposal = vi
      .fn()
      .mockResolvedValueOnce(result(source, ['first evidence']))
      .mockResolvedValueOnce(result(source, ['second evidence']))
    const resolve = vi
      .fn()
      .mockResolvedValue([{ request: 'first evidence', references: [reference('first')] }])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )

    const output = await service.request(input(source))

    expect(output).toMatchObject({
      status: 'needs-host-reference',
      unresolvedRequests: ['first evidence'],
      retryExhausted: false,
      blockedReason: 'additional-provider-consent-required',
    })
    expect(output.attempts).toHaveLength(1)
    expect(requestProposal).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('propagates provider failure without automatic retry', async () => {
    const source = sourceDocument()
    const requestProposal = vi.fn().mockRejectedValue(new Error('fixture-provider-failure'))
    const resolve = vi.fn()
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )

    await expect(service.request(input(source))).rejects.toThrow('fixture-provider-failure')
    expect(requestProposal).toHaveBeenCalledTimes(1)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('normalizes duplicate model requests before calling the resolver', async () => {
    const source = sourceDocument()
    const requestProposal = vi
      .fn()
      .mockResolvedValueOnce(result(source, ['same request', 'same request']))
      .mockResolvedValueOnce(result(source))
    const resolve = vi
      .fn()
      .mockResolvedValue([{ request: 'same request', references: [reference('same')] }])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )

    await service.request(input(source))

    expect(resolve).toHaveBeenCalledWith(['same request'], { signal: undefined })
    expect(requestProposal).toHaveBeenCalledTimes(1)
  })

  it('rejects resolver output for unrequested or duplicated requests', async () => {
    const source = sourceDocument()
    const requestProposal = vi.fn().mockResolvedValue(result(source, ['requested']))

    const extra = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      {
        resolve: vi
          .fn()
          .mockResolvedValue([{ request: 'not requested', references: [reference('extra')] }]),
      },
    )
    await expect(extra.request(input(source))).rejects.toThrow(/非法 resolution entry/)

    const duplicated = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      {
        resolve: vi.fn().mockResolvedValue([
          { request: 'requested', references: [reference('one')] },
          { request: 'requested', references: [reference('two')] },
        ]),
      },
    )
    await expect(duplicated.request(input(source))).rejects.toThrow(/重复返回 request/)
  })

  it('does not treat empty reference content as resolved Host evidence', async () => {
    const source = sourceDocument()
    const requestProposal = vi.fn().mockResolvedValue(result(source, ['requested']))
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      {
        resolve: vi
          .fn()
          .mockResolvedValue([{ request: 'requested', references: [reference('empty', '   ')] }]),
      },
    )

    await expect(service.request(input(source))).rejects.toThrow(/reference content/)
    expect(requestProposal).toHaveBeenCalledTimes(1)
  })

  it('rejects conflicting reference ids instead of silently replacing evidence', async () => {
    const source = sourceDocument()
    const requestProposal = vi.fn().mockResolvedValue(result(source, ['requested']))
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      {
        resolve: vi.fn().mockResolvedValue([
          {
            request: 'requested',
            references: [reference('same-id', 'first'), reference('same-id', 'different')],
          },
        ]),
      },
    )

    await expect(service.request(input(source))).rejects.toThrow(/id 冲突/)
  })

  it('passes the caller AbortSignal to the single transport call and local resolver', async () => {
    const source = sourceDocument()
    const controller = new AbortController()
    const requestProposal = vi
      .fn()
      .mockResolvedValueOnce(result(source, ['requested']))
      .mockResolvedValueOnce(result(source))
    const resolve = vi
      .fn()
      .mockResolvedValue([{ request: 'requested', references: [reference('signal')] }])
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )

    await service.request(input(source), undefined, { signal: controller.signal })

    expect(requestProposal.mock.calls[0]?.[3]?.signal).toBe(controller.signal)
    expect(resolve).toHaveBeenCalledWith(['requested'], { signal: controller.signal })
  })
})
