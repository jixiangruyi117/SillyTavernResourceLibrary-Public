import { describe, expect, it } from 'vitest'
import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'
import { createFrontendWorkshopComposerBehavior } from './FrontendWorkshopInteractionComposer'

describe('FrontendWorkshopInteractionComposer', () => {
  it('用现有 State Variant 创建任意元素的显示和隐藏交互', () => {
    const project = createFrontendWorkshopProject('greeting')
    const behavior = createFrontendWorkshopComposerBehavior(
      project,
      { trigger: 'tap', triggerNodeIds: ['button'], effect: 'show', affectedNodeIds: ['note'] },
      '显示说明',
    )

    expect(behavior?.actions[0]).toMatchObject({ type: 'setState' })
    expect(project.states?.[0]?.variants).toEqual([
      {
        stateId: project.states?.[0]?.states[0]?.id,
        nodeOverrides: [{ nodeId: 'note', visible: false }],
      },
      {
        stateId: project.states?.[0]?.states[1]?.id,
        nodeOverrides: [{ nodeId: 'note', visible: true }],
      },
    ])
  })
})
