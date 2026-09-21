/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'

const mocks = vi.hoisted(() => ({
  checkpoints: [] as Array<{
    id: string
    projectId: string
    sourceCreatedAt: number
    sourceRevision: number
    sourceFingerprint: string
    label: string
    createdAt: number
    textUnits: number
  }>,
  historyStatus: {
    projectId: 'source-project',
    expectedRevision: 1 as number | undefined,
    entryCount: 1,
    cursor: 1,
    canUndo: true,
    canRedo: false,
    textUnits: 12,
  },
  checkpointCreate: vi.fn(),
  checkpointRestore: vi.fn(),
  checkpointReconcile: vi.fn(),
  checkpointClear: vi.fn(),
  historyClear: vi.fn(),
  historyUndo: vi.fn(),
  historyRedo: vi.fn(),
  getDocument: vi.fn(),
}))

vi.mock('../core/FrontendWorkshopContainer', () => ({
  frontendWorkshopSourceCheckpointService: {
    create: mocks.checkpointCreate,
    restore: mocks.checkpointRestore,
    reconcileProject: mocks.checkpointReconcile,
    clearProject: mocks.checkpointClear,
    list: vi.fn(() => mocks.checkpoints),
  },
  frontendWorkshopSourceDocumentService: { get: mocks.getDocument },
  frontendWorkshopSourceHistoryService: {
    clearProject: mocks.historyClear,
    undo: mocks.historyUndo,
    redo: mocks.historyRedo,
    status: vi.fn(() => ({ ...mocks.historyStatus })),
  },
}))

import FrontendWorkshopSourceHistoryPanel from './FrontendWorkshopSourceHistoryPanel.vue'

enableAutoUnmount(afterEach)

function getButton(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (!button) throw new Error(`找不到按钮：${label}`)
  return button
}

describe('FrontendWorkshopSourceHistoryPanel', () => {
  beforeEach(() => {
    mocks.checkpoints.splice(0)
    Object.assign(mocks.historyStatus, {
      projectId: 'source-project',
      expectedRevision: 1,
      entryCount: 1,
      cursor: 1,
      canUndo: true,
      canRedo: false,
      textUnits: 12,
    })
    vi.clearAllMocks()
  })

  it('独立执行撤销并把新 revision 交还 Session', async () => {
    const source = createFrontendWorkshopSourceDocument('source-project', '<div>current</div>', 100)
    const next = { ...source, revision: 2, authorSource: '<div>before</div>' }
    mocks.historyUndo.mockImplementation(async () => {
      Object.assign(mocks.historyStatus, {
        expectedRevision: 2,
        cursor: 0,
        canUndo: false,
        canRedo: true,
      })
      return next
    })
    const wrapper = mount(FrontendWorkshopSourceHistoryPanel, {
      props: { sourceDocument: source },
    })

    await getButton(wrapper, '撤销').trigger('click')
    await flushPromises()

    expect(mocks.historyUndo).toHaveBeenCalledWith(source.projectId)
    expect(wrapper.emitted('revisionAccepted')?.at(-1)).toEqual([
      next,
      '已撤销；预览已按新 revision 重建',
    ])
    expect(wrapper.text()).toContain('已撤销；预览已按新 revision 重建')
    expect(wrapper.emitted('busyChange')).toEqual([[true], [false]])
  })

  it('创建检查点时使用当前 Source revision 与 lineage', async () => {
    const source = createFrontendWorkshopSourceDocument('source-project', '<div>current</div>', 100)
    const checkpoint = {
      id: 'checkpoint-1',
      projectId: source.projectId,
      sourceCreatedAt: source.createdAt,
      sourceRevision: source.revision,
      sourceFingerprint: 'fingerprint-1',
      label: '检查点 1',
      createdAt: 101,
      textUnits: source.authorSource.length,
    }
    mocks.checkpointCreate.mockImplementation(async () => {
      mocks.checkpoints.push(checkpoint)
      return checkpoint
    })
    const wrapper = mount(FrontendWorkshopSourceHistoryPanel, {
      props: { sourceDocument: source },
    })

    await getButton(wrapper, '保存点').trigger('click')
    await flushPromises()

    expect(mocks.checkpointCreate).toHaveBeenCalledWith(source.projectId, {
      expectedRevision: source.revision,
      expectedSourceCreatedAt: source.createdAt,
    })
    expect(wrapper.get('select').element.value).toBe(checkpoint.id)
    expect(wrapper.text()).toContain('已保存检查点：检查点 1')
  })
})
