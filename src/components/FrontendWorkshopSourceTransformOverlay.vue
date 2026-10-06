<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue'

import {
  computeFrontendWorkshopCanvasPlacementTransform,
  computeFrontendWorkshopCanvasRotationTransform,
  type FrontendWorkshopCanvasTransformHandle,
} from '../utils/FrontendWorkshopCanvasTransform'
import type {
  FrontendWorkshopSourceCanvasGesture,
  FrontendWorkshopSourceCanvasGestureCapabilities,
  FrontendWorkshopSourceCanvasGestureMode,
} from '../utils/FrontendWorkshopSourceCanvasGesture'
import type {
  FrontendWorkshopSourceRuntimeDomRect,
  FrontendWorkshopSourceRuntimeDomSelection,
} from '../utils/FrontendWorkshopSourceRuntime'

const props = defineProps<{
  selection: FrontendWorkshopSourceRuntimeDomSelection
  capabilities: FrontendWorkshopSourceCanvasGestureCapabilities
  disabled?: boolean
}>()

const emit = defineEmits<{
  commit: [
    payload: {
      selection: FrontendWorkshopSourceRuntimeDomSelection
      gesture: FrontendWorkshopSourceCanvasGesture
    },
  ]
}>()

interface PointerSession {
  pointerId: number
  mode: FrontendWorkshopSourceCanvasGestureMode
  handle?: FrontendWorkshopCanvasTransformHandle
  startClientX: number
  startClientY: number
  viewportScaleX: number
  viewportScaleY: number
  startRect: FrontendWorkshopSourceRuntimeDomRect
  centerClientX: number
  centerClientY: number
  startAngle?: number
  currentAngle?: number
  latestDeltaX: number
  latestDeltaY: number
  hasMoved: boolean
}

const PREVIEW_CONSTRAINTS = {
  minWidth: 1,
  minHeight: 1,
  minScale: 0.05,
  maxScale: 20,
  clampPositionToOrigin: false,
  clampRightToCanvas: false,
  roundOutput: false,
} as const

const box = shallowRef<HTMLElement>()
const pointerSession = shallowRef<PointerSession>()
const previewRect = shallowRef<FrontendWorkshopSourceRuntimeDomRect>()
const previewRotation = shallowRef(0)

const displayRect = computed(() => previewRect.value ?? props.selection.rect)
const boxStyle = computed(() => ({
  left: `${displayRect.value.x}px`,
  top: `${displayRect.value.y}px`,
  width: `${Math.max(1, displayRect.value.width)}px`,
  height: `${Math.max(1, displayRect.value.height)}px`,
  transform: previewRotation.value ? `rotate(${previewRotation.value}deg)` : undefined,
}))

function canStart(mode: FrontendWorkshopSourceCanvasGestureMode): boolean {
  return !props.disabled && props.capabilities[mode]
}

function pointerAngle(clientX: number, clientY: number, session: PointerSession): number {
  return Math.atan2(clientY - session.centerClientY, clientX - session.centerClientX)
}

function updatePreview(session: PointerSession): void {
  if (session.mode === 'rotate') {
    const startAngle = session.startAngle ?? 0
    const currentAngle = session.currentAngle ?? startAngle
    previewRotation.value = computeFrontendWorkshopCanvasRotationTransform({
      startRotation: 0,
      startAngle,
      currentAngle,
    })
    return
  }

  const placement = {
    x: session.startRect.x,
    y: session.startRect.y,
    width: Math.max(1, session.startRect.width),
    height: Math.max(1, session.startRect.height),
    zIndex: 0,
  }
  const next = computeFrontendWorkshopCanvasPlacementTransform({
    mode: session.mode === 'resize' ? 'resize' : session.mode,
    placement,
    deltaX: session.latestDeltaX,
    deltaY: session.latestDeltaY,
    canvasWidth: 1,
    handle: session.handle,
    constraints: PREVIEW_CONSTRAINTS,
  })
  previewRect.value = {
    x: next.x,
    y: next.y,
    width: next.width,
    height: next.height,
  }
}

