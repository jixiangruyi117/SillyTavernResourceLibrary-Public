<script setup lang="ts">
import type { FrontendWorkshopLayerView } from '../utils/FrontendWorkshopSourceLayers'
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  createFrontendWorkshopSourceRuntimeInstance,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL,
  isFrontendWorkshopSourceRuntimeDomSelection,
  isFrontendWorkshopSourceRuntimeDomSnapshot,
  type FrontendWorkshopSourceRuntimeDomSelection,
  type FrontendWorkshopSourceRuntimeDomSnapshot,
  type FrontendWorkshopSourceRuntimeInstance,
  type FrontendWorkshopSourceRuntimeNetworkMode,
  type FrontendWorkshopSourceRuntimeSizingMode,
} from '../utils/FrontendWorkshopSourceRuntime'
import type {
  FrontendWorkshopSourceCanvasGesture,
  FrontendWorkshopSourceCanvasGestureCapabilities,
} from '../utils/FrontendWorkshopSourceCanvasGesture'
import { loadPreviewVendorLibsForSource } from '../utils/PreviewVendorLibs'
import {
  isRenderCompatibilityDiagnostic,
  RENDER_COMPATIBILITY_EVENTS,
  RENDER_COMPATIBILITY_PROTOCOL,
  type PreviewSessionContext,
  type RenderCompatibilityDiagnostic,
} from '../utils/RenderCompatibilityRuntime'
import RichContentPreview from './RichContentPreview.vue'
import { readFrontendWorkshopCharacterData } from '../utils/FrontendWorkshopSourceDelivery'
import { serializeTavernHelperFrontendEnvelope } from '../utils/FrontendWorkshopTavernFrontendEnvelope'
import FrontendWorkshopSourceTransformOverlay from './FrontendWorkshopSourceTransformOverlay.vue'

const props = withDefaults(
  defineProps<{
    sourceDocument: FrontendWorkshopSourceDocument
    active?: boolean
    networkMode?: FrontendWorkshopSourceRuntimeNetworkMode
    sizingMode?: FrontendWorkshopSourceRuntimeSizingMode
    viewportHeight?: number
    previewSessionContext?: PreviewSessionContext
    selectionMode?: boolean
    sourceMapping?: boolean
    selectedDomSelections?: readonly FrontendWorkshopSourceRuntimeDomSelection[]
    gestureCapabilities?: FrontendWorkshopSourceCanvasGestureCapabilities
    greetingIndex?: number
    layerView?: FrontendWorkshopLayerView
    canvasPanEnabled?: boolean
    gestureDisabled?: boolean
  }>(),
  {
    active: true,
    greetingIndex: undefined,
    canvasPanEnabled: false,
    layerView: undefined,
    networkMode: 'offline',
    sizingMode: 'content',
    viewportHeight: undefined,
    previewSessionContext: undefined,
    selectionMode: false,
    sourceMapping: false,
    selectedDomSelections: () => [],
    gestureCapabilities: undefined,
    gestureDisabled: false,
  },
)

const emit = defineEmits<{
  greetingChange: [index: number]
  canvasPan: [payload: { phase: string; x: number; y: number }]
  ready: [runtime: FrontendWorkshopSourceRuntimeInstance]
  pagehide: [runtime: FrontendWorkshopSourceRuntimeInstance]
  height: [height: number]
  runtimeError: [payload: { kind: string; message: string }]
  domSnapshot: [snapshot: FrontendWorkshopSourceRuntimeDomSnapshot]
  domSelection: [selection: FrontendWorkshopSourceRuntimeDomSelection]
  compatibilityDiagnostic: [diagnostic: RenderCompatibilityDiagnostic]
  sourceGesture: [
    payload: {
      selection: FrontendWorkshopSourceRuntimeDomSelection
      gesture: FrontendWorkshopSourceCanvasGesture
    },
  ]
}>()

