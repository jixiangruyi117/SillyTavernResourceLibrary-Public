/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE, type Category, type ResourceSummary } from '../types/Resource'
import AiTaggingPanel from './AiTaggingPanel.vue'

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(),
  addTagsPerResource: vi.fn(),
  undoAddedTags: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(() => true),
  clearDraft: vi.fn(),
  loadUndo: vi.fn(),
  saveUndo: vi.fn(() => true),
  clearUndo: vi.fn(),
  confirmAction: vi.fn(async () => true),
}))

vi.mock('../core/AppContainer', () => ({
  aiTaggingService: { recognize: mocks.recognize },
  aiTaggingDraftService: {
    loadRuleTemplates: () => [],
    loadDraft: mocks.loadDraft,
    saveDraft: mocks.saveDraft,
    clearDraft: mocks.clearDraft,
    loadUndo: mocks.loadUndo,
    saveUndo: mocks.saveUndo,
    clearUndo: mocks.clearUndo,
  },
  resourceService: {
    addTagsPerResource: mocks.addTagsPerResource,
    undoAddedTags: mocks.undoAddedTags,
  },
  mainApiService: {
    getProfilesState: () => ({
      activeProfileId: 'main',
      profiles: [
        {
          id: 'main',
          name: '主配置',
          protocol: 'openai-compatible',
          url: 'https://example.com/v1',
          apiKey: 'secret',
          model: 'model-a',
          stream: false,
          reasoningEffort: 'auto',
          temperature: 0.7,
          topP: 1,
          maxTokens: 0,
          frequencyPenalty: 0,
          presencePenalty: 0,
        },
      ],
    }),
    getConfig: () => ({
      protocol: 'openai-compatible',
      url: 'https://example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      stream: false,
      reasoningEffort: 'auto',
      temperature: 0.7,
      topP: 1,
      maxTokens: 0,
      frequencyPenalty: 0,
      presencePenalty: 0,
    }),
  },
}))

vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: mocks.confirmAction }))

const resources = [
  {
    id: 'r1',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '林间少女',
    description: '古风角色',
    fileName: 'r1.png',
    mimeType: 'image/png',
    fileSize: 10,
    contentHash: 'h1',
    favorite: false,
    categoryId: 'f1',
    categoryIds: ['f1'],
    tags: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'r2',
    type: RESOURCE_TYPE.WORLD_BOOK,
    name: '都市设定',
    description: '现代城市',
    fileName: 'r2.json',
    mimeType: 'application/json',
    fileSize: 10,
    contentHash: 'h2',
    favorite: false,
    categoryId: null,
    categoryIds: [],
    tags: ['现代'],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  },
] as ResourceSummary[]

const categories = [{ id: 'f1', name: '古风卡', color: '#888' }] as Category[]

afterEach(() => {
  mocks.recognize.mockReset()
  mocks.addTagsPerResource.mockReset()
  mocks.undoAddedTags.mockReset()
  mocks.loadDraft.mockReset()
  mocks.loadDraft.mockReturnValue(undefined)
  mocks.loadUndo.mockReset()
  mocks.loadUndo.mockReturnValue(undefined)
  mocks.saveDraft.mockClear()
  mocks.clearDraft.mockClear()
  mocks.saveUndo.mockClear()
  mocks.clearUndo.mockClear()
  mocks.confirmAction.mockClear()
  mocks.confirmAction.mockResolvedValue(true)
  document.body.style.overflow = ''
})

