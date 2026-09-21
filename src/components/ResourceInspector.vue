<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readAuthorNote, readParsedAuthor } from '../utils/ResourceAuthors'

import { useLoadedObjectUrl } from '../composables/UseLoadedObjectUrl'
import { useResourceThumbnail } from '../composables/UseResourceThumbnail'

import {
  RESOURCE_TYPE,
  RESOURCE_TYPE_LABELS,
  type Category,
  type ResourceSummary,
} from '../types/Resource'

const props = defineProps<{
  resource?: ResourceSummary
  categories?: Category[]
  relatedResources?: ResourceSummary[]
}>()

const emit = defineEmits<{
  edit: [resource: ResourceSummary]
  favorite: [resource: ResourceSummary, favorite: boolean]
  download: [resource: ResourceSummary]
  'copy-link': [resource: ResourceSummary]
}>()

const { previewUrl, replacePreview, confirmPreviewLoaded } = useLoadedObjectUrl()
const thumbnailBlob = useResourceThumbnail(() => props.resource)
let previewIdentity = ''
const isRevealed = ref(false)
const hasPngPreview = computed(() => Boolean(previewUrl.value))

watch(
  () => ({
    blob: thumbnailBlob.value,
    id: props.resource?.id,
    contentHash: props.resource?.contentHash,
    type: props.resource?.type,
    mimeType: props.resource?.mimeType,
    fileName: props.resource?.fileName,
  }),
  ({ blob, id, contentHash, type, mimeType, fileName }) => {
    isRevealed.value = false
    const isPng = mimeType === 'image/png' || /\.png$/i.test(fileName ?? '')
    const isImage = blob && type === RESOURCE_TYPE.CHARACTER_CARD && isPng
    const nextIdentity = isImage ? `${id}:${contentHash}:${blob.size}:${blob.type}` : ''
    if (nextIdentity === previewIdentity && Boolean(previewUrl.value) === Boolean(nextIdentity))
      return
    previewIdentity = nextIdentity
    replacePreview(isImage ? URL.createObjectURL(blob) : '')
  },
  { immediate: true },
)

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <aside class="resource-inspector" aria-live="polite">
    <div v-if="!resource" class="resource-inspector__empty">
      <span class="resource-inspector__folio" aria-hidden="true"></span>
      <h2>选择一项资源</h2>
      <p>在左侧列表中选择资源，这里会显示文件夹、标签和关联内容。</p>
    </div>

    <template v-else>
      <header class="resource-inspector__header">
        <div>
          <h2>{{ resource.name }}</h2>
          <p>{{ resource.fileName }}</p>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="编辑完整详情"
          @click="emit('edit', resource)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4" />
          </svg>
        </button>
      </header>

      <button
        v-if="hasPngPreview"
        class="resource-inspector__preview"
        type="button"
        :aria-label="isRevealed ? '隐藏角色卡原图' : '显示角色卡原图'"
        @click="isRevealed = !isRevealed"
      >
        <img
          :class="{ 'resource-inspector__image--revealed': isRevealed }"
          :src="previewUrl"
          :alt="resource.name"
          @load="confirmPreviewLoaded"
        />
        <span>{{ isRevealed ? '点击隐藏' : '点击查看原图' }}</span>
      </button>

      <div v-else class="resource-inspector__record">
        <strong>{{ resource.name }}</strong>
        <span>{{ RESOURCE_TYPE_LABELS[resource.type] }}</span>
      </div>

      <p v-if="resource.description" class="resource-inspector__description">
        {{ resource.description }}
      </p>

      <dl class="resource-inspector__facts">
        <div>
          <dt>解析作者</dt>
          <dd>{{ readParsedAuthor(resource) || '未知作者' }}</dd>
        </div>
        <div v-if="readAuthorNote(resource)">
          <dt>备注作者</dt>
          <dd>{{ readAuthorNote(resource) }}</dd>
        </div>
        <div>
          <dt>大小</dt>
          <dd>{{ formatSize(resource.fileSize) }}</dd>
        </div>
        <div>
          <dt>整理时间</dt>
          <dd>{{ new Date(resource.updatedAt).toLocaleString('zh-CN') }}</dd>
        </div>
        <div>
          <dt>文件夹</dt>
          <dd>
            {{ categories?.length ? categories.map((item) => item.name).join('、') : '未归档' }}
          </dd>
        </div>
      </dl>

      <section v-if="resource.tags.length" class="resource-inspector__section">
        <h3>标签</h3>
        <div class="resource-inspector__chips">
          <span v-for="tag in resource.tags" :key="tag">#{{ tag }}</span>
        </div>
      </section>

      <section class="resource-inspector__section">
        <h3>
          关联资源 <small>{{ relatedResources?.length ?? 0 }}</small>
        </h3>
        <div v-if="relatedResources?.length" class="resource-inspector__relations">
          <button
            v-for="item in relatedResources.slice(0, 5)"
            :key="item.id"
            type="button"
            @click="emit('edit', item)"
          >
            <span class="resource-inspector__relation-name">{{ item.name }}</span>
            <small class="resource-inspector__relation-type">
              {{ RESOURCE_TYPE_LABELS[item.type] }}
            </small>
          </button>
        </div>
        <p v-else class="resource-inspector__muted">暂未绑定其他资源</p>
      </section>

      <footer class="resource-inspector__actions">
        <button
          class="button button--quiet"
          type="button"
          @click="emit('favorite', resource, !resource.favorite)"
        >
          {{ resource.favorite ? '取消收藏' : '加入收藏' }}
        </button>
        <button class="button button--quiet" type="button" @click="emit('download', resource)">
          下载文件
        </button>
        <button class="button button--quiet" type="button" @click="emit('copy-link', resource)">
          复制本机链接
        </button>
        <button class="button button--primary" type="button" @click="emit('edit', resource)">
          完整详情
        </button>
      </footer>
    </template>
  </aside>
</template>
