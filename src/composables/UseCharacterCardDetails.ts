import type { EmitFn } from 'vue'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { usePreviewPolicy } from '../composables/UsePreviewPolicy'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import {
  applyCharacterCardOverrides,
  characterRegexKey,
  inspectCharacterReplacementResource,
  type CharacterCardOverrides,
  type CharacterReplacementContent,
} from '../utils/CharacterCardCustomization'
import {
  extractCharacterGreetingRegexRules,
  getCharacterGreetingRegexPreviewTimeoutMs,
  type CharacterGreetingRegexResult,
} from '../utils/CharacterGreetingRegex'
import { parseGreetingMetadata } from '../utils/GreetingMetadata'
import { stripOpeningPreviewHiddenBlocks } from '../utils/OpeningPreviewContent'
import { summarizeRegexEffect, type RegexEffectSummary } from '../utils/RegexEffectPreview'
import {
  buildRegexPreviewDocument,
  hasBlockedRegexPreviewContent,
} from '../utils/RegexStaticPreview'
import {
  hasRichPreviewContent,
  replacePreviewMacros,
  type PreviewRuntimeScript,
} from '../utils/RichContentPreview'
import {
  extractTavernHelperScripts,
  readTavernHelperScriptBlob,
} from '../utils/TavernHelperScriptParser'
import { isRecord } from '../utils/UnknownValue'

export type CharacterCardDetailsProps = {
  metadata: Record<string, unknown>
  boundResources?: Resource[]
  overrides?: CharacterCardOverrides
}

export type CharacterCardDetailsEvents = {
  'update:overrides': [value: CharacterCardOverrides]
}

export type CharacterPage = 'overview' | 'greetings' | 'worldBook' | 'regex' | 'helper'

export interface CharacterSection {
  key: string
  label: string
  content: string
  open?: boolean
}

export interface GreetingView {
  key: string
  label: string
  content: string
  description?: string
  group?: string
  theme?: string
}

export interface EmbeddedWorldEntry {
  id: string
  title: string
  keys: string[]
  content: string
  enabled: boolean
}

export interface EmbeddedRegexScript {
  id: string
  overrideKey: string
  name: string
  find: string
  replace: string
  disabled: boolean
  effect: RegexEffectSummary
  previewDocument: string
}

export interface ReplacementSource {
  resource: Resource
  content: CharacterReplacementContent
}

export interface EmbeddedHelperScript {
  id: string
  folder: string
  name: string
  info: string
  content: string
  enabled: boolean
  buttons: string[]
  data?: Record<string, unknown>
}

