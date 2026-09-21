import type {
  FrontendWorkshopNode,
  FrontendWorkshopNodeKind,
} from '../types/FrontendWorkshopProject'
import type { FrontendWorkshopParameterKey } from './FrontendWorkshopParameterRegistry'

export type FrontendWorkshopInspectorTab = 'content' | 'appearance' | 'layout' | 'interaction'
export type FrontendWorkshopInspectorMode = 'quick' | 'full'
export type FrontendWorkshopInspectorLevel = 'quick' | 'detail'
export type FrontendWorkshopInspectorGroup =
  'common' | 'details' | 'position' | 'size' | 'transform' | 'layer'

export type FrontendWorkshopInspectorControl =
  'text' | 'textarea' | 'number' | 'color' | 'toggle' | 'choice' | 'parameter' | 'row' | 'action'

export interface FrontendWorkshopInspectorItem {
  key: string
  tab: FrontendWorkshopInspectorTab
  level: FrontendWorkshopInspectorLevel
  group: FrontendWorkshopInspectorGroup
  label: string
  control: FrontendWorkshopInspectorControl
  appliesTo: 'all' | readonly FrontendWorkshopNodeKind[]
  parameterKey?: FrontendWorkshopParameterKey
  numberCommit?: 'input' | 'change'
}

const TEXTUAL = ['text'] as const satisfies readonly FrontendWorkshopNodeKind[]
const IMAGES = ['image'] as const satisfies readonly FrontendWorkshopNodeKind[]
const APPEARANCE_ALL = [
  'block',
  'text',
  'image',
  'divider',
  'control',
] as const satisfies readonly FrontendWorkshopNodeKind[]
const INTERACTIVE = [
  'block',
  'text',
  'image',
  'control',
] as const satisfies readonly FrontendWorkshopNodeKind[]

/**
 * 手动 Inspector 只登记普通内容、CSS、位置与已存在交互。
 * 这里不再保留任何 recipe/detail router 兼容键；复杂效果直接由 Source/AI 处理。
 */
