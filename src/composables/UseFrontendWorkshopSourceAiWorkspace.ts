import type { EmitFn } from 'vue'
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import { browserStorageService } from '../core/AppContainer'
import type FrontendWorkshopSourcePreview from '../components/FrontendWorkshopSourcePreview.vue'
import type {
  FrontendWorkshopSourceRuntimeNetworkMode,
  FrontendWorkshopSourceRuntimeSizingMode,
} from '../utils/FrontendWorkshopSourceRuntime'
import {
  frontendWorkshopAiLocalStorage,
  frontendWorkshopSourceAiRequestService,
  frontendWorkshopSourceAiSessionService,
  frontendWorkshopSourceDocumentService,
} from '../core/FrontendWorkshopContainer'
import type {
  FrontendWorkshopSourceAiGeneration,
  FrontendWorkshopSourceAiSessionRequestOptions,
  FrontendWorkshopSourceAiSessionSnapshot,
  FrontendWorkshopSourceAiUserTurn,
} from '../services/FrontendWorkshopSourceAiSessionService'
import type { FrontendWorkshopSourceRuntimeFixIntent } from '../services/FrontendWorkshopSourceCompatibilityDiagnosticsService'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  FRONTEND_WORKSHOP_SOURCE_AI_MAX_REFERENCE_IMAGES,
  type FrontendWorkshopSourceAiReferenceImage,
  type FrontendWorkshopSourceAiRuntimeDiagnosticContext,
  validateFrontendWorkshopSourceAiReferenceImages,
} from '../utils/FrontendWorkshopSourceAiContext'
import { createFrontendWorkshopSourceAiFocusedPreviewDocument } from '../utils/FrontendWorkshopSourceAiFocusedPreview'
import { getFrontendWorkshopSourceAiRepairReceipt } from '../utils/FrontendWorkshopSourceAiReplyRepair'
import {
  extractFrontendWorkshopSourceComponentHtml,
  normalizeFrontendWorkshopSourceComponentScopes,
} from '../utils/FrontendWorkshopSourceComponent'
import type { FrontendWorkshopResolvedSourceSelection } from '../utils/FrontendWorkshopSourceSelection'

export type FrontendWorkshopSourceAiWorkspaceProps = {
  projectId: string
  initialSelections?: readonly FrontendWorkshopResolvedSourceSelection[]
  initialInstruction?: string
  runtimeFixIntent?: FrontendWorkshopSourceRuntimeFixIntent
}

export type FrontendWorkshopSourceAiWorkspaceEvents = {
  close: []
  applied: [source: FrontendWorkshopSourceDocument]
}

export type AiMode = 'edit' | 'plan' | 'explain'

export type SourceRange = { start: number; end: number }

export interface ComponentScope {
  range: SourceRange
  label: string
  selection: FrontendWorkshopResolvedSourceSelection
}

export interface RuntimeFixRequestContext {
  runtimeError: { kind: string; message: string }
  runtimeDiagnostics: readonly FrontendWorkshopSourceAiRuntimeDiagnosticContext[]
}

