<script setup lang="ts">
import type { FrontendWorkshopLayerView } from '../utils/FrontendWorkshopSourceLayers'
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  installFrontendWorkshopCanvasPan,
  type FrontendWorkshopCanvasPanEvent,
} from '../utils/FrontendWorkshopCanvasPan'
import { FRONTEND_WORKSHOP_CANVAS_WIDTHS } from '../utils/FrontendWorkshopProjectGeometry'
import type { FrontendWorkshopLayoutViewport } from '../types/FrontendWorkshopProject'

import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { FrontendWorkshopSourceAnalysisCache } from '../utils/FrontendWorkshopSourceAnalysisCache'
import { getFrontendWorkshopSourceCanvasGestureCapabilities } from '../utils/FrontendWorkshopSourceCanvasGesture'
import {
  mapFrontendWorkshopRuntimeDomSnapshot,
  type FrontendWorkshopRuntimeDomMappingSnapshot,
  type FrontendWorkshopRuntimeDomNodeMapping,
} from '../utils/FrontendWorkshopRuntimeDomProvenance'
import {
  resolveFrontendWorkshopSourceSelection,
  type FrontendWorkshopResolvedSourceSelection,
} from '../utils/FrontendWorkshopSourceSelection'
import {
  resolveFrontendWorkshopSourceTransformTargets,
  type FrontendWorkshopSourceTransformTargets,
} from '../utils/FrontendWorkshopSourceTransform'
import type {
  FrontendWorkshopSourceRuntimeDomSelection,
  FrontendWorkshopSourceRuntimeDomSnapshot,
  FrontendWorkshopSourceRuntimeInstance,
  FrontendWorkshopSourceRuntimeNetworkMode,
} from '../utils/FrontendWorkshopSourceRuntime'
import type {
  PreviewSessionContext,
  RenderCompatibilityDiagnostic,
} from '../utils/RenderCompatibilityRuntime'
import type { FrontendWorkshopSourceCanvasGesture } from '../utils/FrontendWorkshopSourceCanvasGesture'
import FrontendWorkshopSourcePreview from './FrontendWorkshopSourcePreview.vue'

const props = defineProps<{
  sourceDocument?: FrontendWorkshopSourceDocument
  networkMode: FrontendWorkshopSourceRuntimeNetworkMode
  previewSessionContext?: PreviewSessionContext
  layerView?: FrontendWorkshopLayerView
  greetingIndex?: number
  gestureDisabled?: boolean
}>()

const emit = defineEmits<{
  runtimeError: [payload: { kind: string; message: string }]
  compatibilityDiagnostic: [diagnostic: RenderCompatibilityDiagnostic]
  selectionModeChange: [active: boolean]
  multiSelectModeChange: [active: boolean]
  greetingChange: [index: number]
  selectionsChange: [selections: readonly FrontendWorkshopResolvedSourceSelection[]]
  transformTargetsChange: [targets: FrontendWorkshopSourceTransformTargets]
  sourceGesture: [
    payload: {
      selection: FrontendWorkshopSourceRuntimeDomSelection
      gesture: FrontendWorkshopSourceCanvasGesture
    },
  ]
}>()

const selectionMode = shallowRef(false)
const multiSelectMode = shallowRef(false)
const panning = shallowRef(false)
let stopBackgroundPan: (() => void) | undefined
const zoom = ref(1)
const canvasMode = ref<FrontendWorkshopLayoutViewport>('phone')
const viewportElement = ref<HTMLElement>()
const zoomPercent = computed(() => Math.round(zoom.value * 100))
const panX = ref(0)
const panY = ref(0)
const baselineSnapshot = shallowRef<FrontendWorkshopSourceRuntimeDomSnapshot>()
const latestSnapshot = shallowRef<FrontendWorkshopSourceRuntimeDomSnapshot>()
const sourcePreview = ref<InstanceType<typeof FrontendWorkshopSourcePreview>>()
const layerEntries = computed(() =>
  (latestSnapshot.value?.nodes ?? [])
    .filter(
      (node) =>
        node.nodeKind === 'element' &&
        !['script', 'style', 'link', 'meta'].includes(node.tagName ?? ''),
    )
    .map((node) => ({
      id: node.runtimeNodeId,
      label: [node.tagName, node.elementId ? `#${node.elementId}` : '', node.label]
        .filter(Boolean)
        .join(' · '),
    })),
)
async function selectLayer(runtimeNodeId: string): Promise<void> {
  if (!layerEntries.value.some((node) => node.id === runtimeNodeId)) return
  if (!selectionMode.value) toggleSelectionMode()
  await nextTick()
  sourcePreview.value?.selectRuntimeNode(runtimeNodeId)
}
async function selectSourceElement(sourceEntityId: string): Promise<boolean> {
  const node = latestSnapshot.value?.nodes.find((item) => item.sourceEntityId === sourceEntityId)
  if (!node) return false
  await selectLayer(node.runtimeNodeId)
  return true
}
function refreshLayers(): void {
  sourcePreview.value?.requestDomSnapshot()
}
const baselineMapping = shallowRef<FrontendWorkshopRuntimeDomMappingSnapshot>()
const latestMapping = shallowRef<FrontendWorkshopRuntimeDomMappingSnapshot>()
const pendingSelection = shallowRef<FrontendWorkshopSourceRuntimeDomSelection>()
const selectionEntries = shallowRef<
  Array<{
    runtime: FrontendWorkshopSourceRuntimeDomSelection
    resolved: FrontendWorkshopResolvedSourceSelection
  }>
