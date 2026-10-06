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
import { resourceService } from '../core/AppContainer'
import {
  communitySourceService,
  discordInboxAutomationSettingsService,
} from '../core/LibraryContainer'
import {
  DEFAULT_DISCORD_INBOX_AUTOMATION_SETTINGS,
  type DiscordInboxAutomationSettings,
} from '../services/DiscordInboxAutomationSettings'
import type { ResourceCommunitySourceView } from '../types/CommunitySource'
import type { ResourceListSummary, ResourceSummary } from '../types/Resource'
import ResourcePicker from './ResourcePicker.vue'

const props = withDefaults(defineProps<{ mode?: 'inbox' | 'pairing' }>(), { mode: 'inbox' })
const emit = defineEmits<{ 'open-resource': [resource: ResourceSummary] }>()
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
const automationSettingsOpen = ref(false)
const automationSettings = ref<DiscordInboxAutomationSettings>({
  ...DEFAULT_DISCORD_INBOX_AUTOMATION_SETTINGS,
})
const recentAutoBindings = ref<
  Array<{
    sourceTitle: string
    resourceLabel: string
    resourceId: string
    sourceId: string
    rule?: string
  }>
>([])
const autoBindingDetails = ref<
  Record<string, { view: ResourceCommunitySourceView; resource?: ResourceListSummary }>
>({})
const reviewExpandedId = ref('')
const replacingBindingId = ref('')
const selectedReplacementId = ref('')
const replacementResources = ref<ResourceListSummary[]>([])
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

async function refreshAutoBindings(): Promise<void> {
  automationSettings.value = {
    ...DEFAULT_DISCORD_INBOX_AUTOMATION_SETTINGS,
    ...(await discordInboxAutomationSettingsService.load()),
  }
  const bindings = await communitySourceService.listRecentAutoBindings(50)
  recentAutoBindings.value = bindings.map(({ source, binding }) => ({
    sourceTitle: source.title || 'Discord 帖子',
    resourceLabel:
      binding.note?.replace(/^自动关联：.*? · /u, '') || `角色卡 ${binding.resourceId.slice(0, 8)}`,
    resourceId: binding.resourceId,
    sourceId: binding.sourceId,
    rule: binding.autoBindingRule,
  }))
}

