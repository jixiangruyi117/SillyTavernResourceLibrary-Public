// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { PropType } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from '../composables/UseBackStack'
import type { FrontendWorkshopResolvedSourceSelection } from '../utils/FrontendWorkshopSourceSelection'

const mocks = vi.hoisted(() => ({
  readResumeState: vi.fn(),
  acceptRevision: vi.fn(),
  clearHistory: vi.fn(),
  sourceSessionBackRequests: 0,
  currentSelections: [] as Array<{
    projectId: string
    sourceRevision: number
    sourceRange: { start: number; end: number }
  }>,
}))

vi.mock('../core/AppResumeState', () => ({
  APP_RESUME_STATE_CHANGE_EVENT: 'srl:app-resume-state-change',
  readAppResumeState: mocks.readResumeState,
}))
vi.mock('../core/FrontendWorkshopContainer', () => ({
  frontendWorkshopSourceHistoryService: { clearProject: mocks.clearHistory },
}))
vi.mock('./FrontendWorkshopSourceSession.vue', async () => {
  const { defineComponent, h, onMounted, onUnmounted } = await import('vue')
  const { SRL_BACK_REQUEST_EVENT: backEvent } = await import('../composables/UseBackStack')
  return {
    default: defineComponent({
      name: 'FrontendWorkshopSourceSession',
      emits: [
        'sourceAvailabilityChanged',
        'sourceAiRequested',
        'sourceRequested',
        'sourceRuntimeFixRequested',
      ],
      setup(_, { emit, expose }) {
        const onBack = () => {
          mocks.sourceSessionBackRequests += 1
        }
        onMounted(() => window.addEventListener(backEvent, onBack, true))
        onUnmounted(() => window.removeEventListener(backEvent, onBack, true))
        expose({
          getCurrentSourceAiSelections: () => mocks.currentSelections,
          acceptAppliedSourceAiRevision: mocks.acceptRevision,
        })
        return () =>
          h('div', { class: 'source-session-stub' }, [
            h(
              'button',
              { class: 'available', onClick: () => emit('sourceAvailabilityChanged', true) },
              'available',
            ),
            h('button', { class: 'open-ai', onClick: () => emit('sourceAiRequested') }, 'ai'),
            h(
              'button',
              {
                class: 'fix-runtime',
                onClick: () =>
                  emit('sourceRuntimeFixRequested', {
                    projectId: 'project-1',
                    sourceRevision: 1,
                    sourceCreatedAt: 100,
                    runtimeError: { kind: 'script-error', message: 'refresh is not defined' },
                    diagnostics: [
                      {
                        id: 'runtime:script-error',
                        category: 'runtime',
                        severity: 'error',
                        title: 'Runtime 错误',
                        message: 'refresh is not defined',
                      },
                    ],
                  }),
              },
              'fix runtime',
            ),
            h('button', { class: 'open-source', onClick: () => emit('sourceRequested') }, 'source'),
          ])
      },
    }),
  }
})
vi.mock('./FrontendWorkshopSourceAiWorkspace.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: {
        initialSelections: {
          type: Array as PropType<FrontendWorkshopResolvedSourceSelection[]>,
          default: () => [],
        },
        initialInstruction: { type: String, default: '' },
        runtimeFixIntent: { type: Object, default: undefined },
      },
      emits: ['close', 'applied'],
      setup(props, { emit }) {
        return () =>
          h(
            'div',
            {
              class: 'ai-workspace-stub',
              'data-instruction': props.initialInstruction,
              'data-selection-start': props.initialSelections[0]?.sourceRange?.start,
              'data-selection-count': props.initialSelections.length,
              'data-runtime-fix-kind': props.runtimeFixIntent?.runtimeError?.kind,
            },
            [
              h('button', { class: 'close-ai', onClick: () => emit('close') }, 'close'),
              h(
                'button',
                {
                  class: 'apply-ai',
                  onClick: () =>
                    emit('applied', { projectId: 'project-1', revision: 2, authorSource: 'new' }),
                },
                'apply',
              ),
            ],
          )
      },
    }),
  }
})
vi.mock('./FrontendWorkshopSourceEditor.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      emits: ['close', 'applied'],
      setup(_, { emit }) {
        return () =>
          h('button', { class: 'source-editor-stub', onClick: () => emit('close') }, 'close')
      },
    }),
  }
})