const frame = ref<HTMLIFrameElement>()
const runtime = shallowRef<FrontendWorkshopSourceRuntimeInstance>()
const ready = ref(false)
const displayedGreeting = ref(0)
const greetingContext = shallowRef<PreviewSessionContext>({})
const greetingContents = computed(() => [...(greetingContext.value.messages?.greetings ?? [])])
function navigateGreeting(target: number): void {
  if (!Number.isInteger(target) || target < 0 || target >= greetingContents.value.length) return
  if (target === displayedGreeting.value) return
  displayedGreeting.value = target
  emit('greetingChange', target)
  ready.value = false
  pendingDomSnapshotRequests.clear()
  if (target === 0) void rebuildRuntime()
  else runtime.value = undefined
}

function reportError(payload: { kind: string; message: string }): void {
  emit('runtimeError', { kind: payload.kind.slice(0, 80), message: payload.message.slice(0, 2000) })
}
const measuredHeight = ref<number>()
const pendingDomSnapshotRequests = new Set<string>()
let rebuildGeneration = 0
let domSnapshotRequestSequence = 0

const activeDomSelection = computed(() => props.selectedDomSelections.at(-1))
const passiveDomSelections = computed(() => props.selectedDomSelections.slice(0, -1))

function currentViewportHeight(): number {
  const requested = Math.trunc(Number(props.viewportHeight) || 0)
  if (requested > 0) return requested
  if (typeof window === 'undefined') return 844
  return Math.max(1, Math.trunc(window.innerHeight || 844))
}

const renderedHeight = computed(() => measuredHeight.value ?? currentViewportHeight())

function postRuntimeControl(type: string, data: Record<string, unknown> = {}): boolean {
  const current = runtime.value
  const target = frame.value?.contentWindow
  if (!current || !target) return false
  target.postMessage(
    {
      protocol: FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL,
      type,
      projectId: current.projectId,
      sourceRevision: current.sourceRevision,
      instanceId: current.instanceId,
      runtimeNonce: current.runtimeNonce,
      ...data,
    },
    '*',
  )
  return true
}

function syncViewport(): void {
  postRuntimeControl(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.viewport, {
    height: currentViewportHeight(),
  })
}

function syncDomSelectionMode(): void {
  if (!ready.value) return
  postRuntimeControl(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelectionMode, {
    enabled: props.selectionMode,
    canvasPanEnabled: props.canvasPanEnabled,
    layerView: props.layerView
      ? {
          hidden: [...props.layerView.hidden],
          locked: [...props.layerView.locked],
          solo: props.layerView.solo,
        }
      : undefined,
  })
}

function requestDomSnapshot(): string | undefined {
  if (!ready.value || pendingDomSnapshotRequests.size >= 4) return undefined
  const requestId = `dom-snapshot-${++domSnapshotRequestSequence}`
  if (
    !postRuntimeControl(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSnapshotRequest, { requestId })
  )
    return undefined
  pendingDomSnapshotRequests.add(requestId)
  return requestId
}

function scrollBy(deltaX: number, deltaY: number, clientX: number, clientY: number): void {
  const bounds = frame.value?.getBoundingClientRect()
  if (props.sizingMode === 'viewport' && ready.value && bounds?.width && bounds.height)
    postRuntimeControl(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.scroll, {
      deltaX,
      deltaY,
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    })
}

function selectRuntimeNode(runtimeNodeId: string): void {
  if (!ready.value || !props.selectionMode) return
  postRuntimeControl(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelectRequest, { runtimeNodeId })
}

defineExpose({ requestDomSnapshot, scrollBy, selectRuntimeNode })