async function toggleAutoBindingReview(
  item: (typeof recentAutoBindings.value)[number],
): Promise<void> {
  const key = `${item.resourceId}:${item.sourceId}`
  if (reviewExpandedId.value === key) {
    reviewExpandedId.value = ''
    return
  }
  reviewExpandedId.value = key
  if (autoBindingDetails.value[key]) return
  actionBusy.value = true
  try {
    const [view, resources] = await Promise.all([
      communitySourceService.getForResource(item.resourceId, item.sourceId),
      resourceService.listResourceListSummaries(),
    ])
    if (!view) throw new Error('帖子或关联记录已不存在。')
    autoBindingDetails.value = {
      ...autoBindingDetails.value,
      [key]: { view, resource: resources.find((resource) => resource.id === item.resourceId) },
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取自动关联内容。'
    reviewExpandedId.value = ''
  } finally {
    actionBusy.value = false
  }
}

async function confirmAutoBinding(item: (typeof recentAutoBindings.value)[number]): Promise<void> {
  if (actionBusy.value) return
  actionBusy.value = true
  try {
    await communitySourceService.confirmAutoBinding(item.resourceId, item.sourceId)
    progress.value = `已确认“${item.sourceTitle}”的自动关联。`
    await refreshAutoBindings()
    window.dispatchEvent(new Event('srl:community-sources-changed'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '确认自动关联失败。'
  } finally {
    actionBusy.value = false
  }
}

async function returnAutoBindingToPending(
  item: (typeof recentAutoBindings.value)[number],
): Promise<void> {
  if (actionBusy.value) return
  actionBusy.value = true
  try {
    await communitySourceService.unbindSource(item.resourceId, item.sourceId)
    progress.value = `已将“${item.sourceTitle}”退回待整理。`
    reviewExpandedId.value = ''
    await refreshAutoBindings()
    window.dispatchEvent(new Event('srl:community-sources-changed'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '退回待整理失败。'
  } finally {
    actionBusy.value = false
  }
}

async function replaceAutoBinding(item: (typeof recentAutoBindings.value)[number]): Promise<void> {
  if (!selectedReplacementId.value || actionBusy.value) return
  actionBusy.value = true
  try {
    await communitySourceService.replaceAutoBinding(
      item.resourceId,
      selectedReplacementId.value,
      item.sourceId,
    )
    const replacement = (await resourceService.listResourceListSummaries()).find(
      (resource) => resource.id === selectedReplacementId.value,
    )
    progress.value = replacement
      ? `已将“${item.sourceTitle}”改关联到“${replacement.name}”。`
      : `已更新“${item.sourceTitle}”的关联。`
    selectedReplacementId.value = ''
    replacingBindingId.value = ''
    reviewExpandedId.value = ''
    await refreshAutoBindings()
    window.dispatchEvent(new Event('srl:community-sources-changed'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '替换关联资源失败。'
  } finally {
    actionBusy.value = false
  }
}

async function startReplacingAutoBinding(sourceId: string): Promise<void> {
  if (actionBusy.value) return
  if (replacingBindingId.value === sourceId) {
    replacingBindingId.value = ''
    selectedReplacementId.value = ''
    return
  }
  actionBusy.value = true
  try {
    replacementResources.value = (await resourceService.listResourceListSummaries()).filter(
      (resource) => resource.type === 'characterCard',
    )
    replacingBindingId.value = sourceId
    selectedReplacementId.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取角色卡列表。'
  } finally {
    actionBusy.value = false
  }
}

async function updateAutomationSetting(
  key: keyof DiscordInboxAutomationSettings,
  enabled: boolean,
): Promise<void> {
  const next = { ...automationSettings.value, [key]: enabled }
  await discordInboxAutomationSettingsService.save(next)
  automationSettings.value = next
}

async function clearAutoBindings(): Promise<void> {
  if (!recentAutoBindings.value.length || actionBusy.value) return
  actionBusy.value = true
  try {
    const count = await communitySourceService.clearRecentAutoBindings(50)
    progress.value = `已取消 ${count} 条自动关联；帖子已回到待整理。`
    await refreshAutoBindings()
    window.dispatchEvent(new Event('srl:community-sources-changed'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '取消自动关联失败。'
  } finally {
    actionBusy.value = false
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
  if (!isPairing.value) void refreshAutoBindings()
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
      <button
        v-if="configured && !isPairing"
        class="discord-inbox__automation-toggle"
        type="button"
        aria-label="收件箱设置"
        :aria-expanded="automationSettingsOpen"
        @click="automationSettingsOpen = !automationSettingsOpen"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h9m4 0h3M4 17h3m4 0h9M13 5v4M7 15v4" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </svg>
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
      <section
        v-if="automationSettingsOpen"
        class="discord-inbox__automation"
        aria-label="收件箱设置"
      >
        <h3>收件箱设置</h3>
        <label>
          <span>同名角色卡 <small>只比对最近 5 条未关联帖子</small></span>
          <input
            type="checkbox"
            :checked="automationSettings.bindSameName"
            @change="
              updateAutomationSetting('bindSameName', ($event.target as HTMLInputElement).checked)
            "
          />
        </label>
        <label>
          <span>同作者角色卡 <small>正文需有“作者：”，且作者名与卡片作者一致</small></span>
          <input
            type="checkbox"
            :checked="automationSettings.bindSameAuthor"
            @change="
              updateAutomationSetting('bindSameAuthor', ($event.target as HTMLInputElement).checked)
            "
          />
        </label>
        <label>
          <span>帖子后导入的第一个角色卡 PNG <small>只处理后台自动收件</small></span>
          <input
            type="checkbox"
            :checked="automationSettings.bindNextPng"
            @change="
              updateAutomationSetting('bindNextPng', ($event.target as HTMLInputElement).checked)
            "
          />
        </label>
      </section>
      <section v-if="recentAutoBindings.length" class="discord-inbox__auto-bindings">
        <header>
          <div>
            <strong>待确认的自动关联（{{ recentAutoBindings.length }}）</strong>
            <small>查看正文和角色卡后确认；有误可替换或退回待整理。</small>
          </div>
          <button type="button" :disabled="actionBusy" @click="clearAutoBindings">
            全部退回待整理
          </button>
        </header>
        <ul>
          <li v-for="item in recentAutoBindings" :key="`${item.resourceId}:${item.sourceId}`">
            <div class="discord-inbox__auto-binding-summary">
              <strong>{{ item.sourceTitle }}</strong>
              <span>→ {{ item.resourceLabel }}</span>
              <small
                >自动匹配：{{
                  item.rule === 'same-name'
                    ? '同名'
                    : item.rule === 'same-author'
                      ? '同作者'
                      : '后续 PNG'
                }}</small
              >
            </div>
            <div class="discord-inbox__auto-binding-actions">
              <button type="button" :disabled="actionBusy" @click="toggleAutoBindingReview(item)">
                {{
                  reviewExpandedId === `${item.resourceId}:${item.sourceId}`
                    ? '收起核对'
                    : '查看核对'
                }}
              </button>
              <button
                type="button"
                :disabled="
                  actionBusy ||
                  reviewExpandedId !== `${item.resourceId}:${item.sourceId}` ||
                  !autoBindingDetails[`${item.resourceId}:${item.sourceId}`]
                "
                @click="confirmAutoBinding(item)"
              >
                确认正确
              </button>
              <button
                type="button"
                :disabled="actionBusy"
                @click="startReplacingAutoBinding(item.sourceId)"
              >
                替换资源
              </button>
              <button
                type="button"
                :disabled="actionBusy"
                @click="returnAutoBindingToPending(item)"
              >
                退回待整理
              </button>
            </div>
            <div
              v-if="reviewExpandedId === `${item.resourceId}:${item.sourceId}`"
              class="discord-inbox__auto-binding-review"
            >
              <p v-if="!autoBindingDetails[`${item.resourceId}:${item.sourceId}`]">
                正在读取核对内容…
              </p>
              <template v-else>
                <article>
                  <h4>帖子正文</h4>
                  <p
                    v-for="message in autoBindingDetails[`${item.resourceId}:${item.sourceId}`].view
                      .messages"
                    :key="message.id"
                    class="discord-inbox__review-message"
                  >
                    <strong>{{ message.authorName }}</strong>
                    <span>{{ message.content || '（没有文字正文）' }}</span>
                  </p>
                </article>
                <article>
                  <h4>当前关联角色卡</h4>
                  <p v-if="autoBindingDetails[`${item.resourceId}:${item.sourceId}`].resource">
                    {{ autoBindingDetails[`${item.resourceId}:${item.sourceId}`].resource?.name }} ·
                    {{
                      autoBindingDetails[`${item.resourceId}:${item.sourceId}`].resource?.fileName
                    }}
                  </p>
                  <p v-else>当前角色卡不存在或已移除。</p>
                  <button
                    v-if="autoBindingDetails[`${item.resourceId}:${item.sourceId}`].resource"
                    type="button"
                    @click="
                      emit(
                        'open-resource',
                        autoBindingDetails[`${item.resourceId}:${item.sourceId}`].resource!,
                      )
                    "
                  >
                    打开角色卡
                  </button>
                </article>
              </template>
            </div>
            <div
              v-if="replacingBindingId === item.sourceId"
              class="discord-inbox__auto-binding-replace"
            >
              <ResourcePicker
                title="选择要关联的角色卡"
                :resources="replacementResources"
                :model-value="selectedReplacementId ? [selectedReplacementId] : []"
                :multiple="false"
                :show-actions="false"
                :disabled="actionBusy"
                @update:model-value="selectedReplacementId = $event[0] ?? ''"
              />
              <button
                class="button button--primary"
                type="button"
                :disabled="!selectedReplacementId || actionBusy"
                @click="replaceAutoBinding(item)"
              >
                确认替换
              </button>
            </div>
          </li>
        </ul>
      </section>
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
