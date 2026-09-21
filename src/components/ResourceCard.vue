<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useLoadedObjectUrl } from '../composables/UseLoadedObjectUrl'
import { useResourceThumbnail } from '../composables/UseResourceThumbnail'

import {
  getRelatedResourceIds,
  RESOURCE_TYPE,
  RESOURCE_TYPE_LABELS,
  type Category,
  type ResourceSummary,
} from '../types/Resource'
import { isRecord } from '../utils/UnknownValue'
import { resourceAuthorLabel } from '../utils/ResourceAuthors'

const props = defineProps<{
  resource: ResourceSummary
  categories?: Category[]
  selectable?: boolean
  selected?: boolean
  blurThumbnails?: boolean
}>()
const emit = defineEmits<{
  favorite: [resource: ResourceSummary, favorite: boolean]
  edit: [resource: ResourceSummary]
  select: [resource: ResourceSummary]
  delete: [resource: ResourceSummary]
}>()

function safePreviewColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return typeof CSS !== 'undefined' && CSS.supports('color', value) ? value : fallback
}

// blurThumbnails 为 true（默认）时，缩略图默认模糊（isRevealed = false）；
// blurThumbnails 为 false 时，缩略图默认清晰（isRevealed = true）。
const isRevealed = ref(props.blurThumbnails === false)
const thumbnailBlob = useResourceThumbnail(() => props.resource)
const { previewUrl, replacePreview, confirmPreviewLoaded } = useLoadedObjectUrl()
const previewRetried = ref(false)
let previewIdentity = ''
const isJsonCharacterCover = computed(
  () => !previewUrl.value && props.resource.type === RESOURCE_TYPE.CHARACTER_CARD,
)
const previewKindLabel = computed(() =>
  props.resource.type === RESOURCE_TYPE.USER_PERSONA ? '用户头像封面' : '角色卡原图',
)
const isCompact = computed(
  () =>
    props.resource.type === RESOURCE_TYPE.POCKET_PHONE ||
    (!previewUrl.value && !isJsonCharacterCover.value),
)
const beautificationPreviewStyle = computed(() => {
  const preview = props.resource.metadata.beautificationPreview
  const colors = isRecord(preview) && Array.isArray(preview.colors) ? preview.colors : []
  return {
    '--beauty-canvas': safePreviewColor(colors[0], '#17231f'),
    '--beauty-user': safePreviewColor(colors[1], '#315347'),
    '--beauty-bot': safePreviewColor(colors[2], '#25352f'),
    '--beauty-text': safePreviewColor(colors[3], '#e8f0eb'),
    '--beauty-accent': safePreviewColor(colors[4], '#9bc9b7'),
  }
})

// 设置中切换模糊开关时同步更新已渲染卡片的显示状态。
watch(
  () => props.blurThumbnails,
  (enabled) => {
    isRevealed.value = enabled === false
  },
)

function retryPreview(): void {
  const blob = thumbnailBlob.value
  if (!blob || previewRetried.value) return
  previewRetried.value = true
  // iOS Safari 解码失败后立即复用同一帧内新建的地址仍会失败，跨帧重建才有效
  window.setTimeout(() => {
    if (thumbnailBlob.value === blob) replacePreview(URL.createObjectURL(blob))
  }, 120)
}

watch(
  () => ({
    blob: thumbnailBlob.value,
    type: props.resource.type,
    mimeType: props.resource.mimeType,
    fileName: props.resource.fileName,
    phoneIconUrl: props.resource.metadata.phoneIconUrl,
  }),
  ({ blob, type, mimeType, fileName, phoneIconUrl }) => {
    if (
      type === RESOURCE_TYPE.POCKET_PHONE &&
      typeof phoneIconUrl === 'string' &&
      /^https:\/\//.test(phoneIconUrl)
    ) {
      previewIdentity = phoneIconUrl
      replacePreview(phoneIconUrl)
      return
    }
    isRevealed.value = props.blurThumbnails === false
    const isPng = mimeType === 'image/png' || /\.png$/i.test(fileName)
    const hasVisualCover =
      Boolean(blob) &&
      ((type === RESOURCE_TYPE.CHARACTER_CARD && isPng) ||
        ([RESOURCE_TYPE.USER_PERSONA, RESOURCE_TYPE.POCKET_PHONE].some((item) => item === type) &&
          Boolean(blob?.type.startsWith('image/'))))
    const nextIdentity =
      blob && hasVisualCover
        ? `${props.resource.id}:${props.resource.contentHash}:${blob.size}:${blob.type}`
        : ''
    if (nextIdentity === previewIdentity && Boolean(previewUrl.value) === Boolean(nextIdentity)) {
      return
    }
    previewIdentity = nextIdentity
    previewRetried.value = false
    if (blob && hasVisualCover) {
      replacePreview(URL.createObjectURL(blob))
    } else replacePreview('')
  },
  { immediate: true },
)
</script>

