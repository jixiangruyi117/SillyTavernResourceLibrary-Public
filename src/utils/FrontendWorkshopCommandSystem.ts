import type {
  FrontendWorkshopBehavior,
  FrontendWorkshopHotspot,
  FrontendWorkshopNode,
  FrontendWorkshopProject,
  FrontendWorkshopStateGroup,
} from '../types/FrontendWorkshopProject'
import { normalizeFrontendWorkshopMvuPath } from './FrontendWorkshopMvuState'
import {
  SCENE_CONSTRAINT_MAX_SIZE,
  SCENE_CONSTRAINT_WIDE_FIELDS,
} from './FrontendWorkshopSceneConstraint'

export interface FrontendWorkshopInvariantIssue {
  code:
    | 'duplicate_id'
    | 'node_cycle'
    | 'missing_layer'
    | 'missing_page'
    | 'missing_field'
    | 'missing_target'
    | 'missing_state'
    | 'missing_variable'
    | 'missing_behavior'
    | 'invalid_field_source'
    | 'invalid_scene_constraint'
  message: string
}

export interface FrontendWorkshopCommandResult {
  ok: boolean
  project: FrontendWorkshopProject
  issues: FrontendWorkshopInvariantIssue[]
}

function cloneProject(project: FrontendWorkshopProject): FrontendWorkshopProject {
  return structuredClone(project)
}

function hasValidSceneSize(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= SCENE_CONSTRAINT_MAX_SIZE
  )
}

function hasValidSceneConstraint(node: FrontendWorkshopNode): boolean {
  const constraint = node.constraint
  if (!constraint) return true

  const validateValues = (value: Record<string, unknown>, isOverride = false): boolean => {
    if (
      (!isOverride && !['hug', 'fill', 'fixed', 'percent'].includes(String(value.widthMode))) ||
      (value.widthMode !== undefined &&
        !['hug', 'fill', 'fixed', 'percent'].includes(String(value.widthMode)))
    )
      return false
    if (
      (!isOverride && !['hug', 'fixed', 'fill'].includes(String(value.heightMode))) ||
      (value.heightMode !== undefined &&
        !['hug', 'fixed', 'fill'].includes(String(value.heightMode)))
    )
      return false
    if (value.widthMode === 'fixed' && !hasValidSceneSize(value.widthValue)) return false
    if (
      value.widthMode === 'percent' &&
      (typeof value.widthValue !== 'number' ||
        !Number.isFinite(value.widthValue) ||
        value.widthValue < 1 ||
        value.widthValue > 100)
    )
      return false
    if (value.heightMode === 'fixed' && !hasValidSceneSize(value.heightValue)) return false
    for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) {
      if (value[key] !== undefined && !hasValidSceneSize(value[key])) return false
    }
    if (
      typeof value.minWidth === 'number' &&
      typeof value.maxWidth === 'number' &&
      value.minWidth > value.maxWidth
    )
      return false
    if (
      typeof value.minHeight === 'number' &&
      typeof value.maxHeight === 'number' &&
      value.minHeight > value.maxHeight
    )
      return false
    if (
      value.aspectRatio !== undefined &&
      (typeof value.aspectRatio !== 'number' ||
        !Number.isFinite(value.aspectRatio) ||
        value.aspectRatio <= 0 ||
        value.aspectRatio > 100)
    )
      return false
    return true
  }

  if (!validateValues(constraint as unknown as Record<string, unknown>)) return false
  if (!constraint.wide) return true
  if (
    !Object.keys(constraint.wide).every((key) =>
      SCENE_CONSTRAINT_WIDE_FIELDS.includes(key as never),
    )
  )
    return false
  if (!validateValues(constraint.wide as Record<string, unknown>, true)) return false
  const effectiveWide = { ...constraint, ...constraint.wide }
  if (
    effectiveWide.minWidth !== undefined &&
    effectiveWide.maxWidth !== undefined &&
    effectiveWide.minWidth > effectiveWide.maxWidth
  )
    return false
  if (
    effectiveWide.minHeight !== undefined &&
    effectiveWide.maxHeight !== undefined &&
    effectiveWide.minHeight > effectiveWide.maxHeight
  )
    return false
  return true
}

function createUniqueId(usedIds: Set<string>): string {
  let id = crypto.randomUUID()
  while (usedIds.has(id)) id = crypto.randomUUID()
  usedIds.add(id)
  return id
}

