import { describe, expect, it, vi } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  detectFrontendWorkshopSourceHostReferenceRequests,
  FrontendWorkshopSourceAiHostReferenceService,
} from './FrontendWorkshopSourceAiHostReferenceService'

describe('Source AI host reference single-request policy', () => {
  it('detects focused local references from fixture-variable-state before provider use', () => {
    const source = createFrontendWorkshopSourceDocument(
      'fixture-variable-state',
      '<script>const state = getVariables({ type: "chat" }); eventOn(tavern_events.MESSAGE_UPDATED, () => state)</script>',
      100,
    )
    expect(
      detectFrontendWorkshopSourceHostReferenceRequests({
        source,
        mode: 'edit',
        instruction: '读取聊天变量并监听消息更新',
        conversation: [],
      }),
    ).toEqual(expect.arrayContaining(['variables api', 'host events']))
  })

  it('never performs an automatic second provider request', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'fixture-variable-state',
      '<main>ready</main>',
      100,
    )
    const transport = {
      requestProposal: vi.fn(async () => ({
        rawText: '{}',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'estimated' as const },
        proposal: {
          kind: 'source-ai-proposal' as const,
          projectId: source.projectId,
          sourceRevision: source.revision,
          summary: 'fixture proposal',
          edits: [],
          hostReferenceRequests: ['worldbook'],
          warnings: [],
        },
        providerReasoning: '',
      })),
    }
    const resolver = {
      resolve: vi.fn(async (requests: readonly string[]) =>
        requests.map((request) => ({
          request,
          references: [{ id: `fixture:${request}`, title: request, content: 'fixture reference' }],
        })),
      ),
    }
    const service = new FrontendWorkshopSourceAiHostReferenceService(transport, resolver)
    const result = await service.request({
      source,
      mode: 'edit',
      instruction: '调整布局',
      conversation: [],
    })
    expect(transport.requestProposal).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('needs-host-reference')
    if (result.status === 'needs-host-reference') {
      expect(result.blockedReason).toBe('additional-provider-consent-required')
      expect(result.unresolvedRequests).toEqual(['worldbook'])
    }
  })
})
