<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { communitySourceService } from '../core/CommunitySourceRuntime'
import { initializeVaultOnce, resourceService, vaultService } from '../core/AppContainer'
import { useTransientStatus } from '../composables/UseTransientStatus'
import {
  clearDiscordHandoffFromLocation,
  consumeDiscordHandoff,
  readDiscordHandoffFromLocation,
  type DiscordHandoffRequest,
} from '../services/DiscordHandoffService'
import type { NativeDeepLink } from '../core/NativeRuntime'
import type { ResourceCommunitySourceView } from '../types/CommunitySource'
import type { ResourceListSummary } from '../types/Resource'

const pending = ref<ResourceCommunitySourceView>()
const resources = ref<ResourceListSummary[]>([])
const query = ref('')
const selectedResourceId = ref('')
const busy = ref(false)
const receiving = ref(false)
const errorMessage = ref('')
const { statusMessage, showTransientStatus } = useTransientStatus()
let activeRequestKey = ''
let deferredRequest: DiscordHandoffRequest | undefined

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

const latestMessage = computed(() => pending.value?.messages.at(-1))
const title = computed(
  () => pending.value?.source.title || latestMessage.value?.authorName || 'Discord 来源',
)

async function loadResources(): Promise<void> {
  resources.value = await resourceService.listResourceListSummaries()
}

async function receive(request: DiscordHandoffRequest): Promise<void> {
  const key = `${request.workerUrl}|${request.token}`
  if (receiving.value || key === activeRequestKey) return
  await initializeVaultOnce()
  if (vaultService.getStatus().locked) {
    deferredRequest = request
    errorMessage.value = '先解锁本地保险库，再领取这条 Discord 来源；临时链接尚未消费。'
    return
  }
  deferredRequest = undefined
  activeRequestKey = key
  receiving.value = true
  errorMessage.value = ''
  try {
    const capture = await consumeDiscordHandoff(request)
    // token 是一次性的；先把完整快照落到本机，再让用户决定关联到哪里。
    const saved = await communitySourceService.saveDiscordCapture(capture)
    const existingBindings = await communitySourceService.getSourceUsage(saved.source.id)
    if (existingBindings.length > 0) {
      pending.value = undefined
      showTransientStatus('已更新已有 Discord 来源')
      window.dispatchEvent(new Event('srl:community-sources-changed'))
    } else {
      pending.value = saved
    }
    clearDiscordHandoffFromLocation()
    await loadResources()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法领取 Discord 来源'
    clearDiscordHandoffFromLocation()
  } finally {
    receiving.value = false
  }
}

function handleVaultUnlocked(): void {
  if (deferredRequest) void receive(deferredRequest)
}

function handleNativeDeepLink(event: Event): void {
  if (!(event instanceof CustomEvent)) return
  const link = event.detail as NativeDeepLink | undefined
  if (!link || link.kind !== 'discordSource') return
  void receive({ workerUrl: link.workerUrl, token: link.token })
}

async function bindExisting(): Promise<void> {
  const view = pending.value
  if (!view || !selectedResourceId.value || busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    await communitySourceService.bindSource(selectedResourceId.value, view.source.id)
    const resource = resources.value.find((item) => item.id === selectedResourceId.value)
    showTransientStatus(`已关联到“${resource?.name ?? '所选资源'}”`)
    pending.value = undefined
    selectedResourceId.value = ''
    query.value = ''
    window.dispatchEvent(new Event('srl:community-sources-changed'))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '来源关联失败'
  } finally {
    busy.value = false
  }
}

