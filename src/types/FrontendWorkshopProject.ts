export const FRONTEND_WORKSHOP_PROJECT_VERSION = 10 as const
export const FRONTEND_WORKSHOP_SCHEMA_VERSION = 7 as const

export type FrontendWorkshopProjectKind = 'greeting' | 'status'
export type FrontendWorkshopNodeKind = 'block' | 'text' | 'image' | 'divider' | 'control'

export type FrontendWorkshopPanel = 'structure' | 'content' | 'appearance' | 'interaction' | 'ai'
export type FrontendWorkshopLayoutViewport = 'phone' | 'wide'

export interface FrontendWorkshopSpacingValue {
  top: number
  right: number
  bottom: number
  left: number
}

export interface FrontendWorkshopNodePlacement {
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  locked?: boolean
}

export interface FrontendWorkshopNodeLayout {
  phone?: FrontendWorkshopNodePlacement
  wide?: FrontendWorkshopNodePlacement
}

export type FrontendWorkshopCompositionMode = 'stack' | 'row' | 'grid' | 'overlay'
export type FrontendWorkshopCompositionAlignment = 'start' | 'center' | 'end' | 'stretch'
export type FrontendWorkshopCompositionJustification = 'start' | 'center' | 'end' | 'space-between'

/** 容器内部的受控响应式场景图；最终只编译为 Flex/Grid。 */
export interface FrontendWorkshopComposition {
  mode: FrontendWorkshopCompositionMode
  gap: number
  phoneColumns: 1 | 2 | 3
  wideColumns: 1 | 2 | 3 | 4
  align: FrontendWorkshopCompositionAlignment
  justify: FrontendWorkshopCompositionJustification
}

export type FrontendWorkshopSceneAnchor =
  | 'auto'
  | 'top-start'
  | 'top-center'
  | 'top-end'
  | 'center'
  | 'bottom-start'
  | 'bottom-center'
  | 'bottom-end'
export type FrontendWorkshopSceneWidthMode = 'hug' | 'fill' | 'fixed' | 'percent'
export type FrontendWorkshopSceneHeightMode = 'hug' | 'fixed' | 'fill'

/** 宽屏仅保存相对于手机版发生变化的字段；未保存字段继续继承手机版。 */
export interface FrontendWorkshopSceneConstraintWideOverride {
  anchor?: FrontendWorkshopSceneAnchor
  offsetX?: number
  offsetY?: number
  widthMode?: FrontendWorkshopSceneWidthMode
  widthValue?: number
  heightMode?: FrontendWorkshopSceneHeightMode
  heightValue?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  aspectRatio?: number
}

/** 子积木在父场景中的安全约束，不接受任意 CSS 坐标或表达式。 */
export interface FrontendWorkshopSceneConstraint {
  anchor: FrontendWorkshopSceneAnchor
  offsetX: number
  offsetY: number
  widthMode: FrontendWorkshopSceneWidthMode
  widthValue?: number
  heightMode: FrontendWorkshopSceneHeightMode
  heightValue?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  aspectRatio?: number
  wide?: FrontendWorkshopSceneConstraintWideOverride
}

export interface FrontendWorkshopAction {
  kind: 'page' | 'external' | 'none'
  target?: string
}

/**
 * 手动面板只维护普通、可直接编译为 CSS 的属性。
 * 材质/主题/motif/effect layer/design token/guided recipe/私有动效 capability 等旧抽象已删除；
 * 复杂效果由 Source 或 AI 直接写真实 HTML/CSS/JS。
 */
export interface FrontendWorkshopNodeStyle {
  align?: 'start' | 'center' | 'end'
  tone?: 'plain' | 'soft' | 'accent'
  columns?: 1 | 2
  emphasis?: 'normal' | 'heading' | 'display'
  rotation?: number
  imageFit?: 'cover' | 'contain'
  imageTone?: 'natural' | 'sepia' | 'mono'
  cornerRadius?: number
  cornerRadii?: {
    topLeft: number
    topRight: number
    bottomRight: number
    bottomLeft: number
  }
  opacity?: number
  surfaceColor?: string
  textColor?: string
  fontSize?: number
  fontWeight?: number
  letterSpacing?: number
  lineHeight?: number
  borderWidth?: number
  borderColor?: string
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double'
  shadowColor?: string
  shadowOffsetX?: number
  shadowOffsetY?: number
  shadowBlur?: number
  shadowSpread?: number
  padding?: FrontendWorkshopSpacingValue
  margin?: FrontendWorkshopSpacingValue
}

/** 文字内容可来自手工输入、状态字段或项目变量，节点类型本身不承担数据绑定语义。 */
export type FrontendWorkshopContentSource =
  | { kind: 'manual' }
  | { kind: 'stateField'; fieldId: string }
  | { kind: 'variable'; variableId: string }

export type FrontendWorkshopControlType =
  'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'radio'

export interface FrontendWorkshopControlOption {
  id: string
  label: string
  value: string
}

/** 表单控件仍是普通 Node；变量是唯一的输入状态来源。 */
export interface FrontendWorkshopControl {
  type: FrontendWorkshopControlType
  variableId?: string
  placeholder?: string
  required?: boolean
  options?: FrontendWorkshopControlOption[]
  min?: number
  max?: number
  step?: number
}

export interface FrontendWorkshopNode {
  id: string
  layerId?: string
  semanticRole?: string
  hidden?: boolean
  kind: FrontendWorkshopNodeKind
  label: string
  text?: string
  imageUrl?: string
  contentSource?: FrontendWorkshopContentSource
  control?: FrontendWorkshopControl
  action?: FrontendWorkshopAction
  style: FrontendWorkshopNodeStyle
  layout?: FrontendWorkshopNodeLayout
  composition?: FrontendWorkshopComposition
  constraint?: FrontendWorkshopSceneConstraint
  children: FrontendWorkshopNode[]
}