import FrontendWorkshopSourceAiShell from './FrontendWorkshopSourceAiShell.vue'

enableAutoUnmount(afterEach)

describe('FrontendWorkshopSourceAiShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sourceSessionBackRequests = 0
    mocks.currentSelections = []
    mocks.readResumeState.mockReturnValue({ feature: 'frontendWorkshop', projectId: 'project-1' })
    mocks.acceptRevision.mockReturnValue(true)
  })
  it('参考库意图沿原AI入口预填，关闭后不残留', async () => {
    const wrapper = mount(FrontendWorkshopSourceAiShell)
    await wrapper.get('.available').trigger('click')
    const session = wrapper.findComponent({ name: 'FrontendWorkshopSourceSession' })
    session.vm.$emit('sourceAiRequested', '立方体 + 毛玻璃')
    await flushPromises()
    expect(document.querySelector('.ai-workspace-stub')?.getAttribute('data-instruction')).toBe(
      '立方体 + 毛玻璃',
    )
    ;(document.querySelector('.close-ai') as HTMLButtonElement).click()
    await flushPromises()
    await wrapper.get('.open-ai').trigger('click')
    expect(document.querySelector('.ai-workspace-stub')?.getAttribute('data-instruction')).toBe('')
    expect(mocks.acceptRevision).not.toHaveBeenCalled()
  })

  async function openAi() {
    const wrapper = mount(FrontendWorkshopSourceAiShell)
    await wrapper.get('.available').trigger('click')
    await wrapper.get('.open-ai').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('只从 SourceSession 的正式入口打开唯一肘肘更健康工作区', async () => {
    const wrapper = await openAi()
    expect(document.body.querySelectorAll('.ai-workspace-stub')).toHaveLength(1)
    expect(wrapper.findAll('.source-session-stub')).toHaveLength(1)
  })

  it('点击 AI 时快照当前多选并交给唯一工作区', async () => {
    mocks.currentSelections = [
      {
        projectId: 'project-1',
        sourceRevision: 1,
        sourceRange: { start: 12, end: 18 },
      },
      {
        projectId: 'project-1',
        sourceRevision: 1,
        sourceRange: { start: 24, end: 30 },
      },
    ]
    const wrapper = await openAi()
    expect(
      document.body.querySelector('.ai-workspace-stub')?.getAttribute('data-selection-start'),
    ).toBe('12')
    expect(
      document.body.querySelector('.ai-workspace-stub')?.getAttribute('data-selection-count'),
    ).toBe('2')
    wrapper.unmount()
  })

  it('将 AI applied revision 交回现有 SourceSession acceptance', async () => {
    const wrapper = await openAi()
    ;(document.body.querySelector('.apply-ai') as HTMLButtonElement).click()
    await flushPromises()
    expect(mocks.acceptRevision).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', revision: 2 }),
      'AI 修改已应用；可撤销，预览已按新 revision 重建',
    )
    wrapper.unmount()
  })

  it('把 Runtime 修复 intent 交给同一个肘肘更健康工作区且不携带旧选区', async () => {
    mocks.currentSelections = [
      {
        projectId: 'project-1',
        sourceRevision: 1,
        sourceRange: { start: 12, end: 18 },
      },
    ]
    const wrapper = mount(FrontendWorkshopSourceAiShell)
    await wrapper.get('.available').trigger('click')
    await wrapper.get('.fix-runtime').trigger('click')
    await flushPromises()

    const workspace = document.body.querySelector('.ai-workspace-stub')
    expect(workspace?.getAttribute('data-runtime-fix-kind')).toBe('script-error')
    expect(workspace?.getAttribute('data-selection-count')).toBe('0')
    expect(document.body.querySelectorAll('.ai-workspace-stub')).toHaveLength(1)
    wrapper.unmount()
  })

  it('在 AI 工作区打开时先消费系统返回且不触发 SourceSession', async () => {
    const wrapper = await openAi()
    const detail: SrlBackRequestDetail = { handled: false }
    const event = new CustomEvent<SrlBackRequestDetail>(SRL_BACK_REQUEST_EVENT, {
      detail,
      cancelable: true,
    })
    window.dispatchEvent(event)
    await flushPromises()
    expect(detail.handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(mocks.sourceSessionBackRequests).toBe(0)
    expect(document.body.querySelector('.ai-workspace-stub')).toBeNull()
    wrapper.unmount()
  })
})
