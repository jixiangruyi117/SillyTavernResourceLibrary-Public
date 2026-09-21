import type { EmitFn } from 'vue'
import { computed, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { usePreviewBudget } from '../composables/UsePreviewBudget'
import { usePreviewPolicy } from '../composables/UsePreviewPolicy'
import { isNativePreviewAssetAvailable } from '../services/NativePreviewAsset'
import type {
  CanonicalPreviewSeed,
  PreviewPerformanceEvent,
  PreviewSessionHost,
  RichContentPreviewEvents,
  RichContentPreviewProps,
} from '../types/RichContentPreviewView'
import { prepareTavernPreviewSource } from '../utils/OpeningPreviewContent'
import { preloadPreviewDocumentResources } from '../utils/PreviewResourcePreloader'
import {
  loadedPreviewVendorNames,
  loadPreviewVendorLibs,
  mergePreviewVendorLibNeeds,
  type PreviewVendorLibs,
} from '../utils/PreviewVendorLibs'
import type { RenderCompatibilityMvuPreviewState } from '../utils/RenderCompatibilityMvu'
import {
  isRenderCompatibilityDiagnostic,
  RENDER_COMPATIBILITY_EVENTS,
  RENDER_COMPATIBILITY_PROTOCOL,
  type RenderCompatibilityDiagnostic,
} from '../utils/RenderCompatibilityRuntime'
import {
  buildRenderCompatibilitySwipeMarkup,
  hasRenderCompatibilityRuntimeSource,
  type PreparedRichContentPreviewMessage,
  type PreviewContentTheme,
  type RichContentPreviewResult,
} from '../utils/RichContentPreview'
import { usePreviewGreetingSession } from './UsePreviewGreetingSession'
export type {
  CanonicalPreviewSeed,
  PreviewPerformanceEvent,
  PreviewSessionHost,
  RichContentPreviewEvents,
  RichContentPreviewProps,
} from '../types/RichContentPreviewView'

export function useRichContentPreview(
  props: Readonly<
    RichContentPreviewProps &
      Required<
        Pick<
          RichContentPreviewProps,
          | 'active'
          | 'emptyText'
          | 'swipePassthrough'
          | 'immersive'
          | 'bare'
          | 'runtimeScripts'
          | 'inspector'
          | 'renderShell'
          | 'messageAvatarMode'
          | 'sourceKind'
          | 'greetingContents'
          | 'greetingIndex'
          | 'displayRegexRules'
          | 'frontendWorkshopBehaviorRuntime'
          | 'preloadResources'
          | 'preloadTrustedResources'
          | 'scale'
        >
      >
  >,
  emit: EmitFn<RichContentPreviewEvents>,
) {
  const {
    currentMvuGreetings,
    loadMvuPreviewState,
    cancelIdlePrewarm,
    prepareGreetingMessage,
    scheduleIdleGreetingPrewarm,
    buildSessionPreview,
    stageCanonicalPreviewSeed,
    hasCurrentCanonicalPreviewSeed,
    activateCanonicalPreviewSeed,
  } = usePreviewGreetingSession(() => ({
    props,
    isRecordValue,
    get mvuCachePromise() {
      return mvuCachePromise
    },
    set mvuCachePromise(value: typeof mvuCachePromise) {
      mvuCachePromise = value
    },
    get mvuCacheCharacterData() {
      return mvuCacheCharacterData
    },
    set mvuCacheCharacterData(value: typeof mvuCacheCharacterData) {
      mvuCacheCharacterData = value
    },
    get mvuCacheGreetingsKey() {
      return mvuCacheGreetingsKey
    },
    set mvuCacheGreetingsKey(value: typeof mvuCacheGreetingsKey) {
      mvuCacheGreetingsKey = value
    },
    get idlePrewarmHandle() {
      return idlePrewarmHandle
    },
    set idlePrewarmHandle(value: typeof idlePrewarmHandle) {
      idlePrewarmHandle = value
    },
    preparedGreetingCache,
    get previewInputRevision() {
      return previewInputRevision
    },
    set previewInputRevision(value: typeof previewInputRevision) {
      previewInputRevision = value
    },
    previewPolicy,
    reportPreviewPerformance,
    previewEnabled,
    view,
    get sessionMvuPreview() {
      return sessionMvuPreview
    },
    set sessionMvuPreview(value: typeof sessionMvuPreview) {
      sessionMvuPreview = value
    },
    get sessionRuntimeGreetings() {
      return sessionRuntimeGreetings
    },
    set sessionRuntimeGreetings(value: typeof sessionRuntimeGreetings) {
      sessionRuntimeGreetings = value
    },
    get sessionVendorLibs() {
      return sessionVendorLibs
    },
    set sessionVendorLibs(value: typeof sessionVendorLibs) {
      sessionVendorLibs = value
    },
    get sessionCharAvatarUrl() {
      return sessionCharAvatarUrl
    },
    set sessionCharAvatarUrl(value: typeof sessionCharAvatarUrl) {
      sessionCharAvatarUrl = value
    },
    contentTheme,
    get canonicalPreviewSeed() {
      return canonicalPreviewSeed
    },
    set canonicalPreviewSeed(value: typeof canonicalPreviewSeed) {
      canonicalPreviewSeed = value
    },
    normalizedGreetingIndex,
    preview,
    get sessionGreetingContents() {
      return sessionGreetingContents
    },
    set sessionGreetingContents(value: typeof sessionGreetingContents) {
      sessionGreetingContents = value
    },
    get sessionGreetingIndex() {
      return sessionGreetingIndex
    },
    set sessionGreetingIndex(value: typeof sessionGreetingIndex) {
      sessionGreetingIndex = value
    },
    get previewDirty() {
      return previewDirty
    },
    set previewDirty(value: typeof previewDirty) {
      previewDirty = value
    },
  }))

  const previewPolicy = usePreviewPolicy()

  const view = ref<'preview' | 'source'>('preview')

  const previewHost = useTemplateRef<HTMLElement>('previewHost')

  const { previewEnabled } = usePreviewBudget(
    'rich-content',
    computed(() => props.active && view.value === 'preview'),
    previewHost,
  )

  const isFrameInteractive = ref(false)

  const isPreviewLoading = ref(true)

  const frame = useTemplateRef<HTMLIFrameElement>('frame')

  const measuredHeight = ref(0)

  const detailsState = ref({ total: 0, open: 0 })

  const previewRevision = ref(0)

  let sessionGreetingContents: readonly string[] | undefined = [...props.greetingContents]

  let sessionGreetingIndex: number | undefined = props.greetingIndex

  let pendingGreetingIndex: number | undefined

  let inFlightGreetingIndex: number | undefined

  let greetingTransitionRequestId = 0

  let previewFormalReady = false

  let sessionSupportsGreetingTransition = false

  let sessionVendorLibs: PreviewVendorLibs | undefined

  let sessionCharAvatarUrl: string | undefined

  let sessionMvuPreview: RenderCompatibilityMvuPreviewState | undefined

  let sessionRuntimeGreetings: string[] = []

  let canonicalPreviewSeed: CanonicalPreviewSeed | undefined

  let previewInputRevision = 0

  let previewDirty = true

  let buildScheduled = false

  let idlePrewarmHandle: number | undefined

  const preparedGreetingCache = new Map<
    number,
    { revision: number; source: string; prepared: PreparedRichContentPreviewMessage }
  >()

  function reportPreviewPerformance(event: Omit<PreviewPerformanceEvent, 'at' | 'title'>): void {
    if (typeof window === 'undefined') return
    const hook = (
      window as Window & {
        __SRL_PREVIEW_PERFORMANCE_AUDIT__?: (event: PreviewPerformanceEvent) => void
      }
    ).__SRL_PREVIEW_PERFORMANCE_AUDIT__
    hook?.({ ...event, at: performance.now(), title: props.title })
  }

  reportPreviewPerformance({ stage: 'component-created' })

  function sameGreetingContents(
    left: readonly string[] | undefined,
    right: readonly string[],
  ): boolean {
    return (
      left !== undefined &&
      left.length === right.length &&
      left.every((item, index) => item === right[index])
    )
  }

  function readContentTheme(): PreviewContentTheme {
    if (typeof document === 'undefined') return 'light'
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  }

  const contentTheme = ref<PreviewContentTheme>(readContentTheme())

  const previewSource = computed(() => prepareTavernPreviewSource(props.source, props.sourceKind))

  const hasPreviewInput = computed(
    () =>
      Boolean(previewSource.value.trim()) ||
      props.runtimeScripts.some((script) => Boolean(script.content.trim())),
  )

  const frameInteractive = computed(
    () => props.immersive || !props.swipePassthrough || isFrameInteractive.value,
  )

  const allDetailsOpen = computed(
    () => detailsState.value.total > 0 && detailsState.value.open === detailsState.value.total,
  )

  const frameStyle = computed(() => {
    const height = measuredHeight.value ? `${measuredHeight.value}px` : undefined
    // The inner message hides overflow; every preview must consume its measured height.
    if (!props.immersive) return { height }
    const viewportWidth = Math.max(0, Math.trunc(Number(props.viewportWidth) || 0))
    return {
      width: viewportWidth ? `${viewportWidth}px` : undefined,
      height,
      transform: scale.value < 1 ? `scale(${scale.value})` : undefined,
      transformOrigin: scale.value < 1 ? 'top left' : undefined,
      background: 'transparent',
    }
  })

  const scale = computed(() => Math.min(1, Math.max(0.1, Number(props.scale) || 1)))

  const frameContainerStyle = computed(() => {
    if (!props.immersive) return undefined
    const viewportWidth = Math.max(0, Math.trunc(Number(props.viewportWidth) || 0))
    if (!viewportWidth || scale.value >= 1) return undefined
    return {
      width: `${Math.ceil(viewportWidth * scale.value)}px`,
      height: measuredHeight.value
        ? `${Math.ceil(measuredHeight.value * scale.value)}px`
        : undefined,
    }
  })

  function blobToDataUrl(blob: Blob): Promise<string | undefined> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
      reader.onerror = () => resolve(undefined)
      reader.readAsDataURL(blob)
    })
  }

  const preview = shallowRef<RichContentPreviewResult>()

  let rebuildGeneration = 0

  let themeObserver: MutationObserver | undefined

  let preloadAbortController: AbortController | undefined

  let releasePreloadedResources: (() => void) | undefined

  let previewDocumentSent = false

  let mvuCacheCharacterData: Record<string, unknown> | undefined

  let mvuCacheGreetingsKey = ''

  let mvuCachePromise: Promise<RenderCompatibilityMvuPreviewState> | undefined

  function isRecordValue(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function replacePreloadedResources(release?: () => void): void {
    const previous = releasePreloadedResources
    releasePreloadedResources = release
    if (previous && previous !== release) window.setTimeout(previous, 0)
  }

  function syncHostViewportHeight(): void {
    if (typeof window === 'undefined') return
    frame.value?.contentWindow?.postMessage(
      { type: 'SRL_HOST_VIEWPORT_HEIGHT', height: window.innerHeight },
      '*',
    )
  }

  function scheduleHostViewportSync(): void {
    if (typeof window === 'undefined') return
    syncHostViewportHeight()
    window.requestAnimationFrame?.(syncHostViewportHeight)
  }

  function normalizedGreetingIndex(): number {
    return Math.min(
      Math.max(0, props.greetingContents.length - 1),
      Math.max(0, Math.trunc(Number(props.greetingIndex) || 0)),
    )
  }

  function isSessionGreetingTransition(): boolean {
    if (!props.greetingContents.length) return false
    const target = normalizedGreetingIndex()
    return (
      sameGreetingContents(sessionGreetingContents, props.greetingContents) &&
      props.greetingContents[target] === props.source
    )
  }

  function currentPreviewSessionHost(): PreviewSessionHost | undefined {
    try {
      return (
        frame.value?.contentWindow as
          (Window & { __SRL_RENDER_COMPAT_HOST__?: PreviewSessionHost }) | undefined
      )?.__SRL_RENDER_COMPAT_HOST__
    } catch {
      return undefined
    }
  }

  function syncGreetingTransition(): boolean {
    if (!sessionSupportsGreetingTransition || !isSessionGreetingTransition()) return false
    const target = normalizedGreetingIndex()
    if (!previewFormalReady) {
      pendingGreetingIndex = target
      isPreviewLoading.value = true
      return true
    }
    if (sessionGreetingIndex === target) {
      pendingGreetingIndex = undefined
      inFlightGreetingIndex = undefined
      isPreviewLoading.value = false
      return true
    }
    if (inFlightGreetingIndex === target) {
      isPreviewLoading.value =
        Number(currentPreviewSessionHost()?.context?.().chat?.[0]?.swipe_id) !== target
      return true
    }

    const host = currentPreviewSessionHost()
    if (!host || typeof host.transitionSwipe !== 'function') return false

    const source = props.greetingContents[target] ?? props.source
    const inputRevision = previewInputRevision
    const requestId = ++greetingTransitionRequestId
    pendingGreetingIndex = target
    inFlightGreetingIndex = target
    isPreviewLoading.value = true
    const preparedMessage = prepareGreetingMessage(source, target, 'alternate')
    const rendered = buildRenderCompatibilitySwipeMarkup(source, previewPolicy.value, {
      vendorLibs: sessionVendorLibs,
      charAvatarUrl: sessionCharAvatarUrl,
      sourceKind: props.sourceKind,
      macroCharName: props.macroCharName,
      macroUserName: props.macroUserName,
      preparedMessage,
    })

    let transitionResult: boolean | Promise<boolean>
    try {
      transitionResult = host.transitionSwipe(target, false, rendered)
    } catch {
      sessionSupportsGreetingTransition = false
      pendingGreetingIndex = undefined
      inFlightGreetingIndex = undefined
      resetPreviewUi()
      void rebuildPreview()
      return true
    }

    let canonicalSeedQueued = false
    const acceptAppliedTarget = () => {
      sessionGreetingIndex = target
      pendingGreetingIndex = undefined
      if (normalizedGreetingIndex() === target) isPreviewLoading.value = false
      if (canonicalSeedQueued) return
      canonicalSeedQueued = true
      queueMicrotask(() => {
        if (
          requestId !== greetingTransitionRequestId ||
          inputRevision !== previewInputRevision ||
          normalizedGreetingIndex() !== target ||
          Number(host.context?.().chat?.[0]?.swipe_id) !== target
        ) {
          return
        }
        stageCanonicalPreviewSeed(source, target)
        scheduleIdleGreetingPrewarm(target)
      })
    }
    if (Number(host.context?.().chat?.[0]?.swipe_id) === target) acceptAppliedTarget()

    void Promise.resolve(transitionResult)
      .then(async (changed) => {
        const applied = Number(host.context?.().chat?.[0]?.swipe_id) === target
        if (!applied) throw new Error('PreviewSession did not apply the requested opening')
        if (requestId === greetingTransitionRequestId) acceptAppliedTarget()
        if (changed) await host.emit(host.events.CHARACTER_MESSAGE_RENDERED, [0])
        if (requestId !== greetingTransitionRequestId) return
        inFlightGreetingIndex = undefined
        if (props.greetingContents.length && normalizedGreetingIndex() !== target) {
          syncGreetingTransition()
          return
        }
        isPreviewLoading.value = false
      })
      .catch(() => {
        if (requestId !== greetingTransitionRequestId) return
        sessionSupportsGreetingTransition = false
        pendingGreetingIndex = undefined
        inFlightGreetingIndex = undefined
        resetPreviewUi()
        void rebuildPreview()
      })
    return true
  }

  function invalidatePreviewFrameSession(): void {
    previewFormalReady = false
    previewDocumentSent = false
    sessionGreetingIndex = undefined
    inFlightGreetingIndex = undefined
    greetingTransitionRequestId += 1
    const seeded = hasCurrentCanonicalPreviewSeed()
    pendingGreetingIndex =
      !seeded && sessionSupportsGreetingTransition && isSessionGreetingTransition()
        ? normalizedGreetingIndex()
        : undefined
    if (seeded || pendingGreetingIndex !== undefined) isPreviewLoading.value = true
  }

  function resetPreviewUi(): void {
    isFrameInteractive.value = false
    measuredHeight.value = 0
    detailsState.value = { total: 0, open: 0 }
  }

  function schedulePreviewBuild(): void {
    if (buildScheduled) return
    buildScheduled = true
    queueMicrotask(() => {
      buildScheduled = false
      if (previewDirty && previewEnabled.value && view.value === 'preview' && props.active) {
        void rebuildPreview()
      }
    })
  }

  function markPreviewInputsDirty(): void {
    previewInputRevision += 1
    previewDirty = true
    canonicalPreviewSeed = undefined
    preparedGreetingCache.clear()
    rebuildGeneration += 1
    preloadAbortController?.abort()
    preloadAbortController = undefined
    cancelIdlePrewarm()
    schedulePreviewBuild()
  }

  function markPreviewSelectionDirty(): void {
    previewDirty = true
    rebuildGeneration += 1
    preloadAbortController?.abort()
    preloadAbortController = undefined
    cancelIdlePrewarm()
    schedulePreviewBuild()
  }

  function suspendPreviewWork(): void {
    rebuildGeneration += 1
    if (!hasCurrentCanonicalPreviewSeed()) previewDirty = true
    preloadAbortController?.abort()
    preloadAbortController = undefined
    cancelIdlePrewarm()
  }

  function setView(nextView: 'preview' | 'source'): void {
    view.value = nextView
  }

  function togglePreviewDetails(): void {
    frame.value?.contentWindow?.postMessage(
      { type: 'SRL_SET_DETAILS_OPEN', open: !allDetailsOpen.value },
      '*',
    )
  }

  async function rebuildPreview(): Promise<void> {
    if (!previewEnabled.value || view.value !== 'preview' || !props.active) {
      previewDirty = true
      return
    }
    const generation = ++rebuildGeneration
    const inputRevision = previewInputRevision
    previewDirty = false
    isPreviewLoading.value = true
    previewDocumentSent = false
    previewFormalReady = false
    sessionSupportsGreetingTransition = false
    pendingGreetingIndex = undefined
    inFlightGreetingIndex = undefined
    greetingTransitionRequestId += 1
    preloadAbortController?.abort()
    preloadAbortController = undefined
    cancelIdlePrewarm()
    const policy = previewPolicy.value
    const shouldWarmNativeResources =
      props.preloadResources &&
      (policy.allowRemoteResources || props.preloadTrustedResources) &&
      isNativePreviewAssetAvailable()
    // 浏览器可以让跨域图片直接显示，却未必获准用 fetch 读取响应体。不要把 CORS
    // 读取限制当作图片失效，也不要因此推迟隔离预览的挂载。
    // Compatibility vendors only belong to a Trusted frontend/script session.
    // Ordinary Markdown and Safe Preview do not request these dynamic chunks.
    const mvuGreetings = currentMvuGreetings()
    const runtimeGreetings = props.greetingContents.length ? props.greetingContents : mvuGreetings
    const targetGreetingIndex = props.greetingContents.length
      ? normalizedGreetingIndex()
      : props.greetingIndex
    const preparedCurrent = prepareGreetingMessage(props.source, targetGreetingIndex, 'current')
    const hasCompatibilityRuntime = hasRenderCompatibilityRuntimeSource(
      props.source,
      props.runtimeScripts,
      policy.allowScripts,
      preparedCurrent,
    )
    function* vendorSources(): Generator<string> {
      yield props.source
      for (const greeting of runtimeGreetings) {
        if (greeting !== props.source) yield greeting
      }
      for (const script of props.runtimeScripts) {
        if (script.content.trim()) yield script.content
      }
    }
    const vendorNeeds = mergePreviewVendorLibNeeds(vendorSources())
    const loadVendors = async (): Promise<PreviewVendorLibs | undefined> => {
      if (!policy.allowScripts || !hasCompatibilityRuntime) return undefined
      const startedAt = performance.now()
      const libs = await loadPreviewVendorLibs(vendorNeeds)
      reportPreviewPerformance({
        stage: 'vendor-load',
        durationMs: performance.now() - startedAt,
        vendorNames: loadedPreviewVendorNames(libs),
      })
      return libs
    }
    const loadMvu = async (): Promise<RenderCompatibilityMvuPreviewState | undefined> => {
      if (!policy.allowScripts || !hasCompatibilityRuntime) return undefined
      const startedAt = performance.now()
      const state = await loadMvuPreviewState(mvuGreetings)
      reportPreviewPerformance({
        stage: 'mvu-parse',
        durationMs: performance.now() - startedAt,
      })
      return state
    }
    const [vendorLibs, mvuPreview] = await Promise.all([loadVendors(), loadMvu()])
    const charAvatarUrl = props.charAvatar ? await blobToDataUrl(props.charAvatar) : undefined
    if (
      generation !== rebuildGeneration ||
      inputRevision !== previewInputRevision ||
      !previewEnabled.value ||
      view.value !== 'preview' ||
      !props.active
    ) {
      return
    }
    sessionVendorLibs = vendorLibs
    sessionCharAvatarUrl = charAvatarUrl
    sessionMvuPreview = mvuPreview
    sessionRuntimeGreetings = [...runtimeGreetings]
    sessionSupportsGreetingTransition = hasCompatibilityRuntime
    const sourceAtBuild = props.source
    const documentStartedAt = performance.now()
    const nextPreview = buildSessionPreview(sourceAtBuild, targetGreetingIndex)
    reportPreviewPerformance({
      stage: 'document-build',
      durationMs: performance.now() - documentStartedAt,
      greetingIndex: targetGreetingIndex,
    })
    stageCanonicalPreviewSeed(sourceAtBuild, targetGreetingIndex, nextPreview)
    if (shouldWarmNativeResources) {
      // 真机先按网页语义挂载原始外链；原生缓存只是后台加速，不能决定当前图片是否可见。
      preview.value = nextPreview
      replacePreloadedResources()
      const controller = new AbortController()
      preloadAbortController = controller
      void preloadPreviewDocumentResources(nextPreview.document, undefined, {
        signal: controller.signal,
      })
        .then((preloaded) => {
          if (generation !== rebuildGeneration || controller.signal.aborted) {
            preloaded.release()
            return
          }
          // 普通外链在正式文档发出后不再为了命中本机缓存重启整只 iframe；下载仍会预热下次。
          // 只有受信资源需要绕过关闭的远程资源策略时，才允许已挂载文档做必要的替换。
          const stillCurrentBuild =
            props.source === sourceAtBuild &&
            (!props.greetingContents.length || normalizedGreetingIndex() === targetGreetingIndex)
          if (
            preloaded.loaded &&
            stillCurrentBuild &&
            (props.preloadTrustedResources || !previewDocumentSent)
          ) {
            const preloadedPreview = { ...nextPreview, document: preloaded.document }
            preview.value = preloadedPreview
            stageCanonicalPreviewSeed(sourceAtBuild, targetGreetingIndex, preloadedPreview)
            replacePreloadedResources(preloaded.release)
            if (previewDocumentSent) previewRevision.value += 1
            scheduleHostViewportSync()
            return
          }
          preloaded.release()
        })
        .catch(() => undefined)
        .finally(() => {
          if (preloadAbortController === controller) preloadAbortController = undefined
        })
    } else {
      preview.value = nextPreview
      replacePreloadedResources()
    }
    sessionGreetingContents = [...props.greetingContents]
    sessionGreetingIndex = targetGreetingIndex
    previewRevision.value += 1
    scheduleHostViewportSync()
    scheduleIdleGreetingPrewarm(targetGreetingIndex)
  }

  function handleFrameLoad(): void {
    reportPreviewPerformance({
      stage: 'iframe-load',
      greetingIndex: normalizedGreetingIndex(),
    })
    previewDocumentSent = true
    previewFormalReady = true
    if (pendingGreetingIndex !== undefined || sessionGreetingIndex !== props.greetingIndex) {
      if (syncGreetingTransition()) {
        scheduleHostViewportSync()
        return
      }
    }
    isPreviewLoading.value = false
    scheduleHostViewportSync()
  }

  function handlePreviewMessage(event: MessageEvent): void {
    const frameElement = frame.value
    if (!frameElement || event.source !== frameElement.contentWindow) return
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null) return
    const payload = data as {
      type?: unknown
      protocol?: unknown
      height?: unknown
      id?: unknown
      label?: unknown
      target?: unknown
      total?: unknown
      open?: unknown
    }
    if (payload.type === 'SRL_PREVIEW_HEIGHT') {
      const height = Number(payload.height)
      if (Number.isFinite(height) && height > 0) measuredHeight.value = Math.ceil(height)
      return
    }
    if (payload.type === 'SRL_PREVIEW_DETAILS_STATE') {
      const total = Math.max(0, Math.trunc(Number(payload.total)))
      const open = Math.min(total, Math.max(0, Math.trunc(Number(payload.open))))
      if (Number.isFinite(total) && Number.isFinite(open)) detailsState.value = { total, open }
      return
    }
    if (payload.type === 'SRL_WORKSHOP_INSPECT' && props.inspector) {
      const id = String(payload.id ?? '').slice(0, 80)
      const label = String(payload.label ?? '').slice(0, 80)
      if (id && label) emit('inspect', { id, label })
      return
    }
    if (payload.type === 'SRL_GREETING_NAVIGATE') {
      const target = Number(payload.target)
      if (Number.isInteger(target) && target >= 0) {
        pendingGreetingIndex = target
        emit('navigateGreeting', target)
      }
      return
    }
    if (
      payload.type === RENDER_COMPATIBILITY_EVENTS.diagnostic &&
      (payload as { protocol?: unknown }).protocol === RENDER_COMPATIBILITY_PROTOCOL &&
      isRenderCompatibilityDiagnostic((payload as { diagnostic?: unknown }).diagnostic)
    ) {
      emit(
        'compatibilityDiagnostic',
        (payload as { diagnostic: RenderCompatibilityDiagnostic }).diagnostic,
      )
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('message', handlePreviewMessage)
    window.addEventListener('resize', scheduleHostViewportSync)
  }

  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      contentTheme.value = readContentTheme()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  }

  onUnmounted(() => {
    cancelIdlePrewarm()
    preloadAbortController?.abort()
    preloadAbortController = undefined
    releasePreloadedResources?.()
    releasePreloadedResources = undefined
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', handlePreviewMessage)
      window.removeEventListener('resize', scheduleHostViewportSync)
    }
    themeObserver?.disconnect()
  })

  watch(
    [
      previewPolicy,
      () => props.title,
      () => props.runtimeScripts,
      () => props.charAvatar,
      () => props.inspector,
      () => props.renderShell,
      () => props.messageAvatarMode,
      () => props.sourceKind,
      () => props.macroCharName,
      () => props.macroUserName,
      () => props.greetingContents,
      () => props.characterData,
      () => props.displayRegexRules,
      () => props.frontendWorkshopBehaviorRuntime,
      () => props.preloadResources,
      () => props.preloadTrustedResources,
      contentTheme,
    ],
    () => {
      resetPreviewUi()
      markPreviewInputsDirty()
    },
    { immediate: true },
  )

  watch([() => props.source, () => props.greetingIndex], () => {
    if (view.value === 'preview' && previewEnabled.value && syncGreetingTransition()) return
    resetPreviewUi()
    if (
      props.greetingContents.length &&
      props.greetingContents[normalizedGreetingIndex()] === props.source
    ) {
      markPreviewSelectionDirty()
    } else {
      markPreviewInputsDirty()
    }
  })

  watch(
    view,
    (nextView) => {
      if (nextView === 'source') {
        suspendPreviewWork()
        invalidatePreviewFrameSession()
        return
      }
      if (previewEnabled.value && !activateCanonicalPreviewSeed()) schedulePreviewBuild()
    },
    { flush: 'sync' },
  )

  watch(
    previewEnabled,
    (enabled, wasEnabled) => {
      if (wasEnabled && !enabled) {
        suspendPreviewWork()
        invalidatePreviewFrameSession()
      }
      if (!wasEnabled && enabled) {
        reportPreviewPerformance({ stage: 'preview-budget-active' })
        if (!activateCanonicalPreviewSeed()) schedulePreviewBuild()
      }
    },
    { flush: 'sync' },
  )
  return {
    hasPreviewInput,
    view,
    setView,
    detailsState,
    allDetailsOpen,
    togglePreviewDetails,
    isFrameInteractive,
    previewEnabled,
    preview,
    frameInteractive,
    frameContainerStyle,
    previewPolicy,
    previewRevision,
    isPreviewLoading,
    frameStyle,
    handleFrameLoad,
    previewSource,
  }
}