export function useCharacterCardDetails(
  props: Readonly<
    CharacterCardDetailsProps &
      Required<Pick<CharacterCardDetailsProps, 'boundResources' | 'overrides'>>
  >,
  emit: EmitFn<CharacterCardDetailsEvents>,
) {
  const previewPolicy = usePreviewPolicy()

  const PAGE_SIZE = 10

  const characterRoot = useTemplateRef<HTMLElement>('characterRoot')

  const greetingTrack = useTemplateRef<HTMLElement>('greetingTrack')

  const activePage = ref<CharacterPage>('overview')

  const activeGreetingIndex = ref(0)

  const greetingPreviewIndex = ref<number | null>(null)

  const selectedWorldEntryId = ref('')

  const selectedRegexScriptId = ref('')

  const selectedHelperScriptId = ref('')

  const embeddedWorldQuery = ref('')

  const embeddedWorldPage = ref(1)

  const embeddedRegexQuery = ref('')

  const embeddedRegexPage = ref(1)

  const processedGreetingContents = ref<string[]>([])

  const greetingRegexState = ref<'idle' | 'processing' | 'ready' | 'failed'>('idle')

  const greetingRegexMatchedNames = ref<string[]>([])

  const greetingRegexErrors = ref<string[]>([])

  const worldBookReplacementSources = ref<ReplacementSource[]>([])

  const greetingReplacementSources = ref<ReplacementSource[]>([])

  const boundRuntimeScripts = ref<PreviewRuntimeScript[]>([])

  let replacementGeneration = 0

  let boundScriptGeneration = 0

  let greetingTouchStart:
    | {
        x: number
        y: number
        index: number
      }
    | undefined

  let greetingPreviewTrigger: HTMLElement | undefined

  let greetingRegexWorker: Worker | undefined

  let greetingRegexTimeout = 0

  let greetingRegexGeneration = 0

  function readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
  }

  function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
  }

  const card = computed(() => (isRecord(props.metadata.card) ? props.metadata.card : undefined))

  const sourceCardData = computed(() => {
    const value = card.value
    return value && isRecord(value.data) ? value.data : value
  })

  const activeReplacementContent = computed<CharacterReplacementContent>(() => ({
    worldBook: worldBookReplacementSources.value.find(
      (item) => item.resource.id === props.overrides.worldBookResourceId,
    )?.content.worldBook,
    greetings: greetingReplacementSources.value.find(
      (item) => item.resource.id === props.overrides.greetingResourceId,
    )?.content.greetings,
  }))

  const effectiveCard = computed(() =>
    card.value
      ? applyCharacterCardOverrides(card.value, props.overrides, activeReplacementContent.value)
      : undefined,
  )

  const cardData = computed(() => {
    const value = effectiveCard.value
    return value && isRecord(value.data) ? value.data : value
  })

  const characterName = computed(
    () => readString(cardData.value?.name) || readString(props.metadata.name) || '角色',
  )

  const creator = computed(
    () => readString(cardData.value?.creator) || readString(props.metadata.creator),
  )

  const characterVersion = computed(
    () =>
      readString(sourceCardData.value?.character_version) ||
      readString(props.metadata.characterVersion),
  )

  const spec = computed(() => readString(props.metadata.characterCardSpec))

  const cardExtensions = computed(() =>
    isRecord(cardData.value?.extensions) ? cardData.value.extensions : undefined,
  )

  const alternateGreetings = computed(() =>
    readStringArray(cardData.value?.alternate_greetings).filter((content) => content.trim()),
  )

  function toGreetingView(content: string, key: string, fallbackLabel: string): GreetingView {
    const parsed = parseGreetingMetadata(content)
    return {
      key,
      label: parsed.title || fallbackLabel,
      content: parsed.content,
      description: parsed.description,
      group: parsed.group,
      theme: parsed.theme,
    }
  }

  const rawGreetings = computed<GreetingView[]>(() => {
    const primary = readString(cardData.value?.first_mes)
    return [
      ...(primary ? [toGreetingView(primary, 'primary', '主开场')] : []),
      ...alternateGreetings.value.map((content, index) =>
        toGreetingView(content, `alternate-${index}`, `备用 ${String(index + 1).padStart(2, '0')}`),
      ),
    ]
  })

  const greetingRegexRules = computed(() =>
    extractCharacterGreetingRegexRules(cardExtensions.value?.regex_scripts),
  )

  const greetings = computed<GreetingView[]>(() =>
    rawGreetings.value.map((greeting, index) => ({
      ...greeting,
      content: processedGreetingContents.value[index] ?? greeting.content,
    })),
  )

  function greetingExcerpt(value: string): string {
    const excerpt = stripOpeningPreviewHiddenBlocks(value)
      .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, ' ')
      .replace(/```(?:html|css|javascript|js)?/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
    if (!excerpt) return '这条开场白主要由 HTML / CSS 效果组成，请进入沉浸阅读查看。'
    return excerpt.length > 240 ? `${excerpt.slice(0, 240).trim()}…` : excerpt
  }

  const greetingRegexStatus = computed(() => {
    const count = greetingRegexRules.value.length
    if (!count) return ''
    if (greetingRegexState.value === 'processing') return `正在检查 ${count} 条角色正则`
    if (greetingRegexState.value === 'failed') return '角色正则预览未完成'
    if (greetingRegexMatchedNames.value.length) {
      return `已匹配 ${greetingRegexMatchedNames.value.length} 条角色正则`
    }
    return `已检查 ${count} 条角色正则`
  })

  const greetingRegexStatusTitle = computed(() => {
    if (greetingRegexErrors.value.length) return greetingRegexErrors.value.join('；')
    if (greetingRegexMatchedNames.value.length) return greetingRegexMatchedNames.value.join('、')
    return '只应用角色卡内已启用、作用于 AI 输出或 Markdown 显示的正则。'
  })

  function stopGreetingRegexWorker(): void {
    if (greetingRegexTimeout) window.clearTimeout(greetingRegexTimeout)
    greetingRegexTimeout = 0
    greetingRegexWorker?.terminate()
    greetingRegexWorker = undefined
  }

  function refreshGreetingRegexPreview(): void {
    const generation = ++greetingRegexGeneration
    stopGreetingRegexWorker()
    processedGreetingContents.value = []
    greetingRegexMatchedNames.value = []
    greetingRegexErrors.value = []

    const rules = greetingRegexRules.value
    if (!rules.length || !rawGreetings.value.length) {
      greetingRegexState.value = 'idle'
      return
    }

    if (typeof Worker === 'undefined') {
      greetingRegexState.value = 'failed'
      greetingRegexErrors.value = ['当前浏览器不支持安全的后台正则预览']
      return
    }

    greetingRegexState.value = 'processing'
    const fail = (message: string): void => {
      if (generation !== greetingRegexGeneration) return
      stopGreetingRegexWorker()
      greetingRegexState.value = 'failed'
      greetingRegexErrors.value = [message]
    }

    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/CharacterGreetingRegexWorker.ts', import.meta.url), {
        type: 'module',
      })
    } catch {
      fail('角色正则后台处理不可用，已回退原始开场白')
      return
    }
    greetingRegexWorker = worker

    worker.addEventListener('message', (event: MessageEvent<CharacterGreetingRegexResult>) => {
      if (generation !== greetingRegexGeneration) return
      stopGreetingRegexWorker()
      processedGreetingContents.value = event.data.contents
      greetingRegexMatchedNames.value = event.data.matchedRuleNames
      greetingRegexErrors.value = event.data.errors
      greetingRegexState.value = 'ready'
    })
    worker.addEventListener('error', () => fail('角色正则执行失败，已回退原始开场白'))
    worker.addEventListener('messageerror', () => fail('角色正则数据传输失败，已回退原始开场白'))
    const contents = rawGreetings.value.map((greeting) =>
      replacePreviewMacros(greeting.content, { charName: characterName.value }),
    )
    greetingRegexTimeout = window.setTimeout(
      () => fail('角色正则处理超时，已回退原始开场白'),
      getCharacterGreetingRegexPreviewTimeoutMs(contents, rules),
    )
    try {
      worker.postMessage({
        contents,
        rules,
        context: { charName: characterName.value },
      })
    } catch {
      fail('角色正则数据传输失败，已回退原始开场白')
    }
  }

  watch([rawGreetings, greetingRegexRules], refreshGreetingRegexPreview, { immediate: true })

  onBeforeUnmount(() => {
    greetingRegexGeneration += 1
    stopGreetingRegexWorker()
  })

  function scrollToCharacterTop(): void {
    nextTick(() => characterRoot.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  function openPage(page: Exclude<CharacterPage, 'overview'>): void {
    activePage.value = page
    selectedWorldEntryId.value = ''
    selectedRegexScriptId.value = ''
    selectedHelperScriptId.value = ''
    scrollToCharacterTop()
    if (page === 'greetings') nextTick(() => scrollToGreeting(0, false))
  }

  function closePage(): void {
    if (selectedWorldEntryId.value) {
      selectedWorldEntryId.value = ''
      return
    }
    if (selectedRegexScriptId.value) {
      selectedRegexScriptId.value = ''
      return
    }
    if (selectedHelperScriptId.value) {
      selectedHelperScriptId.value = ''
      return
    }
    activePage.value = 'overview'
    scrollToCharacterTop()
  }

  function scrollToGreeting(index: number, smooth = true): void {
    const track = greetingTrack.value
    const cards = track ? Array.from(track.children) : []
    if (!track || !cards.length) return
    const nextIndex = Math.min(cards.length - 1, Math.max(0, index))
    const card = cards[nextIndex] as HTMLElement
    const left =
      card.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft
    activeGreetingIndex.value = nextIndex
    track.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' })
  }

  function scrollGreetings(direction: -1 | 1): void {
    scrollToGreeting(activeGreetingIndex.value + direction)
  }

  function updateGreetingIndex(): void {
    const track = greetingTrack.value
    if (!track) return
    const center = track.scrollLeft + track.clientWidth / 2
    const trackLeft = track.getBoundingClientRect().left
    const cards = Array.from(track.children) as HTMLElement[]
    const closestIndex = cards.reduce((bestIndex, card, index) => {
      const cardCenter =
        card.getBoundingClientRect().left - trackLeft + track.scrollLeft + card.offsetWidth / 2
      const bestCard = cards[bestIndex]
      const bestCenter = bestCard
        ? bestCard.getBoundingClientRect().left -
          trackLeft +
          track.scrollLeft +
          bestCard.offsetWidth / 2
        : Number.POSITIVE_INFINITY
      return Math.abs(cardCenter - center) < Math.abs(bestCenter - center) ? index : bestIndex
    }, 0)
    activeGreetingIndex.value = closestIndex
  }

  function handleGreetingKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    scrollGreetings(event.key === 'ArrowLeft' ? -1 : 1)
  }

  function handleGreetingTouchStart(event: TouchEvent): void {
    const touch = event.touches[0]
    if (!touch) return
    greetingTouchStart = {
      x: touch.clientX,
      y: touch.clientY,
      index: activeGreetingIndex.value,
    }
  }

  function handleGreetingTouchEnd(event: TouchEvent): void {
    const touch = event.changedTouches[0]
    const start = greetingTouchStart
    greetingTouchStart = undefined
    if (!touch || !start) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 36 || Math.abs(deltaX) < Math.abs(deltaY) * 1.15) return
    scrollToGreeting(start.index + (deltaX < 0 ? 1 : -1))
  }

  function openGreetingPreview(index: number, event?: Event): void {
    if (!greetings.value.length) return
    greetingPreviewIndex.value = Math.min(greetings.value.length - 1, Math.max(0, index))
    const target = event?.currentTarget
    greetingPreviewTrigger = target instanceof HTMLElement ? target : undefined
  }

  function handleGreetingCardDoubleClick(index: number, event: MouseEvent): void {
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button, a, input, textarea, select, iframe, [contenteditable="true"]')
    ) {
      return
    }
    openGreetingPreview(index, event)
  }

  function handleGreetingPreviewClose(index: number): void {
    nextTick(() => scrollToGreeting(index, false))
    nextTick(() => greetingPreviewTrigger?.focus())
  }

  function helperScriptLocation(script: EmbeddedHelperScript): string {
    return `${script.folder ? `${script.folder} · ` : ''}${script.enabled ? '启用' : '停用'}`
  }

  const embeddedBook = computed(() => {
    const value = cardData.value?.character_book
    return isRecord(value) ? value : undefined
  })

  const embeddedBookName = computed(() => readString(embeddedBook.value?.name) || '角色内嵌世界书')

  const embeddedBookEntries = computed<EmbeddedWorldEntry[]>(() => {
    const entries = embeddedBook.value?.entries
    const values = Array.isArray(entries)
      ? entries
      : isRecord(entries)
        ? Object.values(entries)
        : []
    return values.filter(isRecord).map((entry, index) => {
      const keys = readStringArray(entry.keys ?? entry.key)
      return {
        id: readString(entry.uid ?? entry.id) || String(index),
        title: readString(entry.comment) || keys.join('、') || `世界书条目 ${index + 1}`,
        keys,
        content: readString(entry.content),
        enabled: entry.enabled !== false && entry.disable !== true,
      }
    })
  })

  const filteredEmbeddedBookEntries = computed(() => {
    const query = embeddedWorldQuery.value.trim().toLocaleLowerCase()
    if (!query) return embeddedBookEntries.value
    return embeddedBookEntries.value.filter((entry) =>
      [entry.title, entry.content, ...entry.keys].join('\n').toLocaleLowerCase().includes(query),
    )
  })

  const embeddedWorldPageCount = computed(() =>
    Math.max(1, Math.ceil(filteredEmbeddedBookEntries.value.length / PAGE_SIZE)),
  )

  const pagedEmbeddedBookEntries = computed(() => {
    const start = (embeddedWorldPage.value - 1) * PAGE_SIZE
    return filteredEmbeddedBookEntries.value.slice(start, start + PAGE_SIZE)
  })

  const selectedWorldEntry = computed(() =>
    embeddedBookEntries.value.find((entry) => entry.id === selectedWorldEntryId.value),
  )

  const embeddedRegexScripts = computed<EmbeddedRegexScript[]>(() => {
    const scripts = cardExtensions.value?.regex_scripts
    if (!Array.isArray(scripts)) return []
    return scripts.filter(isRecord).map((script, index) => {
      const find = readString(script.findRegex ?? script.find_regex)
      const replace = readString(script.replaceString ?? script.replace_string)
      const name = readString(script.scriptName ?? script.script_name) || `正则 ${index + 1}`
      const effect = summarizeRegexEffect(find, replace)
      return {
        id: readString(script.id) || String(index),
        overrideKey: characterRegexKey(script, index),
        name,
        find,
        replace,
        disabled: script.disabled === true,
        effect,
        previewDocument: buildRegexPreviewDocument(effect, name, replace, previewPolicy.value),
      }
    })
  })

  async function refreshReplacementSources(): Promise<void> {
    const generation = ++replacementGeneration
    const inspected = await Promise.all(
      props.boundResources.map(async (resource) => ({
        resource,
        content: await inspectCharacterReplacementResource(resource),
      })),
    )
    if (generation !== replacementGeneration) return
    worldBookReplacementSources.value = inspected.filter((item) => item.content.worldBook)
    greetingReplacementSources.value = inspected.filter((item) => item.content.greetings?.length)
  }

  async function refreshBoundRuntimeScripts(): Promise<void> {
    const generation = ++boundScriptGeneration
    const resources = props.boundResources.filter(
      (resource) => resource.type === RESOURCE_TYPE.SCRIPT,
    )
    const inspected = await Promise.all(
      resources.map(async (resource) => ({
        resource,
        scripts: await readTavernHelperScriptBlob(resource.originalBlob, resource.fileName, {
          source: 'bound',
          fallbackName: resource.name,
        }),
      })),
    )
    if (generation !== boundScriptGeneration) return
    boundRuntimeScripts.value = inspected.flatMap(({ resource, scripts }) =>
      scripts
        .filter((script) => script.enabled && script.content.trim())
        .map((script) => ({
          id: `${resource.id}:${script.id}`,
          source: 'bound' as const,
          name: script.name === resource.name ? resource.name : `${resource.name} · ${script.name}`,
          content: script.content,
          data: script.data,
        })),
    )
  }

  function updateReplacement(
    field: 'worldBookResourceId' | 'greetingResourceId',
    resourceId: string,
  ): void {
    const next: CharacterCardOverrides = {
      ...props.overrides,
      regexEnabled: props.overrides.regexEnabled ? { ...props.overrides.regexEnabled } : undefined,
    }
    if (resourceId) next[field] = resourceId
    else delete next[field]
    emit('update:overrides', next)
  }

  function originalRegexEnabled(overrideKey: string): boolean {
    const extensions = isRecord(sourceCardData.value?.extensions)
      ? sourceCardData.value.extensions
      : undefined
    const scripts = Array.isArray(extensions?.regex_scripts) ? extensions.regex_scripts : []
    const script = scripts.find(
      (value, index) => isRecord(value) && characterRegexKey(value, index) === overrideKey,
    )
    return !isRecord(script) || (script.disabled !== true && script.enabled !== false)
  }

  function setRegexEnabled(script: EmbeddedRegexScript, enabled: boolean): void {
    const regexEnabled = { ...(props.overrides.regexEnabled ?? {}) }
    if (enabled === originalRegexEnabled(script.overrideKey))
      delete regexEnabled[script.overrideKey]
    else regexEnabled[script.overrideKey] = enabled
    emit('update:overrides', {
      ...props.overrides,
      ...(Object.keys(regexEnabled).length ? { regexEnabled } : { regexEnabled: undefined }),
    })
  }

  const filteredEmbeddedRegexScripts = computed(() => {
    const query = embeddedRegexQuery.value.trim().toLocaleLowerCase()
    if (!query) return embeddedRegexScripts.value
    return embeddedRegexScripts.value.filter((script) =>
      [script.name, script.find, script.replace, script.effect.explanation]
        .join('\n')
        .toLocaleLowerCase()
        .includes(query),
    )
  })

  const embeddedRegexPageCount = computed(() =>
    Math.max(1, Math.ceil(filteredEmbeddedRegexScripts.value.length / PAGE_SIZE)),
  )

  const pagedEmbeddedRegexScripts = computed(() => {
    const start = (embeddedRegexPage.value - 1) * PAGE_SIZE
    return filteredEmbeddedRegexScripts.value.slice(start, start + PAGE_SIZE)
  })

  const selectedRegexScript = computed(() =>
    embeddedRegexScripts.value.find((script) => script.id === selectedRegexScriptId.value),
  )

  const embeddedHelperScripts = computed<EmbeddedHelperScript[]>(() => {
    return extractTavernHelperScripts(cardData.value, {
      source: 'character',
    })
  })

  const greetingRuntimeScripts = computed<PreviewRuntimeScript[]>(() => {
    const scripts = [
      ...embeddedHelperScripts.value
        .filter((script) => script.enabled && script.content.trim())
        .map((script) => ({
          id: script.id,
          source: 'character' as const,
          name: script.name,
          content: script.content,
          data: script.data,
        })),
      ...boundRuntimeScripts.value,
    ]
    const seen = new Set<string>()
    return scripts.filter((script) => {
      const key = `${script.id || script.name}\u0000${script.content}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

  const selectedHelperScript = computed(() =>
    embeddedHelperScripts.value.find((script) => script.id === selectedHelperScriptId.value),
  )

  const embeddedBookBadge = computed(() => `内嵌世界书 · ${embeddedBookEntries.value.length} 条`)

  const embeddedRegexBadge = computed(() => `内嵌正则 · ${embeddedRegexScripts.value.length} 条`)

  const embeddedHelperBadge = computed(
    () => `酒馆助手脚本 · ${embeddedHelperScripts.value.length} 个`,
  )

  const pageTitle = computed(() => {
    if (activePage.value === 'greetings') return '开场白'
    if (activePage.value === 'worldBook') return embeddedBookName.value
    if (activePage.value === 'regex') return '角色专属正则'
    if (activePage.value === 'helper') return '酒馆助手脚本'
    return '角色档案'
  })

  const pageCount = computed(() => {
    if (activePage.value === 'greetings') return `${greetings.value.length} 个版本`
    if (activePage.value === 'worldBook') return `${embeddedBookEntries.value.length} 个条目`
    if (activePage.value === 'regex') return `${embeddedRegexScripts.value.length} 条规则`
    if (activePage.value === 'helper') return `${embeddedHelperScripts.value.length} 个脚本`
    return ''
  })

  const sections = computed<CharacterSection[]>(() => {
    const data = cardData.value
    if (!data) return []

    return [
      { key: 'description', label: '角色描述', content: readString(data.description) },
      { key: 'personality', label: '性格设定', content: readString(data.personality) },
      { key: 'scenario', label: '场景设定', content: readString(data.scenario) },
      { key: 'mes_example', label: '示例对话', content: readString(data.mes_example) },
      {
        key: 'creator_notes',
        label: '创作者注释',
        content: readString(data.creator_notes) || readString(card.value?.creatorcomment),
      },
      { key: 'system_prompt', label: '系统提示', content: readString(data.system_prompt) },
      {
        key: 'post_history_instructions',
        label: '对话后提示',
        content: readString(data.post_history_instructions),
      },
    ].filter((section) => section.content)
  })

  watch(embeddedWorldQuery, () => {
    embeddedWorldPage.value = 1
    selectedWorldEntryId.value = ''
  })

  watch(embeddedRegexQuery, () => {
    embeddedRegexPage.value = 1
    selectedRegexScriptId.value = ''
  })

  watch(embeddedWorldPageCount, (count) => {
    if (embeddedWorldPage.value > count) embeddedWorldPage.value = count
  })

  watch(embeddedRegexPageCount, (count) => {
    if (embeddedRegexPage.value > count) embeddedRegexPage.value = count
  })

  watch(
    () => props.metadata,
    () => {
      greetingPreviewIndex.value = null
      activePage.value = 'overview'
      activeGreetingIndex.value = 0
      selectedWorldEntryId.value = ''
      selectedRegexScriptId.value = ''
      selectedHelperScriptId.value = ''
      embeddedWorldQuery.value = ''
      embeddedRegexQuery.value = ''
    },
  )

  watch(
    () => props.boundResources.map((resource) => `${resource.id}:${resource.updatedAt}`).join('|'),
    () => {
      void refreshReplacementSources()
      void refreshBoundRuntimeScripts()
    },
    { immediate: true },
  )

  watch(greetingPreviewIndex, (index) => {
    if (index !== null) activeGreetingIndex.value = index
  })
  return {
    cardData,
    activePage,
    creator,
    characterVersion,
    spec,
    worldBookReplacementSources,
    greetingReplacementSources,
    updateReplacement,
    greetings,
    openPage,
    embeddedBookEntries,
    embeddedBookName,
    embeddedBookBadge,
    embeddedRegexScripts,
    embeddedRegexBadge,
    embeddedHelperScripts,
    embeddedHelperBadge,
    sections,
    closePage,
    pageTitle,
    pageCount,
    activeGreetingIndex,
    greetingRegexStatus,
    greetingRegexState,
    greetingRegexStatusTitle,
    openGreetingPreview,
    scrollGreetings,
    updateGreetingIndex,
    handleGreetingKeydown,
    handleGreetingTouchStart,
    handleGreetingTouchEnd,
    handleGreetingCardDoubleClick,
    hasRichPreviewContent,
    greetingExcerpt,
    scrollToGreeting,
    selectedWorldEntry,
    selectedWorldEntryId,
    embeddedWorldQuery,
    pagedEmbeddedBookEntries,
    embeddedWorldPage,
    PAGE_SIZE,
    filteredEmbeddedBookEntries,
    embeddedWorldPageCount,
    selectedRegexScript,
    selectedRegexScriptId,
    setRegexEnabled,
    previewPolicy,
    hasBlockedRegexPreviewContent,
    embeddedRegexQuery,
    pagedEmbeddedRegexScripts,
    embeddedRegexPage,
    filteredEmbeddedRegexScripts,
    embeddedRegexPageCount,
    selectedHelperScript,
    selectedHelperScriptId,
    helperScriptLocation,
    greetingPreviewIndex,
    greetingRuntimeScripts,
    characterName,
    greetingRegexRules,
    handleGreetingPreviewClose,
  }
}
