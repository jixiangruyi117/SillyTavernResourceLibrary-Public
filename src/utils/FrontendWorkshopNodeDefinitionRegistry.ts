import type { FrontendWorkshopNodeKind } from '../types/FrontendWorkshopProject'

export interface FrontendWorkshopNodeDefinition {
  kind: FrontendWorkshopNodeKind
  label: string
  allowsChildren: boolean
  allowsBehavior: boolean
}

/**
 * Modern greeting node kinds only. Flip / collapse / tabs / reveal are InteractionBindings over
 * ordinary nodes and must never re-enter the node registry as hard node kinds.
 */
export const FRONTEND_WORKSHOP_NODE_DEFINITIONS: readonly FrontendWorkshopNodeDefinition[] = [
  { kind: 'block', label: '区块', allowsChildren: true, allowsBehavior: true },
  { kind: 'text', label: '文字', allowsChildren: false, allowsBehavior: true },
  { kind: 'image', label: '图片', allowsChildren: false, allowsBehavior: true },
  { kind: 'divider', label: '分隔线', allowsChildren: false, allowsBehavior: false },
  { kind: 'control', label: '表单控件', allowsChildren: false, allowsBehavior: true },
] as const

export const FRONTEND_WORKSHOP_CREATABLE_NODE_KINDS = [
  'block',
  'text',
  'image',
  'divider',
  'control',
] as const satisfies readonly FrontendWorkshopNodeKind[]

export type FrontendWorkshopCreatableNodeKind =
  (typeof FRONTEND_WORKSHOP_CREATABLE_NODE_KINDS)[number]

const DEFINITION_BY_KIND = new Map(
  FRONTEND_WORKSHOP_NODE_DEFINITIONS.map((item) => [item.kind, item]),
)

export function getFrontendWorkshopNodeDefinition(
  value: unknown,
): FrontendWorkshopNodeDefinition | undefined {
  return DEFINITION_BY_KIND.get(String(value) as FrontendWorkshopNodeKind)
}

export function isFrontendWorkshopNodeKind(value: unknown): value is FrontendWorkshopNodeKind {
  return Boolean(getFrontendWorkshopNodeDefinition(value))
}

export function isFrontendWorkshopCreatableNodeKind(
  value: unknown,
): value is FrontendWorkshopCreatableNodeKind {
  return (FRONTEND_WORKSHOP_CREATABLE_NODE_KINDS as readonly string[]).includes(String(value))
}