function collectNodeIds(nodes: FrontendWorkshopNode[], ids = new Set<string>()): Set<string> {
  for (const node of nodes) {
    ids.add(node.id)
    collectNodeIds(node.children, ids)
  }
  return ids
}

function rekeyNodeSubtree(
  node: FrontendWorkshopNode,
  nodeIdMap: Map<string, string>,
  usedNodeIds: Set<string>,
): void {
  const previousId = node.id
  const nextId = createUniqueId(usedNodeIds)
  nodeIdMap.set(previousId, nextId)
  node.id = nextId
  node.children.forEach((child) => rekeyNodeSubtree(child, nodeIdMap, usedNodeIds))
}

function behaviorStateGroupIds(behaviors: FrontendWorkshopBehavior[]): Set<string> {
  return new Set(
    behaviors.flatMap((behavior) =>
      behavior.actions.flatMap((action) =>
        action.type === 'toggleState' || action.type === 'setState' ? [action.stateGroupId] : [],
      ),
    ),
  )
}

function stateGroupOnlyReferencesNodes(
  stateGroup: FrontendWorkshopStateGroup,
  nodeIds: ReadonlySet<string>,
): boolean {
  return (stateGroup.variants ?? [])
    .flatMap((variant) => variant.nodeOverrides)
    .every((override) => nodeIds.has(override.nodeId))
}

function cleanNodeRelations(
  project: FrontendWorkshopProject,
  removedNodeIds: ReadonlySet<string>,
): void {
  const removedBehaviors = (project.behaviors ?? []).filter((behavior) =>
    behavior.targetNodeIds.some((nodeId) => removedNodeIds.has(nodeId)),
  )
  const removedBehaviorIds = new Set(removedBehaviors.map((behavior) => behavior.id))
  const helperStateGroupIds = behaviorStateGroupIds(removedBehaviors)
  const remainingBehaviors = (project.behaviors ?? []).filter(
    (behavior) => !removedBehaviorIds.has(behavior.id),
  )
  const retainedBehaviorStateGroupIds = behaviorStateGroupIds(remainingBehaviors)

  project.behaviors = remainingBehaviors
  project.states = (project.states ?? [])
    .map((stateGroup) => ({
      ...stateGroup,
      variants: stateGroup.variants?.map((variant) => ({
        ...variant,
        nodeOverrides: variant.nodeOverrides.filter(
          (override) => !removedNodeIds.has(override.nodeId),
        ),
      })),
    }))
    .filter(
      (stateGroup) =>
        !helperStateGroupIds.has(stateGroup.id) ||
        retainedBehaviorStateGroupIds.has(stateGroup.id) ||
        (stateGroup.variants ?? []).some((variant) => variant.nodeOverrides.length > 0),
    )
  project.hotspots = (project.hotspots ?? []).filter(
    (hotspot) =>
      !removedNodeIds.has(hotspot.parentNodeId) && !removedBehaviorIds.has(hotspot.behaviorId),
  )
}

export function duplicateFrontendWorkshopNodeSubtree(
  source: FrontendWorkshopNode,
  existingNodeIds: ReadonlySet<string>,
): { node: FrontendWorkshopNode; nodeIdMap: ReadonlyMap<string, string> } {
  const node = structuredClone(source)
  const nodeIdMap = new Map<string, string>()
  rekeyNodeSubtree(node, nodeIdMap, new Set(existingNodeIds))
  return { node, nodeIdMap }
}

export function removeFrontendWorkshopNodeSubtree(
  project: FrontendWorkshopProject,
  pageId: string,
  nodeId: string,
): boolean {
  const page = project.pages.find((item) => item.id === pageId)
  const node = page ? findNode(page.nodes, nodeId) : undefined
  if (!page || !node) return false

  const removedNodeIds = collectNodeIds([node])
  const parent = findNodeParent(page.nodes, nodeId) ?? page.nodes
  const index = parent.findIndex((item) => item.id === nodeId)
  if (index < 0) return false
  parent.splice(index, 1)
  cleanNodeRelations(project, removedNodeIds)
  return true
}