<template>
  <article
    class="resource-card"
    :class="{
      'resource-card--compact': isCompact,
      'resource-card--character-name': isJsonCharacterCover,
      'resource-card--selectable': selectable,
      'resource-card--selected': selected,
    }"
  >
    <button
      v-if="selectable"
      class="resource-card__selector"
      :class="{ 'resource-card__selector--active': selected }"
      type="button"
      :aria-label="selected ? `取消勾选 ${resource.name}` : `勾选 ${resource.name}`"
      @click="emit('select', resource)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg>
    </button>
    <button
      v-if="previewUrl && resource.type !== RESOURCE_TYPE.POCKET_PHONE"
      class="resource-card__preview"
      :class="{ 'resource-card__preview--revealed': isRevealed }"
      type="button"
      :aria-label="
        selectable
          ? selected
            ? `取消选择 ${resource.name}`
            : `选择 ${resource.name}`
          : isRevealed
            ? `隐藏 ${resource.name} ${previewKindLabel}`
            : `查看 ${resource.name} ${previewKindLabel}`
      "
      @click="selectable ? emit('select', resource) : (isRevealed = !isRevealed)"
    >
      <img
        class="resource-card__image"
        :class="{ 'resource-card__image--revealed': isRevealed }"
        :src="previewUrl"
        :alt="resource.name"
        loading="lazy"
        decoding="async"
        @load="confirmPreviewLoaded"
        @error="retryPreview"
      />
      <span class="resource-card__privacy">{{ isRevealed ? '再次点击隐藏' : '点击查看原图' }}</span>
    </button>
    <button
      v-else-if="isJsonCharacterCover"
      class="resource-card__name-cover"
      type="button"
      :aria-label="
        selectable
          ? selected
            ? `取消选择 ${resource.name}`
            : `选择 ${resource.name}`
          : `查看 ${resource.name} 角色档案`
      "
      @click="selectable ? emit('select', resource) : emit('edit', resource)"
    >
      <span class="resource-card__name-cover-type">JSON CHARACTER</span>
      <strong :title="resource.name">{{ resource.name }}</strong>
      <small>无图片角色卡 · 查看完整档案 <i>→</i></small>
    </button>
    <button
      v-else-if="resource.type === RESOURCE_TYPE.BEAUTIFICATION"
      class="resource-card__beauty-preview"
      type="button"
      :style="beautificationPreviewStyle"
      :aria-label="selectable ? `选择 ${resource.name}` : `预览 ${resource.name} 美化详情`"
      @click="selectable ? emit('select', resource) : emit('edit', resource)"
    >
      <span class="resource-card__beauty-label">THEME PROOF</span>
      <i class="resource-card__beauty-message resource-card__beauty-message--user"></i>
      <i class="resource-card__beauty-message resource-card__beauty-message--bot"></i>
      <small>打开隔离预览 <b>→</b></small>
    </button>

    <div class="resource-card__body">
      <div class="resource-card__eyebrow">
        <span>{{ RESOURCE_TYPE_LABELS[resource.type] }}</span>
        <span>{{ (resource.fileSize / 1024).toFixed(resource.fileSize > 10240 ? 0 : 1) }} KB</span>
      </div>

      <button
        v-if="isCompact"
        class="resource-card__compact-title"
        type="button"
        :aria-label="
          selectable
            ? selected
              ? `取消选择 ${resource.name}`
              : `选择 ${resource.name}`
            : `查看 ${resource.name} 详情`
        "
        @click="selectable ? emit('select', resource) : emit('edit', resource)"
      >
        <img
          v-if="previewUrl && resource.type === RESOURCE_TYPE.POCKET_PHONE"
          class="resource-card__phone-icon"
          referrerpolicy="no-referrer"
          :src="previewUrl"
          alt=""
          @load="confirmPreviewLoaded"
        />
        <span class="resource-card__title" :title="resource.name">{{ resource.name }}</span>
        <small>查看详情 <i>→</i></small>
      </button>
      <h2 v-else-if="previewUrl" class="resource-card__title" :title="resource.name">
        {{ resource.name }}
      </h2>
      <p v-if="isCompact && resource.description" class="resource-card__description">
        {{ resource.description }}
      </p>
      <p class="resource-card__file" :title="resource.fileName">{{ resource.fileName }}</p>
      <p
        v-if="resourceAuthorLabel(resource)"
        class="resource-card__file"
        :title="resourceAuthorLabel(resource)"
      >
        {{ resourceAuthorLabel(resource) }}
      </p>

      <div
        v-if="categories?.length || resource.tags.length || getRelatedResourceIds(resource).length"
        class="resource-card__metadata"
      >
        <span v-for="category in categories" :key="category.id" class="resource-card__category">
          <i :style="{ backgroundColor: category.color }"></i>{{ category.name }}
        </span>
        <span v-for="tag in resource.tags.slice(0, 2)" :key="tag" class="resource-card__tag">
          {{ tag }}
        </span>
        <span v-if="resource.tags.length > 2" class="resource-card__tag">
          +{{ resource.tags.length - 2 }}
        </span>
        <span v-if="getRelatedResourceIds(resource).length" class="resource-card__relation">
          关联 {{ getRelatedResourceIds(resource).length }}
        </span>
      </div>

      <div v-if="!selectable" class="resource-card__actions">
        <button
          class="icon-button"
          type="button"
          aria-label="查看并编辑资源详情"
          @click="emit('edit', resource)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-10h.01" />
          </svg>
        </button>
        <button
          class="icon-button"
          :class="{ 'icon-button--active': resource.favorite }"
          type="button"
          :aria-label="resource.favorite ? '取消收藏' : '收藏'"
          @click="emit('favorite', resource, !resource.favorite)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z"
            />
          </svg>
        </button>
        <button
          class="icon-button icon-button--danger"
          type="button"
          aria-label="删除资源"
          @click="emit('delete', resource)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
          </svg>
        </button>
      </div>
    </div>
  </article>
</template>
