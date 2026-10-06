import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'
import {
  createFrontendWorkshopBehaviorRuntimeState,
  dispatchFrontendWorkshopBehavior,
  frontendWorkshopBehaviorRuntimeScript,
} from './FrontendWorkshopBehaviorRuntime'

describe('FrontendWorkshopBehaviorRuntime', () => {
  it('按条件执行多个受控动作，并在 stop 后停止传播', () => {
    const project = createFrontendWorkshopProject('greeting', 10)
    project.pages.push({ id: 'details', name: '详情', layers: [], nodes: [] })
    project.states = [
      {
        id: 'card-state',
        name: '人物卡',
        defaultStateId: 'front',
        states: [
          { id: 'front', name: '正面' },
          { id: 'back', name: '背面' },
        ],
      },
    ]
    project.variables = [{ id: 'unlocked', name: '已解锁', value: false }]
    project.pages[0]!.nodes.push({
      id: 'portrait',
      kind: 'block',
      label: '人物卡',
      style: {},
      children: [],
    })
    project.behaviors = [
      {
        id: 'first',
        name: '翻面并打开详情',
        trigger: 'tap',
        targetNodeIds: ['portrait'],
        conditions: [{ variableId: 'unlocked', operator: 'eq', value: false }],
        actions: [
          { type: 'toggleState', stateGroupId: 'card-state' },
          { type: 'setVariable', variableId: 'unlocked', value: true },
          { type: 'openScreen', pageId: 'details' },
        ],
        propagation: 'stop',
      },
      {
        id: 'second',
        name: '不应执行',
        trigger: 'tap',
        targetNodeIds: ['portrait'],
        conditions: [],
        actions: [{ type: 'setState', stateGroupId: 'card-state', stateId: 'front' }],
        propagation: 'continue',
      },
    ]

    const result = dispatchFrontendWorkshopBehavior(
      project,
      createFrontendWorkshopBehaviorRuntimeState(project),
      'portrait',
      'tap',
    )

    expect(result.executedBehaviorIds).toEqual(['first'])
    expect(result.state).toMatchObject({
      activeStateIds: { 'card-state': 'back' },
      variables: { unlocked: true },
      currentPageId: 'details',
    })
  })

  it('连续派发复用同一运行时状态，不会重置已切换的状态', () => {
    const project = createFrontendWorkshopProject('greeting', 10)
    project.pages[0]!.nodes.push({
      id: 'card',
      kind: 'block',
      label: '卡片',
      style: {},
      children: [],
    })
    project.states = [
      {
        id: 'flip',
        name: '翻转',
        defaultStateId: 'front',
        states: [
          { id: 'front', name: '正面' },
          { id: 'back', name: '背面' },
        ],
      },
    ]
    project.behaviors = [
      {
        id: 'toggle',
        name: '切换',
        trigger: 'tap',
        targetNodeIds: ['card'],
        conditions: [],
        actions: [{ type: 'toggleState', stateGroupId: 'flip' }],
        propagation: 'stop',
      },
    ]
    const initial = createFrontendWorkshopBehaviorRuntimeState(project)
    const first = dispatchFrontendWorkshopBehavior(project, initial, 'card', 'tap')
    const second = dispatchFrontendWorkshopBehavior(project, first.state, 'card', 'tap')
    expect(first.state.activeStateIds.flip).toBe('back')
    expect(second.state.activeStateIds.flip).toBe('front')
  })

  it('浏览器 Runtime 自己沿真实 DOM 祖先链分发，不再叠 synthetic click 或 MutationObserver', () => {
    const runtime = frontendWorkshopBehaviorRuntimeScript()

    expect(runtime).toContain('while(node&&root.contains(node))')
    expect(runtime).not.toContain('syncGuidedFlip')
    expect(runtime).not.toContain('dispatchEvent(new MouseEvent')
    expect(runtime).not.toContain('new MutationObserver')
    expect(runtime.match(/root\.addEventListener\('click'/gu)).toHaveLength(1)
  })
})
