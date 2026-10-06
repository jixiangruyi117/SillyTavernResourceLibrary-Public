/** @vitest-environment jsdom */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'
import FrontendWorkshopLayerPanel from './FrontendWorkshopLayerPanel.vue'

vi.mock('../composables/UseConfirmDialog', () => ({
  confirmAction: vi.fn(async () => true),
}))

enableAutoUnmount(afterEach)

function layerProject() {
  const project = createFrontendWorkshopProject('greeting')
  project.pages[0]!.layers = [
    { id: 'background', name: '背景', visible: true, locked: false },
    { id: 'content', name: '内容', visible: true, locked: false },
  ]
  project.pages[0]!.nodes = [
    {
      id: 'hidden-node',
      kind: 'text',
      label: '隐藏文字',
      hidden: true,
      layerId: 'content',
      style: {},
      children: [],
    },
  ]
  return project
}

function mountPanel() {
  const project = layerProject()
  return {
    project,
    wrapper: mount(FrontendWorkshopLayerPanel, {
      props: {
        project,
        pageId: project.pages[0]!.id,
        activeLayerId: '',
        selectedNodeId: '',
      },
      global: { stubs: { Teleport: true } },
    }),
  }
}

describe('FrontendWorkshopLayerPanel', () => {
  it('拥有图层选择与隐藏元素恢复 intent', async () => {
    const { wrapper } = mountPanel()
    await wrapper.findAll('.frontend-workbench__layer-name')[1]!.trigger('click')
    expect(wrapper.emitted('activeLayerChange')).toEqual([['content']])
    await wrapper.get('[aria-label="显示隐藏文字"]').trigger('click')
    expect(wrapper.emitted('selectedNodeChange')).toContainEqual(['hidden-node'])
    const payload = wrapper.emitted('commitProject')!.at(-1)![0] as {
      project: ReturnType<typeof layerProject>
    }
    expect(payload.project.pages[0]!.nodes[0]!.hidden).toBe(false)
  })

  it('在 Owner 内生成锁定、重命名和排序后的项目快照', async () => {
    const { project, wrapper } = mountPanel()
    await wrapper.findAll('[aria-label="锁定图层"]')[0]!.trigger('click')
    let payload = wrapper.emitted('commitProject')!.at(-1)![0] as { project: typeof project }
    expect(payload.project.pages[0]!.layers[0]!.locked).toBe(true)
    expect(project.pages[0]!.layers[0]!.locked).toBe(false)

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重命名')!
      .trigger('click')
    await wrapper.get('[aria-label="图层名称"]').setValue('底图')
    await wrapper.get('.frontend-workbench__layer-rename').trigger('submit')
    payload = wrapper.emitted('commitProject')!.at(-1)![0] as { project: typeof project }
    expect(payload.project.pages[0]!.layers[0]!.name).toBe('底图')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '上移')!
      .trigger('click')
    payload = wrapper.emitted('commitProject')!.at(-1)![0] as { project: typeof project }
    expect(payload.project.pages[0]!.layers.map((layer) => layer.id)).toEqual([
      'content',
      'background',
    ])
  })

  it('删除图层时保留元素并迁移到相邻图层', async () => {
    const { wrapper } = mountPanel()
    const deleteButtons = wrapper.findAll('button').filter((button) => button.text() === '删除图层')
    await deleteButtons[1]!.trigger('click')
    await Promise.resolve()
    const payload = wrapper.emitted('commitProject')!.at(-1)![0] as {
      project: ReturnType<typeof layerProject>
    }
    expect(payload.project.pages[0]!.layers.map((layer) => layer.id)).toEqual(['background'])
    expect(payload.project.pages[0]!.nodes[0]!.layerId).toBe('background')
  })
})
