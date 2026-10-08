<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import { useTransientStatus } from '../composables/UseTransientStatus'
import { communitySourceService } from '../core/CommunitySourceRuntime'
import { resourceService } from '../core/AppContainer'
import type { CommunitySource, CommunitySourceMessage } from '../types/CommunitySource'
import type { ResourceListSummary } from '../types/Resource'
import { isResourceGalleryImage } from '../types/ResourceGallery'
import ResourcePicker from './ResourcePicker.vue'

const props = withDefaults(
  defineProps<{ contextResourceId?: string; hideWhenEmpty?: boolean; pageView?: boolean }>(),
  {
    contextResourceId: undefined,
    hideWhenEmpty: false,
    pageView: false,
  },
)

type PendingView = { source: CommunitySource; messages: CommunitySourceMessage[] }

const DISPLAY_LIMIT = 30
const pending = ref<PendingView[]>([])
const resources = ref<ResourceListSummary[]>([])
const loading = ref(false)
const loadError = ref('')
const { statusMessage, showTransientStatus } = useTransientStatus()
const expandedSourceId = ref('')
const bindingSourceId = ref('')
const selectedResourceId = ref('')
const bindingResources = ref<ResourceListSummary[]>([])
const resourceMatchBadges = ref<Record<string, Array<'作' | '名'>>>({})
const hasMore = ref(false)
const busySourceId = ref('')
let resourceRevision = 0
let reloadRequested = false
let disposed = false

const contextResource = computed(() =>
  props.contextResourceId
    ? resources.value.find((resource) => resource.id === props.contextResourceId)
    : undefined,
)

function updateResources(summaries: ResourceListSummary[]): void {
  resources.value = summaries.filter((resource) => !isResourceGalleryImage(resource))
  if (!resources.value.some((resource) => resource.id === selectedResourceId.value))
    selectedResourceId.value = ''
  if (bindingSourceId.value) {
    const view = pending.value.find((item) => item.source.id === bindingSourceId.value)
    if (view) void prepareBindingResources(view)
  }
}

function handleResourcesChanged(event: Event): void {
  const summaries = (event as CustomEvent<ResourceListSummary[]>).detail
  if (Array.isArray(summaries)) {
    resourceRevision += 1
    updateResources(summaries)
  }
}

async function load(): Promise<void> {
  if (disposed) return
  if (loading.value) {
    reloadRequested = true
    return
  }
  const revision = resourceRevision
  loading.value = true
  loadError.value = ''
  try {
    const summaries = await resourceService.listResourceListSummaries()
    if (disposed) return
    const repaired = await communitySourceService.repairInvalidResourceBindings(summaries)
    const views = await communitySourceService.listPendingSources(DISPLAY_LIMIT + 1)
    if (disposed) return
    if (repaired) showTransientStatus(`已解除 ${repaired} 条无效关联，可在待整理中重新选择资源。`)
    hasMore.value = views.length > DISPLAY_LIMIT
    pending.value = views.slice(0, DISPLAY_LIMIT)
    if (
      bindingSourceId.value &&
      !pending.value.some((view) => view.source.id === bindingSourceId.value)
    ) {
      bindingSourceId.value = ''
      bindingResources.value = []
      resourceMatchBadges.value = {}
      selectedResourceId.value = ''
    }
    if (revision === resourceRevision) updateResources(summaries)
  } catch (error) {
    if (!disposed) loadError.value = error instanceof Error ? error.message : '无法读取待整理来源'
  } finally {
    loading.value = false
    if (reloadRequested && !disposed) {
      reloadRequested = false
      void load()
    }
  }
}

function handleSourcesChanged(): void {
  void load()
}

onMounted(() => {
  window.addEventListener('srl:community-sources-changed', handleSourcesChanged)
  window.addEventListener('srl:library-resources-changed', handleResourcesChanged)
  void load()
})

onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('srl:community-sources-changed', handleSourcesChanged)
  window.removeEventListener('srl:library-resources-changed', handleResourcesChanged)
})

function latestMessage(view: PendingView): CommunitySourceMessage | undefined {
  return view.messages.at(-1)
}

function title(view: PendingView): string {
  return view.source.title || latestMessage(view)?.authorName || 'Discord 来源'
}

