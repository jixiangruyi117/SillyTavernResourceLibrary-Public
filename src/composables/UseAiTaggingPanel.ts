import type { EmitFn } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import {
  aiTaggingDraftService,
  aiTaggingService,
  mainApiService,
  resourceService,
} from '../core/AppContainer'
import type { AiTaggingDraft, AiTaggingUndoRecord } from '../services/AiTaggingDraftService'
import {
  AI_TAGGING_DEFAULT_BATCH_SIZE,
  AI_TAGGING_MAX_BATCH_SIZE,
  AI_TAGGING_MAX_SELECTION,
  AI_TAGGING_TAXONOMY_TEMPLATES,
  type AiTaggingFailure,
  type AiTaggingSuggestedTag,
  type AiTaggingSuggestion,
} from '../services/AiTaggingService'
import type { MainApiConfig, MainApiProfile } from '../services/MainApiService'
import {
  getResourceCategoryIds,
  RESOURCE_TYPE_LABELS,
  type Category,
  type ResourceSummary,
  type ResourceType,
} from '../types/Resource'

export type Stage = 'select' | 'running' | 'review'

export type TagState = 'all' | 'tagged' | 'untagged'

export interface ReviewItem extends AiTaggingSuggestion {
  resource: ResourceSummary
  accepted: boolean
  draftTag: string
}

export type AiTaggingPanelProps = {
  resources: ResourceSummary[]
  categories: Category[]
  initialSelectedIds?: string[]
}

export type AiTaggingPanelEvents = {
  close: []
  applied: [details: { resourceCount: number; tagCount: number; action: 'apply' | 'undo' }]
}

