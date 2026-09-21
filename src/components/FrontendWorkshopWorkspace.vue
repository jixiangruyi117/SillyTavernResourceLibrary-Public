<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

import {
  cloneFrontendWorkshopProject,
  ensureFrontendWorkshopNodePlacement,
  findFrontendWorkshopNodeSiblings,
  findFrontendWorkshopParentNode,
  flattenFrontendWorkshopNodes,
  FRONTEND_WORKSHOP_CANVAS_WIDTHS,
  readFrontendWorkshopCanvasNodePlacement,
  readFrontendWorkshopNodePlacement,
} from '../utils/FrontendWorkshopProjectGeometry'
import { findFrontendWorkshopNode } from '../types/FrontendWorkshopProject'
import type {
  FrontendWorkshopLayoutViewport,
  FrontendWorkshopLayer,
  FrontendWorkshopNode,
  FrontendWorkshopNodeKind,
  FrontendWorkshopNodePlacement,
  FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'

interface CanvasViewport {
  zoom: number
  panX: number
  panY: number
}

interface PointerSession {
  pointerId: number
  nodeId: string
  mode: 'move' | 'scale' | 'rotate'
  startClientX: number
  startClientY: number
  startPlacement: FrontendWorkshopNodePlacement
  startRotation: number
  corner?: 'nw' | 'ne' | 'sw' | 'se'
  startAngle?: number
  previousProject: FrontendWorkshopProject
  moved: boolean
}

const props = withDefaults(
  defineProps<{
    project: FrontendWorkshopProject
    pageId: string
    selectedNodeId: string
    activeLayerId: string
    canvasMode: FrontendWorkshopLayoutViewport
    hotspotDrawMode?: boolean
  }>(),
  { hotspotDrawMode: false },
)

const emit = defineEmits<{
  selectNode: [id: string]
  clearSelection: []
  canvasModeChange: [mode: FrontendWorkshopLayoutViewport]
  previewProject: [project: FrontendWorkshopProject]
  commitGesture: [
    payload: { previousProject: FrontendWorkshopProject; project: FrontendWorkshopProject },
  ]
  status: [message: string]
  hideNode: [id: string]
  toggleNodeLock: [id: string]
  duplicateNode: [id: string]
  deleteNode: [id: string]
}>()

const NODE_LABELS: Record<FrontendWorkshopNodeKind, string> = {
  block: '区块',
  text: '文字',
  image: '图片',
  divider: '分隔线',
  control: '表单控件',
}
const CANVAS_BASE_HEIGHTS: Record<FrontendWorkshopLayoutViewport, number> = {
  phone: 860,
  wide: 920,
}

const canvasScroll = ref<HTMLElement>()
const canvasElement = ref<HTMLElement>()
const hostWidth = ref(390)
const viewport = ref<CanvasViewport>({ zoom: 1, panX: 0, panY: 0 })
const latestProject = shallowRef(props.project)
const pointerSession = ref<PointerSession>()
let resizeObserver: ResizeObserver | undefined
const overlapNodes = shallowRef<FrontendWorkshopNode[]>([])
let lastClickedNodeId = ''

watch(
  () => props.project,
  (project) => {
    latestProject.value = project
  },
)

const currentPage = computed(
  () =>
    latestProject.value.pages.find((page) => page.id === props.pageId) ??
    latestProject.value.pages[0],
)
const currentLayers = computed<FrontendWorkshopLayer[]>(() => currentPage.value?.layers ?? [])
const selectedNode = computed(() =>
  currentPage.value
    ? findFrontendWorkshopNode(currentPage.value.nodes, props.selectedNodeId)
    : undefined,
)
const hiddenLayerIds = computed(
  () => new Set(currentLayers.value.filter((layer) => !layer.visible).map((layer) => layer.id)),
)
const visibleCanvasNodes = computed(() =>
  flattenFrontendWorkshopNodes(currentPage.value?.nodes ?? []).filter(
    (node) => !node.hidden && (!node.layerId || !hiddenLayerIds.value.has(node.layerId)),
  ),
)
const canvasWidth = computed(() => FRONTEND_WORKSHOP_CANVAS_WIDTHS[props.canvasMode])
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))
const canvasHeight = computed(() => {
  const nodes = currentPage.value?.nodes ?? []
  return Math.max(
    CANVAS_BASE_HEIGHTS[props.canvasMode],
    ...visibleCanvasNodes.value.map((node) => {
      const placement = readFrontendWorkshopCanvasNodePlacement(nodes, node, props.canvasMode)
      return placement.y + placement.height + 72
    }),
  )
})
const stageStyle = computed(() => ({
  width: `${Math.max(hostWidth.value, canvasWidth.value * viewport.value.zoom + Math.abs(viewport.value.panX))}px`,
  minHeight: `${canvasHeight.value * viewport.value.zoom + Math.abs(viewport.value.panY)}px`,
}))

