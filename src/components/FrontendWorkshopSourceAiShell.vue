<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'

import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from '../composables/UseBackStack'
import {
  APP_RESUME_STATE_CHANGE_EVENT,
  readAppResumeState,
  type AppResumeState,
} from '../core/AppResumeState'
import { frontendWorkshopSourceHistoryService } from '../core/FrontendWorkshopContainer'
import type { FrontendWorkshopSourceRuntimeFixIntent } from '../services/FrontendWorkshopSourceCompatibilityDiagnosticsService'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  FRONTEND_WORKSHOP_SOURCE_LOCATE_EVENT,
  type FrontendWorkshopSourceLocateRequest,
} from '../utils/FrontendWorkshopSourceNavigation'
import type { FrontendWorkshopResolvedSourceSelection } from '../utils/FrontendWorkshopSourceSelection'
import FrontendWorkshopSourceAiWorkspace from './FrontendWorkshopSourceAiWorkspace.vue'
import FrontendWorkshopSourceEditor from './FrontendWorkshopSourceEditor.vue'
import FrontendWorkshopSourceSession from './FrontendWorkshopSourceSession.vue'

interface FrontendWorkshopSourceSessionAiBridge {
  getCurrentSourceAiSelections(): FrontendWorkshopResolvedSourceSelection[]
  acceptAppliedSourceAiRevision(source: FrontendWorkshopSourceDocument, message: string): boolean
}

const emit = defineEmits<{ back: []; libraryChanged: [] }>()
const projectId = ref('')
const sourceSession = ref<FrontendWorkshopSourceSessionAiBridge>()
const aiWorkspaceOpen = ref(false)
const aiInitialInstruction = ref('')
const aiEntrySelections = shallowRef<FrontendWorkshopResolvedSourceSelection[]>([])
const aiRuntimeFixIntent = shallowRef<FrontendWorkshopSourceRuntimeFixIntent>()
const sourceEditorOpen = ref(false)
const sourceEditorRevision = ref<number>()
const sourceEditorRange = ref<{ start: number; end: number }>()
const sourceAvailable = ref(false)
function projectIdFromState(state: AppResumeState | null): string {
  return state?.feature === 'frontendWorkshop' ? (state.projectId ?? '') : ''
}

function syncProjectId(state: AppResumeState | null = readAppResumeState()): void {
  const next = projectIdFromState(state)
  if (next === projectId.value) return
  projectId.value = next
  aiWorkspaceOpen.value = false
  aiEntrySelections.value = []
  aiRuntimeFixIntent.value = undefined
  sourceEditorOpen.value = false
  sourceEditorRange.value = undefined
  sourceAvailable.value = false
}

function handleResumeStateChange(event: Event): void {
  syncProjectId((event as CustomEvent<AppResumeState>).detail ?? readAppResumeState())
}

function setSourceAvailability(available: boolean): void {
  sourceAvailable.value = available
  if (!available) {
    aiWorkspaceOpen.value = false
    aiEntrySelections.value = []
    aiRuntimeFixIntent.value = undefined
    sourceEditorRange.value = undefined
  }
}

function acceptSourceRevision(source: FrontendWorkshopSourceDocument, message: string): boolean {
  if (!projectId.value || source.projectId !== projectId.value) return false
  const accepted = sourceSession.value?.acceptAppliedSourceAiRevision(source, message) ?? false
  if (accepted) sourceAvailable.value = true
  return accepted
}

function handleAiApplied(source: FrontendWorkshopSourceDocument): void {
  acceptSourceRevision(source, 'AI 修改已应用；可撤销，预览已按新 revision 重建')
}

function currentSelections(): FrontendWorkshopResolvedSourceSelection[] {
  return (sourceSession.value?.getCurrentSourceAiSelections() ?? []).map((selection) => ({
    ...selection,
    ...(selection.sourceRange ? { sourceRange: { ...selection.sourceRange } } : {}),
  }))
}

function openAiWorkspace(instruction = ''): void {
  if (!sourceAvailable.value || sourceEditorOpen.value) return
  aiEntrySelections.value = currentSelections()
  aiInitialInstruction.value = instruction
  aiRuntimeFixIntent.value = undefined
  aiWorkspaceOpen.value = true
}

function openRuntimeFixWorkspace(intent: FrontendWorkshopSourceRuntimeFixIntent): void {
  aiInitialInstruction.value = ''
  if (
    !sourceAvailable.value ||
    sourceEditorOpen.value ||
    !projectId.value ||
    intent.projectId !== projectId.value
  )
    return
  aiEntrySelections.value = []
  aiRuntimeFixIntent.value = {
    // Diagnostics supply their own task context.
    ...intent,
    runtimeError: { ...intent.runtimeError },
    diagnostics: intent.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      ...(diagnostic.sourceRange ? { sourceRange: { ...diagnostic.sourceRange } } : {}),
    })),
  }
  aiWorkspaceOpen.value = true
}