export function useAiTaggingPanel(
  props: Readonly<AiTaggingPanelProps>,
  emit: EmitFn<AiTaggingPanelEvents>,
) {
  const DEFAULT_CUSTOM_PROMPT =
    '优先判断人数、背景时代或场景、性向与情绪风格；证据不足的维度不要猜测。'

  const stage = ref<Stage>('select')

  const searchQuery = ref('')

  const typeFilter = ref<'all' | ResourceType>('all')

  const categoryFilter = ref('all')

  const tagState = ref<TagState>('all')

  const tagQuery = ref('')

  const batchSize = ref(AI_TAGGING_DEFAULT_BATCH_SIZE)

  const customPrompt = ref(DEFAULT_CUSTOM_PROMPT)

  const taxonomyTemplateId = ref('free')

  const mergeAliases = ref(false)

  const selectedIds = shallowRef(
    new Set(
      (props.initialSelectedIds ?? [])
        .filter((id) => props.resources.some((resource) => resource.id === id))
        .slice(0, AI_TAGGING_MAX_SELECTION),
    ),
  )

  const message = ref('')

  const failures = ref<AiTaggingFailure[]>([])

  const reviewItems = ref<ReviewItem[]>([])

  const progressCompleted = ref(0)

  const progressTotal = ref(0)

  const progressBatch = ref(0)

  const progressBatchCount = ref(0)

  const usageText = ref('')

  const stopRequested = ref(false)

  const applying = ref(false)

  const undoing = ref(false)

  const restoredAt = ref(0)

  const undoRecord = ref<AiTaggingUndoRecord>()

  let restoringDraft = false

  let recognitionController: AbortController | undefined

  let profiles: MainApiProfile[] = []

  let activeProfileId = ''

  try {
    const state = mainApiService.getProfilesState()
    profiles = state.profiles
    activeProfileId = state.activeProfileId
  } catch {
    profiles = []
  }

  const apiSource = ref('active')

  const temporaryProtocol = ref<MainApiConfig['protocol']>('openai-compatible')

  const temporaryUrl = ref('')

  const temporaryApiKey = ref('')

  const temporaryModel = ref('')

  const apiDetailsOpen = ref(false)

  const triggerElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null

  const previousBodyOverflow = document.body.style.overflow

  const resourceTypes = computed(() =>
    Array.from(new Set(props.resources.map((resource) => resource.type))).map((type) => ({
      type,
      label: RESOURCE_TYPE_LABELS[type],
    })),
  )

  const filteredResources = computed(() => {
    const keyword = searchQuery.value.trim().toLocaleLowerCase()
    const existingTag = tagQuery.value.trim().toLocaleLowerCase()
    return props.resources.filter((resource) => {
      if (typeFilter.value !== 'all' && resource.type !== typeFilter.value) return false
      const categoryIds = getResourceCategoryIds(resource)
      if (categoryFilter.value === 'uncategorized' && categoryIds.length) return false
      if (
        categoryFilter.value !== 'all' &&
        categoryFilter.value !== 'uncategorized' &&
        !categoryIds.includes(categoryFilter.value)
      )
        return false
      if (tagState.value === 'tagged' && !resource.tags.length) return false
      if (tagState.value === 'untagged' && resource.tags.length) return false
      if (
        existingTag &&
        !resource.tags.some((tag) => tag.toLocaleLowerCase().includes(existingTag))
      )
        return false
      if (!keyword) return true
      return [resource.name, resource.fileName, resource.description, ...resource.tags]
        .join('\n')
        .toLocaleLowerCase()
        .includes(keyword)
    })
  })

  const allFilteredSelected = computed(
    () =>
      filteredResources.value.length > 0 &&
      filteredResources.value.every((resource) => selectedIds.value.has(resource.id)),
  )

  const acceptedItems = computed(() =>
    reviewItems.value.filter((item) => item.accepted && item.tags.length),
  )

  const acceptedTagCount = computed(() =>
    acceptedItems.value.reduce((total, item) => total + item.tags.length, 0),
  )

  const activeTaxonomyTemplate = computed(
    () =>
      AI_TAGGING_TAXONOMY_TEMPLATES.find((template) => template.id === taxonomyTemplateId.value) ??
      AI_TAGGING_TAXONOMY_TEMPLATES[0]!,
  )

  const retryableResourceIds = computed(() =>
    Array.from(
      new Set(
        failures.value
          .filter((failure) => failure.retryable)
          .flatMap((failure) => failure.resourceIds),
      ),
    ),
  )

  const undoTagCount = computed(
    () => undoRecord.value?.additions.reduce((total, entry) => total + entry.tags.length, 0) ?? 0,
  )

  const activeProfile = computed(() => profiles.find((profile) => profile.id === activeProfileId))

  const progressPercent = computed(() =>
    progressTotal.value ? Math.round((progressCompleted.value / progressTotal.value) * 100) : 0,
  )

  function replaceSelection(next: Set<string>): void {
    selectedIds.value = next
  }

  function resourceName(resourceId: string): string {
    return props.resources.find((resource) => resource.id === resourceId)?.name ?? '资源已不存在'
  }

  function draftTime(value: number): string {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  }

  function toggleResource(resourceId: string): void {
    const next = new Set(selectedIds.value)
    if (next.has(resourceId)) next.delete(resourceId)
    else if (next.size < AI_TAGGING_MAX_SELECTION) next.add(resourceId)
    else message.value = `单次最多选择 ${AI_TAGGING_MAX_SELECTION} 项，请分轮处理。`
    replaceSelection(next)
  }

  function toggleFilteredSelection(): void {
    const next = new Set(selectedIds.value)
    if (allFilteredSelected.value)
      filteredResources.value.forEach((resource) => next.delete(resource.id))
    else {
      for (const resource of filteredResources.value) {
        if (next.size >= AI_TAGGING_MAX_SELECTION) break
        next.add(resource.id)
      }
      if (filteredResources.value.some((resource) => !next.has(resource.id)))
        message.value = `已选前 ${AI_TAGGING_MAX_SELECTION} 项，其余请分轮处理。`
    }
    replaceSelection(next)
  }

  function clearSelection(): void {
    replaceSelection(new Set())
  }

  function configOverride(): Partial<MainApiConfig> | undefined {
    if (apiSource.value === 'active') return undefined
    if (apiSource.value.startsWith('profile:')) {
      const profile = profiles.find((item) => `profile:${item.id}` === apiSource.value)
      if (!profile) throw new Error('选择的 API 配置已不存在')
      return { ...profile }
    }
    const base = mainApiService.getConfig()
    const customUrl = temporaryUrl.value.trim()
    const customKey = temporaryApiKey.value.trim()
    const customModel = temporaryModel.value.trim()
    return {
      ...base,
      protocol: temporaryProtocol.value,
      url: customUrl || base.url,
      apiKey: customUrl ? customKey : customKey || base.apiKey,
      model: customModel || base.model,
      maxTokens:
        temporaryProtocol.value === 'anthropic-compatible'
          ? Math.max(2_048, base.maxTokens)
          : base.maxTokens,
    }
  }

  function reviewItemsFromSuggestions(suggestions: AiTaggingSuggestion[]): ReviewItem[] {
    const resourceById = new Map(props.resources.map((resource) => [resource.id, resource]))
    return suggestions.flatMap((suggestion) => {
      const resource = resourceById.get(suggestion.resourceId)
      return resource
        ? [{ ...suggestion, resource, accepted: true, draftTag: '' } satisfies ReviewItem]
        : []
    })
  }

  function mergeReviewItems(suggestions: AiTaggingSuggestion[], replacingIds: Set<string>): void {
    const replacements = new Map(
      reviewItemsFromSuggestions(suggestions).map((item) => [item.resourceId, item]),
    )
    const retained = reviewItems.value.filter((item) => !replacingIds.has(item.resourceId))
    reviewItems.value = [...retained, ...replacements.values()]
  }

  async function runRecognition(resourceIds: string[], preserveSuccesses: boolean): Promise<void> {
    if (!resourceIds.length) {
      message.value = '请先选择要识别的资源。'
      return
    }
    message.value = '正在读取首批资源并准备上下文…'
    if (!preserveSuccesses) {
      failures.value = []
      reviewItems.value = []
      usageText.value = ''
    }
    progressCompleted.value = 0
    progressTotal.value = resourceIds.length
    progressBatch.value = 0
    progressBatchCount.value = Math.ceil(resourceIds.length / batchSize.value)
    stopRequested.value = false
    recognitionController = new AbortController()
    stage.value = 'running'
    try {
      const result = await aiTaggingService.recognize({
        resourceIds,
        batchSize: batchSize.value,
        customPrompt: customPrompt.value,
        taxonomyTemplateId: taxonomyTemplateId.value,
        mergeAliases: mergeAliases.value,
        apiOverride: configOverride(),
        shouldContinue: () => !stopRequested.value,
        signal: recognitionController.signal,
        onProgress: (progress) => {
          progressCompleted.value = progress.completed
          progressTotal.value = progress.total
          progressBatch.value = progress.batch
          progressBatchCount.value = progress.batchCount
          message.value = `已完成第 ${progress.batch}/${progress.batchCount} 批，正在整理审核草稿。`
        },
      })
      const targetIds = new Set(resourceIds)
      if (preserveSuccesses) {
        failures.value = [
          ...failures.value.filter(
            (failure) => !failure.resourceIds.some((resourceId) => targetIds.has(resourceId)),
          ),
          ...result.failures,
        ]
        mergeReviewItems(result.suggestions, targetIds)
      } else {
        failures.value = result.failures
        reviewItems.value = reviewItemsFromSuggestions(result.suggestions)
      }
      usageText.value = `${result.usage.totalTokens.toLocaleString()} Token · ${
        result.usage.source === 'provider' ? '供应商统计' : '估算'
      }`
      message.value = result.stopped
        ? `已停止后续批次，保留 ${reviewItems.value.length} 项已完成结果。`
        : failures.value.length
          ? `已保留成功结果，${retryableResourceIds.value.length} 项可单独重试。`
          : reviewItems.value.length
            ? `识别完成，请逐项审核后再注入。`
            : '没有生成可审核结果，请检查失败信息后调整批次或 API。'
      stage.value = 'review'
      persistDraft()
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'AI 标签识别失败'
      stage.value = reviewItems.value.length || failures.value.length ? 'review' : 'select'
    } finally {
      recognitionController = undefined
    }
  }

  async function startRecognition(): Promise<void> {
    await runRecognition(Array.from(selectedIds.value), false)
  }

  async function retryFailures(): Promise<void> {
    await runRecognition(retryableResourceIds.value, true)
  }

  function requestStop(): void {
    stopRequested.value = true
    recognitionController?.abort()
    message.value = '正在取消当前 API 请求；已完成批次的结果会继续保留。'
  }

  function setAllAccepted(accepted: boolean): void {
    reviewItems.value = reviewItems.value.map((item) => ({ ...item, accepted }))
  }

  function removeTag(item: ReviewItem, tag: AiTaggingSuggestedTag): void {
    item.tags = item.tags.filter((candidate) => candidate !== tag)
  }

  function addDraftTag(item: ReviewItem): void {
    const tag = item.draftTag.replace(/^#+/u, '').replace(/\s+/gu, ' ').trim().slice(0, 40)
    if (!tag) return
    const existing = new Set(
      [...item.resource.tags, ...item.tags.map((candidate) => candidate.name)].map((candidate) =>
        candidate.toLocaleLowerCase(),
      ),
    )
    if (!existing.has(tag.toLocaleLowerCase()))
      item.tags.push({
        name: tag,
        evidence: '用户在审核阶段手动补充',
        level: 'explicit',
      })
    item.draftTag = ''
  }

  async function applyReviewedTags(): Promise<void> {
    if (!acceptedItems.value.length || applying.value) return
    applying.value = true
    message.value = '正在把已审核标签写入本地资源库…'
    try {
      const result = await resourceService.addTagsPerResource(
        acceptedItems.value.map((item) => ({
          resourceId: item.resourceId,
          tags: item.tags.map((tag) => tag.name),
        })),
      )
      if (result.entries.length) {
        const record: AiTaggingUndoRecord = {
          version: 1,
          appliedAt: Date.now(),
          additions: result.entries,
        }
        aiTaggingDraftService.saveUndo(record)
        undoRecord.value = record
      }
      aiTaggingDraftService.clearDraft()
      emit('applied', {
        resourceCount: result.resourceCount,
        tagCount: result.tagCount,
        action: 'apply',
      })
      emit('close')
    } catch (error) {
      message.value = error instanceof Error ? error.message : '标签写入失败'
    } finally {
      applying.value = false
    }
  }

  function backToSelection(): void {
    stage.value = 'select'
    message.value = '审核草稿尚未写入，可调整后重新识别。'
  }

  function buildDraft(): AiTaggingDraft {
    return {
      version: 1,
      savedAt: Date.now(),
      stage: stage.value === 'review' ? 'review' : 'select',
      searchQuery: searchQuery.value,
      typeFilter: typeFilter.value,
      categoryFilter: categoryFilter.value,
      tagState: tagState.value,
      tagQuery: tagQuery.value,
      selectedIds: Array.from(selectedIds.value),
      batchSize: batchSize.value,
      customPrompt: customPrompt.value,
      taxonomyTemplateId: taxonomyTemplateId.value,
      mergeAliases: mergeAliases.value,
      api: {
        source: apiSource.value,
        temporaryProtocol: temporaryProtocol.value,
        temporaryUrl: temporaryUrl.value,
        temporaryModel: temporaryModel.value,
      },
      reviewItems: reviewItems.value.map((item) => ({
        resourceId: item.resourceId,
        tags: item.tags,
        accepted: item.accepted,
        draftTag: item.draftTag,
      })),
      failures: failures.value,
      usageText: usageText.value,
    }
  }

  function hasDraftWork(): boolean {
    return (
      selectedIds.value.size > 0 ||
      reviewItems.value.length > 0 ||
      failures.value.length > 0 ||
      searchQuery.value.length > 0 ||
      typeFilter.value !== 'all' ||
      categoryFilter.value !== 'all' ||
      tagState.value !== 'all' ||
      tagQuery.value.length > 0 ||
      batchSize.value !== AI_TAGGING_DEFAULT_BATCH_SIZE ||
      customPrompt.value !== DEFAULT_CUSTOM_PROMPT ||
      taxonomyTemplateId.value !== 'free' ||
      mergeAliases.value ||
      apiSource.value !== 'active' ||
      temporaryUrl.value.length > 0 ||
      temporaryModel.value.length > 0
    )
  }

  function persistDraft(): void {
    if (restoringDraft || stage.value === 'running') return
    if (hasDraftWork()) aiTaggingDraftService.saveDraft(buildDraft())
    else aiTaggingDraftService.clearDraft()
  }

  function restoreDraft(draft: AiTaggingDraft): void {
    const resourceById = new Map(props.resources.map((resource) => [resource.id, resource]))
    restoringDraft = true
    searchQuery.value = draft.searchQuery
    typeFilter.value = resourceTypes.value.some((item) => item.type === draft.typeFilter)
      ? (draft.typeFilter as ResourceType)
      : 'all'
    categoryFilter.value =
      draft.categoryFilter === 'all' ||
      draft.categoryFilter === 'uncategorized' ||
      props.categories.some((category) => category.id === draft.categoryFilter)
        ? draft.categoryFilter
        : 'all'
    tagState.value = draft.tagState
    tagQuery.value = draft.tagQuery
    selectedIds.value = new Set(draft.selectedIds.filter((id) => resourceById.has(id)))
    batchSize.value = draft.batchSize
    customPrompt.value = draft.customPrompt
    taxonomyTemplateId.value = AI_TAGGING_TAXONOMY_TEMPLATES.some(
      (template) => template.id === draft.taxonomyTemplateId,
    )
      ? draft.taxonomyTemplateId
      : 'free'
    mergeAliases.value = draft.mergeAliases
    apiSource.value =
      draft.api.source === 'temporary' ||
      draft.api.source === 'active' ||
      profiles.some((profile) => `profile:${profile.id}` === draft.api.source)
        ? draft.api.source
        : 'active'
    temporaryProtocol.value = draft.api.temporaryProtocol
    temporaryUrl.value = draft.api.temporaryUrl
    temporaryApiKey.value = ''
    temporaryModel.value = draft.api.temporaryModel
    reviewItems.value = draft.reviewItems.flatMap((item) => {
      const resource = resourceById.get(item.resourceId)
      return resource ? [{ ...item, resource } satisfies ReviewItem] : []
    })
    failures.value = draft.failures.flatMap((failure) => {
      const resourceIds = failure.resourceIds.filter((id) => resourceById.has(id))
      return resourceIds.length ? [{ ...failure, resourceIds }] : []
    })
    usageText.value = draft.usageText
    stage.value =
      draft.stage === 'review' && (reviewItems.value.length || failures.value.length)
        ? 'review'
        : 'select'
    restoredAt.value = draft.savedAt
    message.value = '已恢复上次本机草稿；临时 API Key 未保存，需要时请重新填写。'
    restoringDraft = false
  }

  async function discardDraft(): Promise<void> {
    const confirmed = await confirmAction({
      title: '放弃 AI 标签草稿？',
      message: '将清空当前选择、识别结果与审核修改。此操作不会改变已经写入资源的标签。',
      confirmLabel: '放弃草稿',
      cancelLabel: '继续保留',
      danger: true,
    })
    if (!confirmed) return
    restoringDraft = true
    searchQuery.value = ''
    typeFilter.value = 'all'
    categoryFilter.value = 'all'
    tagState.value = 'all'
    tagQuery.value = ''
    selectedIds.value = new Set(props.initialSelectedIds ?? [])
    batchSize.value = AI_TAGGING_DEFAULT_BATCH_SIZE
    customPrompt.value = DEFAULT_CUSTOM_PROMPT
    taxonomyTemplateId.value = 'free'
    mergeAliases.value = false
    apiSource.value = 'active'
    temporaryProtocol.value = 'openai-compatible'
    temporaryUrl.value = ''
    temporaryApiKey.value = ''
    temporaryModel.value = ''
    reviewItems.value = []
    failures.value = []
    usageText.value = ''
    stage.value = 'select'
    aiTaggingDraftService.clearDraft()
    restoredAt.value = 0
    restoringDraft = false
    message.value = '草稿已清空，可以开始新的识别任务。'
  }

  async function undoLastApplication(): Promise<void> {
    const record = undoRecord.value
    if (!record || undoing.value) return
    const confirmed = await confirmAction({
      title: '撤销上次 AI 标签注入？',
      message: `将从 ${record.additions.length} 项资源中移除上次新增且目前仍存在的 ${undoTagCount.value} 个标签。原有标签和之后改名的标签不会删除。`,
      confirmLabel: '撤销注入',
      cancelLabel: '保留标签',
      danger: true,
    })
    if (!confirmed) return
    undoing.value = true
    try {
      const result = await resourceService.undoAddedTags(record.additions)
      aiTaggingDraftService.clearUndo()
      undoRecord.value = undefined
      message.value = `已撤销 ${result.resourceCount} 项资源中的 ${result.tagCount} 个 AI 新增标签。`
      emit('applied', {
        resourceCount: result.resourceCount,
        tagCount: result.tagCount,
        action: 'undo',
      })
    } catch (error) {
      message.value = error instanceof Error ? error.message : '撤销 AI 标签失败'
    } finally {
      undoing.value = false
    }
  }

  async function requestClose(): Promise<void> {
    if (stage.value === 'running') {
      requestStop()
      return
    }
    persistDraft()
    if (hasDraftWork()) {
      const confirmed = await confirmAction({
        title: '保存草稿并退出？',
        message: '当前选择和审核结果已保存在本机，下次打开可以继续。临时 API Key 不会保存。',
        confirmLabel: '保存并退出',
        cancelLabel: '继续编辑',
      })
      if (!confirmed) return
    }
    emit('close')
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    void requestClose()
  }

  onMounted(() => {
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeydown)
    const draft = aiTaggingDraftService.loadDraft()
    if (draft) restoreDraft(draft)
    undoRecord.value = aiTaggingDraftService.loadUndo()
    void nextTick(() => document.querySelector<HTMLElement>('.ai-tagging__close')?.focus())
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown)
    document.body.style.overflow = previousBodyOverflow
    void nextTick(() => triggerElement?.focus())
  })

  watch(
    [
      searchQuery,
      typeFilter,
      categoryFilter,
      tagState,
      tagQuery,
      selectedIds,
      batchSize,
      customPrompt,
      taxonomyTemplateId,
      mergeAliases,
      apiSource,
      temporaryProtocol,
      temporaryUrl,
      temporaryModel,
      reviewItems,
      failures,
      stage,
    ],
    persistDraft,
    { deep: true },
  )

  watch(taxonomyTemplateId, () => {
    if (!Object.keys(activeTaxonomyTemplate.value.aliases).length) mergeAliases.value = false
  })
  return {
    requestClose,
    stage,
    restoredAt,
    undoRecord,
    draftTime,
    discardDraft,
    undoTagCount,
    undoing,
    undoLastApplication,
    filteredResources,
    searchQuery,
    typeFilter,
    resourceTypes,
    categoryFilter,
    tagState,
    tagQuery,
    toggleFilteredSelection,
    allFilteredSelected,
    clearSelection,
    selectedIds,
    AI_TAGGING_MAX_SELECTION,
    customPrompt,
    batchSize,
    AI_TAGGING_MAX_BATCH_SIZE,
    taxonomyTemplateId,
    AI_TAGGING_TAXONOMY_TEMPLATES,
    activeTaxonomyTemplate,
    mergeAliases,
    apiSource,
    activeProfile,
    get profiles() {
      return profiles
    },
    set profiles(value: typeof profiles) {
      profiles = value
    },
    apiDetailsOpen,
    temporaryProtocol,
    temporaryModel,
    temporaryUrl,
    temporaryApiKey,
    toggleResource,
    RESOURCE_TYPE_LABELS,
    progressPercent,
    progressBatch,
    progressBatchCount,
    message,
    progressCompleted,
    progressTotal,
    stopRequested,
    requestStop,
    setAllAccepted,
    reviewItems,
    removeTag,
    addDraftTag,
    failures,
    retryableResourceIds,
    retryFailures,
    resourceName,
    usageText,
    startRecognition,
    applying,
    backToSelection,
    acceptedItems,
    applyReviewedTags,
    acceptedTagCount,
  }
}