export function countExternalGreetingPageReferences(
  project: FrontendWorkshopProject,
  pageId: string,
): number {
  const page = project.pages.find((item) => item.id === pageId)
  if (!page) return 0
  const pageNodeIds = collectNodeIds(page.nodes)
  const behaviorIdsRemovedWithPage = new Set(
    (project.behaviors ?? [])
      .filter((behavior) => behavior.targetNodeIds.some((nodeId) => pageNodeIds.has(nodeId)))
      .map((behavior) => behavior.id),
  )
  let referenceCount = 0
  const visitNode = (node: FrontendWorkshopNode): void => {
    if (node.action?.kind === 'page' && node.action.target === pageId) referenceCount += 1
    node.children.forEach(visitNode)
  }
  project.pages
    .filter((item) => item.id !== pageId)
    .forEach((item) => item.nodes.forEach(visitNode))
  for (const behavior of project.behaviors ?? []) {
    if (behaviorIdsRemovedWithPage.has(behavior.id)) continue
    referenceCount += behavior.actions.filter(
      (action) => action.type === 'openScreen' && action.pageId === pageId,
    ).length
  }
  return referenceCount
}

export function removeFrontendWorkshopGreetingPage(
  project: FrontendWorkshopProject,
  pageId: string,
): boolean {
  const page = project.pages.find((item) => item.id === pageId)
  if (!page || countExternalGreetingPageReferences(project, pageId) > 0) return false
  cleanNodeRelations(project, collectNodeIds(page.nodes))
  project.pages = project.pages.filter((item) => item.id !== pageId)
  return true
}

export function duplicateFrontendWorkshopGreetingPage(
  project: FrontendWorkshopProject,
  sourcePageId: string,
): string | undefined {
  const source = project.pages.find((page) => page.id === sourcePageId)
  if (!source) return undefined

  const page = structuredClone(source)
  const pageId = createUniqueId(new Set(project.pages.map((item) => item.id)))
  const layerIdMap = new Map<string, string>()
  const usedLayerIds = new Set(
    project.pages.flatMap((item) => item.layers.map((layer) => layer.id)),
  )
  page.id = pageId
  page.layers.forEach((layer) => {
    const nextLayerId = createUniqueId(usedLayerIds)
    layerIdMap.set(layer.id, nextLayerId)
    layer.id = nextLayerId
  })

  const sourceNodeIds = collectNodeIds(source.nodes)
  const nodeIdMap = new Map<string, string>()
  const usedNodeIds = collectNodeIds(project.pages.flatMap((item) => item.nodes))
  page.nodes.forEach((node) => rekeyNodeSubtree(node, nodeIdMap, usedNodeIds))
  const rekeyNodeReferences = (node: FrontendWorkshopNode): void => {
    if (node.layerId) node.layerId = layerIdMap.get(node.layerId)
    if (node.action?.kind === 'page' && node.action.target === sourcePageId)
      node.action.target = pageId
    node.children.forEach(rekeyNodeReferences)
  }
  page.nodes.forEach(rekeyNodeReferences)

  const copyableStateGroups = new Map(
    (project.states ?? [])
      .filter((stateGroup) => stateGroupOnlyReferencesNodes(stateGroup, sourceNodeIds))
      .map((stateGroup) => [stateGroup.id, stateGroup]),
  )
  const scopedBehaviors = (project.behaviors ?? []).filter(
    (behavior) =>
      behavior.targetNodeIds.length > 0 &&
      behavior.targetNodeIds.every((nodeId) => sourceNodeIds.has(nodeId)) &&
      behavior.actions.every(
        (action) =>
          (action.type !== 'toggleState' && action.type !== 'setState') ||
          copyableStateGroups.has(action.stateGroupId),
      ),
  )
  const copiedStateGroupIds = new Set(
    [...copyableStateGroups.values()]
      .filter(
        (stateGroup) =>
          (stateGroup.variants ?? []).some((variant) => variant.nodeOverrides.length > 0) ||
          behaviorStateGroupIds(scopedBehaviors).has(stateGroup.id),
      )
      .map((stateGroup) => stateGroup.id),
  )
  const usedStateGroupIds = new Set((project.states ?? []).map((stateGroup) => stateGroup.id))
  const usedStateIds = new Set(
    (project.states ?? []).flatMap((stateGroup) => stateGroup.states.map((state) => state.id)),
  )
  const stateGroupIdMap = new Map<string, string>()
  const stateIdMap = new Map<string, string>()
  const states = [...copiedStateGroupIds].map((stateGroupId) => {
    const stateGroup = structuredClone(copyableStateGroups.get(stateGroupId)!)
    const nextStateGroupId = createUniqueId(usedStateGroupIds)
    stateGroupIdMap.set(stateGroup.id, nextStateGroupId)
    stateGroup.id = nextStateGroupId
    stateGroup.states.forEach((state) => {
      const nextStateId = createUniqueId(usedStateIds)
      stateIdMap.set(state.id, nextStateId)
      state.id = nextStateId
    })
    stateGroup.defaultStateId = stateIdMap.get(stateGroup.defaultStateId)!
    stateGroup.variants?.forEach((variant) => {
      variant.stateId = stateIdMap.get(variant.stateId)!
      variant.nodeOverrides.forEach((override) => {
        override.nodeId = nodeIdMap.get(override.nodeId)!
      })
    })
    return stateGroup
  })

  const usedBehaviorIds = new Set((project.behaviors ?? []).map((behavior) => behavior.id))
  const behaviorIdMap = new Map<string, string>()
  const behaviors = scopedBehaviors.map((sourceBehavior) => {
    const behavior = structuredClone(sourceBehavior)
    const nextBehaviorId = createUniqueId(usedBehaviorIds)
    behaviorIdMap.set(behavior.id, nextBehaviorId)
    behavior.id = nextBehaviorId
    behavior.targetNodeIds = behavior.targetNodeIds.map((nodeId) => nodeIdMap.get(nodeId)!)
    behavior.actions.forEach((action) => {
      if (action.type === 'toggleState' || action.type === 'setState') {
        action.stateGroupId = stateGroupIdMap.get(action.stateGroupId)!
        if (action.type === 'setState') action.stateId = stateIdMap.get(action.stateId)!
      }
      if (action.type === 'openScreen' && action.pageId === sourcePageId) action.pageId = pageId
    })
    return behavior
  })

  const usedHotspotIds = new Set((project.hotspots ?? []).map((hotspot) => hotspot.id))
  const hotspots: FrontendWorkshopHotspot[] = (project.hotspots ?? [])
    .filter(
      (hotspot) => sourceNodeIds.has(hotspot.parentNodeId) && behaviorIdMap.has(hotspot.behaviorId),
    )
    .map((sourceHotspot) => ({
      ...structuredClone(sourceHotspot),
      id: createUniqueId(usedHotspotIds),
      parentNodeId: nodeIdMap.get(sourceHotspot.parentNodeId)!,
      behaviorId: behaviorIdMap.get(sourceHotspot.behaviorId)!,
    }))

  project.pages.push(page)
  if (states.length) project.states = [...(project.states ?? []), ...states]
  if (behaviors.length) project.behaviors = [...(project.behaviors ?? []), ...behaviors]
  if (hotspots.length) project.hotspots = [...(project.hotspots ?? []), ...hotspots]
  return pageId
}

