import { describe, expect, it } from 'vitest'

import {
  createFrontendWorkshopProject,
  type FrontendWorkshopNode,
} from '../types/FrontendWorkshopProject'
import {
  applyFrontendWorkshopCommand,
  duplicateFrontendWorkshopGreetingPage,
  removeFrontendWorkshopNodeSubtree,
  validateFrontendWorkshopProject,
} from './FrontendWorkshopCommandSystem'
import {
  buildFrontendWorkshopReferenceIndex,
  frontendWorkshopMvuSourceReferenceId,
  getFrontendWorkshopReferences,
} from './FrontendWorkshopReferenceIndex'

function node(
  id: string,
  kind: FrontendWorkshopNode['kind'],
  children: FrontendWorkshopNode[] = [],
): FrontendWorkshopNode {
  return { id, kind, label: id, style: {}, children }
}

describe('FrontendWorkshopCommandSystem source-first invariants', () => {
  it('不变量失败时返回执行前项目，不提交重复 ID', () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    project.pages[0]!.nodes.push(node('title', 'text'))

    const result = applyFrontendWorkshopCommand(project, (draft) => {
      draft.pages[0]!.nodes.push(node('title', 'text'))
    })

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([expect.objectContaining({ code: 'duplicate_id' })])
    expect(result.project.pages[0]?.nodes).toHaveLength(1)
  })

  it('拒绝非法尺寸约束，并接受稀疏宽屏覆盖', () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    const image = node('image', 'image')
    image.constraint = {
      anchor: 'auto',
      offsetX: 0,
      offsetY: 0,
      widthMode: 'percent',
      widthValue: 50,
      heightMode: 'hug',
      minWidth: 80,
      maxWidth: 320,
      aspectRatio: 2.35,
      wide: { widthValue: 80 },
    }
    project.pages[0]!.nodes.push(node('scene', 'block', [image]))

    expect(validateFrontendWorkshopProject(project)).toEqual([])
    image.constraint.wide = { widthMode: 'percent', widthValue: 101 }
    expect(validateFrontendWorkshopProject(project)).toEqual([
      expect.objectContaining({ code: 'invalid_scene_constraint' }),
    ])
  })

  it('检查行为、状态、变量与页面引用', () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    project.behaviors = [
      {
        id: 'behavior',
        name: '错误引用',
        trigger: 'tap',
        targetNodeIds: ['missing-node'],
        conditions: [{ variableId: 'missing-variable', operator: 'eq', value: true }],
        actions: [
          { type: 'toggleState', stateGroupId: 'missing-state' },
          { type: 'openScreen', pageId: 'missing-page' },
        ],
        propagation: 'stop',
      },
    ]

    expect(validateFrontendWorkshopProject(project).map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'missing_target',
        'missing_variable',
        'missing_state',
        'missing_page',
      ]),
    )
  })

  it('检查热区的父节点与行为引用', () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    project.hotspots = [
      {
        id: 'hotspot',
        name: '旧热区数据',
        parentNodeId: 'missing-node',
        behaviorId: 'missing-behavior',
        x: 10,
        y: 10,
        width: 20,
        height: 20,
      },
    ]

    expect(validateFrontendWorkshopProject(project).map((item) => item.code)).toEqual(
      expect.arrayContaining(['missing_target', 'missing_behavior']),
    )
  })

  it('检查文字内容来源，并纳入统一引用索引', () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    project.pages[0]!.nodes.push({
      ...node('bound-text', 'text'),
      label: '地点',
      contentSource: { kind: 'stateField', fieldId: 'missing-field' },
    })

    expect(validateFrontendWorkshopProject(project)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing_field' })]),
    )

    project.fields = [{ id: 'place', label: '地点', sample: '樱花町', path: 'place', kind: 'text' }]
    project.pages[0]!.nodes[0]!.contentSource = { kind: 'stateField', fieldId: 'place' }
    project.variables = [{ id: 'mood', name: '心情', value: '平静' }]
    project.pages[0]!.nodes.push({
      ...node('variable-text', 'text'),
      label: '心情',
      contentSource: { kind: 'variable', variableId: 'mood' },
    })

    const index = buildFrontendWorkshopReferenceIndex(project)
    expect(getFrontendWorkshopReferences(index, 'place')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'bound-text' })]),
    )
    expect(getFrontendWorkshopReferences(index, 'mood')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'variable-text' })]),
    )
  })

  it('校验并索引状态字段的受控 MVU 来源路径', () => {
    const project = createFrontendWorkshopProject('greeting', 1)
    project.fields = [
      {
        id: 'affection',
        label: '好感度',
        sample: '67',
        path: '角色.好感度',
        kind: 'number',
        source: { provider: 'mvu', path: '角色.好感度' },
      },
    ]

    expect(validateFrontendWorkshopProject(project)).toEqual([])
    expect(
      getFrontendWorkshopReferences(
        buildFrontendWorkshopReferenceIndex(project),
        frontendWorkshopMvuSourceReferenceId('角色.好感度'),
      ),
    ).toEqual([expect.objectContaining({ kind: 'field', id: 'affection' })])

    project.fields[0]!.source = { provider: 'mvu', path: 'stat_data.角色' }
    expect(validateFrontendWorkshopProject(project)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_field_source' })]),
    )
  })

  it('删除节点时清理依赖该节点的行为、热区和只为该行为服务的状态', () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    const page = project.pages[0]!
    page.nodes.push(node('trigger', 'text'), node('protected', 'text'))
    project.states = [
      {
        id: 'helper-state',
        name: '辅助状态',
        defaultStateId: 'hidden',
        states: [{ id: 'hidden', name: '隐藏' }],
      },
      {
        id: 'unrelated-state',
        name: '无关状态',
        defaultStateId: 'keep',
        states: [{ id: 'keep', name: '保留' }],
      },
    ]
    project.behaviors = [
      {
        id: 'helper-behavior',
        name: '辅助行为',
        trigger: 'tap',
        targetNodeIds: ['trigger'],
        conditions: [],
        actions: [{ type: 'toggleState', stateGroupId: 'helper-state' }],
        propagation: 'stop',
      },
      {
        id: 'unrelated-behavior',
        name: '无关行为',
        trigger: 'tap',
        targetNodeIds: ['protected'],
        conditions: [],
        actions: [],
        propagation: 'continue',
      },
    ]
    project.hotspots = [
      {
        id: 'hotspot',
        name: '点击区',
        parentNodeId: 'trigger',
        behaviorId: 'helper-behavior',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ]

    expect(removeFrontendWorkshopNodeSubtree(project, page.id, 'trigger')).toBe(true)
    expect(project.behaviors?.map((behavior) => behavior.id)).toEqual(['unrelated-behavior'])
    expect(project.states?.map((state) => state.id)).toEqual(['unrelated-state'])
    expect(project.hotspots).toEqual([])
  })

  it('复制页面时重映射普通状态、行为和热区，不依赖 Guided Binding', () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    const page = project.pages[0]!
    page.nodes.push(node('trigger', 'text'), node('panel', 'block'))
    project.states = [
      {
        id: 'state-group',
        name: '显示状态',
        defaultStateId: 'hidden',
        states: [
          { id: 'hidden', name: '隐藏' },
          { id: 'shown', name: '显示' },
        ],
        variants: [
          { stateId: 'hidden', nodeOverrides: [{ nodeId: 'panel', visible: false }] },
          { stateId: 'shown', nodeOverrides: [{ nodeId: 'panel', visible: true }] },
        ],
      },
    ]
    project.behaviors = [
      {
        id: 'behavior',
        name: '切换显示',
        trigger: 'tap',
        targetNodeIds: ['trigger'],
        conditions: [],
        actions: [{ type: 'toggleState', stateGroupId: 'state-group' }],
        propagation: 'stop',
      },
    ]
    project.hotspots = [
      {
        id: 'hotspot',
        name: '点击区',
        parentNodeId: 'trigger',
        behaviorId: 'behavior',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ]

    const copiedPageId = duplicateFrontendWorkshopGreetingPage(project, page.id)
    expect(copiedPageId).toBeTruthy()
    expect(project.pages).toHaveLength(2)
    expect(project.states).toHaveLength(2)
    expect(project.behaviors).toHaveLength(2)
    expect(project.hotspots).toHaveLength(2)
    expect(validateFrontendWorkshopProject(project)).toEqual([])
  })

  it('引用索引只保留当前普通源码模型中的实际关系', () => {
    const project = createFrontendWorkshopProject('greeting', 100)
    const page = project.pages[0]!
    project.fields = [{ id: 'field', label: '地点', sample: '港口', path: 'place', kind: 'text' }]
    project.variables = [{ id: 'variable', name: '心情', value: '平静' }]
    page.nodes.push({
      ...node('profile', 'block'),
      label: '人物卡',
      children: [
        { ...node('field-text', 'text'), contentSource: { kind: 'stateField', fieldId: 'field' } },
        {
          ...node('variable-text', 'text'),
          contentSource: { kind: 'variable', variableId: 'variable' },
        },
      ],
    })
    project.pages.push({
      id: 'next-page',
      name: '下一页',
      layers: [{ id: 'next-layer', name: '默认图层', visible: true, locked: false }],
      nodes: [node('next-title', 'text')],
    })
    page.nodes.push({
      ...node('page-action', 'text'),
      semanticRole: 'action',
      action: { kind: 'page', target: 'next-page' },
    })

    const index = buildFrontendWorkshopReferenceIndex(project)
    expect(getFrontendWorkshopReferences(index, 'field')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'field-text' })]),
    )
    expect(getFrontendWorkshopReferences(index, 'variable')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'variable-text' })]),
    )
    expect(getFrontendWorkshopReferences(index, 'next-page')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'page-action' })]),
    )
  })
})
