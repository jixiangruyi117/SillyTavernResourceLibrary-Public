/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'

import {
  createFrontendWorkshopProject,
  type FrontendWorkshopNode,
} from '../types/FrontendWorkshopProject'
import {
  getFrontendWorkshopProjectCompatibilityIssues,
  renderFrontendWorkshopGreetingBundle,
  renderFrontendWorkshopProject,
} from './FrontendWorkshopProjectRenderer'

function node(
  id: string,
  kind: FrontendWorkshopNode['kind'],
  overrides: Partial<FrontendWorkshopNode> = {},
): FrontendWorkshopNode {
  return {
    id,
    kind,
    label: id,
    style: {},
    children: [],
    ...overrides,
  }
}

function actionText(
  id: string,
  text: string,
  action: FrontendWorkshopNode['action'],
): FrontendWorkshopNode {
  return node(id, 'text', {
    text,
    semanticRole: 'action',
    action,
    style: {
      surfaceColor: '#ffffff',
      textColor: '#243238',
      borderWidth: 1,
      borderColor: '#dbe3e5',
      cornerRadius: 4,
    },
  })
}

describe('FrontendWorkshopProjectRenderer source-first contract', () => {
  it('保留已保存布局的普通 Flex/Grid 与尺寸约束，不恢复布局编辑路由', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.pages[0]!.nodes.push(
      node('container', 'block', {
        composition: {
          mode: 'row',
          gap: 12,
          phoneColumns: 1,
          wideColumns: 2,
          align: 'center',
          justify: 'space-between',
        },
        children: [
          node('child', 'text', {
            text: '保留内容',
            constraint: {
              anchor: 'top-start',
              offsetX: 4,
              offsetY: 5,
              widthMode: 'percent',
              widthValue: 50,
              heightMode: 'fixed',
              heightValue: 80,
              wide: { widthMode: 'fixed', widthValue: 240 },
            },
          }),
        ],
      }),
    )
    const output = renderFrontendWorkshopProject(project)
    expect(output).toContain('display:flex;flex-direction:row;gap:12px')
    expect(output).toContain('width:50%;height:80px')
    expect(output).toContain('width:240px;height:80px')
    expect(output).toContain('align-self:start;justify-self:start')
    expect(output).toContain('保留内容')
  })

  it('空白项目和所有内容均隐藏的项目都会阻断交付', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    expect(getFrontendWorkshopProjectCompatibilityIssues(project)).toContain(
      '空白开场白没有可交付内容，请先添加至少一个可见元素。',
    )
    expect(renderFrontendWorkshopProject(project)).toBe('')

    project.pages[0]!.nodes.push(node('hidden', 'text', { text: '不可见', hidden: true }))
    expect(renderFrontendWorkshopProject(project)).toBe('')
  })

  it('普通 text + action 安全交付 HTTPS 外链，不依赖按钮 preset', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.pages[0]!.nodes.push(
      actionText('reference', '查看资料', {
        kind: 'external',
        target: 'https://example.com/reference',
      }),
    )

    expect(getFrontendWorkshopProjectCompatibilityIssues(project)).toEqual([])
    const result = renderFrontendWorkshopProject(project)
    expect(result).toContain('href="https://example.com/reference"')
    expect(result).toContain('srl-greeting__node--text')
    expect(result).not.toContain('is-preset-button')
  })

  it('非 HTTPS 图片和外链会被兼容检查阻断', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.pages[0]!.nodes.push(
      node('cover', 'image', { imageUrl: 'http://example.com/cover.png' }),
      actionText('link', '不安全链接', { kind: 'external', target: 'http://example.com' }),
    )

    const issues = getFrontendWorkshopProjectCompatibilityIssues(project).join('\n')
    expect(issues).toContain('不是可直接显示的 HTTPS 链接')
    expect(issues).toContain('不是 HTTPS 链接')
    expect(renderFrontendWorkshopProject(project)).toBe('')
  })

  it('卡片式外观由普通 CSS 属性表达，不依赖 appearancePreset/material/motif', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.pages[0]!.nodes.push(
      node('profile', 'block', {
        label: '人物档案',
        style: {
          surfaceColor: '#fffdf7',
          textColor: '#243238',
          borderWidth: 1,
          borderColor: '#dbe3e5',
          borderStyle: 'solid',
          cornerRadius: 8,
          shadowColor: '#202a25',
          shadowOffsetY: 6,
          shadowBlur: 18,
          shadowSpread: 0,
        },
        children: [node('name', 'text', { text: '朝雾' })],
      }),
    )

    const result = renderFrontendWorkshopProject(project)
    expect(result).toContain('srl-greeting__node--block')
    expect(result).toContain('background:#fffdf7')
    expect(result).toContain('border-radius:8px')
    expect(result).toContain('box-shadow:')
    expect(result).not.toContain('appearancePreset')
    expect(result).not.toContain('material')
    expect(result).not.toContain('motif')
  })

  it('状态字段和变量内容来源继续按普通数据绑定渲染', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.fields = [{ id: 'place', label: '地点', sample: '樱花町', path: 'place', kind: 'text' }]
    project.variables = [{ id: 'mood', name: '心情', value: '平静' }]
    project.pages[0]!.nodes.push(
      node('profile', 'block', {
        children: [
          node('place-text', 'text', {
            contentSource: { kind: 'stateField', fieldId: 'place' },
          }),
          node('mood-text', 'text', {
            contentSource: { kind: 'variable', variableId: 'mood' },
          }),
        ],
      }),
    )

    const result = renderFrontendWorkshopProject(project)
    expect(result).toContain('樱花町')
    expect(result).toContain('data-srl-variable-id="mood"')
    expect(result).toContain('平静')
  })

  it('画布位置只编译受控 grid 变量，不输出任意 fixed 布局', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.pages[0]!.nodes.push(
      node('portrait', 'image', {
        imageUrl: 'https://example.com/portrait.png',
        layout: {
          phone: { x: 24, y: 80, width: 180, height: 240, zIndex: 2, locked: false },
          wide: { x: 80, y: 56, width: 240, height: 320, zIndex: 2, locked: false },
        },
      }),
    )

    const source = renderFrontendWorkshopProject(project)
    expect(source).toContain('--srl-col:')
    expect(source).toContain('--srl-wide-col:')
    expect(source).toContain('grid-column:var(--srl-col)')
    expect(source).not.toContain('position:fixed')
  })

  it('普通 Behavior + State 进入唯一 Behavior Runtime 配置，不依赖 guided binding', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.pages[0]!.nodes.push(
      actionText('trigger', '展开', { kind: 'none' }),
      node('detail', 'text', { text: '详情' }),
    )
    project.states = [
      {
        id: 'detail-state',
        name: '详情状态',
        defaultStateId: 'closed',
        states: [
          { id: 'closed', name: '关闭' },
          { id: 'open', name: '打开' },
        ],
        variants: [
          { stateId: 'closed', nodeOverrides: [{ nodeId: 'detail', visible: false }] },
          { stateId: 'open', nodeOverrides: [{ nodeId: 'detail', visible: true }] },
        ],
      },
    ]
    project.behaviors = [
      {
        id: 'toggle-detail',
        name: '切换详情',
        trigger: 'tap',
        targetNodeIds: ['trigger'],
        conditions: [],
        actions: [{ type: 'toggleState', stateGroupId: 'detail-state' }],
        propagation: 'stop',
      },
    ]

    const result = renderFrontendWorkshopProject(project)
    expect(result).toContain('data-srl-behavior-config=')
    expect(result).toContain('toggleState')
    expect(result).not.toContain('guided')
    expect(result).not.toContain('interactionBindings')
  })

  it('多开场白只输出 firstMessage + alternateGreetings，并可按 pageId 单独渲染', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.pages[0]!.id = 'main'
    project.pages[0]!.name = '主开场白'
    project.pages[0]!.nodes.push(node('main-title', 'text', { text: '雨夜来信' }))
    project.pages.push({
      id: 'alternate',
      name: '备用开场白',
      layers: [{ id: 'alternate-layer', name: '默认图层', visible: true, locked: false }],
      nodes: [node('alternate-title', 'text', { text: '旧港来信', layerId: 'alternate-layer' })],
    })

    const bundle = renderFrontendWorkshopGreetingBundle(project)
    expect(bundle.greetings).toHaveLength(2)
    expect(bundle.firstMessage).toContain('雨夜来信')
    expect(bundle.alternateGreetings).toHaveLength(1)
    expect(bundle.alternateGreetings[0]).toContain('旧港来信')
    expect(renderFrontendWorkshopProject(project, 'alternate')).toContain('旧港来信')
  })

  it('status 是唯一 Legacy island，现代 Renderer 明确拒绝交付', () => {
    const status = createFrontendWorkshopProject('status', 1)
    status.pages[0]!.nodes.push(node('status-text', 'text', { text: '旧状态栏' }))

    expect(getFrontendWorkshopProjectCompatibilityIssues(status)).toContain(
      '状态栏请使用状态栏兼容编译器交付。',
    )
    expect(renderFrontendWorkshopProject(status)).toBe('')
  })
})
