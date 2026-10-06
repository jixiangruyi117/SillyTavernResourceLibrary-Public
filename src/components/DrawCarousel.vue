<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { resourceService } from '../core/AppContainer'
import type { CharacterDrawRecord } from '../services/CharacterDrawService'
import type { ResourceSummary } from '../types/Resource'

const props = defineProps<{
  resources: ResourceSummary[]
  previewUrls: Map<string, string>
  records: Record<string, CharacterDrawRecord>
  revealCount: number
  showNames: boolean
}>()

const emit = defineEmits<{
  close: []
  open: [resource: ResourceSummary, index: number]
  skip: []
}>()

const activeIndex = ref(0)
const filmstrip = ref<HTMLElement>()
const doneButton = ref<HTMLButtonElement>()
const fullPreviewUrl = ref('')
const isTurningCard = ref(false)
let fullPreviewGeneration = 0
let revealAnimationFrame = 0

const activeResource = computed(() => props.resources[activeIndex.value])
const activeIsRevealed = computed(() => activeIndex.value < props.revealCount)
const displayIsRevealed = computed(() => activeIsRevealed.value && !isTurningCard.value)
const activeImageUrl = computed(
  () => fullPreviewUrl.value || props.previewUrls.get(activeResource.value?.id ?? '') || '',
)

function occurrenceNumber(index: number): number {
  const resourceId = props.resources[index]?.id
  if (!resourceId) return 0
  return props.resources.slice(0, index + 1).filter((resource) => resource.id === resourceId).length
}

function occurrenceTotal(resourceId: string): number {
  return props.resources.filter((resource) => resource.id === resourceId).length
}

function statusFor(index: number): 'new' | 'duplicate' {
  const resource = props.resources[index]
  if (!resource) return 'duplicate'
  const finalCount = props.records[resource.id]?.count ?? occurrenceTotal(resource.id)
  const countBeforeThisDraw = Math.max(0, finalCount - occurrenceTotal(resource.id))
  return countBeforeThisDraw === 0 && occurrenceNumber(index) === 1 ? 'new' : 'duplicate'
}

function statusLabel(index: number): string {
  return statusFor(index) === 'new' ? '新获得' : '重复获得'
}

function scrollActiveThumbnail(index: number): void {
  void nextTick(() => {
    const target = filmstrip.value?.querySelector<HTMLElement>(`[data-draw-index="${index}"]`)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  })
}

function selectResult(index: number): void {
  if (index < 0 || index >= props.resources.length) return
  if (revealAnimationFrame) window.cancelAnimationFrame(revealAnimationFrame)
  revealAnimationFrame = 0
  isTurningCard.value = false
  activeIndex.value = index
  scrollActiveThumbnail(index)
}

function openActiveResult(): void {
  if (!activeResource.value) return
  if (!displayIsRevealed.value) {
    emit('skip')
    return
  }
  emit('open', activeResource.value, activeIndex.value)
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target !== event.currentTarget) return
  if (props.revealCount < props.resources.length) emit('skip')
  else emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') {
    selectResult(activeIndex.value - 1)
    event.preventDefault()
  } else if (event.key === 'ArrowRight') {
    selectResult(activeIndex.value + 1)
    event.preventDefault()
  }
}

async function loadFullPreview(resource: ResourceSummary | undefined): Promise<void> {
  const generation = ++fullPreviewGeneration
  const previousUrl = fullPreviewUrl.value
  fullPreviewUrl.value = ''
  if (previousUrl) URL.revokeObjectURL(previousUrl)
  if (!resource) return

  try {
    const fullResource = await resourceService.get(resource.id)
    if (generation !== fullPreviewGeneration) return
    const blob = fullResource?.originalBlob
    if (!blob || (!blob.type.startsWith('image/') && !/\.png$/i.test(resource.fileName))) return
    fullPreviewUrl.value = URL.createObjectURL(blob)
  } catch {
    // 缩略图仍可作为主卡后备图，读取原图失败不阻断十连浏览。
  }
}

watch(
  () => activeResource.value,
  (resource) => void loadFullPreview(resource),
  { immediate: true },
)

watch(
  () => props.revealCount,
  async (count, previousCount) => {
    if (count <= previousCount || count < 1) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || count - previousCount > 1) {
      isTurningCard.value = false
      return
    }

    activeIndex.value = Math.min(count - 1, props.resources.length - 1)
    isTurningCard.value = true
    scrollActiveThumbnail(activeIndex.value)
    await nextTick()
    if (revealAnimationFrame) window.cancelAnimationFrame(revealAnimationFrame)
    revealAnimationFrame = window.requestAnimationFrame(() => {
      revealAnimationFrame = window.requestAnimationFrame(() => {
        isTurningCard.value = false
        revealAnimationFrame = 0
      })
    })
  },
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  doneButton.value?.focus({ preventScroll: true })
  scrollActiveThumbnail(0)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (revealAnimationFrame) window.cancelAnimationFrame(revealAnimationFrame)
  fullPreviewGeneration += 1
  if (fullPreviewUrl.value) URL.revokeObjectURL(fullPreviewUrl.value)
})
</script>

