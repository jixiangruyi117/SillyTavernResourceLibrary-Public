<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import {
  createWorkshopLayoutReference,
  normalizeWorkshopLayoutReference,
  type StatusField,
  type WorkshopLayoutItem,
  type WorkshopLayoutReference,
  type WorkshopLayoutViewport,
  type WorkshopTargetSize,
} from '../utils/FrontendWorkshop'

const props = defineProps<{
  fields: StatusField[]
  imageUrls: string[]
  modelValue?: WorkshopLayoutReference
  targetSize?: WorkshopTargetSize
}>()
const emit = defineEmits<{
  apply: [layout: WorkshopLayoutReference]
  close: []
}>()

const canvas = ref<HTMLElement>()
const canvasScroll = ref<HTMLElement>()
const toolbar = ref<HTMLElement>()
const inspector = ref<HTMLElement>()
const layout = ref(
  createWorkshopLayoutReference(props.fields, props.imageUrls, props.modelValue, props.targetSize),
)
const viewportMode = ref<'phone' | 'desktop'>('phone')
const activeLayout = computed<WorkshopLayoutViewport>(() =>
  viewportMode.value === 'desktop' ? layout.value.desktop! : layout.value,
)
const selectedIds = ref<string[]>(
  activeLayout.value.items[0] ? [activeLayout.value.items[0].id] : [],
)
const selectedItems = computed(() =>
  activeLayout.value.items.filter((item) => selectedIds.value.includes(item.id)),
)
const selectedItem = computed(() => selectedItems.value[0])
const multiSelectMode = ref(false)
const guides = ref<{ x?: number; y?: number }>({})
const undoStack = ref<WorkshopLayoutReference[]>([])
const redoStack = ref<WorkshopLayoutReference[]>([])

interface PointerSession {
  pointerId: number
  mode: 'move' | 'resize'
  startClientX: number
  startClientY: number
  primaryId: string
  initialItems: WorkshopLayoutItem[]
}

let pointerSession: PointerSession | undefined
let previousBodyStyle:
  | {
      overflow: string
      position: string
      top: string
      right: string
      bottom: string
      left: string
      width: string
      htmlOverflow: string
      windowX: number
      windowY: number
    }
  | undefined
let controlScrollSnapshot:
  | {
      windowX: number
      windowY: number
      toolbarLeft: number
      canvasLeft: number
      canvasTop: number
      inspectorLeft: number
      inspectorTop: number
    }
  | undefined

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function itemStyle(item: WorkshopLayoutItem): Record<string, string | number> {
  return {
    left: `${(item.x / activeLayout.value.canvasWidth) * 100}%`,
    top: `${(item.y / activeLayout.value.canvasHeight) * 100}%`,
    width: `${(item.width / activeLayout.value.canvasWidth) * 100}%`,
    height: `${(item.height / activeLayout.value.canvasHeight) * 100}%`,
    zIndex: item.zIndex,
  }
}

function cloneLayout(value = layout.value): WorkshopLayoutReference {
  const cloneViewport = (viewport: WorkshopLayoutViewport): WorkshopLayoutViewport => ({
    canvasWidth: viewport.canvasWidth,
    canvasHeight: viewport.canvasHeight,
    items: viewport.items.map((item) => ({ ...item })),
  })
  const phone = cloneViewport(value)
  return normalizeWorkshopLayoutReference({
    ...phone,
    desktop: value.desktop ? cloneViewport(value.desktop) : undefined,
  })
}

function captureControlScroll(event: PointerEvent): void {
  if (!(event.target instanceof Element) || !event.target.closest('button')) return
  controlScrollSnapshot = {
    windowX: window.scrollX,
    windowY: window.scrollY,
    toolbarLeft: toolbar.value?.scrollLeft ?? 0,
    canvasLeft: canvasScroll.value?.scrollLeft ?? 0,
    canvasTop: canvasScroll.value?.scrollTop ?? 0,
    inspectorLeft: inspector.value?.scrollLeft ?? 0,
    inspectorTop: inspector.value?.scrollTop ?? 0,
  }
}