function layerForNode(node: FrontendWorkshopNode): FrontendWorkshopLayer | undefined {
  return currentLayers.value.find((layer) => layer.id === node.layerId)
}

function nodeCanEdit(node: FrontendWorkshopNode): boolean {
  const layer = layerForNode(node)
  if (layer && (!layer.visible || layer.locked)) return false
  if (props.activeLayerId && node.layerId !== props.activeLayerId) return false
  const siblings = findFrontendWorkshopNodeSiblings(currentPage.value?.nodes ?? [], node.id) ?? []
  const index = Math.max(
    0,
    siblings.findIndex((item) => item.id === node.id),
  )
  return !readFrontendWorkshopNodePlacement(node, props.canvasMode, index).locked
}

function editablePlacement(
  project: FrontendWorkshopProject,
  nodeId: string,
): FrontendWorkshopNodePlacement | undefined {
  const page = project.pages.find((item) => item.id === props.pageId) ?? project.pages[0]
  if (!page) return undefined
  const node = findFrontendWorkshopNode(page.nodes, nodeId)
  if (!node) return undefined
  const siblings = findFrontendWorkshopNodeSiblings(page.nodes, nodeId) ?? page.nodes
  const index = Math.max(
    0,
    siblings.findIndex((item) => item.id === nodeId),
  )
  return ensureFrontendWorkshopNodePlacement(node, props.canvasMode, index)
}

function canvasPlacement(node: FrontendWorkshopNode): FrontendWorkshopNodePlacement {
  return readFrontendWorkshopCanvasNodePlacement(
    currentPage.value?.nodes ?? [],
    node,
    props.canvasMode,
  )
}

function authoredNodeStyle(node: FrontendWorkshopNode): Record<string, string> {
  const placement = canvasPlacement(node)
  const style = node.style
  const radius = style.cornerRadius ?? 0
  const opacity = Math.max(0, Math.min(100, style.opacity ?? 100)) / 100
  const shadow =
    style.shadowBlur || style.shadowSpread || style.shadowOffsetX || style.shadowOffsetY
      ? `${style.shadowOffsetX ?? 0}px ${style.shadowOffsetY ?? 0}px ${style.shadowBlur ?? 0}px ${style.shadowSpread ?? 0}px ${style.shadowColor ?? '#000000'}`
      : 'none'
  return {
    left: `${placement.x}px`,
    top: `${placement.y}px`,
    width: `${placement.width}px`,
    height: `${placement.height}px`,
    zIndex: String(placement.zIndex),
    transform: `rotate(${style.rotation ?? 0}deg)`,
    opacity: String(opacity),
    color: style.textColor ?? 'inherit',
    background: style.surfaceColor ?? (node.kind === 'block' ? '#ffffff' : 'transparent'),
    borderWidth: `${style.borderWidth ?? 0}px`,
    borderColor: style.borderColor ?? 'transparent',
    borderStyle: style.borderStyle ?? 'solid',
    borderRadius: `${radius}px`,
    boxShadow: shadow,
    fontSize: style.fontSize ? `${style.fontSize}px` : 'inherit',
    fontWeight: style.fontWeight ? String(style.fontWeight) : 'inherit',
    lineHeight: style.lineHeight ? String(style.lineHeight) : 'normal',
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : 'normal',
    textAlign: style.align === 'center' ? 'center' : style.align === 'end' ? 'right' : 'left',
    padding: style.padding
      ? `${style.padding.top}px ${style.padding.right}px ${style.padding.bottom}px ${style.padding.left}px`
      : '8px',
    margin: style.margin
      ? `${style.margin.top}px ${style.margin.right}px ${style.margin.bottom}px ${style.margin.left}px`
      : '0',
  }
}