>([])
const analysisCache = new FrontendWorkshopSourceAnalysisCache()
let panStart: { x: number; y: number; panX: number; panY: number } | undefined
function handleCanvasPan(event: FrontendWorkshopCanvasPanEvent): void {
  if (event.phase === 'end') {
    panStart = undefined
    panning.value = false
    return
  }
  if (props.gestureDisabled) return
  if (event.phase === 'start') {
    panStart = { x: event.x, y: event.y, panX: panX.value, panY: panY.value }
    panning.value = true
  } else if (panStart) {
    panX.value = panStart.panX + event.x - panStart.x
    panY.value = panStart.panY + event.y - panStart.y
  }
}

const selection = computed(() => selectionEntries.value.at(-1)?.resolved)
const runtimeSelections = computed(() => selectionEntries.value.map((entry) => entry.runtime))
const resolvedSelections = computed(() => selectionEntries.value.map((entry) => entry.resolved))
const stageStyle = computed(() => ({
  width: `${FRONTEND_WORKSHOP_CANVAS_WIDTHS[canvasMode.value]}px`,
  '--source-canvas-scale': zoom.value,
  transform: `translate3d(${panX.value}px, ${panY.value}px, 0) scale(${zoom.value})`,
}))

const transformTargets = computed<FrontendWorkshopSourceTransformTargets>(() => {
  const source = props.sourceDocument
  if (!source || !selection.value) return { fields: {} }
  return resolveFrontendWorkshopSourceTransformTargets(
    source,
    analysisCache.analyze(source),
    selection.value,
  )
})
const gestureCapabilities = computed(() =>
  getFrontendWorkshopSourceCanvasGestureCapabilities(transformTargets.value),
)

watch(resolvedSelections, (value) => emit('selectionsChange', value), { immediate: true })
watch(transformTargets, (value) => emit('transformTargetsChange', value), { immediate: true })
watch(
  () => [props.sourceDocument?.projectId, props.sourceDocument?.revision] as const,
  () => resetSelection(),
)
watch(
  () => props.greetingIndex,
  () => resetSelection(),
)

function sameRuntimeIdentity(
  left: Pick<
    FrontendWorkshopSourceRuntimeDomSnapshot | FrontendWorkshopSourceRuntimeDomSelection,
    'projectId' | 'sourceRevision' | 'instanceId' | 'runtimeNonce'
  >,
  right: Pick<
    FrontendWorkshopSourceRuntimeDomSnapshot | FrontendWorkshopSourceRuntimeDomSelection,
    'projectId' | 'sourceRevision' | 'instanceId' | 'runtimeNonce'
  >,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.sourceRevision === right.sourceRevision &&
    left.instanceId === right.instanceId &&
    left.runtimeNonce === right.runtimeNonce
  )
}

function resetViewport(): void {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}
function adjustZoom(delta: number): void {
  zoom.value = Math.max(0.25, Math.min(2, Number((zoom.value + delta).toFixed(2))))
}
function fitCanvas(): void {
  const viewportWidth = viewportElement.value?.clientWidth
  if (!viewportWidth) return
  const available = Math.max(1, viewportWidth - 94)
  resetViewport()
  zoom.value = Math.min(1, available / FRONTEND_WORKSHOP_CANVAS_WIDTHS[canvasMode.value])
}
function setCanvasMode(mode: FrontendWorkshopLayoutViewport): void {
  canvasMode.value = mode
  void nextTick(fitCanvas)
}
function fitSelection(): void {
  const rectangles = runtimeSelections.value.map((item) => item.rect)
  if (!rectangles.length) return
  const left = Math.min(...rectangles.map((rect) => rect.x))
  const top = Math.min(...rectangles.map((rect) => rect.y))
  const width = Math.max(...rectangles.map((rect) => rect.x + rect.width)) - left
  const height = Math.max(...rectangles.map((rect) => rect.y + rect.height)) - top
  const availableWidth = Math.max(1, (viewportElement.value?.clientWidth ?? 390) - 94)
  const availableHeight = Math.max(1, (viewportElement.value?.clientHeight ?? 500) - 120)
  zoom.value = Math.max(
    0.25,
    Math.min(1.5, availableWidth / Math.max(1, width), availableHeight / Math.max(1, height)),
  )
  panX.value = -left * zoom.value
  panY.value = -top * zoom.value
  viewportElement.value?.scrollTo?.(0, 0)
}