function startGesture(
  event: PointerEvent,
  mode: FrontendWorkshopSourceCanvasGestureMode,
  handle?: FrontendWorkshopCanvasTransformHandle,
): void {
  if (!canStart(mode) || pointerSession.value) return
  event.preventDefault()
  event.stopPropagation()
  const bounds = box.value?.getBoundingClientRect()
  const centerClientX = bounds ? bounds.left + bounds.width / 2 : event.clientX
  const centerClientY = bounds ? bounds.top + bounds.height / 2 : event.clientY
  const session: PointerSession = {
    pointerId: event.pointerId,
    mode,
    handle,
    startClientX: event.clientX,
    startClientY: event.clientY,
    viewportScaleX:
      bounds?.width && props.selection.rect.width > 0
        ? bounds.width / props.selection.rect.width
        : 1,
    viewportScaleY:
      bounds?.height && props.selection.rect.height > 0
        ? bounds.height / props.selection.rect.height
        : 1,
    startRect: { ...props.selection.rect },
    centerClientX,
    centerClientY,
    latestDeltaX: 0,
    latestDeltaY: 0,
    hasMoved: false,
  }
  if (mode === 'rotate') {
    session.startAngle = pointerAngle(event.clientX, event.clientY, session)
    session.currentAngle = session.startAngle
  }
  pointerSession.value = session
  if (event.currentTarget instanceof Element && 'setPointerCapture' in event.currentTarget) {
    try {
      ;(
        event.currentTarget as Element & { setPointerCapture(pointerId: number): void }
      ).setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; window listeners still preserve the session.
    }
  }
  window.addEventListener('pointermove', handlePointerMove, true)
  window.addEventListener('pointerup', handlePointerUp, true)
  window.addEventListener('pointercancel', handlePointerCancel, true)
}

function handlePointerMove(event: PointerEvent): void {
  const session = pointerSession.value
  if (!session || event.pointerId !== session.pointerId) return
  event.preventDefault()
  session.latestDeltaX = (event.clientX - session.startClientX) / session.viewportScaleX
  session.latestDeltaY = (event.clientY - session.startClientY) / session.viewportScaleY
  if (session.mode === 'rotate') {
    session.currentAngle = pointerAngle(event.clientX, event.clientY, session)
  }
  session.hasMoved ||= Math.hypot(session.latestDeltaX, session.latestDeltaY) >= 1
  pointerSession.value = { ...session }
  updatePreview(session)
}

function cleanupPointerSession(): void {
  pointerSession.value = undefined
  previewRect.value = undefined
  previewRotation.value = 0
  window.removeEventListener('pointermove', handlePointerMove, true)
  window.removeEventListener('pointerup', handlePointerUp, true)
  window.removeEventListener('pointercancel', handlePointerCancel, true)
}

function handlePointerUp(event: PointerEvent): void {
  const session = pointerSession.value
  if (!session || event.pointerId !== session.pointerId) return
  event.preventDefault()
  if (session.hasMoved) {
    const gesture: FrontendWorkshopSourceCanvasGesture =
      session.mode === 'rotate'
        ? {
            mode: 'rotate',
            startAngle: session.startAngle,
            currentAngle: session.currentAngle,
          }
        : {
            mode: session.mode,
            deltaX: session.latestDeltaX,
            deltaY: session.latestDeltaY,
            ...(session.handle ? { handle: session.handle } : {}),
          }
    emit('commit', { selection: props.selection, gesture })
  }
  cleanupPointerSession()
}

function handlePointerCancel(event: PointerEvent): void {
  const session = pointerSession.value
  if (!session || event.pointerId !== session.pointerId) return
  cleanupPointerSession()
}

function startMove(event: PointerEvent): void {
  startGesture(event, 'move')
}

function startResize(event: PointerEvent): void {
  startGesture(event, 'resize', 'se')
}

