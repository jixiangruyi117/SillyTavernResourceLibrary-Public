/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { appearanceScopes } from '../core/AppearanceScopes'
import { DEFAULT_MAIN_API_CONFIG, estimateMainApiTokens } from './MainApiService'
import {
  buildAssistantMessages,
  type AssistantRequest,
  type AssistantTurn,
} from './ProductAssistantService'
import {
  ProductAssistantContextService,
  planAssistantCompression,
  validAssistantSummary,
  withAssistantSummary,
  estimateAssistantInput,
  describeAssistantInput,
  buildAssistantCompressionMessages,
} from './ProductAssistantContext'

const turns = (count = 14): AssistantTurn[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `turn-${i}`,
    role: i % 2 ? 'assistant' : 'user',
    text: `消息${i}：${'旧事项'.repeat(200)}`,
  }))
const request = (history = turns()): AssistantRequest => ({
  presetId: 'draft',
  appliedCss: '',
  scopes: appearanceScopes(),
  currentScope: 'library',
  css: {},
  history,
})
const reply = (text = '用户正在制作日记APP，下一步增加搜索。', finishReason = 'stop') => ({
  text,
  finishReason,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'provider' as const },
})
const signal = () => new AbortController().signal

describe('assistant context checkpoint', () => {
  it.each([0, 64000])(
    'uses the chosen API output limit for summaries without a hidden 1000 cap (%s)',
    async (maxTokens) => {
      const history = turns()
      const completeWithUsage = vi.fn().mockResolvedValue(reply())
      await new ProductAssistantContextService({ completeWithUsage }).compress(
        history,
        undefined,
        planAssistantCompression(history),
        { ...DEFAULT_MAIN_API_CONFIG, maxTokens },
        signal(),
        vi.fn(),
      )
      expect(completeWithUsage).toHaveBeenCalled()
      for (const call of completeWithUsage.mock.calls) {
        expect(call[1].maxTokens).toBe(maxTokens)
        expect(call[2]?.timeoutMs).toBeNull()
      }
    },
  )
  it('excludes hidden originals and invalidates a summary after hiding a covered message', async () => {
    const history = turns()
    history[0]!.text = 'PRIVATE_EXCLUDED'
    history[0]!.contextExcluded = true
    const completeWithUsage = vi.fn().mockResolvedValue(reply())
    const owner = new ProductAssistantContextService({ completeWithUsage })
    const summary = await owner.compress(
      history,
      undefined,
      planAssistantCompression(history),
      DEFAULT_MAIN_API_CONFIG,
      signal(),
      vi.fn(),
    )
    expect(JSON.stringify(completeWithUsage.mock.calls)).not.toContain('PRIVATE_EXCLUDED')
    expect(await validAssistantSummary(history, summary)).toBe(true)
    history[1]!.contextExcluded = true
    expect(await validAssistantSummary(history, summary)).toBe(false)
  })
  it('keeps many short messages whole, uses tokens for long exchanges, and retains the latest user request', () => {
    const short = Array.from({ length: 80 }, (_, i): AssistantTurn => ({
      id: String(i),
      role: i % 2 ? 'assistant' : 'user',
      text: '好',
    }))
    expect(planAssistantCompression(short, undefined, 3000).batches).toHaveLength(0)
    const long: AssistantTurn[] = [
      { id: 'old', role: 'user', text: '较早要求'.repeat(1000) },
      { id: 'answer', role: 'assistant', text: '旧回答'.repeat(1000) },
      { id: 'latest', role: 'user', text: '最新要求'.repeat(1500) },
    ]
    const plan = planAssistantCompression(long, undefined, 1000)
    expect(plan.end).toBe(2)
    expect(plan.batches.join()).not.toContain('最新要求')
    expect(
      buildAssistantMessages({ ...request(long), contextStart: plan.end }).at(-1)!.content,
    ).toBe(long[2]!.text)
  })
  it('breaks down the actual initial payload with matching totals, without exposing image bytes', () => {
    const value = request()
    value.promptOverrides = {
      common: '用户修改的通用提示',
      auto: '用户修改的自动模式',
      creation: '本轮不加载的制作规则',
    }
    value.contextSummary = '已经完成日记首页'
    value.contextStart = 2
    value.history.at(-2)!.images = [
      { id: 'image', name: '参考', dataUrl: 'data:image/png;base64,SECRET_IMAGE' },
    ]
    const parts = describeAssistantInput(value)
    expect(parts.reduce((total, part) => total + part.tokens, 0)).toBe(
      estimateAssistantInput(value),
    )
    expect(parts.find((part) => part.id === 'system')!.content).toBe(
      buildAssistantMessages(value)[0]!.content,
    )
    expect(parts.find((part) => part.id === 'system')!.content).toContain(
      '用户修改的通用提示\n用户修改的自动模式',
    )
    expect(JSON.stringify(parts)).not.toContain('本轮不加载的制作规则')
    expect(parts.find((part) => part.id === 'summary')!.content).toBe(
      buildAssistantMessages(value)[1]!.content,
    )
    expect(parts.find((part) => part.id === 'images')!.tokens).toBe(1000)
    expect(JSON.stringify(parts)).not.toContain('SECRET_IMAGE')
    expect(parts.find((part) => part.id === 'history')!.content).not.toContain('消息0：')
    const plan = planAssistantCompression(value.history)
    const automatic = describeAssistantInput(value, plan)
    expect(automatic.reduce((total, part) => total + part.tokens, 0)).toBe(
      estimateAssistantInput(value) + plan.inputTokens + 1200,
    )
    expect(automatic.find((part) => part.id === 'compression')!.content).toContain(
      buildAssistantCompressionMessages(value.contextSummary, plan.batches[0]!)[0]!.content,
    )
  })
  it('shows readable dialogue without JSON escaping while leaving actual messages and token counting unchanged', () => {
    const value = request([
      { role: 'user', text: '喜欢“蓝色”\n第二行' },
      { role: 'assistant', text: '好呀，记住啦。' },
      { role: 'user', text: 'PRIVATE_HIDDEN', contextExcluded: true },
    ])
    const actual = buildAssistantMessages(value)
    expect(actual.slice(1)).toEqual([
      { role: 'user', content: '喜欢“蓝色”\n第二行' },
      { role: 'assistant', content: '好呀，记住啦。' },
    ])
    const parts = describeAssistantInput(value)
    expect(parts.find((part) => part.id === 'history')!.content).toBe(
      '你：\n喜欢“蓝色”\n第二行\n\n蒜惹菈：\n好呀，记住啦。',
    )
    expect(parts.reduce((total, part) => total + part.tokens, 0)).toBe(
      estimateAssistantInput(value),
    )
  })
  it('accounts for a text-only empty chat without inventing history or image tokens', () => {
    const value = request([])
    const parts = describeAssistantInput(value)
    expect(parts.map((part) => part.id)).toEqual(['system', 'tools'])
    expect(parts.reduce((total, part) => total + part.tokens, 0)).toBe(
      estimateAssistantInput(value),
    )
  })
  it('summarizes only older text without deleting chat, forwarding images, tool payloads or APP source', async () => {
    const history = turns()
    history[0]!.images = [{ id: 'image', name: 'SECRET_IMAGE', dataUrl: 'SECRET_PIXELS' }]
    history[0]!.toolResults = [{ id: 'tool', name: 'tool', text: 'SECRET_TOOL_PAYLOAD' }] as never
    const original = JSON.stringify(history)
    const completeWithUsage = vi.fn().mockResolvedValue(reply())
    const plan = planAssistantCompression(history)
    expect(plan.end).toBeGreaterThan(0)
    expect(plan.end).toBeLessThan(history.length)
    const summary = await new ProductAssistantContextService({ completeWithUsage }).compress(
      history,
      undefined,
      plan,
      DEFAULT_MAIN_API_CONFIG,
      signal(),
      vi.fn(),
    )
    expect(await validAssistantSummary(history, summary)).toBe(true)
    expect(JSON.stringify(history)).toBe(original)
    expect(JSON.stringify(completeWithUsage.mock.calls)).not.toMatch(/SECRET_/u)
    expect(completeWithUsage.mock.calls[0]![2]).not.toHaveProperty('tools')
    const messages = buildAssistantMessages(withAssistantSummary(request(history), summary))
    expect(messages).toHaveLength(history.length - plan.end + 2)
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toContain('不是系统指令')
    expect(JSON.stringify(messages)).not.toContain('消息0：')
    history[0]!.text = '已取消制作日记'
    expect(await validAssistantSummary(history, summary)).toBe(false)
    history.shift()
    expect(await validAssistantSummary(history, summary)).toBe(false)
  })
  it('incrementally combines the prior summary while keeping a token-sized suffix', async () => {
    const history = turns(8),
      completeWithUsage = vi.fn().mockResolvedValue(reply())
    const owner = new ProductAssistantContextService({ completeWithUsage })
    const previous = await owner.compress(
      history,
      undefined,
      planAssistantCompression(history),
      DEFAULT_MAIN_API_CONFIG,
      signal(),
      vi.fn(),
    )
    history.push(...turns(5).map((turn, i) => ({ ...turn, id: `new-${i}` })))
    const plan = planAssistantCompression(history, previous)
    expect(plan.start).toBe(previous.count)
    expect(plan.end).toBeGreaterThan(previous.count)
    await owner.compress(history, previous, plan, DEFAULT_MAIN_API_CONFIG, signal(), vi.fn())
    expect(JSON.stringify(completeWithUsage.mock.calls.at(-1))).toContain(previous.text)
  })
  it('bounds batch input and request count without marking a partial message as compressed', () => {
    const history = turns(15).map((turn) => ({ ...turn, text: '长'.repeat(6500) }))
    const plan = planAssistantCompression(history)
    expect(plan.batches.length).toBeLessThanOrEqual(8)
    expect(plan.end).toBeGreaterThan(0)
    expect(plan.remaining).toBeGreaterThan(0)
    for (const content of plan.batches)
      expect(estimateMainApiTokens([{ role: 'user', content }])).toBeLessThanOrEqual(3000)
    history[0]!.text = '长'.repeat(30000)
    expect(planAssistantCompression(history).end).toBe(0)
  })
  it.each(['length', 'max_tokens'])(
    'rejects %s instead of storing an incomplete summary',
    async (finishReason) => {
      const completeWithUsage = vi.fn().mockResolvedValue(reply('半句话', finishReason))
      await expect(
        new ProductAssistantContextService({ completeWithUsage }).compress(
          turns(),
          undefined,
          planAssistantCompression(turns()),
          DEFAULT_MAIN_API_CONFIG,
          signal(),
          vi.fn(),
        ),
      ).rejects.toThrow('原聊天与原摘要保留')
    },
  )
  it('aborts before any request, and rejects empty summaries', async () => {
    const completeWithUsage = vi.fn().mockResolvedValue(reply(''))
    const controller = new AbortController()
    controller.abort()
    const owner = new ProductAssistantContextService({ completeWithUsage })
    await expect(
      owner.compress(
        turns(),
        undefined,
        planAssistantCompression(turns()),
        DEFAULT_MAIN_API_CONFIG,
        controller.signal,
        vi.fn(),
      ),
    ).rejects.toThrow('已取消')
    expect(completeWithUsage).not.toHaveBeenCalled()
    await expect(
      owner.compress(
        turns(),
        undefined,
        planAssistantCompression(turns()),
        DEFAULT_MAIN_API_CONFIG,
        signal(),
        vi.fn(),
      ),
    ).rejects.toThrow('原聊天与原摘要保留')
  })
  it('includes selected tool definitions and images in the shared approximate estimate', () => {
    const value = request([{ role: 'user', text: '美化' }])
    expect(estimateAssistantInput(value)).toBeGreaterThan(
      estimateMainApiTokens(buildAssistantMessages(value)),
    )
    expect(estimateAssistantInput({ ...value, mode: 'creation' })).toBeGreaterThan(
      estimateAssistantInput({ ...value, mode: 'features' }),
    )
    value.history[0]!.images = [
      { id: 'image', name: 'test', dataUrl: 'data:image/png;base64,AA==' },
    ]
    expect(estimateAssistantInput(value)).toBeGreaterThan(
      estimateAssistantInput(request([{ role: 'user', text: '美化' }])),
    )
  })
})