async function rebuildRuntime(): Promise<void> {
  const generation = ++rebuildGeneration
  displayedGreeting.value = props.greetingIndex ?? displayedGreeting.value
  ready.value = false
  measuredHeight.value = undefined
  pendingDomSnapshotRequests.clear()
  if (!props.active) {
    runtime.value = undefined
    return
  }

  greetingContext.value = props.previewSessionContext ?? {}
  if (!props.previewSessionContext?.messages) {
    try {
      const character = readFrontendWorkshopCharacterData(props.sourceDocument.authorSource)
      if (character) {
        const first = serializeTavernHelperFrontendEnvelope(
          props.sourceDocument.authorSource,
        ).envelope
        greetingContext.value = {
          ...props.previewSessionContext,
          character: { name: character.name as string, data: { ...character, first_mes: first } },
          messages: {
            greetings: [first, ...(character.alternate_greetings as string[])],
            activeSwipe: 0,
          },
        }
      }
    } catch (error) {
      reportError({
        kind: 'character-data',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (displayedGreeting.value >= greetingContents.value.length && displayedGreeting.value !== 0) {
    displayedGreeting.value = 0
    emit('greetingChange', 0)
  }
  if (displayedGreeting.value > 0) {
    runtime.value = undefined
    return
  }

  let vendorLibs
  try {
    vendorLibs = await loadPreviewVendorLibsForSource(props.sourceDocument.authorSource)
  } catch (error) {
    if (generation !== rebuildGeneration || !props.active) return
    vendorLibs = undefined
    reportError({
      kind: 'vendor-load',
      message:
        error instanceof Error ? error.message : String(error ?? 'Preview vendor load failed'),
    })
  }
  if (generation !== rebuildGeneration || !props.active) return

  runtime.value = createFrontendWorkshopSourceRuntimeInstance(props.sourceDocument, {
    networkMode: props.networkMode,
    sourceMapping: props.sourceMapping,
    sizingMode: props.sizingMode,
    viewportHeight: currentViewportHeight(),
    vendorLibs,
    previewSessionContext: greetingContext.value,
  })
  await nextTick()
  if (generation === rebuildGeneration) syncViewport()
}

function handleFrameLoad(): void {
  syncViewport()
}

function handleRuntimeMessage(event: MessageEvent): void {
  const current = runtime.value
  if (!current || event.source !== frame.value?.contentWindow) return
  const data = event.data
  if (
    data?.protocol === RENDER_COMPATIBILITY_PROTOCOL &&
    data?.type === RENDER_COMPATIBILITY_EVENTS.diagnostic &&
    isRenderCompatibilityDiagnostic(data.diagnostic)
  ) {
    emit('compatibilityDiagnostic', data.diagnostic)
    return
  }
  if (
    !data ||
    data.protocol !== FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL ||
    data.projectId !== current.projectId ||
    Number(data.sourceRevision) !== current.sourceRevision ||
    data.instanceId !== current.instanceId ||
    data.runtimeNonce !== current.runtimeNonce
  )
    return

  if (
    data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.canvasPan &&
    props.canvasPanEnabled &&
    ['start', 'move', 'end'].includes(data.phase) &&
    Number.isFinite(data.x) &&
    Number.isFinite(data.y)
  ) {
    const bounds = frame.value?.getBoundingClientRect()
    if (bounds)
      emit('canvasPan', {
        phase: data.phase,
        x: bounds.left + data.x * bounds.width,
        y: bounds.top + data.y * bounds.height,
      })
    return
  }
  if (data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.greetingNavigate) {
    navigateGreeting(data.target)
    return
  }
  if (data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.mount) {
    ready.value = true
    emit('ready', current)
    syncDomSelectionMode()
    requestDomSnapshot()
    return
  }
  if (data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.pagehide) {
    ready.value = false
    pendingDomSnapshotRequests.clear()
    emit('pagehide', current)
    return
  }
  if (data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.height) {
    const height = Math.ceil(Number(data.height))
    if (!Number.isFinite(height) || height <= 0) return
    measuredHeight.value = height
    emit('height', height)
    return
  }
  if (data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.error) {
    reportError({
      kind: String(data.kind || 'error'),
      message: String(data.message || ''),
    })
    return
  }
  if (
    data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.compatibilityDiagnostic &&
    isRenderCompatibilityDiagnostic(data.diagnostic)
  ) {
    emit('compatibilityDiagnostic', data.diagnostic)
    return
  }
  if (
    data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelection &&
    props.selectionMode &&
    isFrontendWorkshopSourceRuntimeDomSelection(data)
  ) {
    emit('domSelection', data)
    requestDomSnapshot()
    return
  }
  if (
    data.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSnapshot &&
    isFrontendWorkshopSourceRuntimeDomSnapshot(data) &&
    pendingDomSnapshotRequests.delete(data.requestId)
  )
    emit('domSnapshot', data)
}

watch(
  () => [
    props.active,
    props.networkMode,
    props.sourceMapping,
    props.sizingMode,
    props.viewportHeight,
    props.previewSessionContext,
    props.sourceDocument.projectId,
    props.sourceDocument.revision,
    props.sourceDocument.authorSource,
  ],
  () => void rebuildRuntime(),
  { immediate: true },
)
watch(
  () => [props.selectionMode, props.canvasPanEnabled, props.layerView],
  () => {
    syncDomSelectionMode()
  },
)

watch(
  () => props.greetingIndex,
  (index) => {
    if (index !== undefined) navigateGreeting(index)
  },
)

onMounted(() => {
  window.addEventListener('message', handleRuntimeMessage)
  window.addEventListener('resize', syncViewport)
})

onUnmounted(() => {
  rebuildGeneration += 1
  pendingDomSnapshotRequests.clear()
  window.removeEventListener('message', handleRuntimeMessage)
  window.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <section
    class="frontend-workshop-source-preview-shell"
    :data-sizing-mode="sizingMode"
    :data-source-ready="ready ? 'true' : 'false'"
  >
    <RichContentPreview
      v-if="displayedGreeting > 0"
      class="frontend-workshop-source-preview__greeting"
      :source="greetingContents[displayedGreeting] ?? ''"
      title="备用开场白预览"
      render-shell="content"
      :active="active"
      :greeting-contents="greetingContents"
      :greeting-index="displayedGreeting"
      :character-data="greetingContext.character?.data"
      :macro-char-name="greetingContext.character?.name"
      bare
      @navigate-greeting="navigateGreeting"
      @compatibility-diagnostic="emit('compatibilityDiagnostic', $event)"
    />
    <div
      v-if="displayedGreeting === 0"
      class="frontend-workshop-source-preview"
      :data-source-ready="ready ? 'true' : 'false'"
      :data-selection-mode="selectionMode ? 'true' : 'false'"
      :aria-busy="!ready"
    >
      <p v-if="!ready" class="frontend-workshop-source-preview__loading" role="status">
        正在载入画布…
      </p>
      <iframe
        v-if="runtime"
        :key="runtime.instanceId"
        ref="frame"
        class="frontend-workshop-source-preview__frame"
        :name="`SRL-source-host--${runtime.instanceId}`"
        title="Source Runtime Preview"
        :sandbox="runtime.sandbox"
        :srcdoc="runtime.hostDocument"
        :style="{ height: sizingMode === 'viewport' ? '100%' : `${renderedHeight}px` }"
        @load="handleFrameLoad"
      />
      <FrontendWorkshopSourceTransformOverlay
        v-if="selectionMode && activeDomSelection && gestureCapabilities"
        :selection="activeDomSelection"
        :capabilities="gestureCapabilities"
        :disabled="gestureDisabled"
        @commit="emit('sourceGesture', $event)"
      />
      <div
        v-for="selection in passiveDomSelections"
        :key="selection.runtimeNodeId"
        class="frontend-workshop-source-preview__selection-marker"
        :style="{
          left: `${selection.rect.x}px`,
          top: `${selection.rect.y}px`,
          width: `${Math.max(1, selection.rect.width)}px`,
          height: `${Math.max(1, selection.rect.height)}px`,
        }"
        aria-hidden="true"
      ></div>
    </div>
  </section>
</template>

<style scoped>
.frontend-workshop-source-preview__greeting {
  min-height: 0;
  overflow: auto;
  flex: 1 1 auto;
}

.frontend-workshop-source-preview-shell {
  min-width: 0;
  max-width: 100%;
}
.frontend-workshop-source-preview-shell[data-sizing-mode='viewport'] {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.frontend-workshop-source-preview-shell[data-sizing-mode='viewport']
  .frontend-workshop-source-preview {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}
.frontend-workshop-source-preview {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: auto;
}
.frontend-workshop-source-preview[aria-busy='true'] .frontend-workshop-source-preview__frame {
  pointer-events: none;
}
.frontend-workshop-source-preview__loading {
  margin: 0;
  padding: 8px;
  color: var(--color-ink-soft);
}
.frontend-workshop-source-preview__frame {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 1px;
  border: 0;
  background: transparent;
}
.frontend-workshop-source-preview__selection-marker {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  border: 1.5px dashed var(--color-accent, #136e8a);
  background: color-mix(in srgb, var(--color-accent, #136e8a) 8%, transparent);
  pointer-events: none;
}
</style>