export interface FrontendWorkshopLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

export interface FrontendWorkshopPage {
  id: string
  name: string
  layers: FrontendWorkshopLayer[]
  nodes: FrontendWorkshopNode[]
}

export interface FrontendWorkshopField {
  id: string
  label: string
  sample: string
  path: string
  kind: 'text' | 'number' | 'tag' | 'list' | 'longText'
  source?: {
    provider: 'mvu'
    path: string
  }
}

export interface FrontendWorkshopAssetLink {
  id: string
  name: string
  url: string
  createdAt: number
}

export interface FrontendWorkshopAsset {
  id: string
  kind: 'image' | 'font' | 'reference'
  name: string
  url: string
  createdAt: number
}

export interface FrontendWorkshopState {
  id: string
  name: string
}

/** 某个状态下对既有普通节点施加的受控视觉差异。 */
export interface FrontendWorkshopStateVariant {
  stateId: string
  nodeOverrides: Array<{
    nodeId: string
    visible?: boolean
    style?: Partial<FrontendWorkshopNodeStyle>
  }>
}

export interface FrontendWorkshopStateGroup {
  id: string
  name: string
  defaultStateId: string
  states: FrontendWorkshopState[]
  variants?: FrontendWorkshopStateVariant[]
}

export interface FrontendWorkshopVariable {
  id: string
  name: string
  value: string | number | boolean
}

export type FrontendWorkshopBehaviorTrigger = 'tap' | 'longPress' | 'swipeLeft' | 'swipeRight'
export type FrontendWorkshopBehaviorAction =
  | { type: 'toggleState'; stateGroupId: string }
  | { type: 'setState'; stateGroupId: string; stateId: string }
  | { type: 'setVariable'; variableId: string; value: string | number | boolean }
  | { type: 'openScreen'; pageId: string }

export interface FrontendWorkshopBehaviorCondition {
  variableId: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string | number | boolean
}

/** 普通交互只描述触发、目标和动作，不再绑定 guided recipe。 */
export interface FrontendWorkshopBehavior {
  id: string
  name: string
  trigger: FrontendWorkshopBehaviorTrigger
  targetNodeIds: string[]
  conditions: FrontendWorkshopBehaviorCondition[]
  actions: FrontendWorkshopBehaviorAction[]
  propagation: 'stop' | 'continue'
}

/** 手绘热区只保存相对父容器的百分比坐标，运行时才生成一次命中区域。 */
export interface FrontendWorkshopHotspot {
  id: string
  name: string
  parentNodeId: string
  behaviorId: string
  x: number
  y: number
  width: number
  height: number
}

export interface FrontendWorkshopProjectLastGoodRecord {
  id: string
  projectId: string
  project: FrontendWorkshopProject
  savedAt: number
}

export interface FrontendWorkshopProject {
  id: string
  version: typeof FRONTEND_WORKSHOP_PROJECT_VERSION
  schemaVersion: typeof FRONTEND_WORKSHOP_SCHEMA_VERSION
  document: {
    id: string
    name: string
  }
  kind: FrontendWorkshopProjectKind
  name: string
  createdAt: number
  updatedAt: number
  pages: FrontendWorkshopPage[]
  fields: FrontendWorkshopField[]
  assetLinks?: FrontendWorkshopAssetLink[]
  assets?: FrontendWorkshopAsset[]
  states?: FrontendWorkshopStateGroup[]
  variables?: FrontendWorkshopVariable[]
  behaviors?: FrontendWorkshopBehavior[]
  hotspots?: FrontendWorkshopHotspot[]
}

export function createFrontendWorkshopProject(
  kind: FrontendWorkshopProjectKind,
  now = Date.now(),
): FrontendWorkshopProject {
  const id = crypto.randomUUID()
  const pageId = crypto.randomUUID()
  return {
    id,
    version: FRONTEND_WORKSHOP_PROJECT_VERSION,
    schemaVersion: FRONTEND_WORKSHOP_SCHEMA_VERSION,
    document: { id, name: kind === 'greeting' ? '未命名开场白' : '未命名状态栏' },
    kind,
    name: kind === 'greeting' ? '未命名开场白' : '未命名状态栏',
    createdAt: now,
    updatedAt: now,
    pages: [
      {
        id: pageId,
        name: '首页',
        layers: [{ id: `layer-${pageId}`, name: '默认图层', visible: true, locked: false }],
        nodes: [],
      },
    ],
    fields: [],
  }
}

export function findFrontendWorkshopNode(
  nodes: FrontendWorkshopNode[],
  id: string,
): FrontendWorkshopNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findFrontendWorkshopNode(node.children, id)
    if (child) return child
  }
  return undefined
}

export function getNodeAncestorPath(
  nodes: FrontendWorkshopNode[],
  id: string,
): FrontendWorkshopNode[] {
  for (const node of nodes) {
    if (node.id === id) return [node]
    const path = getNodeAncestorPath(node.children, id)
    if (path.length) return [node, ...path]
  }
  return []
}

export function findFrontendWorkshopNodeParent(
  nodes: FrontendWorkshopNode[],
  id: string,
): FrontendWorkshopNode[] | undefined {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === id)) return node.children
    const child = findFrontendWorkshopNodeParent(node.children, id)
    if (child) return child
  }
  return undefined
}