function startScale(event: PointerEvent): void {
  startGesture(event, 'scale', 'se')
}

function startRotate(event: PointerEvent): void {
  startGesture(event, 'rotate')
}

onUnmounted(cleanupPointerSession)
</script>

<template>
  <div
    ref="box"
    class="frontend-workshop-source-transform-overlay"
    :class="{ 'is-disabled': disabled }"
    :style="boxStyle"
    data-source-transform-overlay="true"
    @pointerdown="startMove"
  >
    <span class="frontend-workshop-source-transform-overlay__label" aria-hidden="true">
      {{ selection.tagName }}
    </span>
    <button
      v-if="capabilities.resize"
      type="button"
      class="frontend-workshop-source-transform-overlay__handle is-resize"
      data-gesture-mode="resize"
      aria-label="调整元素宽高"
      :disabled="disabled"
      @pointerdown.stop="startResize"
    ></button>
    <button
      v-if="capabilities.scale"
      type="button"
      class="frontend-workshop-source-transform-overlay__handle is-scale"
      data-gesture-mode="scale"
      aria-label="等比缩放元素"
      :disabled="disabled"
      @pointerdown.stop="startScale"
    ></button>
    <button
      v-if="capabilities.rotate"
      type="button"
      class="frontend-workshop-source-transform-overlay__handle is-rotate"
      data-gesture-mode="rotate"
      aria-label="旋转元素"
      :disabled="disabled"
      @pointerdown.stop="startRotate"
    ></button>
  </div>
</template>

<style scoped>
.frontend-workshop-source-transform-overlay {
  position: absolute;
  z-index: 3;
  box-sizing: border-box;
  min-width: 1px;
  min-height: 1px;
  border: 1.5px solid var(--color-accent, #136e8a);
  outline: 1px solid color-mix(in srgb, var(--color-surface, #fff) 82%, transparent);
  touch-action: none;
  cursor: move;
  transform-origin: center;
  user-select: none;
}

.frontend-workshop-source-transform-overlay.is-disabled {
  cursor: default;
  opacity: 0.7;
}

.frontend-workshop-source-transform-overlay__label {
  position: absolute;
  top: -20px;
  left: -1px;
  max-width: 12rem;
  padding: 2px 5px;
  overflow: hidden;
  border-radius: 5px;
  background: var(--color-accent, #136e8a);
  color: var(--color-surface, #fff);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.frontend-workshop-source-transform-overlay__handle {
  position: absolute;
  z-index: 1;
  width: calc(44px / var(--source-canvas-scale, 1));
  height: calc(44px / var(--source-canvas-scale, 1));
  padding: 0;
  border: 0;
  background: transparent;
  touch-action: none;
}

.frontend-workshop-source-transform-overlay__handle::after {
  content: '';
  position: absolute;
  inset: calc(13px / var(--source-canvas-scale, 1));
  border: 2px solid var(--color-surface, #fff);
  border-radius: 50%;
  background: var(--color-accent, #136e8a);
  pointer-events: none;
}

.frontend-workshop-source-transform-overlay__handle.is-resize {
  right: calc(-22px / var(--source-canvas-scale, 1));
  bottom: calc(-22px / var(--source-canvas-scale, 1));
  cursor: nwse-resize;
}

.frontend-workshop-source-transform-overlay__handle.is-resize::after {
  border-radius: 4px;
}

.frontend-workshop-source-transform-overlay__handle.is-scale {
  right: calc(-68px / var(--source-canvas-scale, 1));
  bottom: calc(-22px / var(--source-canvas-scale, 1));
  cursor: nwse-resize;
}

.frontend-workshop-source-transform-overlay__handle.is-rotate {
  top: calc(-48px / var(--source-canvas-scale, 1));
  left: 50%;
  margin-left: calc(-22px / var(--source-canvas-scale, 1));
  cursor: grab;
}

.frontend-workshop-source-transform-overlay__handle:disabled {
  cursor: default;
  opacity: 0.45;
}
</style>
