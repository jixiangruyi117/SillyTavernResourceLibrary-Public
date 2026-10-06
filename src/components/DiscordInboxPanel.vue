<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import {
  cancelDiscordInboxJob,
  clearDiscordInboxCloudHistory,
  clearDiscordInboxPairing,
  inboxConnection,
  listDiscordInboxJobs,
  pairDiscordInbox,
  readDiscordInboxStatus,
} from '../services/DiscordHandoffService'
import { loadDiscordSourceConnectionSettings } from '../services/DiscordSourceSettingsService'

const props = withDefaults(defineProps<{ mode?: 'inbox' | 'pairing' }>(), { mode: 'inbox' })
const isPairing = computed(() => props.mode === 'pairing')
type InboxStatus = Awaited<ReturnType<typeof readDiscordInboxStatus>>
type InboxJob = Awaited<ReturnType<typeof listDiscordInboxJobs>>['recent'][number]
const status = ref<InboxStatus>()
const libraryId = ref('')
const credentialsAvailable = ref(false)
const name = ref('这台设备的资源库')
const pairCode = ref('')
const pairExpiresAt = ref(0)
const recent = ref<InboxJob[]>([])
const pendingJobs = ref<InboxJob[]>([])
const pendingCount = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const actionBusy = ref(false)
const cleanupBusy = ref(false)
const receiving = ref(false)
const progress = ref('')
const error = ref('')
const settingsOpen = ref(false)
let disposed = false
let requestedRefresh = false
const configured = computed(() => Boolean(libraryId.value))
const connectionLabel = computed(() =>
  status.value?.paired
    ? status.value.isDefault === false
      ? '非默认目标'
      : '已配对'
    : configured.value
      ? credentialsAvailable.value
        ? '等待配对'
        : '凭据不可用'
      : '尚未配对',
)
const expiresLabel = computed(() =>
  pairExpiresAt.value ? new Date(pairExpiresAt.value).toLocaleTimeString('zh-CN') : '',
)

