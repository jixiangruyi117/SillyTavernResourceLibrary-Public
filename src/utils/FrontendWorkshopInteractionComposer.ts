import type {
  FrontendWorkshopBehavior,
  FrontendWorkshopBehaviorAction,
  FrontendWorkshopBehaviorTrigger,
  FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'

export type FrontendWorkshopComposerEffect =
  'show' | 'hide' | 'toggle' | 'toggleState' | 'setState' | 'openScreen' | 'setVariable'

export interface FrontendWorkshopComposerDraft {
  trigger: FrontendWorkshopBehaviorTrigger
  triggerNodeIds: string[]
  effect: FrontendWorkshopComposerEffect
  affectedNodeIds: string[]
  stateGroupId?: string
  stateId?: string
  pageId?: string
  variableId?: string
  variableValue?: string | number | boolean
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean))).slice(0, 48)
}

function interactionStates(
  project: FrontendWorkshopProject,
  label: string,
  affectedNodeIds: string[],
  effect: 'show' | 'hide' | 'toggle',
): FrontendWorkshopBehaviorAction | undefined {
  const nodeIds = uniqueIds(affectedNodeIds)
  if (!nodeIds.length) return undefined
  const groupId = crypto.randomUUID()
  const initialId = crypto.randomUUID()
  const changedId = crypto.randomUUID()
  const initialVisible = effect !== 'show'
  const changedVisible = effect === 'show'
  project.states ??= []
  project.states.push({
    id: groupId,
    name: `交互：${label}`.slice(0, 80),
    defaultStateId: initialId,
    states: [
      { id: initialId, name: initialVisible ? '显示' : '隐藏' },
      { id: changedId, name: changedVisible ? '显示' : '隐藏' },
    ],
    variants: [
      {
        stateId: initialId,
        nodeOverrides: nodeIds.map((nodeId) => ({ nodeId, visible: initialVisible })),
      },
      {
        stateId: changedId,
        nodeOverrides: nodeIds.map((nodeId) => ({ nodeId, visible: changedVisible })),
      },
    ],
  })
  return effect === 'toggle'
    ? { type: 'toggleState', stateGroupId: groupId }
    : { type: 'setState', stateGroupId: groupId, stateId: changedId }
}

/** 普通交互只组装现有 State / Behavior，不写入第二套运行时或节点模型。 */
export function createFrontendWorkshopComposerBehavior(
  project: FrontendWorkshopProject,
  draft: FrontendWorkshopComposerDraft,
  label: string,
): FrontendWorkshopBehavior | undefined {
  const triggerNodeIds = uniqueIds(draft.triggerNodeIds)
  if (!triggerNodeIds.length) return undefined
  let action: FrontendWorkshopBehaviorAction | undefined
  if (draft.effect === 'show' || draft.effect === 'hide' || draft.effect === 'toggle') {
    action = interactionStates(project, label, draft.affectedNodeIds, draft.effect)
  } else if (draft.effect === 'toggleState' && draft.stateGroupId) {
    action = { type: 'toggleState', stateGroupId: draft.stateGroupId }
  } else if (draft.effect === 'setState' && draft.stateGroupId && draft.stateId) {
    action = { type: 'setState', stateGroupId: draft.stateGroupId, stateId: draft.stateId }
  } else if (draft.effect === 'openScreen' && draft.pageId) {
    action = { type: 'openScreen', pageId: draft.pageId }
  } else if (
    draft.effect === 'setVariable' &&
    draft.variableId &&
    draft.variableValue !== undefined
  ) {
    action = { type: 'setVariable', variableId: draft.variableId, value: draft.variableValue }
  }
  if (!action) return undefined
  return {
    id: crypto.randomUUID(),
    name: `交互：${label}`.slice(0, 80),
    trigger: draft.trigger,
    targetNodeIds: triggerNodeIds,
    conditions: [],
    actions: [action],
    propagation: 'stop',
  }
}

export function composerEffectForBehavior(
  project: FrontendWorkshopProject,
  behavior: FrontendWorkshopBehavior,
): FrontendWorkshopComposerEffect | undefined {
  const action = behavior.actions[0]
  if (!action) return undefined
  if (action.type === 'openScreen') return 'openScreen'
  if (action.type === 'setVariable') return 'setVariable'
  if (action.type === 'setState') return 'setState'
  if (action.type !== 'toggleState') return undefined
  const group = project.states?.find((item) => item.id === action.stateGroupId)
  const variants = group?.variants ?? []
  if (variants.length !== 2) return 'toggleState'
  const values = variants.flatMap((variant) => variant.nodeOverrides.map((item) => item.visible))
  return values.includes(true) && values.includes(false) ? 'toggle' : 'toggleState'
}
