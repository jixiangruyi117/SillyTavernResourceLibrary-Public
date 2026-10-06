import type {
  FrontendWorkshopHotspot,
  FrontendWorkshopNode,
  FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'

export type FrontendWorkshopHotspotConflictKind =
  'interactive-parent' | 'interactive-child' | 'scroll-container' | 'hotspot-overlap'

export interface FrontendWorkshopHotspotConflict {
  hotspotId: string
  kind: FrontendWorkshopHotspotConflictKind
  targetId: string
  message: string
  remedy: string
}

function flatten(nodes: readonly FrontendWorkshopNode[]): FrontendWorkshopNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

function isInteractive(node: FrontendWorkshopNode): boolean {
  return node.kind === 'control' || (node.action?.kind !== undefined && node.action.kind !== 'none')
}

function isScrollContainer(node: FrontendWorkshopNode): boolean {
  return /(?:scroll|滚动|滑动区域|列表容器)/iu.test(`${node.semanticRole ?? ''} ${node.label}`)
}

function intersects(left: FrontendWorkshopHotspot, right: FrontendWorkshopHotspot): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

export function getFrontendWorkshopHotspotConflicts(
  project: Pick<FrontendWorkshopProject, 'pages' | 'hotspots'>,
): FrontendWorkshopHotspotConflict[] {
  const nodes = flatten(project.pages.flatMap((page) => page.nodes))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const hotspots = project.hotspots ?? []
  const conflicts: FrontendWorkshopHotspotConflict[] = []

  for (const hotspot of hotspots) {
    const parent = byId.get(hotspot.parentNodeId)
    if (!parent) continue
    if (isInteractive(parent)) {
      conflicts.push({
        hotspotId: hotspot.id,
        kind: 'interactive-parent',
        targetId: parent.id,
        message: `热区覆盖交互控件“${parent.label}”。`,
        remedy: '直接把 Behavior 绑定到该控件，不要再叠加热区。',
      })
    }
    const interactiveChild = flatten(parent.children).find(isInteractive)
    if (interactiveChild) {
      conflicts.push({
        hotspotId: hotspot.id,
        kind: 'interactive-child',
        targetId: interactiveChild.id,
        message: `父容器内含交互控件“${interactiveChild.label}”，热区可能截获点击或输入。`,
        remedy: '改为绑定现有控件，或把热区移动到不含控件的独立容器。',
      })
    }
    if (isScrollContainer(parent) || flatten(parent.children).some(isScrollContainer)) {
      conflicts.push({
        hotspotId: hotspot.id,
        kind: 'scroll-container',
        targetId: parent.id,
        message: `热区位于滚动容器“${parent.label}”内，可能阻断滚动手势。`,
        remedy: '将热区移出滚动容器，或直接绑定容器中的目标节点。',
      })
    }
    for (const other of hotspots) {
      if (
        other.id <= hotspot.id ||
        other.parentNodeId !== hotspot.parentNodeId ||
        !intersects(hotspot, other)
      )
        continue
      conflicts.push({
        hotspotId: hotspot.id,
        kind: 'hotspot-overlap',
        targetId: other.id,
        message: `热区“${hotspot.name}”与“${other.name}”发生重叠。`,
        remedy: '缩小或移动其中一个热区，确保同一点只触发一个行为。',
      })
      conflicts.push({
        hotspotId: other.id,
        kind: 'hotspot-overlap',
        targetId: hotspot.id,
        message: `热区“${other.name}”与“${hotspot.name}”发生重叠。`,
        remedy: '缩小或移动其中一个热区，确保同一点只触发一个行为。',
      })
    }
  }
  return conflicts
}

export function safeFrontendWorkshopHotspots(project: FrontendWorkshopProject) {
  const blocked = new Set(
    getFrontendWorkshopHotspotConflicts(project).map((item) => item.hotspotId),
  )
  return (project.hotspots ?? []).filter((hotspot) => !blocked.has(hotspot.id))
}