export const FRONTEND_WORKSHOP_INSPECTOR_ITEMS = [
  {
    key: 'content.label',
    tab: 'content',
    level: 'quick',
    group: 'common',
    label: '元素名称',
    control: 'text',
    appliesTo: 'all',
  },
  {
    key: 'content.text',
    tab: 'content',
    level: 'quick',
    group: 'common',
    label: '文字内容',
    control: 'textarea',
    appliesTo: TEXTUAL,
  },
  {
    key: 'content.imageUrl',
    tab: 'content',
    level: 'quick',
    group: 'common',
    label: '图片 URL',
    control: 'text',
    appliesTo: IMAGES,
  },

  {
    key: 'appearance.fontSize',
    tab: 'appearance',
    level: 'quick',
    group: 'common',
    label: '字号',
    control: 'parameter',
    appliesTo: TEXTUAL,
    parameterKey: 'fontSize',
  },
  {
    key: 'appearance.fontWeight',
    tab: 'appearance',
    level: 'quick',
    group: 'common',
    label: '字重',
    control: 'parameter',
    appliesTo: TEXTUAL,
    parameterKey: 'fontWeight',
  },
  {
    key: 'appearance.lineHeight',
    tab: 'appearance',
    level: 'quick',
    group: 'common',
    label: '行高',
    control: 'parameter',
    appliesTo: TEXTUAL,
    parameterKey: 'lineHeight',
  },
  {
    key: 'appearance.letterSpacing',
    tab: 'appearance',
    level: 'detail',
    group: 'details',
    label: '字距',
    control: 'parameter',
    appliesTo: TEXTUAL,
    parameterKey: 'letterSpacing',
  },
  {
    key: 'appearance.textColor',
    tab: 'appearance',
    level: 'quick',
    group: 'common',
    label: '文字颜色',
    control: 'parameter',
    appliesTo: TEXTUAL,
    parameterKey: 'textColor',
  },
  {
    key: 'appearance.align',
    tab: 'appearance',
    level: 'quick',
    group: 'common',
    label: '对齐',
    control: 'parameter',
    appliesTo: TEXTUAL,
    parameterKey: 'align',
  },
  {
    key: 'appearance.surfaceColor',
    tab: 'appearance',
    level: 'quick',
    group: 'common',
    label: '背景颜色',
    control: 'color',
    appliesTo: APPEARANCE_ALL,
  },
  {
    key: 'appearance.opacity',
    tab: 'appearance',
    level: 'quick',
    group: 'common',
    label: '透明度',
    control: 'parameter',
    appliesTo: APPEARANCE_ALL,
    parameterKey: 'opacity',
  },
  {
    key: 'appearance.cornerRadius',
    tab: 'appearance',
    level: 'detail',
    group: 'details',
    label: '圆角',
    control: 'parameter',
    appliesTo: APPEARANCE_ALL,
    parameterKey: 'cornerRadius',
  },
  {
    key: 'appearance.border',
    tab: 'appearance',
    level: 'detail',
    group: 'details',
    label: '边框',
    control: 'row',
    appliesTo: APPEARANCE_ALL,
  },
  {
    key: 'appearance.shadow',
    tab: 'appearance',
    level: 'detail',
    group: 'details',
    label: '阴影',
    control: 'row',
    appliesTo: APPEARANCE_ALL,
  },
  {
    key: 'appearance.imageFit',
    tab: 'appearance',
    level: 'quick',
    group: 'common',
    label: '图片适应',
    control: 'choice',
    appliesTo: IMAGES,
  },
  {
    key: 'appearance.imageTone',
    tab: 'appearance',
    level: 'detail',
    group: 'details',
    label: '基础色调',
    control: 'choice',
    appliesTo: IMAGES,
  },

  {
    key: 'layout.x',
    tab: 'layout',
    level: 'quick',
    group: 'position',
    label: 'X',
    control: 'number',
    appliesTo: 'all',
  },
  {
    key: 'layout.y',
    tab: 'layout',
    level: 'quick',
    group: 'position',
    label: 'Y',
    control: 'number',
    appliesTo: 'all',
  },
  {
    key: 'layout.width',
    tab: 'layout',
    level: 'quick',
    group: 'size',
    label: '宽度',
    control: 'number',
    appliesTo: 'all',
  },
  {
    key: 'layout.height',
    tab: 'layout',
    level: 'quick',
    group: 'size',
    label: '高度',
    control: 'number',
    appliesTo: 'all',
  },
  {
    key: 'layout.rotation',
    tab: 'layout',
    level: 'quick',
    group: 'transform',
    label: '旋转',
    control: 'parameter',
    appliesTo: 'all',
    parameterKey: 'rotation',
  },
  {
    key: 'layout.locked',
    tab: 'layout',
    level: 'quick',
    group: 'transform',
    label: '锁定',
    control: 'toggle',
    appliesTo: 'all',
  },
  {
    key: 'layout.zIndex',
    tab: 'layout',
    level: 'quick',
    group: 'layer',
    label: '层级',
    control: 'number',
    appliesTo: 'all',
  },
  {
    key: 'layout.layer',
    tab: 'layout',
    level: 'quick',
    group: 'layer',
    label: '所属图层',
    control: 'choice',
    appliesTo: 'all',
  },
  {
    key: 'layout.reset',
    tab: 'layout',
    level: 'detail',
    group: 'transform',
    label: '复位旋转',
    control: 'action',
    appliesTo: 'all',
  },
  {
    key: 'layout.sendBack',
    tab: 'layout',
    level: 'detail',
    group: 'layer',
    label: '置于最底',
    control: 'action',
    appliesTo: 'all',
  },
  {
    key: 'layout.moveBack',
    tab: 'layout',
    level: 'detail',
    group: 'layer',
    label: '下移一层',
    control: 'action',
    appliesTo: 'all',
  },
  {
    key: 'layout.moveForward',
    tab: 'layout',
    level: 'detail',
    group: 'layer',
    label: '上移一层',
    control: 'action',
    appliesTo: 'all',
  },
  {
    key: 'layout.sendFront',
    tab: 'layout',
    level: 'detail',
    group: 'layer',
    label: '置于最顶',
    control: 'action',
    appliesTo: 'all',
  },

  {
    key: 'interaction.behaviors',
    tab: 'interaction',
    level: 'quick',
    group: 'common',
    label: '已有交互',
    control: 'row',
    appliesTo: INTERACTIVE,
  },
] as const satisfies readonly FrontendWorkshopInspectorItem[]

export function frontendWorkshopInspectorItemAppliesToNode(
  item: FrontendWorkshopInspectorItem,
  node: FrontendWorkshopNode,
): boolean {
  if (item.appliesTo === 'all') return true
  return (item.appliesTo as readonly FrontendWorkshopNodeKind[]).includes(node.kind)
}

export function listFrontendWorkshopInspectorItems(
  node: FrontendWorkshopNode,
  tab: FrontendWorkshopInspectorTab,
  mode: FrontendWorkshopInspectorMode,
): FrontendWorkshopInspectorItem[] {
  return FRONTEND_WORKSHOP_INSPECTOR_ITEMS.filter(
    (item) =>
      item.tab === tab &&
      frontendWorkshopInspectorItemAppliesToNode(item, node) &&
      (mode === 'full' || item.level === 'quick'),
  )
}

export function listFrontendWorkshopInspectorItemKeys(
  node: FrontendWorkshopNode,
  tab: FrontendWorkshopInspectorTab,
  mode: FrontendWorkshopInspectorMode,
): string[] {
  return listFrontendWorkshopInspectorItems(node, tab, mode).map((item) => item.key)
}
