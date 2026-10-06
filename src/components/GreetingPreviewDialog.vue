<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import FeatureBackButton from './FeatureBackButton.vue'
import RichContentPreview from './RichContentPreview.vue'
import type { PreviewRuntimeScript } from '../utils/RichContentPreview'
import type { CharacterGreetingRegexRule } from '../utils/CharacterGreetingRegex'

export interface GreetingPreviewItem {
  key: string
  label: string
  content: string
  description?: string
  group?: string
  theme?: string
}

const props = withDefaults(
  defineProps<{
    items: GreetingPreviewItem[]
    modelValue: number | null
    contextTitle?: string
    macroCharName?: string
    runtimeScripts?: PreviewRuntimeScript[]
    characterData?: Record<string, unknown>
    displayRegexRules?: CharacterGreetingRegexRule[]
    preloadResources?: boolean
  }>(),
  {
    contextTitle: '开场白',
    macroCharName: undefined,
    runtimeScripts: () => [],
    characterData: undefined,
    displayRegexRules: () => [],
    preloadResources: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
  close: [index: number]
}>()

const closeButton = ref<{ focus: () => void }>()
const stage = ref<HTMLElement>()
const contentFullscreen = ref(false)
let touchStart:
  | {
      x: number
      y: number
    }
  | undefined

const activeItem = computed(() => {
  const index = props.modelValue
  return index === null ? undefined : props.items[index]
})
const greetingContents = computed(() => props.items.map((item) => item.content))

function greetingContext(item: GreetingPreviewItem): string {
  return [item.group, item.theme].filter(Boolean).join(' · ') || 'OPENING MESSAGE'
}

function close(): void {
  const index = props.modelValue
  if (index === null) return
  contentFullscreen.value = false
  emit('update:modelValue', null)
  emit('close', index)
}

function enterContentFullscreen(): void {
  contentFullscreen.value = true
  nextTick(() => stage.value?.scrollTo?.({ top: 0, behavior: 'auto' }))
}

function exitContentFullscreen(): void {
  contentFullscreen.value = false
  nextTick(() => closeButton.value?.focus())
}

function move(direction: -1 | 1): void {
  const current = props.modelValue
  if (current === null) return
  emit('update:modelValue', Math.min(props.items.length - 1, Math.max(0, current + direction)))
}

function navigateToGreeting(target: number): void {
  if (!Number.isInteger(target) || target < 0 || target >= props.items.length) return
  emit('update:modelValue', target)
}

function handleTouchStart(event: TouchEvent): void {
  const touch = event.touches[0]
  if (!touch) return
  touchStart = { x: touch.clientX, y: touch.clientY }
}

function handleTouchEnd(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  const start = touchStart
  touchStart = undefined
  if (!touch || !start) return
  const deltaX = touch.clientX - start.x
  const deltaY = touch.clientY - start.y
  if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return
  move(deltaX < 0 ? 1 : -1)
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.modelValue === null) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (contentFullscreen.value) exitContentFullscreen()
    else close()
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    move(event.key === 'ArrowLeft' ? -1 : 1)
  }
}

watch(
  () => props.modelValue,
  (index, previousIndex) => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('greeting-preview-open', index !== null)
    }
    if (index !== null) {
      nextTick(() => {
        stage.value?.scrollTo?.({ top: 0, behavior: 'auto' })
        if (previousIndex === null) closeButton.value?.focus()
      })
    } else contentFullscreen.value = false
  },
  { immediate: true },
)

watch(
  () => props.items.length,
  (length) => {
    const index = props.modelValue
    if (index === null) return
    if (!length) emit('update:modelValue', null)
    else if (index >= length) emit('update:modelValue', length - 1)
  },
)

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', handleKeydown)
}

onUnmounted(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', handleKeydown)
  if (typeof document !== 'undefined') document.body.classList.remove('greeting-preview-open')
})
</script>

<template>
  <Teleport to="body">
    <Transition name="greeting-preview">
      <section
        v-if="activeItem && modelValue !== null"
        class="greeting-preview-overlay"
        :class="{ 'is-content-fullscreen': contentFullscreen }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`greeting-preview-title-${modelValue}`"
        @click.self="close"
      >
        <header class="greeting-preview-overlay__header">
          <FeatureBackButton ref="closeButton" label="返回开场白列表" @click="close" />
          <span>
            <strong :id="`greeting-preview-title-${modelValue}`">{{ contextTitle }}</strong>
          </span>
          <div class="greeting-preview-overlay__header-actions">
            <button
              type="button"
              aria-label="内容全屏"
              title="内容全屏"
              @click="enterContentFullscreen"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
              </svg>
            </button>
            <em>
              {{ String(modelValue + 1).padStart(2, '0') }} /
              {{ String(items.length).padStart(2, '0') }}
            </em>
          </div>
        </header>

        <button
          v-if="contentFullscreen"
          type="button"
          class="greeting-preview-overlay__exit-fullscreen"
          aria-label="退出开场白内容全屏"
          @click="exitContentFullscreen"
        >
          <span aria-hidden="true">×</span>
          退出全屏
        </button>

        <main
          ref="stage"
          class="greeting-preview-overlay__stage"
          @click.self="close"
          @touchstart.passive="handleTouchStart"
          @touchend.passive="handleTouchEnd"
        >
          <article>
            <div class="greeting-preview-overlay__reader">
              <header>
                <span>
                  <small>{{ greetingContext(activeItem) }}</small>
                  <h3>{{ activeItem.label }}</h3>
                </span>
                <em>{{ String(modelValue + 1).padStart(2, '0') }}</em>
              </header>
              <p v-if="activeItem.description" class="greeting-preview-overlay__description">
                {{ activeItem.description }}
              </p>
              <RichContentPreview
                :source="activeItem.content"
                :title="activeItem.label"
                :runtime-scripts="runtimeScripts"
                :macro-char-name="macroCharName"
                :greeting-contents="greetingContents"
                :greeting-index="modelValue"
                :character-data="characterData"
                :display-regex-rules="displayRegexRules"
                :preload-resources="preloadResources"
                source-kind="openingArchive"
                render-shell="content"
                immersive
                bare
                @navigate-greeting="navigateToGreeting"
              />
            </div>
          </article>
        </main>

        <footer class="greeting-preview-overlay__footer">
          <button type="button" :disabled="modelValue === 0" @click="move(-1)">
            <span aria-hidden="true">←</span>
            上一条
          </button>
          <span>{{ activeItem.label }}</span>
          <button type="button" :disabled="modelValue === items.length - 1" @click="move(1)">
            下一条
            <span aria-hidden="true">→</span>
          </button>
        </footer>
      </section>
    </Transition>
  </Teleport>
</template>
