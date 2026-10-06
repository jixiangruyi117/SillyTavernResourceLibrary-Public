/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { ref, defineComponent, h } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_MAIN_API_CONFIG } from '../services/MainApiService'
import { appearanceScopes } from '../core/AppearanceScopes'
import type { AssistantPreferences } from '../services/ProductAssistantWorkspaceService'
import type { AssistantTurn } from '../services/ProductAssistantService'
const { confirm, completeWithUsage, config } = vi.hoisted(() => ({
  confirm: vi.fn(),
  completeWithUsage: vi.fn(),
  config: vi.fn(),
}))
vi.mock('./UseConfirmDialog', () => ({ confirmAction: confirm }))
vi.mock('../core/AppContainer', () => ({
  mainApiService: { getConfig: vi.fn(), completeWithUsage },
  productAssistantWorkspaceService: { config },
}))
import { useProductAssistantContext } from './UseProductAssistantContext'
let wrapper: ReturnType<typeof mount> | undefined
function setup() {
  const history = ref<AssistantTurn[]>(
    Array.from({ length: 14 }, (_, i) => ({
      id: `${i}`,
      role: 'user',
      text: `旧消息${i}：${'事项'.repeat(400)}`,
    })),
  )
  const preferences = ref<AssistantPreferences>({
    name: '蒜惹菈',
    avatar: '',
    apiProfileId: '',
    estimateInputTokens: true,
    autoCompressContext: false,
    compressionTokenThreshold: 4000,
  })
  const busy = ref(false),
    phase = ref(''),
    error = ref(''),
    persist = vi.fn().mockResolvedValue(undefined),
    consent = new Set<string>()
  const getRequest = () => ({
    history: [...history.value],
    toolCallingEnabled: preferences.value.toolCallingEnabled,
    toolCallLimit: preferences.value.toolCallLimit,
    presetId: 'draft',
    appliedCss: '',
    scopes: appearanceScopes(),
    currentScope: 'library',
    css: {},
  })
  let context!: ReturnType<typeof useProductAssistantContext>
  wrapper = mount(
    defineComponent({
      setup() {
        context = useProductAssistantContext({
          history,
          preferences,
          busy,
          phase,
          error,
          initializing: ref(false),
          consent,
          persist,
          getRequest,
          openSettings: vi.fn(),
        })
        return () => h('div')
      },
    }),
  )
  return { context, history, preferences, busy, error, persist, getRequest }
}
beforeEach(() => {
  vi.clearAllMocks()
  config.mockReturnValue({
    ...DEFAULT_MAIN_API_CONFIG,
    url: 'https://context-test.invalid/v1',
    model: 'test',
  })
  confirm.mockResolvedValue(true)
  completeWithUsage.mockResolvedValue({
    text: '用户在制作日记APP，下一步加搜索。',
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'provider' },
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})
it('reviews EVERY star click even with remembered consent, and cancellation makes zero provider calls', async () => {
  const { context, getRequest } = setup()
  expect(await context.prepareSend(getRequest(), new AbortController().signal)).toBeDefined()
  expect(confirm.mock.lastCall![0].title).toContain('预计输入约')
  confirm.mockResolvedValue(false)
  expect(await context.prepareSend(getRequest(), new AbortController().signal)).toBeUndefined()
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(completeWithUsage).not.toHaveBeenCalled()
})
it('keeps a short confirmation without the removed sending-scope section', async () => {
  const { context, preferences, getRequest } = setup()
  preferences.value.estimateInputTokens = false
  confirm.mockResolvedValue(false)
  await context.prepareSend(getRequest(), new AbortController().signal)
  const review = confirm.mock.lastCall![0]
  expect(review.message).toContain('模型：')
  expect(review.message).toContain('可能多次请求并计费')
  expect(review.message).not.toContain('APP草稿摘要')
  expect(review.details).toBeUndefined()
  expect(completeWithUsage).not.toHaveBeenCalled()
})
it('does not claim hidden JSON design references will be sent', async () => {
  const { context, preferences, history, getRequest } = setup()
  preferences.value.estimateInputTokens = false
  history.value = [
    {
      id: 'hidden-reference',
      role: 'user',
      text: 'hidden',
      contextExcluded: true,
      designReferences: [{ id: 'ref', name: 'theme.json', json: '{"color":"blue"}' }],
    },
    { id: 'visible', role: 'user', text: '继续' },
  ]
  await context.prepareSend(getRequest(), new AbortController().signal)
  expect(confirm.mock.lastCall![0].message).not.toContain('JSON 设计参考')
})
it('discloses tools off without promising reads or screenshots and renews consent when toggled', async () => {
  const { context, preferences, history, getRequest } = setup()
  history.value = [{ role: 'user', text: '请说明' }]
  preferences.value.estimateInputTokens = false
  await context.prepareSend(getRequest(), new AbortController().signal)
  preferences.value.toolCallingEnabled = false
  await context.prepareSend(getRequest(), new AbortController().signal)
  expect(confirm).toHaveBeenCalledTimes(2)
  const message = confirm.mock.lastCall![0].message
  expect(message).toContain('工具调用已关闭')
  expect(message).toContain('一次普通对话请求')
  expect(message).not.toContain('沿原工具')
  expect(completeWithUsage).not.toHaveBeenCalled()
})
it('reviews a changed tool budget before sending without causing a model request', async () => {
  const { context, preferences, history, getRequest } = setup()
  history.value = [{ role: 'user', text: '继续制作' }]
  preferences.value.estimateInputTokens = false
  await context.prepareSend(getRequest(), new AbortController().signal)
  preferences.value.toolCallLimit = 32
  await context.prepareSend(getRequest(), new AbortController().signal)
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(confirm.mock.lastCall![0].message).toContain('上限 32 次')
  expect(completeWithUsage).not.toHaveBeenCalled()
})
it('does not call compression when automatic preflight is cancelled', async () => {
  const { context, preferences, getRequest } = setup()
  preferences.value.autoCompressContext = true
  confirm.mockResolvedValue(false)
  expect(await context.prepareSend(getRequest(), new AbortController().signal)).toBeUndefined()
  expect(confirm.mock.lastCall![0].message).toContain('先压缩较早对话')
  expect(completeWithUsage).not.toHaveBeenCalled()
})
it('does not auto-compress with a blank threshold even with the automatic switch on', async () => {
  const { context, preferences, getRequest } = setup()
  preferences.value.compressionTokenThreshold = undefined
  preferences.value.autoCompressContext = true
  const prepared = await context.prepareSend(getRequest(), new AbortController().signal)
  expect(prepared?.request).not.toHaveProperty('contextTokenLimit')
  expect(completeWithUsage).not.toHaveBeenCalled()
  expect(confirm.mock.lastCall![0].message).not.toContain('先压缩较早对话')
  await context.compress()
  expect(completeWithUsage).toHaveBeenCalled()
})
it('never treats the compression threshold as an input cap when automatic compression is off', async () => {
  const { context, preferences, getRequest } = setup()
  preferences.value.compressionTokenThreshold = 1
  expect(await context.prepareSend(getRequest(), new AbortController().signal)).toBeDefined()
  expect(completeWithUsage).not.toHaveBeenCalled()
})
it('sends a long latest requirement even when automatic compression cannot reduce it below the threshold', async () => {
  const { context, preferences, history, getRequest } = setup()
  preferences.value.autoCompressContext = true
  preferences.value.compressionTokenThreshold = 1
  history.value = [{ role: 'user', text: '最新需求'.repeat(10000) }]
  const prepared = await context.prepareSend(getRequest(), new AbortController().signal)
  expect(prepared?.request.history[0]!.text).toBe(history.value[0]!.text)
  expect(completeWithUsage).not.toHaveBeenCalled()
})
it('automatically compresses before generating and persists a checkpoint without deleting history', async () => {
  const { context, preferences, getRequest, history, persist } = setup()
  preferences.value.autoCompressContext = true
  const prepared = await context.prepareSend(getRequest(), new AbortController().signal)
  expect(completeWithUsage).toHaveBeenCalled()
  expect(prepared?.request.contextStart).toBeGreaterThan(0)
  expect(history.value).toHaveLength(14)
  expect(persist).toHaveBeenCalled()
})
it('does not compress below the threshold and reviews a changed threshold', async () => {
  const { context, preferences, getRequest } = setup()
  preferences.value.autoCompressContext = true
  preferences.value.estimateInputTokens = false
  preferences.value.compressionTokenThreshold = 1_000_000
  await context.prepareSend(getRequest(), new AbortController().signal)
  await context.prepareSend(getRequest(), new AbortController().signal)
  expect(confirm).toHaveBeenCalledOnce()
  preferences.value.compressionTokenThreshold = 900_000
  await context.prepareSend(getRequest(), new AbortController().signal)
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(completeWithUsage).not.toHaveBeenCalled()
})
it('does not reject the prepared input when a completed summary remains above the threshold', async () => {
  const { context, preferences, getRequest } = setup()
  preferences.value.autoCompressContext = true
  preferences.value.compressionTokenThreshold = 1
  const prepared = await context.prepareSend(getRequest(), new AbortController().signal)
  expect(completeWithUsage).toHaveBeenCalled()
  expect(prepared?.request.contextStart).toBeGreaterThan(0)
})
it('keeps the prior checkpoint after a storage failure and releases manual busy state', async () => {
  const { context, error, busy, persist } = setup()
  await context.compress()
  const previous = context.summary.value
  expect(previous).toBeDefined()
  context.restore(undefined)
  persist.mockRejectedValueOnce(new Error('存储空间不足'))
  await context.compress()
  expect(context.summary.value).toBeUndefined()
  expect(error.value).toContain('存储空间不足')
  expect(busy.value).toBe(false)
  expect(context.compressing.value).toBe(false)
})
it('invalidates the checkpoint when an older message changes', async () => {
  const { context, history, persist } = setup()
  await context.compress()
  expect(context.summary.value).toBeDefined()
  history.value[0]!.text = '取消之前的目标'
  await vi.waitFor(() => expect(context.summary.value).toBeUndefined())
  expect(persist).toHaveBeenCalledTimes(2)
})
it('manual cancellation keeps all messages and never contacts a provider', async () => {
  const { context, history, busy } = setup()
  confirm.mockResolvedValue(false)
  await context.compress()
  expect(completeWithUsage).not.toHaveBeenCalled()
  expect(history.value).toHaveLength(14)
  expect(busy.value).toBe(false)
})
it('commits a bounded partial checkpoint but pauses generation until older messages are covered', async () => {
  const { context, preferences, history, getRequest, persist } = setup()
  preferences.value.autoCompressContext = true
  history.value = Array.from({ length: 18 }, (_, i) => ({
    id: `large-${i}`,
    role: 'user',
    text: '字'.repeat(6500),
  }))
  await expect(context.prepareSend(getRequest(), new AbortController().signal)).rejects.toThrow(
    '请继续压缩后生成',
  )
  expect(context.summary.value?.count).toBeGreaterThan(0)
  expect(context.summary.value!.count).toBeLessThan(12)
  expect(persist).toHaveBeenCalled()
  expect(history.value).toHaveLength(18)
})