describe('AiTaggingPanel', () => {
  it('可按标签状态筛选候选资源', async () => {
    const wrapper = mount(AiTaggingPanel, { props: { resources, categories } })
    const selects = wrapper.findAll('select')
    await selects[2]?.setValue('untagged')

    const queue = wrapper.find('.ai-tagging__candidate-list').text()
    expect(queue).toContain('林间少女')
    expect(queue).not.toContain('都市设定')
    wrapper.unmount()
  })

  it('识别结果必须经过审核页，点击注入后才调用资源 Service', async () => {
    mocks.recognize.mockImplementation(async (options) => {
      options.onProgress?.({ completed: 1, total: 1, batch: 1, batchCount: 1 })
      return {
        suggestions: [
          {
            resourceId: 'r1',
            tags: [
              { name: '单人', evidence: '描述只有一位角色', level: 'explicit' },
              { name: '古风', evidence: '场景使用古代服饰', level: 'inferred' },
            ],
          },
        ],
        failures: [],
        errors: [],
        stopped: false,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, source: 'provider' },
      }
    })
    mocks.addTagsPerResource.mockResolvedValue({
      resourceCount: 1,
      tagCount: 2,
      entries: [{ resourceId: 'r1', resourceName: '林间少女', tags: ['单人', '古风'] }],
    })
    const wrapper = mount(AiTaggingPanel, {
      props: { resources, categories, initialSelectedIds: ['r1'] },
    })

    const start = wrapper.findAll('button').find((button) => button.text().includes('开始识别'))
    await start?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('审核 AI 建议')
    expect(wrapper.text()).toContain('单人')
    expect(wrapper.text()).toContain('明确证据')
    expect(wrapper.text()).toContain('合理推断')
    expect(mocks.addTagsPerResource).not.toHaveBeenCalled()

    const apply = wrapper.findAll('button').find((button) => button.text().includes('注入 1 项'))
    await apply?.trigger('click')
    await flushPromises()

    expect(mocks.addTagsPerResource).toHaveBeenCalledWith([
      { resourceId: 'r1', tags: ['单人', '古风'] },
    ])
    expect(wrapper.emitted('applied')).toEqual([
      [{ resourceCount: 1, tagCount: 2, action: 'apply' }],
    ])
    expect(mocks.saveUndo).toHaveBeenCalledOnce()
    expect(mocks.clearDraft).toHaveBeenCalledOnce()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('临时 API 更换地址但未填 Key 时不会继承主 API Key', async () => {
    mocks.recognize.mockResolvedValue({
      suggestions: [],
      failures: [],
      errors: [],
      stopped: false,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'estimated' },
    })
    const wrapper = mount(AiTaggingPanel, {
      props: { resources, categories, initialSelectedIds: ['r1'] },
    })
    const apiSource = wrapper
      .findAll('select')
      .find((select) => select.element.querySelector('option[value="temporary"]'))
    await apiSource?.setValue('temporary')
    await wrapper.find('.ai-tagging__details-toggle').trigger('click')
    await wrapper.find('input[type="url"]').setValue('https://another.example/v1')
    const start = wrapper.findAll('button').find((button) => button.text().includes('开始识别'))
    await start?.trigger('click')
    await flushPromises()

    expect(mocks.recognize).toHaveBeenCalledWith(
      expect.objectContaining({
        apiOverride: expect.objectContaining({
          url: 'https://another.example/v1',
          apiKey: '',
        }),
      }),
    )
    wrapper.unmount()
  })

  it('显示失败资源并仅重试失败项，成功审核结果继续保留', async () => {
    mocks.recognize
      .mockResolvedValueOnce({
        suggestions: [
          {
            resourceId: 'r1',
            tags: [{ name: '古风', evidence: '服饰明确', level: 'explicit' }],
          },
        ],
        failures: [
          { batch: 2, resourceIds: ['r2'], message: '第 2 批失败：限流', retryable: true },
        ],
        errors: ['第 2 批失败：限流'],
        stopped: false,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, source: 'provider' },
      })
      .mockResolvedValueOnce({
        suggestions: [
          {
            resourceId: 'r2',
            tags: [{ name: '都市', evidence: '现代城市设定', level: 'explicit' }],
          },
        ],
        failures: [],
        errors: [],
        stopped: false,
        usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100, source: 'provider' },
      })
    const wrapper = mount(AiTaggingPanel, {
      props: { resources, categories, initialSelectedIds: ['r1', 'r2'] },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('开始识别'))
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('第 2 批失败：限流')
    expect(wrapper.text()).toContain('都市设定')
    expect(wrapper.text()).toContain('古风')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('仅重试失败项 1'))
      ?.trigger('click')
    await flushPromises()

    expect(mocks.recognize).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceIds: ['r2'] }),
    )
    expect(wrapper.text()).toContain('古风')
    expect(wrapper.text()).toContain('都市')
    expect(wrapper.text()).not.toContain('第 2 批失败：限流')
    wrapper.unmount()
  })

  it('可从本机恢复审核草稿，退出前确认且不恢复临时 Key', async () => {
    mocks.loadDraft.mockReturnValue({
      version: 1,
      savedAt: 100,
      stage: 'review',
      searchQuery: '',
      typeFilter: 'all',
      categoryFilter: 'all',
      tagState: 'all',
      tagQuery: '',
      selectedIds: ['r1'],
      batchSize: 4,
      customPrompt: '草稿提示词',
      taxonomyTemplateId: 'story-resource',
      mergeAliases: true,
      api: {
        source: 'temporary',
        temporaryProtocol: 'openai-compatible',
        temporaryUrl: 'https://draft.example/v1',
        temporaryModel: 'draft-model',
      },
      reviewItems: [
        {
          resourceId: 'r1',
          tags: [{ name: '古风', evidence: '场景明确', level: 'explicit' }],
          accepted: true,
          draftTag: '',
        },
      ],
      failures: [],
      usageText: '120 Token · 供应商统计',
    })
    const wrapper = mount(AiTaggingPanel, { props: { resources, categories } })
    await flushPromises()

    expect(wrapper.text()).toContain('已恢复本机草稿')
    expect(wrapper.text()).toContain('古风')
    await wrapper.find('.ai-tagging__close').trigger('click')
    await flushPromises()

    expect(mocks.confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: '保存并退出' }),
    )
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(mocks.saveDraft.mock.calls.flat().join(' ')).not.toContain('secret')
    wrapper.unmount()
  })

  it('撤销入口只提交上次真实新增标签记录', async () => {
    const additions = [{ resourceId: 'r1', resourceName: '林间少女', tags: ['甜宠'] }]
    mocks.loadUndo.mockReturnValue({ version: 1, appliedAt: 100, additions })
    mocks.undoAddedTags.mockResolvedValue({ resourceCount: 1, tagCount: 1, entries: additions })
    const wrapper = mount(AiTaggingPanel, { props: { resources, categories } })
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('撤销上次 AI 注入'))
      ?.trigger('click')
    await flushPromises()

    expect(mocks.undoAddedTags).toHaveBeenCalledWith(additions)
    expect(mocks.clearUndo).toHaveBeenCalledOnce()
    expect(wrapper.emitted('applied')).toEqual([
      [{ resourceCount: 1, tagCount: 1, action: 'undo' }],
    ])
    wrapper.unmount()
  })
})
