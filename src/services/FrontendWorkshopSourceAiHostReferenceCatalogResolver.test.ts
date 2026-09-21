/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourceAiProposal } from '../utils/FrontendWorkshopSourceAiProposal'
import {
  FRONTEND_WORKSHOP_SOURCE_AI_HOST_REFERENCE_CATALOG_VERSION,
  FrontendWorkshopSourceAiHostReferenceCatalogResolver,
} from './FrontendWorkshopSourceAiHostReferenceCatalogResolver'
import {
  FrontendWorkshopSourceAiHostReferenceService,
  type FrontendWorkshopSourceAiProposalTransport,
} from './FrontendWorkshopSourceAiHostReferenceService'

const contractCases = [
  ['TavernHelper getCurrentMessageId signature', ['th-4.9.3:runtime-identity']],
  ['TavernHelper events API', ['th-4.9.3:events']],
  ['eventOn MESSAGE_UPDATED listener cleanup', ['th-4.9.3:events']],
  ['setChatMessages refresh affected signature', ['th-4.9.3:chat-messages']],
  ['TavernHelper 消息刷新 API', ['th-4.9.3:chat-messages']],
  ['读取开场白 swipes_data 并监听 MESSAGE_SWIPED', ['th-4.9.3:events', 'th-4.9.3:greeting-swipes']],
  ['楼层变量 getVariables 的 message scope', ['th-4.9.3:variables']],
  ['Mvu.getMvuData 和 VARIABLE_UPDATE_ENDED', ['mvu:optional-api']],
  ['用 triggerSlash 执行 STScript', ['th-4.9.3:stscript']],
  ['registerMacroLike 自定义酒馆宏', ['th-4.9.3:macros-formatting']],
  ['用 updateWorldbookWith 修改世界书', ['th-4.9.3:worldbooks']],
  ['generation API', ['th-4.9.3:generation']],
  ['请求生成并用 stopGenerationById 取消', ['th-4.9.3:generation']],
] as const

describe('FrontendWorkshopSourceAiHostReferenceCatalogResolver', () => {
  it('生成需求在第一次 Provider 请求前获得真实接口资料', async () => {
    const source = createFrontendWorkshopSourceDocument('generation-reference', '<div></div>', 100)
    let calls = 0
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      {
        async requestProposal(_source, bundle) {
          calls += 1
          const reference =
            bundle.sections.find((section) => section.kind === 'host-reference')?.content ?? ''
          expect(reference).toContain('generate(config: GenerateConfig)')
          expect(reference).toContain('GenerateToolCallResult')
          return {
            rawText: '{}',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'provider' },
            proposal: {
              kind: 'source-ai-proposal',
              projectId: source.projectId,
              sourceRevision: source.revision,
              summary: '资料已获得',
              edits: [],
              hostReferenceRequests: [],
              warnings: [],
            },
          }
        },
      },
      new FrontendWorkshopSourceAiHostReferenceCatalogResolver(),
    )
    const result = await service.request({
      source,
      mode: 'edit',
      instruction: '按钮调用酒馆模型请求生成',
      writeScope: { kind: 'whole-source' },
    })
    expect(result.status).toBe('completed')
    expect(calls).toBe(1)
  })

  it('publishes an explicit version for the target host baseline', () => {
    expect(FRONTEND_WORKSHOP_SOURCE_AI_HOST_REFERENCE_CATALOG_VERSION).toBe(
      'st-1.18.0_th-4.9.3_s9-2',
    )
  })

  it.each(contractCases)('retrieves focused evidence for %s', async (request, expectedIds) => {
    const resolver = new FrontendWorkshopSourceAiHostReferenceCatalogResolver()

    const [entry] = await resolver.resolve([request])

    expect(entry?.request).toBe(request)
    expect(entry?.references.map((reference) => reference.id)).toEqual(expectedIds)
    expect(
      entry?.references.every((reference) => reference.content.includes('Evidence baseline:')),
    ).toBe(true)
  })

  it('deduplicates references inside a combined task and keeps unknown requests fail closed', async () => {
    const resolver = new FrontendWorkshopSourceAiHostReferenceCatalogResolver()

    const [combined, unknown] = await resolver.resolve([
      'getChatMessages 后用 setChatMessages 修改聊天消息',
      '需要一个仓库没有证据的 ImaginaryHost.teleport API',
    ])

    expect(combined?.references.map((reference) => reference.id)).toEqual([
      'th-4.9.3:chat-messages',
    ])
    expect(unknown).toEqual({
      request: '需要一个仓库没有证据的 ImaginaryHost.teleport API',
      references: [],
    })
  })

  it('fails with AbortError when the request was already cancelled', async () => {
    const resolver = new FrontendWorkshopSourceAiHostReferenceCatalogResolver()
    const controller = new AbortController()
    controller.abort()

    await expect(
      resolver.resolve(['getChatMessages signature'], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('resolves requested evidence locally and waits for explicit provider consent', async () => {
    const source = createFrontendWorkshopSourceDocument(
      'project-host-reference-catalog',
      '<div>hello</div>',
      100,
    )
    const request = 'TavernHelper setChatMessages refresh signature'
    let calls = 0
    const transport: FrontendWorkshopSourceAiProposalTransport = {
      async requestProposal(_source, bundle) {
        calls += 1
        const proposal: FrontendWorkshopSourceAiProposal = {
          kind: 'source-ai-proposal',
          projectId: source.projectId,
          sourceRevision: source.revision,
          summary: calls === 1 ? '需要宿主证据。' : '证据已确认。',
          edits: [],
          hostReferenceRequests: calls === 1 ? [request] : [],
          warnings: [],
        }
        expect(
          bundle.sections.find((section) => section.kind === 'host-reference')?.content,
        ).not.toContain('setChatMessages')
        return {
          rawText: '{}',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'provider' },
          proposal,
        }
      },
    }
    const service = new FrontendWorkshopSourceAiHostReferenceService(
      transport,
      new FrontendWorkshopSourceAiHostReferenceCatalogResolver(),
    )

    const result = await service.request({
      source,
      mode: 'edit',
      instruction: '调用宿主 API。',
      writeScope: { kind: 'whole-source' },
    })

    expect(result.status).toBe('needs-host-reference')
    expect(result).toMatchObject({
      blockedReason: 'additional-provider-consent-required',
      unresolvedRequests: [request],
    })
    expect(result.attempts).toHaveLength(1)
    expect(calls).toBe(1)
    expect(result.resolvedReferences.map((reference) => reference.id)).toEqual([
      'th-4.9.3:chat-messages',
    ])
  })
})
