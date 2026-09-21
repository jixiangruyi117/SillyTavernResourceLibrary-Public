import type { EmitFn } from 'vue'
import { useTemplateRef, computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from '../composables/UseBackStack'
import { confirmAction } from '../composables/UseConfirmDialog'
import {
  assetStore,
  browserStorageService,
  characterDrawService,
  resourceService,
} from '../core/AppContainer'

import {
  createEmptyCharacterDrawState,
  filterCharacterDrawPool,
  type CharacterDrawOptions,
  type CharacterDrawState,
  type DrawFreshness,
} from '../services/CharacterDrawService'

import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import { getHiddenCategoryIds, isResourceHiddenByCategory } from '../utils/CategoryVisibility'
import { drawRevealDelay } from '../utils/DrawRevealTiming'
import type { FeatureHubProps, FeatureHubEvents } from './UseFeatureHub'

export function useDrawApp(props: Readonly<FeatureHubProps>, emit: EmitFn<FeatureHubEvents>) {
  const resultCloseButton = useTemplateRef<HTMLButtonElement>('resultCloseButton')

  const FRESHNESS_OPTIONS: Array<{ value: DrawFreshness; label: string }> = [
    { value: 'all', label: '不限' },
    { value: 'notSevenDays', label: '七日未见' },
    { value: 'never', label: '从未抽到' },
  ]

  const drawState = ref<CharacterDrawState>(createEmptyCharacterDrawState())

  const selectedCategoryId = ref('')

  const selectedTag = ref('')

  const favoritesOnly = ref(false)

  const showNames = ref(browserStorageService.getDrawShowNames())

  const freshness = ref<DrawFreshness>('all')

  const resultIds = ref<string[]>([])

  const isDrawing = ref(false)

  const isClearing = ref(false)

  const revealCount = ref(0)

  const drawError = ref('')

  const resultGeneration = ref(0)

  const previewUrls = ref(new Map<string, string>())

  const isResultOverlayOpen = ref(false)

  const revealTimers: number[] = []

  let previewGeneration = 0

  const hiddenCategoryIds = computed(() => getHiddenCategoryIds(props.categories))

  const drawCategories = computed(() =>
    props.categories.filter((category) => category.hidden !== true),
  )

  const drawResources = computed(() =>
    props.resources.filter(
      (resource) => !isResourceHiddenByCategory(resource, hiddenCategoryIds.value),
    ),
  )

  const characters = computed(() =>
    drawResources.value.filter((resource) => resource.type === RESOURCE_TYPE.CHARACTER_CARD),
  )

  const characterTags = computed(() => {
    const counts = new Map<string, number>()
    for (const resource of characters.value) {
      for (const tag of resource.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
      (left, right) => right.count - left.count || left.tag.localeCompare(right.tag, 'zh-CN'),
    )
  })

  const drawOptions = computed<CharacterDrawOptions>(() => ({
    count: 1,
    categoryId: selectedCategoryId.value || undefined,
    tag: selectedTag.value || undefined,
    favoritesOnly: favoritesOnly.value,
    freshness: freshness.value,
  }))

  const drawPool = computed(() =>
    filterCharacterDrawPool(drawResources.value, drawState.value, drawOptions.value),
  )

  const resultResources = computed(() => {
    const byId = new Map(props.resources.map((resource) => [resource.id, resource]))
    return resultIds.value.flatMap((id) => {
      const resource = byId.get(id)
      return resource ? [resource] : []
    })
  })

  const singleResult = computed(() =>
    resultResources.value.length === 1 ? resultResources.value[0] : undefined,
  )

  const recentHistory = computed(() => drawState.value.history.slice(0, 4))

  const isRevealing = computed(
    () => resultResources.value.length > 0 && revealCount.value < resultResources.value.length,
  )

  const resourceById = computed(
    () => new Map(props.resources.map((resource) => [resource.id, resource])),
  )

  function releasePreviews(): void {
    previewGeneration += 1
    for (const url of previewUrls.value.values()) URL.revokeObjectURL(url)
    previewUrls.value = new Map()
  }

  function clearRevealTimers(): void {
    for (const timer of revealTimers.splice(0)) window.clearTimeout(timer)
  }

  function startReveal(count: number): void {
    clearRevealTimers()
    revealCount.value = 0
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      revealCount.value = count
      return
    }

    for (let index = 0; index < count; index += 1) {
      revealTimers.push(
        window.setTimeout(
          () => {
            revealCount.value = index + 1
          },
          drawRevealDelay(count, index),
        ),
      )
    }
  }

  function skipReveal(): void {
    if (!isRevealing.value) return
    clearRevealTimers()
    revealCount.value = resultResources.value.length
  }

  function closeResultOverlay(): void {
    clearRevealTimers()
    revealCount.value = resultResources.value.length
    isResultOverlayOpen.value = false
  }

  function returnToLibrary(): void {
    closeResultOverlay()
    emit('close')
  }

  function handleResultOverlayClick(event: MouseEvent): void {
    if (!isResultOverlayOpen.value || !(event.target instanceof Element)) return
    if (singleResult.value && isRevealing.value) {
      skipReveal()
      return
    }
    if (
      event.target.closest(
        '.draw-result-card, .draw-results > header, .gallery-reveal__header, .gallery-artwork, .gallery-plaque, .gallery-reveal__actions',
      )
    ) {
      return
    }
    closeResultOverlay()
  }

  async function rebuildPreviews(): Promise<void> {
    releasePreviews()
    const generation = previewGeneration
    const urls = new Map<string, string>()
    const useOriginal = resultResources.value.length === 1
    for (const resource of resultResources.value) {
      if (!resource.mimeType.startsWith('image/') && !/\.png$/i.test(resource.fileName)) continue
      let imageBlob: Blob | undefined =
        resource.thumbnailBlob ??
        (resource.thumbnailAssetId
          ? await assetStore.getBlob(resource.thumbnailAssetId)
          : undefined)
      if (useOriginal) {
        const fullResource = await resourceService.get(resource.id)
        imageBlob = fullResource?.originalBlob ?? imageBlob
      }
      if (imageBlob) urls.set(resource.id, URL.createObjectURL(imageBlob))
    }
    if (generation !== previewGeneration) {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      return
    }
    previewUrls.value = urls
  }

  function toggleShowNames(): void {
    showNames.value = !showNames.value
    browserStorageService.setDrawShowNames(showNames.value)
  }

  function formatDate(value: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value)
  }

  function resultRecord(resourceId: string) {
    return drawState.value.records[resourceId]
  }

  function readMetadataString(resource: ResourceSummary, key: string): string {
    const value = resource.metadata[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  function resourceCreator(resource: ResourceSummary): string {
    const direct = readMetadataString(resource, 'creator')
    if (direct) return direct
    const card = resource.metadata.card
    if (!card || typeof card !== 'object' || Array.isArray(card)) return ''
    const cardRecord = card as Record<string, unknown>
    const rawData = cardRecord.data ?? cardRecord
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return ''
    const value = (rawData as Record<string, unknown>).creator
    return typeof value === 'string' ? value.trim() : ''
  }

  function historyNames(resourceIds: string[]): string {
    const names = resourceIds.flatMap((id) => {
      const resource = resourceById.value.get(id)
      return resource ? [resource.name] : []
    })
    if (!names.length) return '资源已移除'
    return `${names.slice(0, 3).join('、')}${names.length > 3 ? ` 等 ${names.length} 张` : ''}`
  }

  async function draw(count: 1 | 10): Promise<void> {
    if (isDrawing.value || isRevealing.value) return
    isDrawing.value = true
    drawError.value = ''
    resultIds.value = []
    revealCount.value = 0
    clearRevealTimers()
    releasePreviews()
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 360))
      const result = await characterDrawService.draw(drawResources.value, {
        ...drawOptions.value,
        count,
      })
      drawState.value = result.state
      resultIds.value = result.resourceIds
      resultGeneration.value += 1
      await nextTick()
      await rebuildPreviews()
      isDrawing.value = false
      isResultOverlayOpen.value = true
      startReveal(result.resourceIds.length)
    } catch (error) {
      drawError.value = error instanceof Error ? error.message : '抽取失败，请稍后再试'
    } finally {
      isDrawing.value = false
    }
  }

  function openResult(resource: ResourceSummary, index: number): void {
    if (index >= revealCount.value) return
    isResultOverlayOpen.value = false
    emit('openResource', resource)
  }

  async function clearDrawRecords(): Promise<void> {
    if (isClearing.value) return
    const confirmed = await confirmAction({
      title: '清除抽卡记录',
      message: '确定清除全部抽卡记录吗？累计次数、每张卡的抽取时间和最近轮次都会删除。',
      confirmLabel: '清除',
      danger: true,
    })
    if (!confirmed) return
    isClearing.value = true
    drawError.value = ''
    try {
      drawState.value = await characterDrawService.clear()
      resultIds.value = []
      isResultOverlayOpen.value = false
      revealCount.value = 0
      clearRevealTimers()
      releasePreviews()
    } catch {
      drawError.value = '抽卡记录清除失败，请稍后重试'
    } finally {
      isClearing.value = false
    }
  }
  function handleVisibilityChange() {
    if (document.hidden) {
      clearRevealTimers()
      revealCount.value = resultResources.value.length
    }
  }
  function handleOverlayBack(event: Event) {
    if (!isResultOverlayOpen.value) return
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return
    if (document.body.classList.contains('modal-open')) return
    const detail = event instanceof CustomEvent ? (event.detail as SrlBackRequestDetail) : undefined
    if (detail?.handled) return
    closeResultOverlay()
    if (detail) detail.handled = true
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  watch(
    () => props.resources,
    () => {
      if (resultIds.value.length) void rebuildPreviews()
    },
  )
  watch(isResultOverlayOpen, async (open) => {
    document.body.classList.toggle('draw-reveal-open', open)
    if (open) {
      await nextTick()
      resultCloseButton.value?.focus({ preventScroll: true })
    }
  })
  onMounted(async () => {
    window.addEventListener('keydown', handleOverlayBack, true)
    window.addEventListener(SRL_BACK_REQUEST_EVENT, handleOverlayBack, true)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    try {
      drawState.value = await characterDrawService.load()
    } catch {
      drawError.value = '抽卡记录暂时无法读取'
    }
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', handleOverlayBack, true)
    window.removeEventListener(SRL_BACK_REQUEST_EVENT, handleOverlayBack, true)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    document.body.classList.remove('draw-reveal-open')
    releasePreviews()
    clearRevealTimers()
  })

  return {
    drawPool,
    drawState,
    characters,
    selectedCategoryId,
    drawCategories,
    selectedTag,
    characterTags,
    FRESHNESS_OPTIONS,
    freshness,
    favoritesOnly,
    showNames,
    toggleShowNames,
    isDrawing,
    resultResources,
    isResultOverlayOpen,
    singleResult,
    resultGeneration,
    isRevealing,
    handleResultOverlayClick,
    closeResultOverlay,
    skipReveal,
    openResult,
    previewUrls,
    resultRecord,
    resourceCreator,
    formatDate,
    draw,
    returnToLibrary,
    revealCount,
    drawError,
    recentHistory,
    isClearing,
    clearDrawRecords,
    historyNames,
  }
}
