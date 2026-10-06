import type { Ref } from 'vue'
import { usePreviewPolicy } from '../composables/UsePreviewPolicy'
import type {
  CanonicalPreviewSeed,
  PreviewPerformanceEvent,
  RichContentPreviewProps,
} from '../types/RichContentPreviewView'
import { type PreviewVendorLibs } from '../utils/PreviewVendorLibs'
import type { RenderCompatibilityMvuPreviewState } from '../utils/RenderCompatibilityMvu'
import {
  buildRichContentPreview,
  prepareRichContentPreviewMessage,
  requiresSynchronousGreetingFormatting,
  type PreparedRichContentPreviewMessage,
  type PreviewContentTheme,
  type RichContentPreviewResult,
} from '../utils/RichContentPreview'

interface PreviewGreetingSessionContext {
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
  >
  isRecordValue: (value: unknown) => value is Record<string, unknown>
  mvuCachePromise: Promise<RenderCompatibilityMvuPreviewState> | undefined
  mvuCacheCharacterData: Record<string, unknown> | undefined
  mvuCacheGreetingsKey: string
  idlePrewarmHandle: number | undefined
  preparedGreetingCache: Map<
    number,
    { revision: number; source: string; prepared: PreparedRichContentPreviewMessage }
  >
  previewInputRevision: number
  previewPolicy: ReturnType<typeof usePreviewPolicy>
  reportPreviewPerformance: (event: Omit<PreviewPerformanceEvent, 'at' | 'title'>) => void
  previewEnabled: Ref<boolean, boolean>
  view: Ref<'preview' | 'source'>
  sessionMvuPreview: RenderCompatibilityMvuPreviewState | undefined
  sessionRuntimeGreetings: string[]
  sessionVendorLibs: PreviewVendorLibs | undefined
  sessionCharAvatarUrl: string | undefined
  contentTheme: Ref<PreviewContentTheme>
  canonicalPreviewSeed: CanonicalPreviewSeed | undefined
  normalizedGreetingIndex: () => number
  preview: Ref<RichContentPreviewResult | undefined>
  sessionGreetingContents: readonly string[] | undefined
  sessionGreetingIndex: number | undefined
  previewDirty: boolean
}