export function useFrontendWorkshopSourceAiWorkspace(
  props: Readonly<FrontendWorkshopSourceAiWorkspaceProps>,
  emit: EmitFn<FrontendWorkshopSourceAiWorkspaceEvents>,
) {
  const session = shallowRef<FrontendWorkshopSourceAiSessionSnapshot>()

  const beforeDocument = shallowRef<FrontendWorkshopSourceDocument>()
  const afterDocument = shallowRef<FrontendWorkshopSourceDocument>()

  const instruction = ref(props.initialInstruction ?? '')
  const pendingImages = ref<FrontendWorkshopSourceAiReferenceImage[]>([])

  const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

  const mode = ref<AiMode>('edit')
  const planDraft = ref('')
  const planGenerationId = ref('')

  const settingsOpen = ref(false)
  const settingsReady = ref(false)
  const onlineResearch = ref(false)
  const researchBudget = ref<number>(1)
  const tavernHelperVersion = ref('4.9.3')
  const sillyTavernVersion = ref('1.18.0')

  const compareOpen = ref(false)
  const previewExpanded = ref(false)
  watch(mode, () => {
    previewExpanded.value = false
    planGenerationId.value = ''
  })
  const networkMode = ref<FrontendWorkshopSourceRuntimeNetworkMode>(
    browserStorageService.getPreviewPolicy().allowRemoteResources ? 'host' : 'offline',
  )
  const previewSizing = ref<FrontendWorkshopSourceRuntimeSizingMode | undefined>()
  const previewSizingMode = computed(
    () => previewSizing.value ?? (previewFocus.value ? 'content' : 'viewport'),
  )
  const beforePreview =
    useTemplateRef<InstanceType<typeof FrontendWorkshopSourcePreview>>('beforePreview')
  const afterPreview =
    useTemplateRef<InstanceType<typeof FrontendWorkshopSourcePreview>>('afterPreview')
  let stopPreviewPolicyListener: (() => void) | undefined

  const comparePosition = ref(50)

  const compareDragging = ref(false)

  const previewPanX = ref(0)

  const previewPanY = ref(0)

  const previewRatio = ref(52)

  const expandedChanges = ref(new Set<string>())

  const expandedDiffs = ref(new Set<string>())

  const expandedThoughts = ref(new Set<string>())

  const actionMenuId = ref('')

  const editingTurnId = ref('')

  const localError = ref('')

  const splitHost = useTemplateRef<HTMLElement>('splitHost')

  const previewViewport = useTemplateRef<HTMLElement>('previewViewport')

  const previewStage = useTemplateRef<HTMLElement>('previewStage')

  const entryComponentScopes = shallowRef<ComponentScope[]>([])

  const entryScopePending = ref(true)

  const entryScopeError = ref('')

  let stopSessionSubscription: (() => void) | undefined

  let longPressTimer: ReturnType<typeof setTimeout> | undefined

  let compareHoldTimer: ReturnType<typeof setTimeout> | undefined

  let previewGeneration = 0

  let previousBodyOverflow = ''

  let initialRuntimeFixStarted = false

  const generationsById = computed(
    () =>
      new Map((session.value?.generations ?? []).map((generation) => [generation.id, generation])),
  )

  const turnsById = computed(
    () => new Map((session.value?.turns ?? []).map((turn) => [turn.id, turn])),
  )

  const activeGeneration = computed(() =>
    session.value?.activeGenerationId
      ? generationsById.value.get(session.value.activeGenerationId)
      : undefined,
  )

  const visibleConversation = computed(() => {
    const active = activeGeneration.value
    if (!active) return []
    const items: Array<{
      turn: FrontendWorkshopSourceAiUserTurn
      generation: FrontendWorkshopSourceAiGeneration
    }> = []
    let generation: FrontendWorkshopSourceAiGeneration | undefined = active
    while (generation) {
      const turn = turnsById.value.get(generation.turnId)
      if (!turn) break
      items.unshift({ turn, generation })
      generation = turn.parentGenerationId
        ? generationsById.value.get(turn.parentGenerationId)
        : undefined
    }
    return items
  })

  const branchNotice = computed(
    () =>
      Boolean(activeGeneration.value?.resultCheckpointId) &&
      session.value?.activeGenerationId !== session.value?.materializedGenerationId,
  )

  const busy = computed(() =>
    Boolean(!settingsReady.value || session.value?.pending || session.value?.applying),
  )

  function requiresAdditionalProviderConsent(
    generation: FrontendWorkshopSourceAiGeneration,
  ): boolean {
    return (
      generation.status === 'needs-host-reference' &&
      generation.blockedReason === 'additional-provider-consent-required'
    )
  }

  function generationComponentRanges(
    generation: FrontendWorkshopSourceAiGeneration | undefined,
  ): { before: SourceRange[]; after: SourceRange[] } | undefined {
    const ranges = generation?.bundle?.writeScope.allowedRanges
    if (generation?.bundle?.writeScope.kind !== 'ranges' || !ranges?.length) return undefined
    const before = ranges.map((range) => ({ ...range }))
    const edits = generation.proposal?.edits ?? []
    const after = before.map((range) => {
      const deltaBefore = edits
        .filter((edit) => edit.end <= range.start && edit.start < range.start)
        .reduce((total, edit) => total + edit.replacement.length - (edit.end - edit.start), 0)
      const deltaInside = edits
        .filter((edit) => edit.start >= range.start && edit.end <= range.end)
        .reduce((total, edit) => total + edit.replacement.length - (edit.end - edit.start), 0)
      return {
        start: range.start + deltaBefore,
        end: range.end + deltaBefore + deltaInside,
      }
    })
    return { before, after }
  }

  const previewFocus = computed(() => {
    if (entryScopePending.value) {
      const scopes = entryComponentScopes.value
      return scopes.length
        ? {
            before: scopes.map((scope) => scope.range),
            after: scopes.map((scope) => scope.range),
            label: scopes.length === 1 ? scopes[0]!.label : `已选 ${scopes.length} 个`,
          }
        : undefined
    }
    const ranges = generationComponentRanges(activeGeneration.value)
    return ranges
      ? {
          ...ranges,
          label: ranges.before.length === 1 ? '单组件' : `${ranges.before.length} 个组件`,
        }
      : undefined
  })

  const previewProjection = computed<{
    before?: FrontendWorkshopSourceDocument
    after?: FrontendWorkshopSourceDocument
    error?: string
  }>(() => {
    const before = beforeDocument.value
    const after = afterDocument.value
    const focus = previewFocus.value
    if (!after) return {}
    if (!focus) return { before, after }
    try {
      return {
        before: before
          ? createFrontendWorkshopSourceAiFocusedPreviewDocument(before, focus.before)
          : undefined,
        after: createFrontendWorkshopSourceAiFocusedPreviewDocument(after, focus.after),
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '组件预览生成失败',
      }
    }
  })

  const previewScopeLabel = computed(() => previewFocus.value?.label ?? '整页')

  function generationPosition(generation: FrontendWorkshopSourceAiGeneration): string {
    const turn = turnsById.value.get(generation.turnId)
    const index = turn?.generationIds.indexOf(generation.id) ?? -1
    return `${index >= 0 ? index + 1 : 1} / ${turn?.generationIds.length ?? 1}`
  }

  function canSelectSibling(
    generation: FrontendWorkshopSourceAiGeneration,
    delta: number,
  ): boolean {
    const turn = turnsById.value.get(generation.turnId)
    if (!turn) return false
    const index = turn.generationIds.indexOf(generation.id)
    return index >= 0 && Boolean(turn.generationIds[index + delta])
  }

  function selectSibling(generation: FrontendWorkshopSourceAiGeneration, delta: number): void {
    const turn = turnsById.value.get(generation.turnId)
    if (!turn) return
    const target = turn.generationIds[turn.generationIds.indexOf(generation.id) + delta]
    if (target) selectGeneration(target)
  }

  function formatTime(value: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(value)
  }

  async function resolveEntryComponentScopes(): Promise<void> {
    entryComponentScopes.value = []
    entryScopeError.value = ''
    const selections = props.initialSelections ?? []
    if (!selections.length) return
    try {
      const current = await frontendWorkshopSourceDocumentService.get(props.projectId)
      if (!current) throw new Error('当前 FrontendWorkshop Source 不存在')
      entryComponentScopes.value = normalizeFrontendWorkshopSourceComponentScopes(
        selections.map((selection) => {
          const extracted = extractFrontendWorkshopSourceComponentHtml(current, selection)
          return {
            range: { ...extracted.range },
            label: `${extracted.tagName}${selection.elementId ? `#${selection.elementId}` : ''}`,
            selection,
          }
        }),
      )
    } catch (error) {
      entryScopeError.value = error instanceof Error ? error.message : '无法建立多组件 AI 范围'
    }
  }

  async function refreshPreview(
    generationId = session.value?.activeGenerationId ?? '',
  ): Promise<void> {
    const requestGeneration = ++previewGeneration
    try {
      if (entryScopePending.value && props.initialSelections?.length) {
        const current = await frontendWorkshopSourceDocumentService.get(props.projectId)
        if (requestGeneration !== previewGeneration || !current) return
        beforeDocument.value = current
        afterDocument.value = current
        return
      }
      if (generationId) {
        const preview = await frontendWorkshopSourceAiSessionService.previewGeneration(
          props.projectId,
          generationId,
        )
        if (requestGeneration !== previewGeneration) return
        beforeDocument.value = preview.before
        afterDocument.value = preview.after
        return
      }
      const current = await frontendWorkshopSourceDocumentService.get(props.projectId)
      if (requestGeneration !== previewGeneration || !current) return
      beforeDocument.value = current
      afterDocument.value = current
    } catch (error) {
      if (requestGeneration === previewGeneration) {
        localError.value = error instanceof Error ? error.message : '预览加载失败'
      }
    }
  }

  function bindSession(projectId: string): void {
    void frontendWorkshopSourceAiSessionService.restore?.(projectId)
    stopSessionSubscription?.()
    let previousPreviewKey: string | undefined
    stopSessionSubscription = frontendWorkshopSourceAiSessionService.subscribe(
      projectId,
      (snapshot) => {
        session.value = snapshot
        const active = snapshot.generations.find((item) => item.id === snapshot.activeGenerationId)
        const key = `${snapshot.activeGenerationId}:${active?.status}:${active?.resultRevision}`
        if (key !== previousPreviewKey) {
          previousPreviewKey = key
          void refreshPreview(snapshot.activeGenerationId ?? '')
        }
      },
    )
  }

  watch(
    () => props.projectId,
    (projectId) => {
      entryScopePending.value = true
      void resolveEntryComponentScopes()
      bindSession(projectId)
    },
    { immediate: true },
  )

  watch(compareOpen, (open) => {
    if (open) return
    previewPanX.value = 0
    previewPanY.value = 0
  })

  onMounted(() => {
    stopPreviewPolicyListener = browserStorageService.onPreviewPolicyChange((policy) => {
      networkMode.value = policy.allowRemoteResources ? 'host' : 'offline'
    })
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    void (async () => {
      try {
        const saved = (await frontendWorkshopAiLocalStorage.read('preferences'))?.data as
          Record<string, unknown> | undefined
        if (saved) {
          onlineResearch.value = saved.onlineResearch === true
          researchBudget.value =
            typeof saved.researchBudget === 'number' &&
            Number.isSafeInteger(saved.researchBudget) &&
            saved.researchBudget >= 0
              ? saved.researchBudget
              : 1
          if (typeof saved.tavernHelperVersion === 'string')
            tavernHelperVersion.value = saved.tavernHelperVersion.slice(0, 80)
          if (typeof saved.sillyTavernVersion === 'string')
            sillyTavernVersion.value = saved.sillyTavernVersion.slice(0, 80)
          if (!props.initialInstruction)
            mode.value =
              saved.mode === 'plan' ? 'plan' : saved.mode === 'explain' ? 'explain' : 'edit'
        }
      } catch {
        localError.value = 'AI 设置读取失败，使用本次默认设置。'
      } finally {
        settingsReady.value = true
      }
      await frontendWorkshopSourceAiSessionService.restore?.(props.projectId)
      await refreshPreview()
      await startInitialRuntimeFix()
    })()
  })

  watch(
    [onlineResearch, researchBudget, tavernHelperVersion, sillyTavernVersion, mode],
    async () => {
      if (!settingsReady.value) return
      try {
        await frontendWorkshopAiLocalStorage.write('preferences', {
          onlineResearch: onlineResearch.value,
          researchBudget: researchBudget.value,
          tavernHelperVersion: tavernHelperVersion.value,
          sillyTavernVersion: sillyTavernVersion.value,
          mode: mode.value,
        })
      } catch {
        localError.value = 'AI 设置未能保存在本机，本次选择仍有效。'
      }
    },
  )

  async function applyPending(generation: FrontendWorkshopSourceAiGeneration): Promise<void> {
    try {
      const applied = await frontendWorkshopSourceAiSessionService.applyGeneration(
        props.projectId,
        generation.id,
      )
      if (applied) emit('applied', applied.document)
    } catch (error) {
      localError.value = error instanceof Error ? error.message : '无法应用回复'
    }
  }

  async function clearConversation(): Promise<void> {
    if (
      busy.value ||
      !(await confirmAction({
        title: '清空对话',
        message: '清空本作品的 AI 对话和恢复记录？已保存的作品保留。',
        confirmLabel: '清空',
        danger: true,
      }))
    )
      return
    frontendWorkshopSourceAiSessionService.clear(props.projectId)
  }

  onUnmounted(() => {
    stopPreviewPolicyListener?.()
    stopSessionSubscription?.()
    if (longPressTimer) clearTimeout(longPressTimer)
    if (compareHoldTimer) clearTimeout(compareHoldTimer)
    document.body.style.overflow = previousBodyOverflow
  })

  async function requestAndApply(
    text: string,
    sessionOptions?: FrontendWorkshopSourceAiSessionRequestOptions,
    sourceGeneration?: FrontendWorkshopSourceAiGeneration,
    referenceImages?: readonly FrontendWorkshopSourceAiReferenceImage[],
    runtimeFix?: RuntimeFixRequestContext,
  ): Promise<void> {
    localError.value = ''
    if (
      onlineResearch.value &&
      (!Number.isSafeInteger(researchBudget.value) || researchBudget.value < 0)
    ) {
      localError.value = '额外调用 AI 次数请填写 0 或正整数'
      return
    }
    const oldBundle = sourceGeneration?.bundle
    if (
      entryScopePending.value &&
      props.initialSelections?.length &&
      !entryComponentScopes.value.length
    ) {
      await resolveEntryComponentScopes()
      if (!entryComponentScopes.value.length) {
        localError.value = entryScopeError.value || '无法建立多组件 AI 范围'
        return
      }
    }
    const entryScopes = entryScopePending.value ? entryComponentScopes.value : []
    const activeRanges = generationComponentRanges(activeGeneration.value)
    const selectedRanges = entryScopes.length
      ? entryScopes.map((scope) => scope.range)
      : !sessionOptions
        ? (activeRanges?.after ?? [])
        : []
    const selections = entryScopes.map((scope) => scope.selection)
    const requestMode = oldBundle
      ? oldBundle.mode
      : runtimeFix
        ? 'runtime-fix'
        : mode.value === 'explain' || mode.value === 'plan'
          ? mode.value
          : selectedRanges.length
            ? 'edit-selection'
            : 'edit'
    const writeScope = oldBundle
      ? oldBundle.writeScope.kind === 'read-only'
        ? ({ kind: 'read-only' } as const)
        : oldBundle.writeScope.kind === 'ranges'
          ? ({ kind: 'ranges', ranges: oldBundle.writeScope.allowedRanges } as const)
          : ({ kind: 'whole-source' } as const)
      : requestMode === 'explain' || requestMode === 'plan'
        ? ({ kind: 'read-only' } as const)
        : selectedRanges.length
          ? ({ kind: 'ranges', ranges: selectedRanges } as const)
          : ({ kind: 'whole-source' } as const)
    try {
      const result = await frontendWorkshopSourceAiRequestService.request({
        projectId: props.projectId,
        mode: requestMode,
        instruction: text,
        ...(onlineResearch.value
          ? {
              hostResearch: {
                maxAdditionalRequests: researchBudget.value,
                tavernHelperVersion: tavernHelperVersion.value.trim(),
                sillyTavernVersion: sillyTavernVersion.value.trim(),
              },
            }
          : {}),
        writeScope,
        ...(referenceImages ? { referenceImages } : {}),
        ...(selections.length && !sessionOptions ? { selections } : {}),
        ...(requestMode === 'runtime-fix'
          ? {
              runtimeError: oldBundle?.runtimeError ?? runtimeFix?.runtimeError,
              runtimeDiagnostics: oldBundle?.runtimeDiagnostics ?? runtimeFix?.runtimeDiagnostics,
            }
          : {}),
        ...(sessionOptions ? { session: sessionOptions } : {}),
      })
      if (!result.accepted || result.status !== 'completed') return
      if (requestMode === 'plan' || requestMode === 'explain') {
        await refreshPreview(result.generationId)
        return
      }
      entryScopePending.value = false
      const applied = await frontendWorkshopSourceAiSessionService.applyGeneration(
        props.projectId,
        result.generationId,
        {
          label:
            sessionOptions?.kind === 'repair'
              ? 'AI 修复回复'
              : requestMode === 'runtime-fix'
                ? 'AI 修复运行错误'
                : 'AI 修改',
        },
      )
      if (applied) emit('applied', applied.document)
      await refreshPreview(result.generationId)
    } catch (error) {
      localError.value = error instanceof Error ? error.message : 'AI 请求失败'
    }
  }

  async function startInitialRuntimeFix(): Promise<void> {
    const intent = props.runtimeFixIntent
    if (!intent || initialRuntimeFixStarted) return
    initialRuntimeFixStarted = true
    if (intent.projectId !== props.projectId) {
      localError.value = '运行错误对应的项目已变化，请重新运行检查'
      return
    }
    const current = await frontendWorkshopSourceDocumentService.get(props.projectId)
    if (
      !current ||
      current.createdAt !== intent.sourceCreatedAt ||
      current.revision !== intent.sourceRevision
    ) {
      localError.value = '运行错误对应的 Source revision 已变化，请重新运行检查'
      return
    }
    await requestAndApply(
      '修复当前运行错误，并保持现有功能与视觉不变。',
      undefined,
      undefined,
      undefined,
      {
        runtimeError: { ...intent.runtimeError },
        runtimeDiagnostics: intent.diagnostics.map((diagnostic) => ({
          category: diagnostic.category,
          severity: diagnostic.severity,
          title: diagnostic.title,
          message: diagnostic.message,
          ...(diagnostic.sourceRange ? { sourceRange: { ...diagnostic.sourceRange } } : {}),
        })),
      },
    )
  }

  async function submitInstruction(): Promise<void> {
    const text = instruction.value.trim()
    if (!text || busy.value) return
    const options = editingTurnId.value
      ? ({ kind: 'edit', turnId: editingTurnId.value } as const)
      : undefined
    const sourceGeneration = editingTurnId.value
      ? generationsById.value.get(turnsById.value.get(editingTurnId.value)?.generationIds[0] ?? '')
      : undefined
    const referenceImages = pendingImages.value.map((image) => ({ ...image }))
    instruction.value = ''
    pendingImages.value = []
    editingTurnId.value = ''
    await requestAndApply(text, options, sourceGeneration, referenceImages)
  }

  function reviewPlan(generation: FrontendWorkshopSourceAiGeneration): void {
    if (busy.value || !generation.proposal?.generationPrompt) return
    frontendWorkshopSourceAiSessionService.selectGeneration(props.projectId, generation.id)
    planGenerationId.value = generation.id
    planDraft.value = generation.proposal.generationPrompt
  }

  async function approvePlan(): Promise<void> {
    const generation = generationsById.value.get(planGenerationId.value)
    if (busy.value || !planDraft.value.trim() || !generation?.proposal?.generationPrompt) return
    frontendWorkshopSourceAiSessionService.selectGeneration(props.projectId, generation.id)
    const text = planDraft.value.trim()
    planGenerationId.value = ''
    planDraft.value = ''
    mode.value = 'edit'
    previewExpanded.value = false
    const images = visibleConversation.value.flatMap(({ turn }) => turn.referenceImages)
    const uniqueImages = [...new Map(images.map((image) => [image.id, image])).values()]
    await requestAndApply(
      text,
      undefined,
      undefined,
      uniqueImages.slice(-FRONTEND_WORKSHOP_SOURCE_AI_MAX_REFERENCE_IMAGES),
    )
  }

  async function regenerate(generation: FrontendWorkshopSourceAiGeneration): Promise<void> {
    const turn = turnsById.value.get(generation.turnId)
    if (!turn || busy.value) return
    actionMenuId.value = ''
    await requestAndApply(
      turn.content,
      { kind: 'regenerate', generationId: generation.id },
      generation,
    )
  }

  async function repairReply(generation: FrontendWorkshopSourceAiGeneration): Promise<void> {
    const turn = turnsById.value.get(generation.turnId)
    if (!turn || busy.value || !getFrontendWorkshopSourceAiRepairReceipt(generation)) return
    actionMenuId.value = ''
    await requestAndApply(turn.content, { kind: 'repair', generationId: generation.id }, generation)
  }

  function selectGeneration(generationId: string): void {
    entryScopePending.value = false
    frontendWorkshopSourceAiSessionService.selectGeneration(props.projectId, generationId)
    actionMenuId.value = ''
  }

  function editTurn(turn: FrontendWorkshopSourceAiUserTurn): void {
    editingTurnId.value = turn.id
    instruction.value = turn.content
    pendingImages.value = turn.referenceImages.map((image) => ({ ...image }))
    actionMenuId.value = ''
  }

  function openImagePicker(): void {
    if (!busy.value) fileInput.value?.click()
  }

  function readImage(file: File): Promise<FrontendWorkshopSourceAiReferenceImage> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error(`无法读取图片“${file.name}”`))
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error(`无法读取图片“${file.name}”`))
          return
        }
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type as FrontendWorkshopSourceAiReferenceImage['mimeType'],
          dataUrl: reader.result,
          size: file.size,
        })
      }
      reader.readAsDataURL(file)
    })
  }

  async function addReferenceImages(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const files = [...(input.files ?? [])]
    input.value = ''
    if (!files.length) return
    localError.value = ''
    try {
      if (
        pendingImages.value.length + files.length >
        FRONTEND_WORKSHOP_SOURCE_AI_MAX_REFERENCE_IMAGES
      ) {
        throw new Error(`AI 参考图最多 ${FRONTEND_WORKSHOP_SOURCE_AI_MAX_REFERENCE_IMAGES} 张`)
      }
      const images = await Promise.all(files.map(readImage))
      pendingImages.value = [
        ...validateFrontendWorkshopSourceAiReferenceImages([...pendingImages.value, ...images]),
      ]
    } catch (error) {
      localError.value = error instanceof Error ? error.message : '参考图片添加失败'
    }
  }

  function removePendingImage(id: string): void {
    pendingImages.value = pendingImages.value.filter((image) => image.id !== id)
  }

  async function deleteTurn(turn: FrontendWorkshopSourceAiUserTurn): Promise<void> {
    actionMenuId.value = ''
    if (
      !(await confirmAction({
        title: '删除消息',
        message: '删除这条用户消息及其全部后续对话分支？',
        confirmLabel: '删除',
        danger: true,
      }))
    )
      return
    await frontendWorkshopSourceAiSessionService.deleteTurn(props.projectId, turn.id)
    await refreshPreview()
  }

  async function deleteGeneration(generation: FrontendWorkshopSourceAiGeneration): Promise<void> {
    actionMenuId.value = ''
    if (
      !(await confirmAction({
        title: '删除回复',
        message: '删除这条 AI 回复及从这里继续的对话？',
        confirmLabel: '删除',
        danger: true,
      }))
    )
      return
    await frontendWorkshopSourceAiSessionService.deleteGeneration(props.projectId, generation.id)
    await refreshPreview()
  }

  function toggleExpanded(kind: 'changes' | 'diffs' | 'thoughts', id: string): void {
    const owner =
      kind === 'changes' ? expandedChanges : kind === 'diffs' ? expandedDiffs : expandedThoughts
    const next = new Set(owner.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    owner.value = next
  }

  function startLongPress(id: string): void {
    if (longPressTimer) clearTimeout(longPressTimer)
    longPressTimer = setTimeout(() => {
      actionMenuId.value = id
    }, 520)
  }

  function stopLongPress(): void {
    if (longPressTimer) clearTimeout(longPressTimer)
    longPressTimer = undefined
  }

  function openActions(id: string): void {
    stopLongPress()
    actionMenuId.value = actionMenuId.value === id ? '' : id
  }

  function startDividerDrag(event: PointerEvent): void {
    const host = splitHost.value
    if (!host) return
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      const bounds = host.getBoundingClientRect()
      const ratio = ((moveEvent.clientY - bounds.top) / bounds.height) * 100
      previewRatio.value = Math.max(25, Math.min(68, ratio))
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  function panPreviewFromPointer(event: PointerEvent): void {
    if (!compareOpen.value) return
    const stage = previewStage.value
    const target = event.currentTarget as HTMLElement
    if (!stage) return
    const startX = event.clientX
    const startY = event.clientY
    const startPanX = previewPanX.value
    const startPanY = previewPanY.value
    let previousX = startX
    let previousY = startY
    target.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      if (previewSizingMode.value === 'viewport') {
        scrollComparedPreviews(
          previousX - moveEvent.clientX,
          previousY - moveEvent.clientY,
          moveEvent.clientX,
          moveEvent.clientY,
        )
        previousX = moveEvent.clientX
        previousY = moveEvent.clientY
        return
      }
      previewPanX.value = startPanX + moveEvent.clientX - startX
      previewPanY.value = startPanY + moveEvent.clientY - startY
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  function scrollComparedPreviews(
    deltaX: number,
    deltaY: number,
    clientX: number,
    clientY: number,
  ): void {
    beforePreview.value?.scrollBy(deltaX, deltaY, clientX, clientY)
    afterPreview.value?.scrollBy(deltaX, deltaY, clientX, clientY)
  }

  function scrollComparison(event: WheelEvent): void {
    if (!compareOpen.value || previewSizingMode.value !== 'viewport') return
    event.preventDefault()
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? previewViewport.value?.clientHeight || 1
          : 1
    scrollComparedPreviews(event.deltaX * unit, event.deltaY * unit, event.clientX, event.clientY)
  }

  watch(previewSizingMode, () => {
    previewPanX.value = 0
    previewPanY.value = 0
  })

  function updateComparePosition(clientX: number): void {
    const viewport = previewViewport.value
    if (!viewport) return
    const bounds = viewport.getBoundingClientRect()
    if (bounds.width <= 0) return
    comparePosition.value = Math.round(
      Math.max(0, Math.min(100, ((clientX - bounds.left) / bounds.width) * 100)),
    )
  }

  function startCompareDividerHold(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement
    let held = false
    if (compareHoldTimer) clearTimeout(compareHoldTimer)
    target.setPointerCapture?.(event.pointerId)
    compareHoldTimer = setTimeout(() => {
      held = true
      compareDragging.value = true
    }, 320)
    const move = (moveEvent: PointerEvent) => {
      if (held) {
        updateComparePosition(moveEvent.clientX)
      }
    }
    const end = () => {
      if (compareHoldTimer) clearTimeout(compareHoldTimer)
      compareHoldTimer = undefined
      compareDragging.value = false
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  function adjustComparePosition(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    comparePosition.value = Math.max(
      0,
      Math.min(100, comparePosition.value + (event.key === 'ArrowLeft' ? -5 : 5)),
    )
  }
  return {
    planDraft,
    planGenerationId,
    reviewPlan,
    approvePlan,
    previewExpanded,
    networkMode,
    previewSizing,
    previewSizingMode,
    scrollComparison,
    settingsOpen,
    settingsReady,
    applyPending,
    clearConversation,
    onlineResearch,
    researchBudget,
    tavernHelperVersion,
    sillyTavernVersion,
    mode,
    busy,
    compareOpen,
    previewRatio,
    previewScopeLabel,
    previewProjection,
    panPreviewFromPointer,
    previewPanX,
    previewPanY,
    comparePosition,
    compareDragging,
    startCompareDividerHold,
    adjustComparePosition,
    startDividerDrag,
    visibleConversation,
    openActions,
    startLongPress,
    stopLongPress,
    formatTime,
    actionMenuId,
    editTurn,
    deleteTurn,
    expandedThoughts,
    toggleExpanded,
    expandedChanges,
    requiresAdditionalProviderConsent,
    regenerate,
    repairReply,
    getFrontendWorkshopSourceAiRepairReceipt,
    canSelectSibling,
    selectSibling,
    generationPosition,
    expandedDiffs,
    deleteGeneration,
    branchNotice,
    localError,
    session,
    pendingImages,
    removePendingImage,
    addReferenceImages,
    FRONTEND_WORKSHOP_SOURCE_AI_MAX_REFERENCE_IMAGES,
    openImagePicker,
    instruction,
    editingTurnId,
    submitInstruction,
    frontendWorkshopSourceAiSessionService,
  }
}