const touchPoints = new Map<number, { x: number; y: number }>()
let viewportGesture:
  | {
      distance: number
      x: number
      y: number
      localX: number
      localY: number
      viewport: CanvasViewport
    }
  | undefined
function trackTouchStart(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return
  touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (touchPoints.size !== 2) return
  const [a, b] = [...touchPoints.values()]
  if (!a || !b) return
  const rect = canvasElement.value?.getBoundingClientRect()
  if (!rect) return
  const x = (a.x + b.x) / 2
  const y = (a.y + b.y) / 2
  viewportGesture = {
    distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    x,
    y,
    localX: (x - rect.left) / viewport.value.zoom,
    localY: (y - rect.top) / viewport.value.zoom,
    viewport: { ...viewport.value },
  }
  if (pointerSession.value) {
    latestProject.value = pointerSession.value.previousProject
    emit('previewProject', latestProject.value)
    pointerSession.value = undefined
  }
  event.preventDefault()
  event.stopPropagation()
}
function trackTouchMove(event: PointerEvent): void {
  if (!touchPoints.has(event.pointerId)) return
  touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY })
  const gesture = viewportGesture
  if (!gesture) return
  event.preventDefault()
  event.stopPropagation()
  const [a, b] = [...touchPoints.values()]
  if (!a || !b) return
  const zoom = Math.max(
    0.35,
    Math.min(2, (gesture.viewport.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.distance),
  )
  viewport.value = {
    zoom,
    panX:
      gesture.viewport.panX +
      (a.x + b.x) / 2 -
      gesture.x -
      gesture.localX * (zoom - gesture.viewport.zoom),
    panY:
      gesture.viewport.panY +
      (a.y + b.y) / 2 -
      gesture.y -
      gesture.localY * (zoom - gesture.viewport.zoom),
  }
}
function endTouch(event: PointerEvent): void {
  touchPoints.delete(event.pointerId)
  if (!viewportGesture) return
  event.preventDefault()
  event.stopPropagation()
  if (!touchPoints.size) viewportGesture = undefined
}

function screenDelta(value: number): number {
  return value / Math.max(0.1, viewport.value.zoom)
}

