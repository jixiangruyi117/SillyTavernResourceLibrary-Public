import type { FrontendWorkshopProject } from '../types/FrontendWorkshopProject'

export type FrontendWorkshopReferenceKind =
  'node' | 'behavior' | 'hotspot' | 'field' | 'asset' | 'state' | 'variable' | 'page'

export interface FrontendWorkshopReference {
  kind: FrontendWorkshopReferenceKind
  id: string
  path: string
}

export function frontendWorkshopMvuSourceReferenceId(path: string): string {
  return `mvu:${path}`
}

export type FrontendWorkshopReferenceIndex = ReadonlyMap<
  string,
  readonly FrontendWorkshopReference[]
>

function addReference(
  index: Map<string, FrontendWorkshopReference[]>,
  id: string | undefined,
  reference: FrontendWorkshopReference,
): void {
  if (!id) return
  const entries = index.get(id) ?? []
  entries.push(reference)
  index.set(id, entries)
}

/** 为删除、复制与清理提供同一份当前模型引用事实，不通过 DOM selector 反查对象。 */
export function buildFrontendWorkshopReferenceIndex(
  project: FrontendWorkshopProject,
): FrontendWorkshopReferenceIndex {
  const index = new Map<string, FrontendWorkshopReference[]>()

  project.fields.forEach((field, fieldIndex) => {
    if (field.source?.provider === 'mvu')
      addReference(index, frontendWorkshopMvuSourceReferenceId(field.source.path), {
        kind: 'field',
        id: field.id,
        path: `fields[${fieldIndex}].source.path`,
      })
  })

  const visitNode = (
    node: FrontendWorkshopProject['pages'][number]['nodes'][number],
    path: string,
  ): void => {
    if (node.contentSource?.kind === 'stateField')
      addReference(index, node.contentSource.fieldId, {
        kind: 'node',
        id: node.id,
        path: `${path}.contentSource.fieldId`,
      })
    if (node.contentSource?.kind === 'variable')
      addReference(index, node.contentSource.variableId, {
        kind: 'node',
        id: node.id,
        path: `${path}.contentSource.variableId`,
      })
    if (node.action?.kind === 'page')
      addReference(index, node.action.target, {
        kind: 'node',
        id: node.id,
        path: `${path}.action.target`,
      })
    node.children.forEach((child, childIndex) =>
      visitNode(child, `${path}.children[${childIndex}]`),
    )
  }

  project.pages.forEach((page, pageIndex) =>
    page.nodes.forEach((node, nodeIndex) =>
      visitNode(node, `pages[${pageIndex}].nodes[${nodeIndex}]`),
    ),
  )

  project.behaviors?.forEach((behavior, behaviorIndex) => {
    behavior.targetNodeIds.forEach((nodeId, targetIndex) =>
      addReference(index, nodeId, {
        kind: 'behavior',
        id: behavior.id,
        path: `behaviors[${behaviorIndex}].targetNodeIds[${targetIndex}]`,
      }),
    )
    behavior.conditions.forEach((condition, conditionIndex) =>
      addReference(index, condition.variableId, {
        kind: 'behavior',
        id: behavior.id,
        path: `behaviors[${behaviorIndex}].conditions[${conditionIndex}].variableId`,
      }),
    )
    behavior.actions.forEach((action, actionIndex) => {
      if (action.type === 'toggleState' || action.type === 'setState')
        addReference(index, action.stateGroupId, {
          kind: 'behavior',
          id: behavior.id,
          path: `behaviors[${behaviorIndex}].actions[${actionIndex}].stateGroupId`,
        })
      if (action.type === 'setState')
        addReference(index, action.stateId, {
          kind: 'behavior',
          id: behavior.id,
          path: `behaviors[${behaviorIndex}].actions[${actionIndex}].stateId`,
        })
      if (action.type === 'setVariable')
        addReference(index, action.variableId, {
          kind: 'behavior',
          id: behavior.id,
          path: `behaviors[${behaviorIndex}].actions[${actionIndex}].variableId`,
        })
      if (action.type === 'openScreen')
        addReference(index, action.pageId, {
          kind: 'behavior',
          id: behavior.id,
          path: `behaviors[${behaviorIndex}].actions[${actionIndex}].pageId`,
        })
    })
  })

  project.hotspots?.forEach((hotspot, hotspotIndex) => {
    addReference(index, hotspot.parentNodeId, {
      kind: 'hotspot',
      id: hotspot.id,
      path: `hotspots[${hotspotIndex}].parentNodeId`,
    })
    addReference(index, hotspot.behaviorId, {
      kind: 'hotspot',
      id: hotspot.id,
      path: `hotspots[${hotspotIndex}].behaviorId`,
    })
  })

  return index
}

export function getFrontendWorkshopReferences(
  index: FrontendWorkshopReferenceIndex,
  id: string,
): readonly FrontendWorkshopReference[] {
  return index.get(id) ?? []
}