function restoreControlScroll(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest('button') : null
  const snapshot = controlScrollSnapshot
  controlScrollSnapshot = undefined
  if (!target || !snapshot) return
  void nextTick().then(() => {
    if (toolbar.value) toolbar.value.scrollLeft = snapshot.toolbarLeft
    if (canvasScroll.value) {
      canvasScroll.value.scrollLeft = snapshot.canvasLeft
      canvasScroll.value.scrollTop = snapshot.canvasTop
    }
    if (inspector.value) {
      inspector.value.scrollLeft = snapshot.inspectorLeft
      inspector.value.scrollTop = snapshot.inspectorTop
    }
    if (window.scrollX !== snapshot.windowX || window.scrollY !== snapshot.windowY) {
      window.scrollTo(snapshot.windowX, snapshot.windowY)
    }
    if (event.detail > 0 && target instanceof HTMLElement) target.blur()
  })
}

function remember(): void {
  undoStack.value = [...undoStack.value.slice(-39), cloneLayout()]
  redoStack.value = []
}

function undo(): void {
  const previous = undoStack.value.at(-1)
  if (!previous) return
  redoStack.value = [...redoStack.value, cloneLayout()]
  layout.value = previous
  undoStack.value = undoStack.value.slice(0, -1)
  keepValidSelection()
}

function redo(): void {
  const next = redoStack.value.at(-1)
  if (!next) return
  undoStack.value = [...undoStack.value, cloneLayout()]
  layout.value = next
  redoStack.value = redoStack.value.slice(0, -1)
  keepValidSelection()
}

function keepValidSelection(): void {
  const validIds = new Set(activeLayout.value.items.map((item) => item.id))
  selectedIds.value = selectedIds.value.filter((id) => validIds.has(id))
  if (!selectedIds.value.length && activeLayout.value.items[0])
    selectedIds.value = [activeLayout.value.items[0].id]
}

function switchViewport(value: 'phone' | 'desktop'): void {
  viewportMode.value = value
  selectedIds.value = activeLayout.value.items[0] ? [activeLayout.value.items[0].id] : []
  guides.value = {}
}

function selectItem(event: PointerEvent | MouseEvent, item: WorkshopLayoutItem): void {
  const additive = multiSelectMode.value || event.ctrlKey || event.metaKey || event.shiftKey
  const groupIds =
    item.groupId && !additive
      ? activeLayout.value.items
          .filter((candidate) => candidate.groupId === item.groupId)
          .map((candidate) => candidate.id)
      : [item.id]
  if (!additive) {
    selectedIds.value = groupIds
    return
  }
  const next = new Set(selectedIds.value)
  for (const id of groupIds) {
    if (next.has(id)) next.delete(id)
    else next.add(id)
  }
  selectedIds.value = Array.from(next)
}

