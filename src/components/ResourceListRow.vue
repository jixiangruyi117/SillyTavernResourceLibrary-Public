<script setup lang="ts">
import { computed, watch } from 'vue'
import { resourceAuthorLabel } from '../utils/ResourceAuthors'

import { useLoadedObjectUrl } from '../composables/UseLoadedObjectUrl'
import { useResourceThumbnail } from '../composables/UseResourceThumbnail'

import {
  getRelatedResourceIds,
  RESOURCE_TYPE,
  RESOURCE_TYPE_LABELS,
  type Category,
  type ResourceSummary,
} from '../types/Resource'

const props = defineProps<{
  resource: ResourceSummary
  categories?: Category[]
  selectable?: boolean
  selected?: boolean
  active?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  favorite: [resource: ResourceSummary, favorite: boolean]
  open: [resource: ResourceSummary]
  select: [resource: ResourceSummary]
  delete: [resource: ResourceSummary]
}>()

const { previewUrl, replacePreview, confirmPreviewLoaded } = useLoadedObjectUrl()
const thumbnailBlob = useResourceThumbnail(() => props.resource)
let previewIdentity = ''
const initials = computed(() => props.resource.name.trim().slice(0, 2) || 'SR')
const visibleTagLimit = computed(() => (props.compact ? 1 : 2))
const relationCount = computed(() => getRelatedResourceIds(props.resource).length)

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
    const isImage =
      blob &&
      ((type === RESOURCE_TYPE.CHARACTER_CARD &&
        (mimeType === 'image/png' || /\.png$/i.test(fileName))) ||
        ([RESOURCE_TYPE.USER_PERSONA, RESOURCE_TYPE.POCKET_PHONE].some((item) => item === type) &&
          blob.type.startsWith('image/')))
    const nextIdentity = isImage
      ? `${props.resource.id}:${props.resource.contentHash}:${blob.size}:${blob.type}`
      : ''
    if (nextIdentity === previewIdentity && Boolean(previewUrl.value) === Boolean(nextIdentity))
      return
    previewIdentity = nextIdentity
    replacePreview(isImage ? URL.createObjectURL(blob) : '')
  },
  { immediate: true },
)

function handlePrimaryAction(): void {
  if (props.selectable) emit('select', props.resource)
  else emit('open', props.resource)
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes > 10240 ? 0 : 1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <article
    class="resource-row"
    :class="{
      'resource-row--active': active,
      'resource-row--selected': selected,
      'resource-row--compact': compact,
    }"
  >
    <button
      v-if="selectable"
      class="resource-row__selector"
      :class="{ 'resource-row__selector--active': selected }"
      type="button"
      :aria-label="selected ? `取消勾选 ${resource.name}` : `勾选 ${resource.name}`"
      @click="emit('select', resource)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg>
    </button>

    <button class="resource-row__identity" type="button" @click="handlePrimaryAction">
      <span class="resource-row__thumb" :class="{ 'resource-row__thumb--text': !previewUrl }">
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt=""
          loading="lazy"
          decoding="async"
          @load="confirmPreviewLoaded"
        />
        <span v-else>{{ initials }}</span>
      </span>
      <span class="resource-row__name-block">
        <strong :title="resource.name">{{ resource.name }}</strong>
        <small :title="resource.fileName">{{ resource.fileName }}</small>
        <small v-if="resourceAuthorLabel(resource)" :title="resourceAuthorLabel(resource)">{{
          resourceAuthorLabel(resource)
        }}</small>
      </span>
    </button>

    <span class="resource-row__type">{{ RESOURCE_TYPE_LABELS[resource.type] }}</span>

    <span class="resource-row__folders" :title="categories?.map((item) => item.name).join('、')">
      <i v-if="categories?.length" :style="{ backgroundColor: categories[0]?.color }"></i>
      {{ categories?.length ? categories.map((item) => item.name).join('、') : '未归档' }}
    </span>

    <span class="resource-row__tags">
      <span v-for="tag in resource.tags.slice(0, visibleTagLimit)" :key="tag">#{{ tag }}</span>
      <small v-if="resource.tags.length > visibleTagLimit">
        +{{ resource.tags.length - visibleTagLimit }}
      </small>
      <small v-if="relationCount">关联 {{ relationCount }}</small>
    </span>

    <span class="resource-row__size">{{ formatSize(resource.fileSize) }}</span>
    <time class="resource-row__time" :datetime="new Date(resource.updatedAt).toISOString()">
      {{ new Date(resource.updatedAt).toLocaleDateString('zh-CN') }}
    </time>

    <span v-if="!selectable" class="resource-row__actions">
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
        class="icon-button"
        type="button"
        aria-label="查看资源详情"
        @click="emit('open', resource)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
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
    </span>
  </article>
</template>