async function refresh(): Promise<void> {
  if (loading.value) {
    requestedRefresh = true
    return
  }
  loading.value = true
  error.value = ''
  try {
    const settings = loadDiscordSourceConnectionSettings()
    libraryId.value = settings.inboxLibraryId ?? ''
    credentialsAvailable.value = Boolean(settings.inboxSecret)
    name.value = settings.inboxName || name.value
    if (!settings.inboxLibraryId || !settings.inboxSecret) {
      status.value = undefined
      pairCode.value = ''
      recent.value = []
      pendingJobs.value = []
      pendingCount.value = 0
      hasMore.value = false
      if (settings.inboxLibraryId)
        error.value =
          '本机收件凭据不可用，请在连接设置中断开本机配对后重新生成口令。重配会建立新目标，不会迁移旧目标中的帖子。'
      if (isPairing.value) settingsOpen.value = true
      return
    }
    const wasPaired = status.value?.paired
    status.value = await readDiscordInboxStatus()
    if (disposed) return
    if (isPairing.value) {
      if (!status.value.paired) settingsOpen.value = true
      else if (!wasPaired) settingsOpen.value = false
    }
    name.value = status.value.name || name.value
    if (isPairing.value) {
      pairCode.value = settings.inboxPairCode ?? ''
      pairExpiresAt.value = settings.inboxPairExpiresAt ?? 0
      if (wasPaired === false && status.value.paired)
        window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    } else {
      const jobs = await listDiscordInboxJobs()
      if (disposed) return
      pendingJobs.value = jobs.jobs
      recent.value = jobs.recent.slice(0, 5)
      pendingCount.value = jobs.jobs.length
      hasMore.value = jobs.hasMore
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取云端收件状态，请稍后刷新。'
  } finally {
    loading.value = false
    if (requestedRefresh && !disposed) {
      requestedRefresh = false
      void refresh()
    }
  }
}

async function cleanupCloudHistory(): Promise<void> {
  if (cleanupBusy.value || actionBusy.value) return
  if (
    !(await confirmAction({
      title: '清理云端已结束任务',
      message:
        '将删除已保存帖子的云端回执和已导入资源的云端记录；本机内容不会受影响。待领取帖子、正在处理的任务，以及失败或已取消的资源任务会保留，方便继续领取、重试或单独清理。此清理无法撤销。',
      confirmLabel: '清理云端记录',
    }))
  )
    return
  cleanupBusy.value = true
  error.value = ''
  try {
    const result = await clearDiscordInboxCloudHistory()
    progress.value = `已清理云端记录：帖子 ${result.posts} 条，资源 ${result.resources} 项。`
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
    window.dispatchEvent(new Event('srl:discord-resources-updated'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '云端记录清理失败。'
  } finally {
    cleanupBusy.value = false
  }
}

async function cancelPendingPost(job: InboxJob): Promise<void> {
  if (actionBusy.value) return
  if (
    !(await confirmAction({
      title: '取消这条待领取帖子？',
      message: '将删除云端帖子正文和待领取记录，且不能恢复。已经保存在本机的帖子不会受影响。',
      confirmLabel: '取消并清理',
    }))
  )
    return
  actionBusy.value = true
  error.value = ''
  try {
    await cancelDiscordInboxJob(job.id, inboxConnection())
    progress.value = '已取消并清理这条云端帖子。'
    await refresh()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '取消帖子失败。'
  } finally {
    actionBusy.value = false
  }
}

async function pair(): Promise<void> {
  if (actionBusy.value) return
  if (!loadDiscordSourceConnectionSettings().workerBaseUrl) {
    error.value = '先在连接设置中保存 Worker 地址，再生成配对码。'
    return
  }
  actionBusy.value = true
  error.value = ''
  try {
    const pairing = await pairDiscordInbox(name.value.trim() || '这台设备的资源库')
    pairCode.value = pairing.code
    pairExpiresAt.value = pairing.expiresAt
    settingsOpen.value = true
    await refresh()
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '配对码生成失败，请重试。'
  } finally {
    actionBusy.value = false
  }
}

async function disconnect(): Promise<void> {
  if (actionBusy.value) return
  if (
    !(await confirmAction({
      title: '断开云端收件',
      message:
        '建议先刷新领取待收帖子及资源任务。断开后，这台设备停止从当前收件库自动领取；旧目标的待收内容最多在云端保留 7 天。已保存在本机的内容仍保留。',
      confirmLabel: '断开配对',
    }))
  )
    return
  actionBusy.value = true
  error.value = ''
  try {
    await clearDiscordInboxPairing()
    settingsOpen.value = false
    await refresh()
    window.dispatchEvent(new Event('srl:receive-discord-inbox'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '配对未能断开，请重试。'
  } finally {
    actionBusy.value = false
  }
}

async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(pairCode.value)
    progress.value = '已复制配对码。'
  } catch {
    error.value = '未能复制，请选中配对码手动复制。'
  }
}

function receive(): void {
  error.value = ''
  window.dispatchEvent(new Event('srl:receive-discord-inbox'))
}

function onConnectionChanged(): void {
  void refresh()
}

function onSettingsToggle(event: Event): void {
  settingsOpen.value = (event.target as HTMLDetailsElement).open
}

function onProgress(event: Event): void {
  if (!(event instanceof CustomEvent)) return
  const detail = event.detail as {
    status?: string
    busy?: boolean
    received?: number
    waitingBinding?: number
    error?: string
  }
  if (isPairing.value) {
    if (detail.status === 'ready') void refresh()
    return
  }
  receiving.value = detail.busy === true
  if (detail.error) error.value = detail.error
  else error.value = ''
  if (detail.status === 'locked') progress.value = '待解锁本地保险库。'
  else if (detail.status === 'error')
    progress.value = `本轮领取未完成，已保存 ${detail.received ?? 0} 条。`
  else if (detail.busy) progress.value = `正在领取，已保存 ${detail.received ?? 0} 条。`
  else if (detail.status === 'ready') {
    progress.value = detail.received
      ? `已保存 ${detail.received} 条${detail.waitingBinding ? `，${detail.waitingBinding} 条待关联` : ''}。`
      : '目前没有新的待领取帖子。'
    void refresh()
  }
}

function jobState(job: InboxJob): string {
  return job.state === 'saved'
    ? '已保存'
    : job.state === 'waiting_binding'
      ? '待关联资源'
      : '待领取'
}

onMounted(() => {
  window.addEventListener('srl:discord-inbox-updated', onProgress)
  if (!isPairing.value) window.addEventListener('srl:receive-discord-inbox', onConnectionChanged)
  void refresh()
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('srl:discord-inbox-updated', onProgress)
  window.removeEventListener('srl:receive-discord-inbox', onConnectionChanged)
})
</script>

<template>
  <section
    :class="isPairing ? 'discord-inbox-pairing' : 'discord-inbox'"
    :aria-labelledby="isPairing ? 'discord-inbox-pairing-title' : 'discord-inbox-title'"
    :aria-busy="loading || receiving"
  >
    <header class="discord-inbox__header">
      <div class="discord-inbox__heading">
        <div class="discord-inbox__title">
          <strong :id="isPairing ? 'discord-inbox-pairing-title' : 'discord-inbox-title'">{{
            isPairing ? '资源库配对' : '帖子收件'
          }}</strong>
          <span
            v-if="isPairing || !status?.paired || status.isDefault === false"
            class="discord-inbox__connection"
            >{{ connectionLabel }}</span
          >
        </div>
        <p v-if="configured" class="discord-inbox__target" :title="status?.name || name">
          {{ status?.paired && status.isDefault !== false ? '默认目标' : '本机收件库' }}：{{
            status?.name || name
          }}
        </p>
        <p v-else class="discord-inbox__intro">
          {{ isPairing ? '帖子收件和资源下载共用此配对。' : '先在顶部“连接设置”中配对资源库。' }}
        </p>
      </div>
      <button
        v-if="configured && !isPairing"
        class="discord-inbox__receive"
        type="button"
        aria-label="刷新并领取"
        data-assistant-focus="inbox-post-claim"
        :disabled="receiving || actionBusy || !credentialsAvailable"
        @click="receive"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 8a8 8 0 0 0-13-2L3 9m0-5v5h5M5 16a8 8 0 0 0 13 2l3-3m0 5v-5h-5" />
        </svg>
        {{ receiving ? '正在领取…' : '领取' }}
      </button>
      <button
        v-if="configured && !isPairing"
        type="button"
        data-assistant-focus="inbox-cloud-cleanup"
        :disabled="loading || actionBusy || cleanupBusy || !credentialsAvailable"
        @click="cleanupCloudHistory"
      >
        {{ cleanupBusy ? '清理中…' : '清理云端' }}
      </button>
    </header>
    <template v-if="configured && !isPairing">
      <p v-if="pendingCount" class="discord-inbox__pending" role="status">
        待领取 {{ pendingCount }}{{ hasMore ? '+' : '' }} 条
      </p>
      <details v-if="pendingJobs.length" class="discord-inbox__pending-jobs">
        <summary>待领取帖子（{{ pendingJobs.length }}）</summary>
        <ul aria-label="待领取的云端帖子">
          <li v-for="job in pendingJobs" :key="job.id">
            <span class="discord-inbox__job-title" :title="job.title || 'Discord 帖子'">{{
              job.title || 'Discord 帖子'
            }}</span>
            <button type="button" :disabled="actionBusy" @click="cancelPendingPost(job)">
              取消
            </button>
          </li>
        </ul>
        <p>取消会删除尚未领取的云端正文；已保存在本机的内容不受影响。</p>
      </details>
      <p v-if="progress" class="discord-inbox__progress" role="status">{{ progress }}</p>
      <p v-if="status?.paired && status.isDefault === false" class="discord-inbox__note">
        新帖子发往最近配对的目标；这里仍可领取之前的任务。
      </p>
      <details
        v-if="recent.length"
        class="discord-inbox__history"
        :open="recent.some((job) => job.state === 'waiting_binding')"
      >
        <summary>最近收件记录（{{ recent.length }}）</summary>
        <ul aria-label="最近收件进度">
          <li v-for="job in recent" :key="job.id">
            <span class="discord-inbox__post-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 4h14v12H9l-4 4V4Z M8 8h8M8 12h5" />
              </svg>
            </span>
            <span class="discord-inbox__job-title" :title="job.title || 'Discord 帖子'">{{
              job.title || 'Discord 帖子'
            }}</span>
            <small :class="{ 'discord-inbox__waiting': job.state === 'waiting_binding' }">{{
              jobState(job)
            }}</small>
          </li>
        </ul>
        <p>云端回执最长保留 7 天；已保存的本机帖子不会自动删除。</p>
      </details>
      <p v-else-if="status?.paired && !pendingCount && !loading && !error && !progress">
        暂无新帖子。
      </p>
    </template>
    <details v-if="isPairing" :open="settingsOpen" @toggle="onSettingsToggle">
      <summary>管理配对</summary>
      <section
        v-if="settingsOpen && configured"
        id="discord-inbox-settings"
        class="discord-inbox__settings"
        aria-label="资源库配对设置"
      >
        <div v-if="pairCode && !status?.paired" class="discord-inbox__code">
          <span>配对码</span>
          <div>
            <code>{{ pairCode }}</code>
            <button type="button" @click="copyCode">复制</button>
          </div>
          <p>
            在 Discord 输入 <strong>/绑定资源库</strong>，填写配对码{{
              expiresLabel ? `，${expiresLabel} 到期` : ''
            }}。只交给自己的账号。
          </p>
        </div>
        <p v-if="!status?.paired">首次使用需在下方注册消息命令。口令过期后，先断开再生成新码。</p>
        <p>
          当前收件库：<strong>{{ status?.name || name }}</strong
          >。云端保留 {{ status?.expiresInDays ?? 7 }} 天，每次最多领取 100
          条。正文已保存后可回收件箱整理关联；附件单独缓存。
        </p>
        <button
          v-if="!status?.paired && credentialsAvailable"
          type="button"
          :disabled="loading || actionBusy"
          @click="refresh"
        >
          检查配对
        </button>
        <button
          class="discord-inbox__disconnect"
          type="button"
          :disabled="actionBusy"
          @click="disconnect"
        >
          断开配对
        </button>
      </section>
      <div v-else-if="settingsOpen && !configured" class="discord-inbox__pair">
        <label
          >收件库名称<input v-model="name" maxlength="60" placeholder="方便认出这台设备"
        /></label>
        <button class="button button--primary" type="button" :disabled="actionBusy" @click="pair">
          {{ actionBusy ? '正在生成…' : '生成配对码' }}
        </button>
      </div>
      <p v-if="progress" class="discord-inbox__progress" role="status">{{ progress }}</p>
    </details>
    <p v-if="error" class="discord-inbox__error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped src="../styles/DiscordInboxPanel.css"></style>
