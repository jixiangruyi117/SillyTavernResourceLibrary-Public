import { describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type {
  FrontendWorkshopSourceAiContextInput,
  FrontendWorkshopSourceAiHostReference,
} from '../utils/FrontendWorkshopSourceAiContext'
import type { FrontendWorkshopSourceAiTransportResult } from './FrontendWorkshopSourceAiTransportService'
import type { MainApiConfig, MainApiRequestOptions } from './MainApiService'
import { FrontendWorkshopSourceAiHostReferenceService } from './FrontendWorkshopSourceAiHostReferenceService'

function proposalResult(
  source: ReturnType<typeof createFrontendWorkshopSourceDocument>,
  hostReferenceRequests: readonly string[] = [],
): FrontendWorkshopSourceAiTransportResult {
  return {
    rawText: '{}',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      source: 'estimated',
    },
    proposal: {
      kind: 'source-ai-proposal',
      projectId: source.projectId,
      sourceRevision: source.revision,
      summary: hostReferenceRequests.length ? 'need evidence' : 'done',
      edits: [],
      hostReferenceRequests,
      warnings: [],
    },
  }
}

function reference(id: string, content: string): FrontendWorkshopSourceAiHostReference {
  return { id, title: `${id} title`, content }
}

describe('FrontendWorkshopSourceAiHostReferenceService request snapshots', () => {
  it('keeps the original typed input snapshot and never retries automatically after resolver mutation', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'project-ai-host-snapshot',
      '<div>hello</div>',
      100,
    )
    const original: FrontendWorkshopSourceAiContextInput = {
      source,
      mode: 'edit',
      instruction: 'original instruction',
      writeScope: { kind: 'ranges', ranges: [{ start: 0, end: 5 }] },
      hostReferences: [reference('existing', 'original existing evidence')],
      conversation: [{ role: 'user', content: 'original conversation' }],
      options: { maxHostReferenceTextUnits: 2_000 },
    }
    const override: Partial<MainApiConfig> = { model: 'model-before' }
    const controller = new AbortController()
    const requestOptions: MainApiRequestOptions = {
      timeoutMs: 12_345,
      signal: controller.signal,
    }

    const requestProposal = vi
      .fn()
      .mockResolvedValueOnce(proposalResult(source, ['requested evidence']))
    const resolve = vi.fn().mockImplementation(async () => {
      original.instruction = 'tampered instruction'
      original.writeScope = { kind: 'read-only' }
      const existing = original.hostReferences?.[0]
      if (existing) existing.content = 'tampered existing evidence'
      const conversation = original.conversation?.[0]
      if (conversation) conversation.content = 'tampered conversation'
      if (original.options) original.options.maxHostReferenceTextUnits = 1
      override.model = 'model-after'
      requestOptions.timeoutMs = 1
      return [
        {
          request: 'requested evidence',
          references: [reference('resolved', 'verified resolved evidence')],
        },
      ]
    })
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      { requestProposal },
      { resolve },
    )

    const output = await service.request(original, override, requestOptions)

    expect(output.status).toBe('needs-host-reference')
    expect(output).toMatchObject({
      blockedReason: 'additional-provider-consent-required',
      unresolvedRequests: ['requested evidence'],
      resolvedReferences: [reference('resolved', 'verified resolved evidence')],
    })
    expect(output.attempts).toHaveLength(1)
    const firstBundle = output.attempts[0]!.bundle

    const task = firstBundle.sections.find((section) => section.kind === 'task-mode')?.content ?? ''
    const host =
      firstBundle.sections.find((section) => section.kind === 'host-reference')?.content ?? ''
    const conversationSection =
      firstBundle.sections.find((section) => section.kind === 'conversation')?.content ?? ''

    expect(task).toContain('original instruction')
    expect(task).not.toContain('tampered instruction')
    expect(host).toContain('original existing evidence')
    expect(host).not.toContain('tampered existing evidence')
    expect(conversationSection).toContain('original conversation')
    expect(conversationSection).not.toContain('tampered conversation')

    expect(requestProposal.mock.calls[0]?.[0]).not.toBe(source)
    expect(requestProposal).toHaveBeenCalledTimes(1)
    expect(requestProposal.mock.calls[0]?.[2]).toMatchObject({ model: 'model-before' })
    expect(requestProposal.mock.calls[0]?.[3]).toMatchObject({ timeoutMs: 12_345 })
    expect(requestProposal.mock.calls[0]?.[3]?.signal).toBe(controller.signal)
    expect(resolve).toHaveBeenCalledWith(['requested evidence'], { signal: controller.signal })
  })
})
