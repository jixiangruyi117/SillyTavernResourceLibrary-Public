import { describe, expect, it } from 'vitest'

import { getFrontendWorkshopBehaviorConflicts } from './FrontendWorkshopBehaviorConflict'

describe('getFrontendWorkshopBehaviorConflicts', () => {
  it('标记同一元素同一触发器上的停止传播竞争', () => {
    const conflicts = getFrontendWorkshopBehaviorConflicts([
      {
        id: 'first',
        name: '第一项',
        trigger: 'tap',
        targetNodeIds: ['card'],
        conditions: [],
        actions: [{ type: 'openScreen', pageId: 'page' }],
        propagation: 'stop',
      },
      {
        id: 'second',
        name: '第二项',
        trigger: 'tap',
        targetNodeIds: ['card'],
        conditions: [],
        actions: [{ type: 'openScreen', pageId: 'page' }],
        propagation: 'continue',
      },
    ])

    expect(conflicts).toMatchObject([
      { nodeId: 'card', trigger: 'tap', behaviorIds: ['first', 'second'] },
    ])
  })

  it('允许不同触发器或全部继续传播的行为共存', () => {
    expect(
      getFrontendWorkshopBehaviorConflicts([
        {
          id: 'tap',
          name: '点击',
          trigger: 'tap',
          targetNodeIds: ['card'],
          conditions: [],
          actions: [{ type: 'openScreen', pageId: 'page' }],
          propagation: 'continue',
        },
        {
          id: 'swipe',
          name: '左滑',
          trigger: 'swipeLeft',
          targetNodeIds: ['card'],
          conditions: [],
          actions: [{ type: 'openScreen', pageId: 'page' }],
          propagation: 'continue',
        },
      ]),
    ).toEqual([])
  })
})