export function usePreviewGreetingSession(getContext: () => PreviewGreetingSessionContext) {
  function currentMvuGreetings(): string[] {
    const context = getContext()

    const first =
      typeof context.props.characterData?.first_mes === 'string'
        ? context.props.characterData.first_mes
        : ''
    const alternates = Array.isArray(context.props.characterData?.alternate_greetings)
      ? context.props.characterData.alternate_greetings.filter(
          (value): value is string => typeof value === 'string',
        )
      : []
    const cardGreetings = [first, ...alternates].filter(Boolean)
    return cardGreetings.length
      ? cardGreetings
      : context.props.greetingContents.length
        ? [...context.props.greetingContents]
        : [context.props.source]
  }

  function hasMvuMarkers(greetings: string[]): boolean {
    const context = getContext()

    if (greetings.some((greeting) => /<initvar>/i.test(greeting))) return true
    const book = context.isRecordValue(context.props.characterData?.character_book)
      ? context.props.characterData.character_book
      : undefined
    const rawEntries = book?.entries
    const entries = Array.isArray(rawEntries)
      ? rawEntries
      : context.isRecordValue(rawEntries)
        ? Object.values(rawEntries)
        : []
    return entries.filter(context.isRecordValue).some((entry) => {
      const label = typeof entry.comment === 'string' ? entry.comment : entry.name
      return typeof label === 'string' && label.toLowerCase().includes('[initvar]')
    })
  }

  function loadMvuPreviewState(
    greetings: string[],
  ): Promise<RenderCompatibilityMvuPreviewState> | undefined {
    const context = getContext()

    if (!hasMvuMarkers(greetings)) return undefined
    const greetingsKey = greetings.join('\u0000')
    if (
      context.mvuCachePromise &&
      context.mvuCacheCharacterData === context.props.characterData &&
      context.mvuCacheGreetingsKey === greetingsKey
    ) {
      return context.mvuCachePromise
    }
    context.mvuCacheCharacterData = context.props.characterData
    context.mvuCacheGreetingsKey = greetingsKey
    context.mvuCachePromise = import('../utils/RenderCompatibilityMvu').then((module) =>
      module.buildRenderCompatibilityMvuPreviewState({
        characterData: context.props.characterData,
        greetings,
        charName: context.props.macroCharName,
        userName: context.props.macroUserName,
      }),
    )
    return context.mvuCachePromise
  }

  function cancelIdlePrewarm(): void {
    const context = getContext()

    if (context.idlePrewarmHandle === undefined || typeof window === 'undefined') return
    window.cancelIdleCallback?.(context.idlePrewarmHandle)
    context.idlePrewarmHandle = undefined
  }

  function prepareGreetingMessage(
    source: string,
    greetingIndex: number,
    formatterKind: PreviewPerformanceEvent['formatterKind'],
  ): PreparedRichContentPreviewMessage {
    const context = getContext()

    const cached = context.preparedGreetingCache.get(greetingIndex)
    if (cached?.revision === context.previewInputRevision && cached.source === source) {
      return cached.prepared
    }
    const startedAt = performance.now()
    const prepared = prepareRichContentPreviewMessage(source, context.previewPolicy.value, {
      sourceKind: context.props.sourceKind,
      macroCharName: context.props.macroCharName,
      macroUserName: context.props.macroUserName,
    })
    context.preparedGreetingCache.set(greetingIndex, {
      revision: context.previewInputRevision,
      source,
      prepared,
    })
    context.reportPreviewPerformance({
      stage: 'formatter',
      durationMs: performance.now() - startedAt,
      greetingIndex,
      formatterKind,
    })
    return prepared
  }

  function preparedRuntimeGreetings(
    greetings: string[],
    currentIndex: number,
  ): Array<PreparedRichContentPreviewMessage | undefined> {
    const context = getContext()

    if (
      !context.previewPolicy.value.allowScripts ||
      !requiresSynchronousGreetingFormatting(greetings, context.props.runtimeScripts)
    ) {
      return []
    }
    return greetings.map((greeting, index) =>
      index === currentIndex
        ? prepareGreetingMessage(context.props.source, index, 'current')
        : prepareGreetingMessage(greeting, index, 'compatibility'),
    )
  }

  function scheduleIdleGreetingPrewarm(currentIndex: number): void {
    const context = getContext()

    cancelIdlePrewarm()
    if (
      typeof window === 'undefined' ||
      typeof window.requestIdleCallback !== 'function' ||
      !context.previewEnabled.value ||
      context.view.value !== 'preview' ||
      !context.props.greetingContents.length ||
      (context.previewPolicy.value.allowScripts &&
        requiresSynchronousGreetingFormatting(
          context.props.greetingContents,
          context.props.runtimeScripts,
        ))
    ) {
      return
    }
    const revision = context.previewInputRevision
    const targets = [currentIndex - 1, currentIndex + 1].filter(
      (target) => target >= 0 && target < context.props.greetingContents.length,
    )
    const run = (deadline: IdleDeadline) => {
      context.idlePrewarmHandle = undefined
      if (
        revision !== context.previewInputRevision ||
        !context.previewEnabled.value ||
        context.view.value !== 'preview'
      ) {
        return
      }
      while (targets.length && deadline.timeRemaining() > 0) {
        const target = targets.shift()!
        const source = context.props.greetingContents[target]
        if (source !== undefined) prepareGreetingMessage(source, target, 'prewarm')
      }
      if (targets.length) context.idlePrewarmHandle = window.requestIdleCallback(run)
    }
    context.idlePrewarmHandle = window.requestIdleCallback(run)
  }

  function buildSessionPreview(source: string, greetingIndex: number): RichContentPreviewResult {
    const context = getContext()

    const runtimeGreetings = context.sessionMvuPreview?.recognized
      ? context.sessionRuntimeGreetings
      : context.props.greetingContents
    const preparedMessage = prepareGreetingMessage(source, greetingIndex, 'current')
    return buildRichContentPreview(
      source,
      context.props.title,
      context.previewPolicy.value,
      context.props.runtimeScripts,
      {
        vendorLibs: context.sessionVendorLibs,
        charAvatarUrl: context.sessionCharAvatarUrl,
        inspectTargets: context.props.inspector,
        renderShell: context.props.renderShell,
        messageAvatarMode: context.props.messageAvatarMode,
        sourceKind: context.props.sourceKind,
        macroCharName: context.props.macroCharName,
        macroUserName: context.props.macroUserName,
        greetingContents: runtimeGreetings,
        greetingIndex,
        characterData: context.props.characterData,
        swipesData: context.sessionMvuPreview?.recognized
          ? context.sessionMvuPreview.swipesData
          : undefined,
        mvuRecognized: context.sessionMvuPreview?.recognized,
        mvuErrors: context.sessionMvuPreview?.errors,
        unsupportedMvuOpeningUpdates: context.sessionMvuPreview?.unsupportedOpeningUpdates,
        contentTheme: context.contentTheme.value,
        frontendWorkshopBehaviorRuntime: context.props.frontendWorkshopBehaviorRuntime,
        preparedMessage,
        preparedGreetingMessages: preparedRuntimeGreetings(runtimeGreetings, greetingIndex),
      },
    )
  }

  function stageCanonicalPreviewSeed(
    source: string,
    greetingIndex: number,
    previewResult?: RichContentPreviewResult,
  ): void {
    const context = getContext()

    context.canonicalPreviewSeed = {
      preview: previewResult,
      revision: context.previewInputRevision,
      source,
      greetingIndex,
    }
  }

  function hasCurrentCanonicalPreviewSeed(): boolean {
    const context = getContext()

    const seed = context.canonicalPreviewSeed
    if (!seed) return false
    const target = context.normalizedGreetingIndex()
    return (
      seed.revision === context.previewInputRevision &&
      seed.source === context.props.source &&
      seed.greetingIndex === target
    )
  }

  function activateCanonicalPreviewSeed(): boolean {
    const context = getContext()

    if (!hasCurrentCanonicalPreviewSeed()) return false
    const seed = context.canonicalPreviewSeed!
    const target = context.normalizedGreetingIndex()
    if (seed.preview) {
      context.preview.value = seed.preview
    } else {
      const startedAt = performance.now()
      context.preview.value = buildSessionPreview(context.props.source, target)
      context.reportPreviewPerformance({
        stage: 'document-build',
        durationMs: performance.now() - startedAt,
        greetingIndex: target,
      })
    }
    context.sessionGreetingContents = [...context.props.greetingContents]
    context.sessionGreetingIndex = target
    context.previewDirty = false
    scheduleIdleGreetingPrewarm(target)
    return true
  }
  return {
    currentMvuGreetings,
    hasMvuMarkers,
    loadMvuPreviewState,
    cancelIdlePrewarm,
    prepareGreetingMessage,
    preparedRuntimeGreetings,
    scheduleIdleGreetingPrewarm,
    buildSessionPreview,
    stageCanonicalPreviewSeed,
    hasCurrentCanonicalPreviewSeed,
    activateCanonicalPreviewSeed,
  }
}
