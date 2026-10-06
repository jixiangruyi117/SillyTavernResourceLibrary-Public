/** @vitest-environment jsdom */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createFrontendWorkshopProject,
  type FrontendWorkshopNode,
} from '../types/FrontendWorkshopProject'
import FrontendWorkshopNodeEditor from './FrontendWorkshopNodeEditor.vue'

enableAutoUnmount(afterEach)

function textNode(): FrontendWorkshopNode {
  return {
    id: 'node',
    kind: 'text',
    label: '标题',
    text: '原文',
    style: {},
    children: [],
  }
}

function mountEditor(tab: 'content' | 'appearance' | 'layout' | 'interaction') {
  const project = createFrontendWorkshopProject('greeting')
  project.pages[0]!.nodes = [textNode()]
  return {
    project,
    wrapper: mount(FrontendWorkshopNodeEditor, {
      props: {
        project,
        pageId: project.pages[0]!.id,
        nodeId: 'node',
        requestedTab: tab,
      },
    }),
  }
}

describe('FrontendWorkshopNodeEditor flat inspector', () => {
  it('内容页直接编辑文字，不存在旧详情路由', async () => {
    const { wrapper } = mountEditor('content')
    expect(wrapper.find('.frontend-workshop-node-inspector').exists()).toBe(false)
    expect(wrapper.find('[data-node-detail-view]').exists()).toBe(false)
    await wrapper.get('textarea').setValue('新文案')
    await wrapper.get('textarea').trigger('change')
    const payload = wrapper.emitted('commitProject')!.at(-1)![0] as {
      project: ReturnType<typeof createFrontendWorkshopProject>
    }
    expect(payload.project.pages[0]!.nodes[0]!.text).toBe('新文案')
  })

  it('外观页直接显示普通 CSS 参数，不显示 recipe/token/guided', () => {
    const { wrapper } = mountEditor('appearance')
    const text = wrapper.text()
    expect(text).toContain('文字')
    expect(text).toContain('填充')
    expect(text).toContain('边框')
    expect(text).toContain('阴影')
    expect(text).not.toMatch(/material|motif|token|guided|gradient/iu)
  })

  it('布局页只有位置尺寸与图层直接参数', () => {
    const { wrapper } = mountEditor('layout')
    const text = wrapper.text()
    for (const label of ['X', 'Y', '宽度', '高度', '旋转', '所属图层', '层级'])
      expect(text).toContain(label)
    expect(text).not.toContain('宽度模式')
    expect(text).not.toContain('高度模式')
  })

  it('交互页只展示当前已有 Behavior，不创建第二套交互模型', () => {
    const { project, wrapper } = mountEditor('interaction')
    expect(wrapper.text()).toContain('已有交互')
    expect(wrapper.text()).toContain('当前元素没有已识别的交互')
    expect(project).not.toHaveProperty('interactionBindings')
    expect(project.pages[0]!.nodes[0]).not.toHaveProperty('interaction')
  })
})

describe('FrontendWorkshopNodeEditor existing interaction ownership', () => {
  it('移除当前节点交互时不删除另一个节点共享的行为', async () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    const page = project.pages[0]!
    for (const id of ['a', 'b'])
      page.nodes.push({
        id,
        kind: 'text',
        label: id,
        text: id,
        style: {},
        children: [],
        layerId: page.layers[0]!.id,
      })
    project.variables = [{ id: 'flag', name: 'flag', value: false }]
    project.behaviors = [
      {
        id: 'shared',
        name: '共享行为',
        targetNodeIds: ['a', 'b'],
        trigger: 'tap',
        conditions: [],
        actions: [{ type: 'setVariable', variableId: 'flag', value: true }],
        propagation: 'stop',
      },
    ]
    const wrapper = mount(FrontendWorkshopNodeEditor, {
      props: { project, pageId: page.id, nodeId: 'a', requestedTab: 'interaction' },
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '移除')!
      .trigger('click')
    const result = wrapper.emitted('commitProject')?.[0]?.[0] as
      { project: typeof project } | undefined
    expect(result?.project.behaviors?.[0]?.targetNodeIds).toEqual(['b'])
    expect(project.behaviors[0]!.targetNodeIds).toEqual(['a', 'b'])
    wrapper.unmount()
  })
})
