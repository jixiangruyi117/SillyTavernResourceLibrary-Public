<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import { useTransientStatus } from '../composables/UseTransientStatus'
import { communitySourceService } from '../core/CommunitySourceRuntime'
import { resourceService } from '../core/AppContainer'
import type { CommunitySource, CommunitySourceMessage } from '../types/CommunitySource'
import type { ResourceListSummary } from '../types/Resource'

const props = defineProps<{ contextResourceId?: string }>()

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
const query = ref('')
const hasMore = ref(false)
const busySourceId = ref('')

const contextResource = computed(() =>
  props.contextResourceId
    ? resources.value.find((resource) => resource.id === props.contextResourceId)
    : undefined,
)

const filteredResources = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  const source = keyword
    ? resources.value.filter((resource) =>
        [resource.name, resource.fileName, ...resource.tags]
          .join('\n')
          .toLocaleLowerCase()
          .includes(keyword),
      )
    : resources.value
  return source.slice(0, 12)
})

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const [views, summaries] = await Promise.all([
      communitySourceService.listPendingSources(DISPLAY_LIMIT + 1),
      resourceService.listResourceListSummaries(),
    ])
    hasMore.value = views.length > DISPLAY_LIMIT
    pending.value = views.slice(0, DISPLAY_LIMIT)
    resources.value = summaries
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '无法读取待整理来源'
  } finally {
    loading.value = false
  }
}

function handleSourcesChanged(): void {
  void load()
}

onMounted(() => {
  window.addEventListener('srl:community-sources-changed', handleSourcesChanged)
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener('srl:community-sources-changed', handleSourcesChanged)
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
  bindingSourceId.value = bindingSourceId.value === sourceId ? '' : sourceId
  selectedResourceId.value = ''
  query.value = ''
}

async function bind(sourceId: string, resourceId: string): Promise<void> {
  if (!resourceId || busySourceId.value) return
  busySourceId.value = sourceId
  loadError.value = ''
  try {
    await communitySourceService.bindSource(resourceId, sourceId)
    const resource = resources.value.find((item) => item.id === resourceId)
    showTransientStatus(`已关联到“${resource?.name ?? '所选资源'}”`)
    bindingSourceId.value = ''
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
    if (bindingSourceId.value === view.source.id) bindingSourceId.value = ''
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
  <section class="discord-pending" aria-labelledby="discord-pending-title">
    <header class="discord-pending__header">
      <div>
        <strong id="discord-pending-title">待整理来源</strong>
        <small>从 Discord 领取、但还没有关联到资源的内容。</small>
      </div>
      <span v-if="pending.length">{{ pending.length }}{{ hasMore ? '+' : '' }}</span>
    </header>

    <p v-if="loading && !pending.length" class="discord-pending__state">正在读取…</p>
    <p v-else-if="!pending.length" class="discord-pending__state">目前没有待整理来源。</p>

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
              <a
                v-for="attachment in message.attachments"
                :key="attachment.id"
                :href="attachment.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ attachment.name }}
              </a>
            </div>
          </article>
        </div>

        <div v-if="bindingSourceId === view.source.id" class="discord-pending__bind">
          <input v-model="query" type="search" placeholder="搜索资源名称、文件名或标签" />
          <div class="discord-pending__resources">
            <label v-for="resource in filteredResources" :key="resource.id">
              <input v-model="selectedResourceId" type="radio" :value="resource.id" />
              <span>
                <strong>{{ resource.name }}</strong>
                <small>{{ resource.fileName }}</small>
              </span>
            </label>
          </div>
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