function startPointer(
  event: PointerEvent,
  item: WorkshopLayoutItem,
  mode: PointerSession['mode'],
): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  selectItem(event, item)
  if (item.locked) return
  if (!selectedIds.value.includes(item.id)) selectedIds.value = [item.id]
  remember()
  pointerSession = {
    pointerId: event.pointerId,
    mode,
    startClientX: event.clientX,
    startClientY: event.clientY,
    primaryId: item.id,
    initialItems: selectedItems.value.map((selected) => ({ ...selected })),
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function snapPosition(
  proposed: number,
  size: number,
  axis: 'x' | 'y',
  movingIds: Set<string>,
): { value: number; guide?: number } {
  const canvasSize = axis === 'x' ? activeLayout.value.canvasWidth : activeLayout.value.canvasHeight
  const targets = [0, canvasSize / 2, canvasSize]
  for (const other of activeLayout.value.items) {
    if (movingIds.has(other.id)) continue
    const start = axis === 'x' ? other.x : other.y
    const otherSize = axis === 'x' ? other.width : other.height
    targets.push(start, start + otherSize / 2, start + otherSize)
  }
  const anchors = [proposed, proposed + size / 2, proposed + size]
  let bestDistance = 7
  let adjustment = 0
  let guide: number | undefined
  for (const anchor of anchors) {
    for (const target of targets) {
      const distance = Math.abs(target - anchor)
      if (distance < bestDistance) {
        bestDistance = distance
        adjustment = target - anchor
        guide = target
      }
    }
  }
  return { value: Math.round(proposed + adjustment), guide }
}

function snapEdge(
  edge: number,
  axis: 'x' | 'y',
  movingIds: Set<string>,
): { value: number; guide?: number } {
  const canvasSize = axis === 'x' ? activeLayout.value.canvasWidth : activeLayout.value.canvasHeight
  const targets = [0, canvasSize / 2, canvasSize]
  for (const other of activeLayout.value.items) {
    if (movingIds.has(other.id)) continue
    const start = axis === 'x' ? other.x : other.y
    const size = axis === 'x' ? other.width : other.height
    targets.push(start, start + size / 2, start + size)
  }
  const target = targets
    .map((value) => ({ value, distance: Math.abs(value - edge) }))
    .sort((left, right) => left.distance - right.distance)[0]
  return target && target.distance < 7
    ? { value: Math.round(target.value), guide: target.value }
    : { value: Math.round(edge) }
}

function movePointer(event: PointerEvent): void {
  if (!pointerSession || pointerSession.pointerId !== event.pointerId || !canvas.value) return
  event.preventDefault()
  const item = activeLayout.value.items.find(
    (candidate) => candidate.id === pointerSession?.primaryId,
  )
  if (!item) return
  const bounds = canvas.value.getBoundingClientRect()
  const deltaX =
    (event.clientX - pointerSession.startClientX) * (activeLayout.value.canvasWidth / bounds.width)
  const deltaY =
    (event.clientY - pointerSession.startClientY) *
    (activeLayout.value.canvasHeight / bounds.height)
  if (pointerSession.mode === 'move') {
    const initialItems = pointerSession.initialItems.filter((candidate) => !candidate.locked)
    const minX = Math.min(...initialItems.map((candidate) => candidate.x))
    const minY = Math.min(...initialItems.map((candidate) => candidate.y))
    const maxX = Math.max(...initialItems.map((candidate) => candidate.x + candidate.width))
    const maxY = Math.max(...initialItems.map((candidate) => candidate.y + candidate.height))
    let safeDeltaX = Math.min(activeLayout.value.canvasWidth - maxX, Math.max(-minX, deltaX))
    let safeDeltaY = Math.min(activeLayout.value.canvasHeight - maxY, Math.max(-minY, deltaY))
    const primaryInitial = initialItems.find((candidate) => candidate.id === item.id)
    if (primaryInitial) {
      const movingIds = new Set(initialItems.map((candidate) => candidate.id))
      const snappedX = snapPosition(
        primaryInitial.x + safeDeltaX,
        primaryInitial.width,
        'x',
        movingIds,
      )
      const snappedY = snapPosition(
        primaryInitial.y + safeDeltaY,
        primaryInitial.height,
        'y',
        movingIds,
      )
      safeDeltaX += snappedX.value - (primaryInitial.x + safeDeltaX)
      safeDeltaY += snappedY.value - (primaryInitial.y + safeDeltaY)
      safeDeltaX = Math.min(activeLayout.value.canvasWidth - maxX, Math.max(-minX, safeDeltaX))
      safeDeltaY = Math.min(activeLayout.value.canvasHeight - maxY, Math.max(-minY, safeDeltaY))
      guides.value = { x: snappedX.guide, y: snappedY.guide }
    }
    for (const initial of initialItems) {
      const target = activeLayout.value.items.find((candidate) => candidate.id === initial.id)
      if (!target) continue
      target.x = Math.round(initial.x + safeDeltaX)
      target.y = Math.round(initial.y + safeDeltaY)
    }
    return
  }
  const initial = pointerSession.initialItems.find((candidate) => candidate.id === item.id)
  if (!initial) return
  const movingIds = new Set([item.id])
  const snappedRight = snapEdge(initial.x + initial.width + deltaX, 'x', movingIds)
  const snappedBottom = snapEdge(initial.y + initial.height + deltaY, 'y', movingIds)
  item.width = clamp(snappedRight.value - initial.x, 56, activeLayout.value.canvasWidth - item.x)
  item.height = clamp(snappedBottom.value - initial.y, 44, activeLayout.value.canvasHeight - item.y)
  guides.value = { x: snappedRight.guide, y: snappedBottom.guide }
}

function endPointer(event: PointerEvent): void {
  if (pointerSession?.pointerId === event.pointerId) {
    pointerSession = undefined
    guides.value = {}
  }
}

function updateSelected(key: 'x' | 'y' | 'width' | 'height', rawValue: string): void {
  const item = selectedItem.value
  if (!item || item.locked) return
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return
  remember()
  if (key === 'x') item.x = clamp(value, 0, activeLayout.value.canvasWidth - item.width)
  if (key === 'y') item.y = clamp(value, 0, activeLayout.value.canvasHeight - item.height)
  if (key === 'width') item.width = clamp(value, 56, activeLayout.value.canvasWidth - item.x)
  if (key === 'height') item.height = clamp(value, 44, activeLayout.value.canvasHeight - item.y)
}

function moveLayer(direction: -1 | 1): void {
  const items = selectedItems.value.filter((item) => !item.locked)
  if (!items.length) return
  remember()
  items.forEach((item) => {
    item.zIndex = clamp(item.zIndex + direction, 1, 40)
  })
}

function alignSelected(mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
  const items = selectedItems.value.filter((item) => !item.locked)
  if (!items.length) return
  remember()
  const left = items.length > 1 ? Math.min(...items.map((item) => item.x)) : 0
  const right =
    items.length > 1
      ? Math.max(...items.map((item) => item.x + item.width))
      : activeLayout.value.canvasWidth
  const top = items.length > 1 ? Math.min(...items.map((item) => item.y)) : 0
  const bottom =
    items.length > 1
      ? Math.max(...items.map((item) => item.y + item.height))
      : activeLayout.value.canvasHeight
  for (const item of items) {
    if (mode === 'left') item.x = left
    if (mode === 'center') item.x = Math.round((left + right - item.width) / 2)
    if (mode === 'right') item.x = right - item.width
    if (mode === 'top') item.y = top
    if (mode === 'middle') item.y = Math.round((top + bottom - item.height) / 2)
    if (mode === 'bottom') item.y = bottom - item.height
  }
}

function distributeSelected(axis: 'horizontal' | 'vertical'): void {
  const items = selectedItems.value.filter((item) => !item.locked)
  if (items.length < 3) return
  remember()
  const sorted = [...items].sort((left, right) =>
    axis === 'horizontal' ? left.x - right.x : left.y - right.y,
  )
  const first = sorted[0]!
  const last = sorted.at(-1)!
  const occupied = sorted.reduce(
    (total, item) => total + (axis === 'horizontal' ? item.width : item.height),
    0,
  )
  const span =
    axis === 'horizontal' ? last.x + last.width - first.x : last.y + last.height - first.y
  const gap = Math.max(0, (span - occupied) / (sorted.length - 1))
  let cursor = axis === 'horizontal' ? first.x : first.y
  for (const item of sorted) {
    if (axis === 'horizontal') {
      item.x = Math.round(cursor)
      cursor += item.width + gap
    } else {
      item.y = Math.round(cursor)
      cursor += item.height + gap
    }
  }
}

function toggleLock(): void {
  if (!selectedItems.value.length) return
  remember()
  const shouldLock = selectedItems.value.some((item) => !item.locked)
  selectedItems.value.forEach((item) => {
    item.locked = shouldLock
  })
}

function groupSelected(): void {
  if (selectedItems.value.length < 2) return
  remember()
  const groupId = `group-${crypto.randomUUID().slice(0, 8)}`
  selectedItems.value.forEach((item) => {
    item.groupId = groupId
  })
}

function ungroupSelected(): void {
  if (!selectedItems.value.some((item) => item.groupId)) return
  remember()
  selectedItems.value.forEach((item) => {
    item.groupId = ''
  })
}

function duplicateSelected(): void {
  if (!selectedItems.value.length) return
  remember()
  const created = selectedItems.value.map((item) => ({
    ...item,
    id: `${item.kind}-${crypto.randomUUID().slice(0, 8)}`,
    x: clamp(item.x + 12, 0, activeLayout.value.canvasWidth - item.width),
    y: clamp(item.y + 12, 0, activeLayout.value.canvasHeight - item.height),
    zIndex: clamp(item.zIndex + 1, 1, 40),
    locked: false,
    groupId: '',
  }))
  activeLayout.value.items.push(...created)
  selectedIds.value = created.map((item) => item.id)
}

async function resetLayout(): Promise<void> {
  const confirmed = await confirmAction({
    title: '恢复自动排列',
    message: '当前拖拽和缩放结果会被清除，字段与图片会回到自动排列的位置。',
    confirmLabel: '恢复排列',
  })
  if (!confirmed) return
  remember()
  layout.value = createWorkshopLayoutReference(props.fields, props.imageUrls)
  switchViewport(viewportMode.value)
}

function applyLayout(): void {
  emit('apply', normalizeWorkshopLayoutReference(layout.value))
}

function handleKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    duplicateSelected()
    return
  }
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  previousBodyStyle = {
    overflow: document.body.style.overflow,
    position: document.body.style.position,
    top: document.body.style.top,
    right: document.body.style.right,
    bottom: document.body.style.bottom,
    left: document.body.style.left,
    width: document.body.style.width,
    htmlOverflow: document.documentElement.style.overflow,
    windowX: window.scrollX,
    windowY: window.scrollY,
  }
  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.top = `${-previousBodyStyle.windowY}px`
  document.body.style.right = '0'
  document.body.style.bottom = '0'
  document.body.style.left = `${-previousBodyStyle.windowX}px`
  document.body.style.width = '100%'
  document.documentElement.style.overflow = 'hidden'
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  if (previousBodyStyle) {
    document.body.style.overflow = previousBodyStyle.overflow
    document.body.style.position = previousBodyStyle.position
    document.body.style.top = previousBodyStyle.top
    document.body.style.right = previousBodyStyle.right
    document.body.style.bottom = previousBodyStyle.bottom
    document.body.style.left = previousBodyStyle.left
    document.body.style.width = previousBodyStyle.width
    document.documentElement.style.overflow = previousBodyStyle.htmlOverflow
    window.scrollTo(previousBodyStyle.windowX, previousBodyStyle.windowY)
  }
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <section
    class="layout-studio mobile-dialog-viewport"
    role="dialog"
    aria-modal="true"
    aria-labelledby="layout-studio-title"
    :style="{
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: 'var(--app-viewport-height)',
      maxHeight: 'var(--app-viewport-height)',
      overflow: 'hidden',
      isolation: 'isolate',
      zIndex: 2147483000,
      backgroundColor: 'var(--color-surface, #fbf8f0)',
    }"
    @pointerdown.capture="captureControlScroll"
    @click.capture="restoreControlScroll"
  >
    <header>
      <button type="button" aria-label="退出自由排版" @click="emit('close')">×</button>
      <span>
        <small>LAYOUT REFERENCE</small>
        <strong id="layout-studio-title">自由排版参考</strong>
      </span>
      <div>
        <button type="button" :disabled="!undoStack.length" @click="undo">撤销</button>
        <button type="button" :disabled="!redoStack.length" @click="redo">重做</button>
        <button type="button" @click="resetLayout">恢复排列</button>
        <button type="button" class="button button--primary is-primary" @click="applyLayout">
          应用参考
        </button>
      </div>
    </header>

    <main>
      <section class="layout-studio__workspace" aria-label="排版画布">
        <nav ref="toolbar" class="layout-studio__toolbar" aria-label="布局操作">
          <div class="layout-studio__mobile-history" role="group" aria-label="操作历史">
            <button type="button" :disabled="!undoStack.length" @click="undo">撤销</button>
            <button type="button" :disabled="!redoStack.length" @click="redo">重做</button>
          </div>
          <div class="layout-studio__viewport-tabs" role="group" aria-label="布局意图">
            <button
              type="button"
              :class="{ 'is-active': viewportMode === 'phone' }"
              @click="switchViewport('phone')"
            >
              手机布局
            </button>
            <button
              type="button"
              :class="{ 'is-active': viewportMode === 'desktop' }"
              @click="switchViewport('desktop')"
            >
              宽屏布局
            </button>
          </div>
          <div role="group" aria-label="对齐">
            <button type="button" title="左对齐" @click="alignSelected('left')">左</button>
            <button type="button" title="水平居中" @click="alignSelected('center')">中</button>
            <button type="button" title="右对齐" @click="alignSelected('right')">右</button>
            <button type="button" title="上对齐" @click="alignSelected('top')">上</button>
            <button type="button" title="垂直居中" @click="alignSelected('middle')">中</button>
            <button type="button" title="下对齐" @click="alignSelected('bottom')">下</button>
          </div>
          <div role="group" aria-label="等距分布">
            <button
              type="button"
              :disabled="selectedItems.length < 3"
              @click="distributeSelected('horizontal')"
            >
              横向等距
            </button>
            <button
              type="button"
              :disabled="selectedItems.length < 3"
              @click="distributeSelected('vertical')"
            >
              纵向等距
            </button>
          </div>
        </nav>
        <div ref="canvasScroll" class="layout-studio__canvas-scroll">
          <span class="layout-studio__canvas-scroll-hint">上下滑动画布，查看完整手机布局</span>
          <div
            ref="canvas"
            class="layout-studio__canvas"
            :style="{ aspectRatio: `${activeLayout.canvasWidth} / ${activeLayout.canvasHeight}` }"
            @pointermove="movePointer"
            @pointerup="endPointer"
            @pointercancel="endPointer"
          >
            <i
              v-if="guides.x !== undefined"
              class="layout-studio__guide is-vertical"
              :style="{ left: `${(guides.x / activeLayout.canvasWidth) * 100}%` }"
            ></i>
            <i
              v-if="guides.y !== undefined"
              class="layout-studio__guide is-horizontal"
              :style="{ top: `${(guides.y / activeLayout.canvasHeight) * 100}%` }"
            ></i>
            <article
              v-for="item in activeLayout.items"
              :key="item.id"
              :class="[
                `is-${item.kind}`,
                {
                  'is-selected': selectedIds.includes(item.id),
                  'is-locked': item.locked,
                  'is-grouped': item.groupId,
                },
              ]"
              :style="itemStyle(item)"
              @pointerdown="startPointer($event, item, 'move')"
            >
              <template v-if="item.kind === 'image'">
                <img :src="item.source" alt="" draggable="false" />
                <span>{{ item.label }}</span>
              </template>
              <template v-else>
                <small>{{ item.label }}</small>
                <strong>{{
                  fields.find((field) => field.path === item.source)?.example || '示例值'
                }}</strong>
              </template>
              <button
                v-if="!item.locked"
                type="button"
                class="layout-studio__resize"
                :aria-label="`缩放${item.label}`"
                @pointerdown="startPointer($event, item, 'resize')"
              ></button>
            </article>
          </div>
        </div>
        <p>
          拖动时会吸附画布与其他对象并显示对齐线。按住 Ctrl/Shift
          可多选，手机可开启多选模式；手机与宽屏构图分别保存，AI 再转换成响应式布局。
          方框的外沿就是布局占位范围，位置、宽高和层级均以方框为准；框中文字只是内容示意，不以字形边缘为准。
        </p>
      </section>

      <aside ref="inspector" class="layout-studio__inspector">
        <div class="layout-studio__selection-actions">
          <button
            type="button"
            :class="{ 'is-active': multiSelectMode }"
            @click="multiSelectMode = !multiSelectMode"
          >
            {{ multiSelectMode ? '结束多选' : '多选' }}
          </button>
          <button type="button" :disabled="!selectedItems.length" @click="duplicateSelected">
            复制
          </button>
          <button type="button" :disabled="selectedItems.length < 2" @click="groupSelected">
            分组
          </button>
          <button
            type="button"
            :disabled="!selectedItems.some((item) => item.groupId)"
            @click="ungroupSelected"
          >
            取消分组
          </button>
          <button type="button" :disabled="!selectedItems.length" @click="toggleLock">
            {{ selectedItems.some((item) => !item.locked) ? '锁定' : '解锁' }}
          </button>
        </div>
        <div class="layout-studio__objects" aria-label="画布对象">
          <button
            v-for="item in activeLayout.items"
            :key="item.id"
            type="button"
            :class="{ 'is-active': selectedIds.includes(item.id) }"
            @click="selectItem($event, item)"
          >
            <small>{{ item.kind === 'image' ? '图片' : '字段' }}</small>
            <strong>{{ item.label }}</strong>
            <em v-if="item.locked">已锁</em>
          </button>
        </div>
        <section v-if="selectedItem">
          <header>
            <span>
              <small>SELECTED</small>
              <strong>
                {{
                  selectedItems.length > 1 ? `已选 ${selectedItems.length} 项` : selectedItem.label
                }}
              </strong>
            </span>
            <div>
              <button type="button" aria-label="下移一层" @click="moveLayer(-1)">下移</button>
              <button type="button" aria-label="上移一层" @click="moveLayer(1)">上移</button>
            </div>
          </header>
          <div class="layout-studio__measurements">
            <label>
              <span>横向</span>
              <input
                type="number"
                :value="selectedItem.x"
                :disabled="selectedItem.locked"
                @change="updateSelected('x', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>纵向</span>
              <input
                type="number"
                :value="selectedItem.y"
                :disabled="selectedItem.locked"
                @change="updateSelected('y', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>宽度</span>
              <input
                type="number"
                :value="selectedItem.width"
                :disabled="selectedItem.locked"
                @change="updateSelected('width', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>高度</span>
              <input
                type="number"
                :value="selectedItem.height"
                :disabled="selectedItem.locked"
                @change="updateSelected('height', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
          <p>
            层级 {{ selectedItem.zIndex }} ·
            {{
              selectedItem.locked
                ? '对象已锁定，先解锁再移动。'
                : '数值用于精确微调，也可以只在画布上拖动。'
            }}
          </p>
        </section>
      </aside>
    </main>
  </section>
</template>

<style scoped src="../styles/FrontendWorkshopLayoutStudio.css"></style>
