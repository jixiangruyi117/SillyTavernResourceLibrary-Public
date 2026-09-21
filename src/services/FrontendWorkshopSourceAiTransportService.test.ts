import { describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { buildFrontendWorkshopSourceAiContext } from '../utils/FrontendWorkshopSourceAiContext'
import { FrontendWorkshopSourceAiTransportService } from './FrontendWorkshopSourceAiTransportService'
import { MainApiService } from './MainApiService'

function sourceDocument(authorSource = '<div>hello</div>') {
  return createFrontendWorkshopSourceDocument('project-ai-transport', authorSource, 100)
}

function validResponse(start: number, end: number, expectedText: string, replacement: string) {
  return JSON.stringify({
    kind: 'source-ai-proposal',
    projectId: 'project-ai-transport',
    sourceRevision: 1,
    summary: '完成 proposal',
    edits: [
      {
        start,
        end,
        expectedText,
        replacement,
        reason: '按请求修改',
      },
    ],
    hostReferenceRequests: [],
    warnings: [],
  })
}

describe('FrontendWorkshopSourceAiTransportService', () => {
  it('allows a reasoning code generation to finish after the general API deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
            setTimeout(
              () =>
                resolve(
                  new Response(
                    JSON.stringify({
                      choices: [
                        {
                          message: { content: validResponse(5, 10, 'hello', 'world') },
                          finish_reason: 'stop',
                        },
                      ],
                      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                  ),
                ),
              130_000,
            )
          }),
      ),
    )
    try {
      const source = sourceDocument()
      const bundle = buildFrontendWorkshopSourceAiContext({
        source,
        mode: 'edit',
        instruction: '修改',
        writeScope: { kind: 'whole-source' },
      })
      const service = new FrontendWorkshopSourceAiTransportService(new MainApiService())
      const result = expect(
        service.requestProposal(
          source,
          bundle,
          {
            url: 'https://api.example.test/v1',
            model: 'test-model',
            apiKey: '',
            stream: false,
          },
          { timeoutMs: undefined },
        ),
      ).resolves.toMatchObject({ proposal: { edits: [{ replacement: 'world' }] } })
      await vi.advanceTimersByTimeAsync(130_000)
      await result
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
  it.each(['stop', 'length', 'incomplete'])(
    'retains received text and usage before rejecting invalid %s replies',
    async (finishReason) => {
      const source = sourceDocument()
      const bundle = buildFrontendWorkshopSourceAiContext({
        source,
        mode: 'edit',
        instruction: '修改',
        writeScope: { kind: 'whole-source' },
      })
      const onReceipt = vi.fn()
      const service = new FrontendWorkshopSourceAiTransportService({
        completeWithUsage: vi.fn(async (_messages, _override, options) => {
          options?.onText?.('{broken')
          return {
            text: '{broken JSON',
            finishReason,
            usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, source: 'provider' as const },
          }
        }),
      })
      await expect(
        service.requestProposal(source, bundle, undefined, { onReceipt }),
      ).rejects.toThrow()
      expect(onReceipt.mock.calls.at(-1)?.[0]).toMatchObject({
        rawText: '{broken JSON',
        status: 'invalid',
        usage: { totalTokens: 5 },
      })
      expect(
        onReceipt.mock.calls.some(
          ([receipt]) => receipt.rawText === '{broken' && receipt.status === 'receiving',
        ),
      ).toBe(true)
    },
  )
  it('JSON 转义保真保留复杂 JS、换行、反斜杠与代码围栏字符', async () => {
    const original = '<div>hello</div>'
    const replacement = `<body>\n<script>const value = ${JSON.stringify('引号"与反斜杠\\以及````')};\n</script>\n</body>`
    const source = sourceDocument(original)
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '添加脚本',
      writeScope: { kind: 'whole-source' },
    })
    const service = new FrontendWorkshopSourceAiTransportService({
      completeWithUsage: vi.fn().mockResolvedValue({
        text: validResponse(0, original.length, original, replacement),
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'provider' },
      }),
    })
    const result = await service.requestProposal(source, bundle)
    expect(result.proposal.edits[0]?.replacement).toBe(replacement)
    expect(result.proposal.edits[0]?.expectedText).toBe(original)
    expect(source.authorSource).toBe(original)
  })

  it.each(['length', 'max_tokens'])(
    '截断回复 %s 不进入补丁解析且不自动重试',
    async (finishReason) => {
      const source = sourceDocument()
      const bundle = buildFrontendWorkshopSourceAiContext({
        source,
        mode: 'edit',
        instruction: '修改',
        writeScope: { kind: 'whole-source' },
      })
      const completeWithUsage = vi.fn().mockResolvedValue({
        text: '{',
        finishReason,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'provider' },
      })
      const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })
      await expect(service.requestProposal(source, bundle)).rejects.toThrow(/输出长度上限/)
      expect(completeWithUsage).toHaveBeenCalledTimes(1)
      expect(source.authorSource).toBe('<div>hello</div>')
    },
  )

  it('reuses MainApi messages/options and returns a validated proposal without applying Source', async () => {
    const source = sourceDocument()
    const start = source.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '把 hello 改成 world。',
      writeScope: { kind: 'ranges', ranges: [{ start, end: start + 5 }] },
    })
    const signal = new AbortController().signal
    const completeWithUsage = vi.fn().mockResolvedValue({
      text: validResponse(start, start + 5, 'hello', 'world'),
      reasoning: '先确认 Source 范围。',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        source: 'provider',
      },
    })
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })

    const result = await service.requestProposal(
      source,
      bundle,
      { temperature: 0.2 },
      { timeoutMs: 300_000, signal },
    )

    expect(completeWithUsage).toHaveBeenCalledTimes(1)
    expect(completeWithUsage).toHaveBeenCalledWith(
      bundle.messages.map((message) => ({ role: message.role, content: message.content })),
      { temperature: 0.2 },
      { timeoutMs: 300_000, signal, onText: expect.any(Function) },
    )
    expect(result.proposal.edits[0]?.replacement).toBe('world')
    expect(result.usage.totalTokens).toBe(150)
    expect(result.rawText).toBe(validResponse(start, start + 5, 'hello', 'world'))
    expect(result.providerReasoning).toBe('先确认 Source 范围。')
    expect(source.authorSource).toBe('<div>hello</div>')
  })

  it('rejects stale context before spending an API request', async () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const newer = { ...source, revision: 2 }
    const completeWithUsage = vi.fn()
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })

    await expect(service.requestProposal(newer, bundle)).rejects.toThrow(/Context Bundle 已失效/)
    expect(completeWithUsage).not.toHaveBeenCalled()
  })

  it('把参考图片作为 MainApi 用户消息的多模态内容发送', async () => {
    const source = sourceDocument()
    const start = source.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '参考图片修改。',
      writeScope: { kind: 'whole-source' },
    })
    const completeWithUsage = vi.fn().mockResolvedValue({
      text: validResponse(start, start + 5, 'hello', 'world'),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'provider' },
    })
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })
    await service.requestProposal(source, bundle, undefined, undefined, [
      {
        id: 'image-1',
        name: 'reference.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AA==',
        size: 1,
      },
    ])
    const messages = completeWithUsage.mock.calls[0]?.[0]
    expect(messages.at(-1)?.content).toEqual([
      { type: 'text', text: bundle.messages.at(-1)?.content },
      { type: 'image', dataUrl: 'data:image/png;base64,AA==' },
    ])
  })

  it('accepts one json Markdown fence around an otherwise valid proposal', async () => {
    const source = sourceDocument()
    const start = source.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const rawText = `\`\`\`json\n${validResponse(start, start + 5, 'hello', 'world')}\n\`\`\``
    const completeWithUsage = vi.fn().mockResolvedValue({
      text: rawText,
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        source: 'estimated',
      },
    })
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })

    const result = await service.requestProposal(source, bundle)
    expect(result.proposal.edits[0]?.replacement).toBe('world')
    expect(result.rawText).toBe(rawText)
    expect(source.authorSource).toBe('<div>hello</div>')
  })

  it('accepts one unlabeled Markdown fence around an otherwise valid proposal', async () => {
    const source = sourceDocument()
    const start = source.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const completeWithUsage = vi.fn().mockResolvedValue({
      text: `\`\`\`\n${validResponse(start, start + 5, 'hello', 'world')}\n\`\`\``,
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        source: 'estimated',
      },
    })
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })

    const result = await service.requestProposal(source, bundle)
    expect(result.proposal.edits[0]?.replacement).toBe('world')
  })

  it('still rejects prose around a valid proposal instead of extracting arbitrary JSON', async () => {
    const source = sourceDocument()
    const start = source.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const completeWithUsage = vi.fn().mockResolvedValue({
      text: `这是结果：\n${validResponse(start, start + 5, 'hello', 'world')}\n请确认。`,
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        source: 'estimated',
      },
    })
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })

    await expect(service.requestProposal(source, bundle)).rejects.toThrow(/纯 JSON/)
    expect(source.authorSource).toBe('<div>hello</div>')
  })

  it('still validates proposal schema after removing a single Markdown fence', async () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const completeWithUsage = vi.fn().mockResolvedValue({
      text: '```json\n{}\n```',
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        source: 'estimated',
      },
    })
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })

    await expect(service.requestProposal(source, bundle)).rejects.toThrow(/字段不匹配/)
    expect(source.authorSource).toBe('<div>hello</div>')
  })

  it('allows a Host Reference request result with zero edits', async () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'runtime-fix',
      instruction: '需要 TavernHelper API 时先取证。',
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
    const completeWithUsage = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        kind: 'source-ai-proposal',
        projectId: source.projectId,
        sourceRevision: source.revision,
        summary: '需要补充宿主资料',
        edits: [],
        hostReferenceRequests: ['TavernHelper 消息刷新 API'],
        warnings: [],
      }),
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        source: 'provider',
      },
    })
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })

    const result = await service.requestProposal(source, bundle)
    expect(result.proposal.edits).toEqual([])
    expect(result.proposal.hostReferenceRequests).toEqual(['TavernHelper 消息刷新 API'])
  })

  it('rejects a recreated same-revision Source lineage before calling MainApi', async () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const recreated = {
      ...source,
      createdAt: source.createdAt + 1,
      updatedAt: source.updatedAt + 1,
      revision: source.revision,
    }
    const completeWithUsage = vi.fn()
    const service = new FrontendWorkshopSourceAiTransportService({ completeWithUsage })

    await expect(service.requestProposal(recreated, bundle)).rejects.toThrow(
      /Context Bundle 已失效/,
    )
    expect(completeWithUsage).not.toHaveBeenCalled()
  })
})