function beginPointer(
  event: PointerEvent,
  node: FrontendWorkshopNode,
  mode: PointerSession['mode'],
  corner: PointerSession['corner'] = 'se',
): void {
  if (!nodeCanEdit(node)) return
  event.preventDefault()
  event.stopPropagation()
  emit('selectNode', node.id)
  const placement = canvasPlacement(node)
  const center = canvasElement.value?.getBoundingClientRect()
  const centerX = center
    ? center.left + (placement.x + placement.width / 2) * viewport.value.zoom
    : event.clientX
  const centerY = center
    ? center.top + (placement.y + placement.height / 2) * viewport.value.zoom
    : event.clientY
  pointerSession.value = {
    pointerId: event.pointerId,
    nodeId: node.id,
    mode,
    corner,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPlacement: { ...placement },
    startRotation: Number(node.style.rotation) || 0,
    startAngle:
      mode === 'rotate' ? Math.atan2(event.clientY - centerY, event.clientX - centerX) : undefined,
    previousProject: cloneFrontendWorkshopProject(latestProject.value),
    moved: false,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function updatePointer(event: PointerEvent): void {
  const session = pointerSession.value
  if (!session || session.pointerId !== event.pointerId) return
  event.preventDefault()
  const dx = screenDelta(event.clientX - session.startClientX)
  const dy = screenDelta(event.clientY - session.startClientY)
  if (!session.moved && Math.hypot(dx, dy) < 2) return
  session.moved = true
  const next = cloneFrontendWorkshopProject(session.previousProject)
  const placement = editablePlacement(next, session.nodeId)
  const page = next.pages.find((item) => item.id === props.pageId) ?? next.pages[0]
  const node = page ? findFrontendWorkshopNode(page.nodes, session.nodeId) : undefined
  if (!placement || !page || !node) return

  if (session.mode === 'move') {
    const parent = findFrontendWorkshopParentNode(page.nodes, node.id)
    const parentCanvas = parent
      ? readFrontendWorkshopCanvasNodePlacement(page.nodes, parent, props.canvasMode)
      : undefined
    placement.x = Math.round(session.startPlacement.x + dx - (parentCanvas?.x ?? 0))
    placement.y = Math.round(session.startPlacement.y + dy - (parentCanvas?.y ?? 0))
  } else if (session.mode === 'scale') {
    const left = session.corner === 'nw' || session.corner === 'sw'
    const top = session.corner === 'nw' || session.corner === 'ne'
    placement.width = Math.max(24, Math.round(session.startPlacement.width + (left ? -dx : dx)))
    placement.height = Math.max(24, Math.round(session.startPlacement.height + (top ? -dy : dy)))
    const parent = findFrontendWorkshopParentNode(page.nodes, node.id)
    const parentCanvas = parent ? canvasPlacement(parent) : undefined
    if (left)
      placement.x =
        session.startPlacement.x +
        session.startPlacement.width -
        placement.width -
        (parentCanvas?.x ?? 0)
    if (top)
      placement.y =
        session.startPlacement.y +
        session.startPlacement.height -
        placement.height -
        (parentCanvas?.y ?? 0)
  } else {
    const rect = canvasElement.value?.getBoundingClientRect()
    if (rect) {
      const centerX =
        rect.left +
        (session.startPlacement.x + session.startPlacement.width / 2) * viewport.value.zoom
      const centerY =
        rect.top +
        (session.startPlacement.y + session.startPlacement.height / 2) * viewport.value.zoom
      const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX)
      const delta = ((angle - (session.startAngle ?? angle)) * 180) / Math.PI
      node.style.rotation = Math.max(-180, Math.min(180, Math.round(session.startRotation + delta)))
    }
  }
  latestProject.value = next
  emit('previewProject', next)
}

function endPointer(event: PointerEvent): void {
  const session = pointerSession.value
  if (!session || session.pointerId !== event.pointerId) return
  pointerSession.value = undefined
  if (!session.moved) return
  emit('commitGesture', { previousProject: session.previousProject, project: latestProject.value })
}

function cancelPointer(event: PointerEvent): void {
  const session = pointerSession.value
  if (!session || session.pointerId !== event.pointerId) return
  pointerSession.value = undefined
  latestProject.value = session.previousProject
  emit('previewProject', session.previousProject)
}

function setCanvasMode(mode: FrontendWorkshopLayoutViewport): void {
  if (props.canvasMode === mode) return
  emit('canvasModeChange', mode)
  void nextTick(fitCanvas)
}

function setZoom(next: number): void {
  viewport.value.zoom = Math.max(0.35, Math.min(2, Number(next.toFixed(2))))
}
function adjustZoom(delta: number): void {
  setZoom(viewport.value.zoom + delta)
}
function resetZoom(): void {
  viewport.value = { zoom: 1, panX: 0, panY: 0 }
}
function fitCanvas(): void {
  const available = Math.max(280, (canvasScroll.value?.clientWidth ?? canvasWidth.value) - 24)
  setZoom(Math.min(1, available / canvasWidth.value))
  viewport.value.panX = 0
  viewport.value.panY = 0
}
function fitSelection(): void {
  const node = selectedNode.value
  if (!node) return
  const placement = canvasPlacement(node)
  const available = Math.max(240, (canvasScroll.value?.clientWidth ?? canvasWidth.value) - 40)
  setZoom(Math.min(1.5, available / Math.max(120, placement.width)))
  void nextTick(() => revealNode(node.id))
}

function revealNode(nodeId: string): void {
  void nextTick(() => {
    const node = [
      ...(canvasElement.value?.querySelectorAll<HTMLElement>('[data-node-id]') ?? []),
    ].find((element) => element.dataset.nodeId === nodeId)
    node?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' })
  })
}
function selectOverlapNode(nodeId: string): void {
  emit('selectNode', nodeId)
  closeOverlapPicker()
}

function closeOverlapPicker(): void {
  overlapNodes.value = []
}
function selectCanvasNode(event: MouseEvent, node: FrontendWorkshopNode): void {
  if (lastClickedNodeId === node.id) {
    const rect = canvasElement.value?.getBoundingClientRect()
    const x = (event.clientX - (rect?.left ?? 0)) / viewport.value.zoom
    const y = (event.clientY - (rect?.top ?? 0)) / viewport.value.zoom
    const hits = visibleCanvasNodes.value
      .filter((candidate) => {
        const p = canvasPlacement(candidate)
        return x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height
      })
      .sort((a, b) => canvasPlacement(b).zIndex - canvasPlacement(a).zIndex)
    overlapNodes.value = hits.length > 1 ? hits : []
  } else closeOverlapPicker()
  lastClickedNodeId = node.id
  emit('selectNode', node.id)
}
function getScrollTop(): number {
  return canvasScroll.value?.scrollTop ?? 0
}
function restoreScrollTop(value: number): void {
  if (canvasScroll.value) canvasScroll.value.scrollTop = value
}
function getDesignHeight(): number {
  return canvasHeight.value
}

function updateHostWidth(): void {
  hostWidth.value = canvasScroll.value?.clientWidth ?? 390
}

onMounted(() => {
  updateHostWidth()
  if (typeof ResizeObserver !== 'undefined' && canvasScroll.value) {
    resizeObserver = new ResizeObserver(updateHostWidth)
    resizeObserver.observe(canvasScroll.value)
  }
  void nextTick(fitCanvas)
})
onUnmounted(() => {
  resizeObserver?.disconnect()
  pointerSession.value = undefined
})

defineExpose({
  zoomPercent,
  setCanvasMode,
  adjustZoom,
  resetZoom,
  fitSelection,
  closeOverlapPicker,
  fitCanvas,
  getDesignHeight,
  getScrollTop,
  restoreScrollTop,
  revealNode,
})
</script>

<template>
  <section class="frontend-workbench__canvas-wrap">
    <header class="frontend-workbench__canvas-label">
      <strong>{{ currentPage?.name ?? '首页' }}</strong>
      <small>{{ canvasMode === 'phone' ? '手机画布' : '宽屏画布' }}</small>
    </header>
    <nav
      v-if="overlapNodes.length"
      class="frontend-workbench__overlap-picker"
      aria-label="选择重叠元素"
    >
      <button
        v-for="node in overlapNodes"
        :key="node.id"
        type="button"
        @click="selectOverlapNode(node.id)"
      >
        {{ NODE_LABELS[node.kind] }}：{{ node.label
        }}{{ !nodeCanEdit(node) ? ' · 图层已锁定' : '' }}
      </button>
      <button type="button" @click="closeOverlapPicker">关闭</button>
    </nav>
    <div ref="canvasScroll" class="frontend-workbench__canvas-scroll">
      <div class="frontend-workbench__canvas-viewport-stage" :style="stageStyle">
        <div
          ref="canvasElement"
          class="frontend-workbench__canvas"
          :class="`is-${canvasMode}`"
          :style="{
            width: `${canvasWidth}px`,
            minHeight: `${canvasHeight}px`,
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          }"
          @click.self="emit('clearSelection')"
          @pointermove="updatePointer"
          @pointerup="endPointer"
          @pointercancel="cancelPointer"
          @pointerdown.capture="trackTouchStart"
          @pointermove.capture="trackTouchMove"
          @pointerup.capture="endTouch"
          @pointercancel.capture="endTouch"
        >
          <article
            v-for="node in visibleCanvasNodes"
            :key="node.id"
            class="frontend-workbench__canvas-node"
            :class="{
              'is-selected': node.id === selectedNodeId,
              'is-locked': !nodeCanEdit(node),
              'is-outside-active-layer': Boolean(activeLayerId) && node.layerId !== activeLayerId,
              [`is-${node.kind}`]: true,
            }"
            :style="authoredNodeStyle(node)"
            :data-node-id="node.id"
            tabindex="0"
            @click.stop="selectCanvasNode($event, node)"
            @keydown.enter.prevent="emit('selectNode', node.id)"
            @pointerdown="beginPointer($event, node, 'move')"
          >
            <template v-if="node.kind === 'image'">
              <img
                v-if="node.imageUrl"
                :src="node.imageUrl"
                alt=""
                :style="{
                  objectFit: node.style.imageFit ?? 'cover',
                  filter:
                    node.style.imageTone === 'mono'
                      ? 'grayscale(1) contrast(.9)'
                      : node.style.imageTone === 'sepia'
                        ? 'sepia(.78) contrast(.88) brightness(.92)'
                        : 'none',
                }"
              />
              <span v-else>等待图片链接</span>
            </template>
            <template v-else-if="node.kind === 'divider'"><hr /></template>
            <template v-else>
              <strong v-if="node.kind === 'text'" style="font-weight: inherit">{{
                node.text || node.label
              }}</strong>
              <template v-else>
                <small>{{ NODE_LABELS[node.kind] }}</small>
                <strong>{{ node.text || node.label }}</strong>
              </template>
            </template>

            <template v-if="node.id === selectedNodeId && nodeCanEdit(node)">
              <button
                v-for="corner in ['nw', 'ne', 'sw', 'se'] as const"
                :key="corner"
                class="frontend-workbench__scale-handle"
                :class="`is-${corner}`"
                type="button"
                :aria-label="`缩放 ${corner}`"
                @pointerdown="beginPointer($event, node, 'scale', corner)"
              ></button>
              <button
                class="frontend-workbench__rotate-handle"
                type="button"
                aria-label="旋转"
                @pointerdown="beginPointer($event, node, 'rotate')"
              ></button>
              <nav class="frontend-workbench__selection-actions" aria-label="当前元素操作">
                <button type="button" @pointerdown.stop @click.stop="emit('hideNode', node.id)">
                  隐藏
                </button>
                <button
                  type="button"
                  @pointerdown.stop
                  @click.stop="emit('toggleNodeLock', node.id)"
                >
                  锁定
                </button>
                <button
                  type="button"
                  @pointerdown.stop
                  @click.stop="emit('duplicateNode', node.id)"
                >
                  复制
                </button>
                <button type="button" @pointerdown.stop @click.stop="emit('deleteNode', node.id)">
                  删除
                </button>
              </nav>
            </template>
            <output
              v-else-if="node.id === selectedNodeId"
              class="frontend-workbench__transform-readout"
              >已锁定 · 仅可查看</output
            >
          </article>

          <div v-if="!visibleCanvasNodes.length" class="frontend-workbench__empty-canvas">
            <small>空白画布</small>
            <strong>从左侧“＋”添加内容</strong>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style src="../styles/FrontendWorkshopWorkspace.css"></style>