function closeAiWorkspace(): void {
  aiInitialInstruction.value = ''
  aiWorkspaceOpen.value = false
  aiEntrySelections.value = []
  aiRuntimeFixIntent.value = undefined
}

function openSourceEditor(range?: { start: number; end: number }, revision?: number): void {
  sourceEditorRevision.value = revision
  if (!projectId.value) return
  closeAiWorkspace()
  sourceEditorRange.value = range ? { ...range } : undefined
  sourceEditorOpen.value = true
}

function closeSourceEditor(): void {
  sourceEditorOpen.value = false
  sourceEditorRange.value = undefined
}

function handleSourceLocate(event: Event): void {
  const detail = (event as CustomEvent<FrontendWorkshopSourceLocateRequest>).detail
  if (!detail || detail.projectId !== projectId.value || !sourceAvailable.value) return
  openSourceEditor(detail.range, detail.sourceRevision)
}

function handleSourceEditorApplied(
  source: FrontendWorkshopSourceDocument,
  wasTakeover: boolean,
): void {
  frontendWorkshopSourceHistoryService.clearProject(source.projectId)
  const accepted = acceptSourceRevision(
    source,
    wasTakeover ? '源码已导入，画布已更新' : '源码已保存，画布已更新',
  )
  if (accepted) closeSourceEditor()
}

function closeTopPage(): boolean {
  if (sourceEditorOpen.value) {
    closeSourceEditor()
    return true
  }
  if (aiWorkspaceOpen.value) {
    closeAiWorkspace()
    return true
  }
  return false
}

function handleSecondaryBackRequest(event: Event): void {
  if (!sourceEditorOpen.value && !aiWorkspaceOpen.value) return
  const detail = (event as CustomEvent<SrlBackRequestDetail>).detail
  if (detail) detail.handled = true
  event.preventDefault()
  event.stopImmediatePropagation()
  closeTopPage()
}

function handleSecondaryKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !closeTopPage()) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

if (typeof window !== 'undefined') {
  window.addEventListener(SRL_BACK_REQUEST_EVENT, handleSecondaryBackRequest, true)
  window.addEventListener('keydown', handleSecondaryKeydown, true)
}

onMounted(() => {
  syncProjectId()
  window.addEventListener(APP_RESUME_STATE_CHANGE_EVENT, handleResumeStateChange)
  window.addEventListener(FRONTEND_WORKSHOP_SOURCE_LOCATE_EVENT, handleSourceLocate)
})

onUnmounted(() => {
  window.removeEventListener(APP_RESUME_STATE_CHANGE_EVENT, handleResumeStateChange)
  window.removeEventListener(FRONTEND_WORKSHOP_SOURCE_LOCATE_EVENT, handleSourceLocate)
  window.removeEventListener(SRL_BACK_REQUEST_EVENT, handleSecondaryBackRequest, true)
  window.removeEventListener('keydown', handleSecondaryKeydown, true)
})
</script>

<template>
  <div class="frontend-workshop-source-ai-shell">
    <FrontendWorkshopSourceSession
      ref="sourceSession"
      @back="emit('back')"
      @library-changed="emit('libraryChanged')"
      @source-availability-changed="setSourceAvailability"
      @source-requested="openSourceEditor()"
      @source-ai-requested="openAiWorkspace"
      @source-runtime-fix-requested="openRuntimeFixWorkspace"
    />
  </div>

  <Teleport to="body">
    <FrontendWorkshopSourceAiWorkspace
      v-if="aiWorkspaceOpen && projectId && sourceAvailable"
      :project-id="projectId"
      :initial-selections="aiEntrySelections"
      :initial-instruction="aiInitialInstruction"
      :runtime-fix-intent="aiRuntimeFixIntent"
      @close="closeAiWorkspace"
      @applied="handleAiApplied"
    />
    <FrontendWorkshopSourceEditor
      v-if="sourceEditorOpen && projectId"
      :project-id="projectId"
      :initial-range="sourceEditorRange"
      :initial-source-revision="sourceEditorRevision"
      @close="closeSourceEditor"
      @applied="handleSourceEditorApplied"
    />
  </Teleport>
</template>

<style scoped>
.frontend-workshop-source-ai-shell {
  display: contents;
}
</style>
