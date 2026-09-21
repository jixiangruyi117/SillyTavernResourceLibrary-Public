<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  hidden?: boolean
  canUndo: boolean
  canRedo: boolean
  hasCheckpoint: boolean
  singleColumn: boolean
}>()
const emit = defineEmits<{
  undo: []
  redo: []
  save: []
  restore: []
  single: []
}>()
const surface = useTemplateRef<HTMLElement>('surface')
const open = ref(false)
const bounds = ref({ width: 320, height: 600 })
const position = ref({ x: 0, y: 180 })
const diameter = 34
const ballRadius = diameter / 2
const radius = 88
const actions = computed(
  () =>
    [
      { id: 'undo', label: '撤销', disabled: !props.canUndo },
      { id: 'redo', label: '重做', disabled: !props.canRedo },
      { id: 'save', label: '保存工作台检查点', disabled: false },
      { id: 'restore', label: '恢复检查点', disabled: !props.hasCheckpoint },
      { id: 'single', label: props.singleColumn ? '双列显示' : '单列显示', disabled: false },
    ] as const,
)
const center = computed(() => ({
  x: open.value
    ? clamp(position.value.x + ballRadius, 120, bounds.value.width - 120)
    : position.value.x + ballRadius,
  y: open.value
    ? clamp(position.value.y + ballRadius, 116, bounds.value.height - 116)
    : position.value.y + ballRadius,
}))
let drag:
  { pointer: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined
let suppressClick = false
let observer: ResizeObserver | undefined
let positioned = false
watch(
  () => props.hidden,
  (hidden) => {
    if (hidden) {
      open.value = false
      drag = undefined
    }
  },
)
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(Math.max(min, max), value))
}
function constrain() {
  const rect = surface.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return
  bounds.value = { width: rect.width, height: rect.height }
  if (!positioned) {
    position.value = { x: rect.width - diameter, y: Math.min(180, rect.height - diameter) }
    positioned = true
  }
  position.value = {
    x: clamp(position.value.x, 0, rect.width - diameter),
    y: clamp(position.value.y, 0, rect.height - diameter),
  }
}
function start(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0) return
  constrain()
  suppressClick = false
  drag = {
    pointer: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: center.value.x - ballRadius,
    top: center.value.y - ballRadius,
    moved: false,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  if (!drag.moved && Math.hypot(dx, dy) < 6) return
  drag.moved = true
  open.value = false
  position.value = {
    x: clamp(drag.left + dx, 0, bounds.value.width - diameter),
    y: clamp(drag.top + dy, 0, bounds.value.height - diameter),
  }
}
function end(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return
  suppressClick = drag.moved
  if (drag.moved) {
    const p = position.value
    const right = bounds.value.width - diameter
    const bottom = bounds.value.height - diameter
    const distance = Math.min(p.x, right - p.x, p.y, bottom - p.y)
    // 只有靠近边缘才吸附，工作区内部仍可自由停放。
    if (distance < 40) {
      if (distance === p.x) p.x = 0
      else if (distance === right - p.x) p.x = right
      else if (distance === p.y) p.y = 0
      else p.y = bottom
    }
  }
  drag = undefined
}
function toggle() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  constrain()
  open.value = !open.value
}
function activate(id: 'undo' | 'redo' | 'save' | 'restore' | 'single') {
  if (id === 'undo') emit('undo')
  else if (id === 'redo') emit('redo')
  else if (id === 'save') emit('save')
  else if (id === 'restore') emit('restore')
  else emit('single')
  open.value = false
}
function actionStyle(index: number) {
  const angle = ((-90 + index * 72) * Math.PI) / 180
  return {
    left: `${center.value.x + Math.cos(angle) * radius - 34}px`,
    top: `${center.value.y + Math.sin(angle) * radius - 24}px`,
  }
}
onMounted(() => {
  constrain()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(constrain)
    if (surface.value) observer.observe(surface.value)
  }
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <Teleport to="body">
    <div v-show="!hidden" ref="surface" class="stitch-tools" @keydown.esc.stop="open = false">
      <div v-if="open" class="stitch-tools__menu" role="group" aria-label="工作台历史与检查点">
        <button
          v-for="(action, index) in actions"
          :key="action.id"
          type="button"
          class="button button--quiet stitch-tools__action"
          :style="actionStyle(index)"
          :disabled="action.disabled"
          :aria-pressed="action.id === 'single' ? singleColumn : undefined"
          @click="activate(action.id)"
        >
          {{ action.label }}
        </button>
      </div>
      <button
        type="button"
        class="button button--primary stitch-tools__ball"
        :style="{ left: `${center.x - ballRadius}px`, top: `${center.y - ballRadius}px` }"
        aria-label="工作台悬浮工具"
        :aria-expanded="open"
        title="点击展开，拖动移动，靠边吸附"
        @pointerdown="start"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
        @lostpointercapture="drag = undefined"
        @click="toggle"
      >
        <span aria-hidden="true">{{ open ? '×' : '⋮' }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.stitch-tools {
  position: fixed;
  z-index: 310;
  inset: max(8px, var(--safe-top, 0px)) max(8px, var(--safe-right, 0px))
    max(8px, var(--safe-bottom, 0px)) max(8px, var(--safe-left, 0px));
  pointer-events: none;
}
.stitch-tools__ball,
.stitch-tools__action {
  position: absolute;
  pointer-events: auto;
  padding: 0;
}
.stitch-tools__ball {
  width: 34px;
  height: 34px;
  min-height: 34px;
  border-radius: 50%;
  touch-action: none;
  user-select: none;
  font-size: 20px;
  cursor: grab;
}
.stitch-tools__action {
  width: 68px;
  height: 48px;
  min-height: 48px;
  padding: 3px;
  border-radius: 16px;
  font-size: 12px;
  line-height: 1.3;
}
</style>