<template>
  <section
    class="draw-carousel"
    role="dialog"
    aria-modal="true"
    aria-label="十连抽结果"
    @click="handleBackdropClick"
  >
    <header class="draw-carousel__header">
      <span aria-hidden="true"></span>
      <div>
        <small>TEN ENCOUNTERS</small>
        <h2>十连抽结果</h2>
      </div>
      <button
        ref="doneButton"
        type="button"
        class="draw-carousel__done"
        @click.stop="emit('close')"
      >
        完成
      </button>
    </header>

    <main v-if="activeResource" class="draw-carousel__stage">
      <p class="draw-carousel__counter">
        <span>{{ String(activeIndex + 1).padStart(2, '0') }}</span>
        <i></i>
        {{ String(resources.length).padStart(2, '0') }}
      </p>

      <button
        type="button"
        class="draw-carousel__main-card"
        :class="{
          'draw-carousel__main-card--revealed': displayIsRevealed,
          'draw-carousel__main-card--turning': isTurningCard,
        }"
        :aria-label="
          displayIsRevealed
            ? `查看角色 ${activeResource.name} 的详情`
            : `第 ${activeIndex + 1} 张卡牌尚未翻开`
        "
        @click.stop="openActiveResult"
      >
        <span :key="`${activeResource.id}-${activeIndex}`" class="draw-carousel__main-inner">
          <span class="draw-carousel__back" aria-hidden="true">
            <i></i>
            <strong>SRL</strong>
          </span>
          <span class="draw-carousel__front">
            <img
              v-if="activeImageUrl"
              :src="activeImageUrl"
              :alt="`${activeResource.name}角色卡`"
              decoding="async"
            />
            <span v-else class="draw-carousel__placeholder">
              {{ activeResource.name.trim().slice(0, 2) || 'SR' }}
            </span>
          </span>
        </span>
      </button>

      <div class="draw-carousel__identity">
        <span
          v-if="displayIsRevealed"
          class="draw-carousel__status"
          :class="`draw-carousel__status--${statusFor(activeIndex)}`"
        >
          {{ statusLabel(activeIndex) }}
        </span>
        <strong v-if="!displayIsRevealed">第 {{ activeIndex + 1 }} 张档案</strong>
        <strong v-else-if="showNames">{{ activeResource.name || '未命名角色' }}</strong>
        <strong v-else>角色档案</strong>
        <small v-if="displayIsRevealed">
          角色卡
          <span v-if="showNames && activeResource.tags.length">
            · {{ activeResource.tags.slice(0, 2).join(' · ') }}
          </span>
        </small>
        <small v-else>即将揭晓</small>
      </div>
    </main>

    <nav ref="filmstrip" class="draw-carousel__filmstrip" aria-label="十连结果缩略图">
      <button
        v-for="(resource, index) in resources"
        :key="`${resource.id}-${index}`"
        type="button"
        :data-draw-index="index"
        :class="{
          'is-active': index === activeIndex,
          'is-revealed': index < revealCount,
        }"
        :aria-label="
          index < revealCount
            ? `查看第 ${index + 1} 张结果${showNames ? `：${resource.name}` : ''}`
            : `第 ${index + 1} 张结果尚未揭晓`
        "
        :aria-current="index === activeIndex ? 'true' : undefined"
        @click.stop="selectResult(index)"
      >
        <span>{{ String(index + 1).padStart(2, '0') }}</span>
        <img
          v-if="index < revealCount && previewUrls.get(resource.id)"
          :src="previewUrls.get(resource.id)"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <i v-else>{{ index < revealCount ? resource.name.trim().slice(0, 1) || 'S' : 'SR' }}</i>
        <em :class="`draw-carousel__thumbnail-status--${statusFor(index)}`" aria-hidden="true"></em>
      </button>
    </nav>

    <footer class="draw-carousel__controls">
      <button
        type="button"
        :disabled="activeIndex === 0"
        @click.stop="selectResult(activeIndex - 1)"
      >
        上一张
      </button>
      <button type="button" class="draw-carousel__primary" @click.stop="openActiveResult">
        {{ displayIsRevealed ? '查看详情' : '立即揭晓' }}
      </button>
      <button
        type="button"
        :disabled="activeIndex === resources.length - 1"
        @click.stop="selectResult(activeIndex + 1)"
      >
        下一张
      </button>
    </footer>

    <p v-if="revealCount < resources.length" class="draw-carousel__hint">
      正在揭晓 {{ Math.min(revealCount + 1, resources.length) }} / {{ resources.length }} ·
      轻触空白处跳过
    </p>
  </section>
</template>