function resetSelection(clearMode = false): void {
  panStart = undefined
  panning.value = false
  latestSnapshot.value = undefined
  baselineSnapshot.value = undefined
  baselineMapping.value = undefined
  latestMapping.value = undefined
  pendingSelection.value = undefined
  selectionEntries.value = []
  if (clearMode) {
    multiSelectMode.value = false
    emit('multiSelectModeChange', false)
  }
  if (clearMode && selectionMode.value) {
    selectionMode.value = false
    emit('selectionModeChange', false)
  }
}

function toggleSelectionMode(): void {
  if (multiSelectMode.value) {
    multiSelectMode.value = false
    selectionEntries.value = selectionEntries.value.slice(-1)
    emit('multiSelectModeChange', false)
    return
  }
  selectionMode.value = !selectionMode.value
  if (!selectionMode.value) {
    pendingSelection.value = undefined
    selectionEntries.value = []
    multiSelectMode.value = false
    emit('multiSelectModeChange', false)
  }
  emit('selectionModeChange', selectionMode.value)
}

function toggleMultiSelectMode(): void {
  multiSelectMode.value = !multiSelectMode.value
  if (multiSelectMode.value && !selectionMode.value) {
    selectionMode.value = true
    emit('selectionModeChange', true)
  }
  if (!multiSelectMode.value && selectionEntries.value.length > 1) {
    selectionEntries.value = selectionEntries.value.slice(-1)
  }
  emit('multiSelectModeChange', multiSelectMode.value)
}

function clearSelections(): void {
  pendingSelection.value = undefined
  selectionEntries.value = []
}

function handleRuntimeReady(runtime: FrontendWorkshopSourceRuntimeInstance): void {
  const source = props.sourceDocument
  if (
    !source ||
    runtime.projectId !== source.projectId ||
    runtime.sourceRevision !== source.revision
  )
    return
  resetSelection()
}

function handleRuntimePagehide(runtime: FrontendWorkshopSourceRuntimeInstance): void {
  const baseline = baselineSnapshot.value
  if (baseline && sameRuntimeIdentity(baseline, runtime)) resetSelection()
}

function preferredMappingForSelection(
  runtimeSelection: FrontendWorkshopSourceRuntimeDomSelection,
): FrontendWorkshopRuntimeDomNodeMapping | undefined {
  const baseline = baselineMapping.value
  if (
    baseline &&
    baseline.projectId === runtimeSelection.projectId &&
    baseline.sourceRevision === runtimeSelection.sourceRevision &&
    baseline.runtimeInstanceId === runtimeSelection.instanceId &&
    baseline.runtimeNonce === runtimeSelection.runtimeNonce
  ) {
    const node = baseline.nodes.find(
      (candidate) => candidate.runtimeNodeId === runtimeSelection.runtimeNodeId,
    )
    if (node?.mappingConfidence === 'exact') return node
  }

  const latest = latestMapping.value
  if (
    latest &&
    latest.projectId === runtimeSelection.projectId &&
    latest.sourceRevision === runtimeSelection.sourceRevision &&
    latest.runtimeInstanceId === runtimeSelection.instanceId &&
    latest.runtimeNonce === runtimeSelection.runtimeNonce
  ) {
    const node = latest.nodes.find(
      (candidate) => candidate.runtimeNodeId === runtimeSelection.runtimeNodeId,
    )
    if (node) return node
  }

  return baseline?.nodes.find(
    (candidate) => candidate.runtimeNodeId === runtimeSelection.runtimeNodeId,
  )
}

function resolvePendingSelection(): void {
  const source = props.sourceDocument
  const runtimeSelection = pendingSelection.value
  if (
    !source ||
    !runtimeSelection ||
    runtimeSelection.projectId !== source.projectId ||
    runtimeSelection.sourceRevision !== source.revision
  )
    return
  const resolved = resolveFrontendWorkshopSourceSelection(
    source,
    analysisCache.analyze(source),
    runtimeSelection,
    preferredMappingForSelection(runtimeSelection),
  )
  const existingIndex = selectionEntries.value.findIndex(
    (entry) => entry.runtime.runtimeNodeId === runtimeSelection.runtimeNodeId,
  )
  if (multiSelectMode.value && existingIndex >= 0) {
    selectionEntries.value = selectionEntries.value.filter((_, index) => index !== existingIndex)
  } else if (multiSelectMode.value) {
    selectionEntries.value = [...selectionEntries.value, { runtime: runtimeSelection, resolved }]
  } else {
    selectionEntries.value = [{ runtime: runtimeSelection, resolved }]
  }
  pendingSelection.value = undefined
}