async function createLinkResource(): Promise<void> {
  const view = pending.value
  if (!view || busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const [result] = await resourceService.importLinks([view.source.canonicalUrl])
    if (!result || result.status === 'failed' || result.status === 'versionCandidate') {
      throw new Error(result?.status === 'failed' ? result.message : '创建链接资源失败')
    }
    await communitySourceService.bindSource(result.resource.id, view.source.id)
    await loadResources()
    showTransientStatus(
      result.status === 'duplicate'
        ? `发现已有同链接资源，已关联到“${result.resource.name}”`
        : `已创建“${result.resource.name}”并关联来源`,
    )
    pending.value = undefined
    window.dispatchEvent(new Event('srl:community-sources-changed'))
    window.dispatchEvent(new Event('srl:library-changed'))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建链接资源失败'
  } finally {
    busy.value = false
  }
}

function keepForLater(): void {
  if (!pending.value) return
  showTransientStatus('已保存在本机，稍后可从来源高级设置继续整理。')
  pending.value = undefined
}

onMounted(() => {
  window.addEventListener('srl:native-deep-link', handleNativeDeepLink)
  window.addEventListener('srl:vault-unlocked', handleVaultUnlocked)
  const fromLocation = readDiscordHandoffFromLocation()
  if (fromLocation) void receive(fromLocation)
  void loadResources()
})

onBeforeUnmount(() => {
  window.removeEventListener('srl:native-deep-link', handleNativeDeepLink)
  window.removeEventListener('srl:vault-unlocked', handleVaultUnlocked)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="receiving" class="discord-intake-status" role="status">正在领取 Discord 来源…</div>

    <div
      v-if="pending"
      class="discord-intake-overlay mobile-dialog-viewport"
      role="presentation"
      @click.self="keepForLater"
    >
      <section
        class="discord-intake"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-intake-title"
      >
        <header>
          <div>
            <small>DISCORD SOURCE</small>
            <h2 id="discord-intake-title">保存 Discord 来源</h2>
          </div>
          <button type="button" aria-label="稍后整理" @click="keepForLater">×</button>
        </header>

        <section class="discord-intake__source">
          <strong>{{ title }}</strong>
          <span v-if="latestMessage">{{ latestMessage.authorName }}</span>
          <p>
            {{
              latestMessage?.content
                ? latestMessage.content.replace(/\s+/gu, ' ').slice(0, 220) +
                  (latestMessage.content.length > 220 ? '…' : '')
                : '这条消息主要包含 Embed 或附件。完整数据已经保存到本机。'
            }}
          </p>
          <small>完整正文已经先保存到本机；这里仅显示预览。</small>
        </section>

        <section class="discord-intake__bind">
          <label>
            <span>关联已有资源</span>
            <input v-model="query" type="search" placeholder="搜索资源名称、文件名或标签" />
          </label>

          <div v-if="filteredResources.length" class="discord-intake__resources">
            <label
              v-for="resource in filteredResources"
              :key="resource.id"
              :class="{ 'is-selected': selectedResourceId === resource.id }"
            >
              <input v-model="selectedResourceId" type="radio" :value="resource.id" />
              <span>
                <strong>{{ resource.name }}</strong>
                <small>{{ resource.fileName }}</small>
              </span>
            </label>
          </div>
          <p v-else class="discord-intake__empty">没有找到匹配资源。</p>

          <button
            class="button button--primary"
            type="button"
            :disabled="busy || !selectedResourceId"
            @click="bindExisting"
          >
            {{ busy ? '正在保存…' : '关联所选资源' }}
          </button>
        </section>

        <footer>
          <button type="button" :disabled="busy" @click="createLinkResource">创建链接资源</button>
          <button type="button" :disabled="busy" @click="keepForLater">稍后整理</button>
        </footer>

        <p
          v-if="errorMessage"
          class="discord-intake__message discord-intake__message--error"
          role="alert"
        >
          {{ errorMessage }}
        </p>
      </section>
    </div>

    <p v-if="statusMessage" class="discord-intake-toast" role="status">{{ statusMessage }}</p>
    <p
      v-if="errorMessage && !pending"
      class="discord-intake-toast discord-intake-toast--error"
      role="alert"
    >
      {{ errorMessage }}
    </p>
  </Teleport>
</template>

<style scoped src="../styles/DiscordSourceHandoffIntake.css"></style>
