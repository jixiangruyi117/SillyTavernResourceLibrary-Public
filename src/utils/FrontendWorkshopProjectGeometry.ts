import { toRaw } from 'vue'

import type {
  FrontendWorkshopLayoutViewport,
  FrontendWorkshopNode,
  FrontendWorkshopNodeKind,
  FrontendWorkshopNodePlacement,
  FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'

export const FRONTEND_WORKSHOP_CANVAS_WIDTHS: Record<FrontendWorkshopLayoutViewport, number> = {
  phone: 390,
  wide: 720,
}

export function flattenFrontendWorkshopNodes(
  nodes: FrontendWorkshopNode[],
): FrontendWorkshopNode[] {
  return nodes.flatMap((node) => [node, ...flattenFrontendWorkshopNodes(node.children)])
}

export function findFrontendWorkshopParentNode(
  nodes: FrontendWorkshopNode[],
  nodeId: string,
): FrontendWorkshopNode | undefined {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === nodeId)) return node
    const parent = findFrontendWorkshopParentNode(node.children, nodeId)
    if (parent) return parent
  }
  return undefined
}

export function cloneFrontendWorkshopProject(
  project: FrontendWorkshopProject,
): FrontendWorkshopProject {
  const unwrap = (value: unknown): unknown => {
    const raw = value && typeof value === 'object' ? toRaw(value) : value
    if (Array.isArray(raw)) return raw.map(unwrap)
    if (!raw || typeof raw !== 'object') return raw
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, entry]) => [key, unwrap(entry)]),
    )
  }
  return structuredClone(unwrap(project)) as FrontendWorkshopProject
}

export function defaultFrontendWorkshopNodePlacement(
  kind: FrontendWorkshopNodeKind,
  viewport: FrontendWorkshopLayoutViewport,
  index: number,
): FrontendWorkshopNodePlacement {
  const canvasWidth = FRONTEND_WORKSHOP_CANVAS_WIDTHS[viewport]
  const height = kind === 'image' ? 220 : kind === 'control' ? 88 : 120
  return {
    x: viewport === 'phone' ? 16 : 24 + (index % 2) * 344,
    y: 20 + Math.floor(index / (viewport === 'phone' ? 1 : 2)) * (height + 24),
    width: viewport === 'phone' ? canvasWidth - 32 : 320,
    height,
    zIndex: Math.min(40, index + 1),
    locked: false,
  }
}

export function readFrontendWorkshopNodePlacement(
  node: FrontendWorkshopNode,
  viewport: FrontendWorkshopLayoutViewport,
  index: number,
): FrontendWorkshopNodePlacement {
  return node.layout?.[viewport] ?? defaultFrontendWorkshopNodePlacement(node.kind, viewport, index)
}

export function findFrontendWorkshopNodeSiblings(
  nodes: FrontendWorkshopNode[],
  nodeId: string,
): FrontendWorkshopNode[] | undefined {
  if (nodes.some((node) => node.id === nodeId)) return nodes
  for (const node of nodes) {
    const siblings = findFrontendWorkshopNodeSiblings(node.children, nodeId)
    if (siblings) return siblings
  }
  return undefined
}

export function frontendWorkshopNodeDepth(
  nodes: FrontendWorkshopNode[],
  nodeId: string,
  depth = 0,
): number {
  for (const node of nodes) {
    if (node.id === nodeId) return depth
    const nested = frontendWorkshopNodeDepth(node.children, nodeId, depth + 1)
    if (nested >= 0) return nested
  }
  return -1
}

export function readFrontendWorkshopCanvasNodePlacement(
  nodes: FrontendWorkshopNode[],
  node: FrontendWorkshopNode,
  viewport: FrontendWorkshopLayoutViewport,
): FrontendWorkshopNodePlacement {
  const siblings = findFrontendWorkshopNodeSiblings(nodes, node.id) ?? nodes
  const index = Math.max(
    0,
    siblings.findIndex((item) => item.id === node.id),
  )
  const local = readFrontendWorkshopNodePlacement(node, viewport, index)
  const parent = findFrontendWorkshopParentNode(nodes, node.id)
  if (!parent) return local
  const parentPlacement = readFrontendWorkshopCanvasNodePlacement(nodes, parent, viewport)
  if (!node.layout?.[viewport]) {
    const fallback = defaultFrontendWorkshopNodePlacement(node.kind, viewport, index)
    return {
      ...fallback,
      x: parentPlacement.x + 16,
      y: parentPlacement.y + 16 + index * 24,
      width: Math.min(fallback.width, Math.max(96, parentPlacement.width - 32)),
      zIndex: parentPlacement.zIndex + index + 1,
    }
  }
  return {
    ...local,
    x: parentPlacement.x + local.x,
    y: parentPlacement.y + local.y,
    zIndex: parentPlacement.zIndex + local.zIndex,
  }
}

export function ensureFrontendWorkshopNodePlacement(
  node: FrontendWorkshopNode,
  viewport: FrontendWorkshopLayoutViewport,
  index: number,
): FrontendWorkshopNodePlacement {
  node.layout ??= {}
  node.layout[viewport] ??= defaultFrontendWorkshopNodePlacement(node.kind, viewport, index)
  return node.layout[viewport]!
}