function handleDomSelection(runtimeSelection: FrontendWorkshopSourceRuntimeDomSelection): void {
  const source = props.sourceDocument
  if (
    !source ||
    runtimeSelection.projectId !== source.projectId ||
    runtimeSelection.sourceRevision !== source.revision
  )
    return
  pendingSelection.value = runtimeSelection
  resolvePendingSelection()
}

function handleDomSnapshot(snapshot: FrontendWorkshopSourceRuntimeDomSnapshot): void {
  const source = props.sourceDocument
  if (
    !source ||
    snapshot.projectId !== source.projectId ||
    snapshot.sourceRevision !== source.revision
  )
    return
  latestSnapshot.value = snapshot
  const existingBaseline = baselineSnapshot.value
  const usableBaseline =
    existingBaseline && sameRuntimeIdentity(existingBaseline, snapshot)
      ? existingBaseline
      : undefined
  const mapping = mapFrontendWorkshopRuntimeDomSnapshot(
    source,
    analysisCache.analyze(source),
    snapshot,
    usableBaseline,
  )
  if (snapshot.snapshotSequence === 1) {
    baselineSnapshot.value = snapshot
    baselineMapping.value = mapping
  }
  latestMapping.value = mapping
  if (selectionEntries.value.length) {
    const analysis = analysisCache.analyze(source)
    selectionEntries.value = selectionEntries.value.map((entry) => ({
      runtime: entry.runtime,
      resolved: resolveFrontendWorkshopSourceSelection(
        source,
        analysis,
        entry.runtime,
        preferredMappingForSelection(entry.runtime),
      ),
    }))
  }
  resolvePendingSelection()
}

defineExpose({
  layerEntries,
  selectLayer,
  selectSourceElement,
  refreshLayers,
  canvasMode,
  zoomPercent,
  setCanvasMode,
  adjustZoom,
  resetViewport,
  fitCanvas,
  fitSelection,
  clearSelections,
  resetSelection,
  toggleMultiSelectMode,
  toggleSelectionMode,
})

onUnmounted(() => {
  analysisCache.clear()
  stopBackgroundPan?.()
})
onMounted(() => {
  if (viewportElement.value)
    stopBackgroundPan = installFrontendWorkshopCanvasPan(
      window,
      () => !props.gestureDisabled,
      handleCanvasPan,
      viewportElement.value,
    )
  void nextTick(fitCanvas)
})
</script>

<template>
  <section class="frontend-workshop-source-workspace" :class="{ 'is-panning': panning }">
    <div ref="viewportElement" class="frontend-workshop-source-workspace__viewport">
      <div
        v-if="sourceDocument"
        class="frontend-workshop-source-workspace__stage"
        :style="stageStyle"
      >
        <FrontendWorkshopSourcePreview
          ref="sourcePreview"
          source-mapping
          :source-document="sourceDocument"
          :network-mode="networkMode"
          :preview-session-context="previewSessionContext"
          :selection-mode="selectionMode && !greetingIndex"
          :greeting-index="greetingIndex"
          :layer-view="layerView"
          :canvas-pan-enabled="!gestureDisabled"
          :selected-dom-selections="runtimeSelections"
          :gesture-capabilities="gestureCapabilities"
          :gesture-disabled="gestureDisabled"
          @greeting-change="emit('greetingChange', $event)"
          @canvas-pan="handleCanvasPan($event as FrontendWorkshopCanvasPanEvent)"
          @ready="handleRuntimeReady"
          @pagehide="handleRuntimePagehide"
          @runtime-error="emit('runtimeError', $event)"
          @compatibility-diagnostic="emit('compatibilityDiagnostic', $event)"
          @dom-snapshot="handleDomSnapshot"
          @dom-selection="handleDomSelection"
          @source-gesture="emit('sourceGesture', $event)"
        />
      </div>
      <div
        v-if="!sourceDocument"
        class="frontend-workshop-source-workspace__unavailable"
        role="status"
      >
        <strong>源码暂时无法读取</strong>
        <span>没有改用旧预览，以免把 Source-backed 项目误当成结构化项目运行。</span>
      </div>
    </div>
    <div
      v-if="selectionMode && multiSelectMode && !greetingIndex"
      class="frontend-workshop-source-workspace__selection-summary"
      role="status"
    >
      <span>已选 {{ resolvedSelections.length }} 个</span>
      <button v-if="resolvedSelections.length" type="button" @click="clearSelections">清空</button>
    </div>
  </section>
</template>

<style scoped src="../styles/FrontendWorkshopSourceWorkspace.css"></style>