function preview(view: PendingView): string {
  const message = latestMessage(view)
  const content = message?.content.replace(/\s+/gu, ' ').trim() ?? ''
  if (content) return content.length > 180 ? `${content.slice(0, 180)}…` : content
  if (message?.attachments.length) return `包含 ${message.attachments.length} 个附件`
  if (message?.embeds.length) return `包含 ${message.embeds.length} 个 Embed`
  return '已保存来源内容'
}

function formatDate(value: string | number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN')
}

function startBinding(sourceId: string): void {
  if (bindingSourceId.value === sourceId) {
    bindingSourceId.value = ''
    bindingResources.value = []
    resourceMatchBadges.value = {}
    return
  }
  bindingSourceId.value = sourceId
  selectedResourceId.value = ''
  bindingResources.value = []
  resourceMatchBadges.value = {}
  const view = pending.value.find((item) => item.source.id === sourceId)
  if (view) void prepareBindingResources(view)
}

function normalizeMatch(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

function authorMatchValue(value: string): string {
  return normalizeMatch(value)
    .replace(/^dc\s*/iu, '')
    .trim()
}

async function prepareBindingResources(view: PendingView): Promise<void> {
  try {
    const unboundResources = await communitySourceService.listUnboundResources(resources.value)
    const body = `${view.source.title ?? ''}\n${view.messages
      .map((message) => message.content)
      .join('\n')}`
    const postText = normalizeMatch(body)
    const postAuthors = new Set(
      Array.from(body.matchAll(/(?:^|\n)\s*(?:作者|author)\s*[:：]\s*([^\r\n]+)/giu))
        .map((match) => authorMatchValue(match[1] ?? ''))
        .filter(Boolean),
    )
    const badges: Record<string, Array<'作' | '名'>> = {}
    const ranked = unboundResources.map((resource, index) => {
      const found: Array<'作' | '名'> = []
      if (resource.type === 'characterCard') {
        const resourceName = normalizeMatch(resource.name)
        const creator =
          typeof resource.metadata.creator === 'string'
            ? authorMatchValue(resource.metadata.creator)
            : ''
        if (creator && postAuthors.has(creator)) found.push('作')
        if (resourceName && postText.includes(resourceName)) found.push('名')
      }
      if (found.length) badges[resource.id] = found
      return { resource, index, rank: found.includes('名') ? 2 : found.includes('作') ? 1 : 0 }
    })
    bindingResources.value = ranked
      .sort((left, right) => right.rank - left.rank || left.index - right.index)
      .map(({ resource }) => resource)
    resourceMatchBadges.value = badges
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '无法读取未关联资源。'
  }
}

async function bind(sourceId: string, resourceId: string): Promise<void> {
  const resource = resources.value.find((item) => item.id === resourceId)
  if (!resource || busySourceId.value) return
  busySourceId.value = sourceId
  loadError.value = ''
  try {
    await communitySourceService.bindSource(resourceId, sourceId)
    showTransientStatus(`已关联到“${resource.name}”`)
    bindingSourceId.value = ''
    bindingResources.value = []
    resourceMatchBadges.value = {}
    selectedResourceId.value = ''
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    await load()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '来源关联失败'
  } finally {
    busySourceId.value = ''
  }
}

async function deletePending(view: PendingView): Promise<void> {
  if (busySourceId.value) return
  const confirmed = await confirmAction({
    title: '删除待整理来源',
    message: `确定删除“${title(view)}”的本机保存副本吗？只会删除 SRL 中的内容，不会影响 Discord 原消息。`,
    confirmLabel: '删除本机副本',
    danger: true,
  })
  if (!confirmed) return
  busySourceId.value = view.source.id
  try {
    await communitySourceService.deleteSource(view.source.id)
    if (expandedSourceId.value === view.source.id) expandedSourceId.value = ''
    if (bindingSourceId.value === view.source.id) {
      bindingSourceId.value = ''
      bindingResources.value = []
      resourceMatchBadges.value = {}
    }
    showTransientStatus('已删除本机保存副本')
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    await load()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '删除失败'
  } finally {
    busySourceId.value = ''
  }
}
</script>

<template>
  <section
    v-if="!props.hideWhenEmpty || pending.length || loading || loadError || statusMessage"
    class="discord-pending"
    :class="{
      'discord-pending--inbox': props.hideWhenEmpty,
      'discord-pending--page': props.pageView,
    }"
    :aria-labelledby="props.pageView ? undefined : 'discord-pending-title'"
    :aria-label="props.pageView ? '待整理来源' : undefined"
  >
    <header class="discord-pending__header">
      <div v-if="!props.pageView">
        <strong id="discord-pending-title">待整理来源</strong>
        <small>从 Discord 领取、但还没有关联到资源的内容。</small>
      </div>
      <span v-if="pending.length">{{ pending.length }}{{ hasMore ? '+' : '' }}</span>
    </header>

    <p v-if="loading && !pending.length" class="discord-pending__state">正在读取…</p>
    <p v-else-if="!pending.length" class="discord-pending__state">
      {{ props.pageView ? '暂无待整理来源' : '目前没有待整理来源。' }}
    </p>

    <div v-else class="discord-pending__list">
      <article v-for="view in pending" :key="view.source.id" class="discord-pending__item">
        <div class="discord-pending__summary">
          <div>
            <strong>{{ title(view) }}</strong>
            <small>
              {{ latestMessage(view)?.authorName || '未知作者' }} · {{ view.messages.length }}
              条已保存内容
            </small>
            <p>{{ preview(view) }}</p>
          </div>
          <span>{{ formatDate(view.source.updatedAt) }}</span>
        </div>

        <div class="discord-pending__actions">
          <button
            type="button"
            @click="expandedSourceId = expandedSourceId === view.source.id ? '' : view.source.id"
          >
            {{ expandedSourceId === view.source.id ? '收起内容' : '查看保存内容' }}
          </button>
          <a :href="view.source.canonicalUrl" target="_blank" rel="noopener noreferrer">
            打开原消息
          </a>
          <button
            v-if="contextResource"
            type="button"
            :disabled="busySourceId === view.source.id"
            @click="bind(view.source.id, contextResource.id)"
          >
            关联当前资源
          </button>
          <button type="button" @click="startBinding(view.source.id)">选择其他资源</button>
          <button
            class="discord-pending__delete"
            type="button"
            :disabled="busySourceId === view.source.id"
            @click="deletePending(view)"
          >
            删除
          </button>
        </div>

        <div v-if="expandedSourceId === view.source.id" class="discord-pending__messages">
          <article v-for="message in view.messages" :key="message.id">
            <header>
              <strong>{{ message.authorName }}</strong>
              <span>{{ formatDate(message.timestamp) }}</span>
            </header>
            <p v-if="message.content">{{ message.content }}</p>
            <p v-else class="discord-pending__empty-body">这条消息没有文字正文。</p>
            <div v-if="message.attachments.length" class="discord-pending__attachments">
              <div v-for="attachment in message.attachments" :key="attachment.id">
                <a :href="attachment.url" target="_blank" rel="noopener noreferrer">
                  {{ attachment.name }}
                </a>
                <details v-if="attachment.textContent" class="discord-text-attachment">
                  <summary>查看提取的文字</summary>
                  <pre>{{ attachment.textContent }}</pre>
                </details>
              </div>
            </div>
          </article>
        </div>

        <div v-if="bindingSourceId === view.source.id" class="discord-pending__bind">
          <ResourcePicker
            title="选择关联资源"
            :resources="bindingResources"
            :model-value="selectedResourceId ? [selectedResourceId] : []"
            :match-badges="resourceMatchBadges"
            :multiple="false"
            :show-actions="false"
            :disabled="Boolean(busySourceId)"
            @update:model-value="selectedResourceId = $event[0] ?? ''"
          />
          <button
            class="button button--primary"
            type="button"
            :disabled="!selectedResourceId || busySourceId === view.source.id"
            @click="bind(view.source.id, selectedResourceId)"
          >
            关联所选资源
          </button>
        </div>
      </article>
    </div>

    <p v-if="hasMore" class="discord-pending__state">这里只显示最近 {{ DISPLAY_LIMIT }} 项。</p>
    <p v-if="statusMessage" class="discord-pending__status" role="status">
      {{ statusMessage }}
    </p>
    <p v-if="loadError" class="discord-pending__error" role="alert">{{ loadError }}</p>
  </section>
</template>

<style scoped src="../styles/DiscordPendingSources.css"></style>