function findNode(nodes: FrontendWorkshopNode[], id: string): FrontendWorkshopNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findNode(node.children, id)
    if (child) return child
  }
  return undefined
}

function findNodeParent(
  nodes: FrontendWorkshopNode[],
  id: string,
): FrontendWorkshopNode[] | undefined {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === id)) return node.children
    const childParent = findNodeParent(node.children, id)
    if (childParent) return childParent
  }
  return undefined
}

/**
 * Command 的不变量门禁。它仅判定数据关系，不编译或持久化，
 * 因此失败时调用方仍可保留执行前的内存快照。
 */
export function validateFrontendWorkshopProject(
  project: FrontendWorkshopProject,
): FrontendWorkshopInvariantIssue[] {
  const issues: FrontendWorkshopInvariantIssue[] = []
  const nodeIds = new Set<string>()
  const pageIds = new Set(project.pages.map((page) => page.id))
  const fieldIds = new Set(project.fields.map((field) => field.id))
  const variableIds = new Set((project.variables ?? []).map((variable) => variable.id))
  const stateGroupIds = new Set((project.states ?? []).map((group) => group.id))
  const stateIds = new Set(
    (project.states ?? []).flatMap((group) => group.states.map((state) => state.id)),
  )
  const seen = new WeakSet<object>()

  project.fields.forEach((field) => {
    if (
      field.source &&
      (field.source.provider !== 'mvu' || !normalizeFrontendWorkshopMvuPath(field.source.path))
    )
      issues.push({
        code: 'invalid_field_source',
        message: `状态字段 ${field.id} 的 MVU 路径不合法。`,
      })
  })

  const visitNode = (node: FrontendWorkshopNode, layerIds: Set<string>): void => {
    if (seen.has(node)) {
      issues.push({ code: 'node_cycle', message: `节点 ${node.id} 存在循环父子引用。` })
      return
    }
    seen.add(node)
    if (nodeIds.has(node.id))
      issues.push({ code: 'duplicate_id', message: `节点 ID 重复：${node.id}` })
    nodeIds.add(node.id)
    if (node.layerId && !layerIds.has(node.layerId))
      issues.push({ code: 'missing_layer', message: `节点 ${node.id} 指向不存在的图层。` })
    if (node.contentSource?.kind === 'stateField' && !fieldIds.has(node.contentSource.fieldId))
      issues.push({ code: 'missing_field', message: `文字 ${node.id} 绑定了不存在的状态字段。` })
    if (node.contentSource?.kind === 'variable' && !variableIds.has(node.contentSource.variableId))
      issues.push({ code: 'missing_variable', message: `文字 ${node.id} 绑定了不存在的变量。` })
    if (node.control?.variableId && !variableIds.has(node.control.variableId))
      issues.push({ code: 'missing_variable', message: `控件 ${node.id} 绑定了不存在的变量。` })
    if (node.action?.kind === 'page' && (!node.action.target || !pageIds.has(node.action.target)))
      issues.push({ code: 'missing_page', message: `节点 ${node.id} 指向不存在的页面。` })
    if (!hasValidSceneConstraint(node))
      issues.push({
        code: 'invalid_scene_constraint',
        message: `节点 ${node.id} 的尺寸约束不合法。`,
      })
    node.children.forEach((child) => visitNode(child, layerIds))
    seen.delete(node)
  }

  project.pages.forEach((page) => {
    const layerIds = new Set(page.layers.map((layer) => layer.id))
    page.nodes.forEach((node) => visitNode(node, layerIds))
  })

  project.behaviors?.forEach((behavior) => {
    behavior.targetNodeIds.forEach((nodeId) => {
      if (!nodeIds.has(nodeId))
        issues.push({ code: 'missing_target', message: `行为 ${behavior.id} 指向不存在的节点。` })
    })
    behavior.conditions.forEach((condition) => {
      if (!variableIds.has(condition.variableId))
        issues.push({ code: 'missing_variable', message: `行为 ${behavior.id} 指向不存在的变量。` })
    })
    behavior.actions.forEach((action) => {
      if (action.type === 'toggleState' && !stateGroupIds.has(action.stateGroupId))
        issues.push({ code: 'missing_state', message: `行为 ${behavior.id} 指向不存在的状态组。` })
      if (
        action.type === 'setState' &&
        (!stateGroupIds.has(action.stateGroupId) || !stateIds.has(action.stateId))
      )
        issues.push({ code: 'missing_state', message: `行为 ${behavior.id} 指向不存在的状态。` })
      if (action.type === 'setVariable' && !variableIds.has(action.variableId))
        issues.push({ code: 'missing_variable', message: `行为 ${behavior.id} 指向不存在的变量。` })
      if (action.type === 'openScreen' && !pageIds.has(action.pageId))
        issues.push({ code: 'missing_page', message: `行为 ${behavior.id} 指向不存在的页面。` })
    })
  })

  project.states?.forEach((group) => {
    group.variants?.forEach((variant) => {
      if (!stateIds.has(variant.stateId))
        issues.push({
          code: 'missing_state',
          message: `状态变体指向不存在的状态：${variant.stateId}`,
        })
      variant.nodeOverrides.forEach((override) => {
        if (!nodeIds.has(override.nodeId))
          issues.push({
            code: 'missing_target',
            message: `状态变体指向不存在的节点：${override.nodeId}`,
          })
      })
    })
  })

  const behaviorIds = new Set((project.behaviors ?? []).map((behavior) => behavior.id))
  project.hotspots?.forEach((hotspot) => {
    if (!nodeIds.has(hotspot.parentNodeId))
      issues.push({ code: 'missing_target', message: `热区 ${hotspot.id} 指向不存在的父节点。` })
    if (!behaviorIds.has(hotspot.behaviorId))
      issues.push({ code: 'missing_behavior', message: `热区 ${hotspot.id} 指向不存在的行为。` })
  })

  return issues
}

export function applyFrontendWorkshopCommand(
  current: FrontendWorkshopProject,
  apply: (draft: FrontendWorkshopProject) => void,
): FrontendWorkshopCommandResult {
  const draft = cloneProject(current)
  apply(draft)
  const issues = validateFrontendWorkshopProject(draft)
  return issues.length
    ? { ok: false, project: current, issues }
    : { ok: true, project: draft, issues: [] }
}
