<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { useTransientStatus } from '../composables/UseTransientStatus'
import { assistantGuidance } from '../core/ProductAssistantGuidance'
import { DISCORD_BRIDGE_PUBLIC_REPOSITORY_URL } from '../services/DiscordBridgeDeployService'
import {
  getDiscordWorkerEndpoints,
  normalizeDiscordWorkerBaseUrl,
} from '../services/DiscordSourceConnectionService'
import {
  loadDiscordSourceConnectionSettings,
  saveDiscordSourceConnectionSettings,
  saveDiscordSourceConnectionStatus,
} from '../services/DiscordSourceSettingsService'
import DiscordManualDeployDrawer from './DiscordManualDeployDrawer.vue'
import DiscordInboxPanel from './DiscordInboxPanel.vue'
import DiscordPendingSources from './DiscordPendingSources.vue'
import DiscordSetupGuideDrawer from './DiscordSetupGuideDrawer.vue'

const props = withDefaults(
  defineProps<{ contextResourceId?: string; title?: string; backLabel?: string }>(),
  { contextResourceId: undefined, title: '来源链接高级设置', backLabel: '返回来源与链接' },
)
const emit = defineEmits<{ close: [] }>()

type ConnectionState = 'idle' | 'testing' | 'connected' | 'stale' | 'error'
type DiagnosticState =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'd1-error'
  | 'discord-missing'
  | 'discord-invalid'
  | 'worker-error'
  | 'outdated'
  | 'need-token'
type CommandState =
  'idle' | 'checking' | 'registering' | 'registered' | 'missing' | 'stale' | 'error'

interface WorkerHealthPayload {
  ok?: unknown
  database?: unknown
  discordConfigured?: unknown
  discordVariables?: {
    applicationId?: unknown
    publicKey?: unknown
    botToken?: unknown
  }
  applicationId?: unknown
}

interface CommandStatusPayload {
  ok?: unknown
  applicationId?: unknown
  applicationIdMatches?: unknown
  publicKeyMatches?: unknown
  commandRegistered?: unknown
  error?: unknown
}

const applicationId = ref('')
const publicKey = ref('')
const botToken = ref('')
const credentialPersistence = ref<'local' | 'session'>('local')
const workerUrl = ref('')
const showToken = ref(false)
const oneClickDeployOpen = ref(false)
const githubDeployOpen = ref(false)
const manualDeployOpen = ref(false)
const connectionState = ref<ConnectionState>('idle')
const diagnosticState = ref<DiagnosticState>('idle')
const commandState = ref<CommandState>('idle')
const { statusMessage, setStatus, showTransientStatus } = useTransientStatus()

watch(
  assistantGuidance,
  (guide) => {
    if (guide?.destination !== 'inbox') return
    if (guide.id === 'discord-oneclick-tutorial') oneClickDeployOpen.value = true
    else if (guide.id === 'discord-github-tutorial') githubDeployOpen.value = true
    else if (guide.id === 'discord-manual-deploy-tutorial') manualDeployOpen.value = true
  },
  { immediate: true },
)

const endpoints = computed(() => getDiscordWorkerEndpoints(workerUrl.value))
const discordAppConfigured = computed(() =>
  Boolean(applicationId.value.trim() && publicKey.value.trim() && botToken.value.trim()),
)
const cloudflareStatusLabel = computed(() => {
  switch (diagnosticState.value) {
    case 'checking':
      return '配置核验中'
    case 'ready':
      return '配置核验通过'
    case 'd1-error':
      return 'D1 检查失败'
    case 'discord-missing':
      return 'Discord 变量缺失'
    case 'discord-invalid':
      return 'Discord 凭证不匹配'
    case 'worker-error':
      return 'Worker 检查失败'
    case 'outdated':
      return 'Worker 需更新'
    case 'need-token':
      return '待验证 Bot Token'
    default:
      return connectionState.value === 'testing'
        ? '检查中'
        : connectionState.value === 'connected'
          ? 'Worker / D1 可达'
          : connectionState.value === 'stale'
            ? '上次正常'
            : connectionState.value === 'error'
              ? '检查失败'
              : '待检查'
  }
})
const cloudflareStatusActive = computed(
  () =>
    diagnosticState.value === 'ready' ||
    (diagnosticState.value === 'idle' && ['connected', 'stale'].includes(connectionState.value)),
)
const cloudflareStatusError = computed(() =>
  ['d1-error', 'discord-missing', 'discord-invalid', 'worker-error', 'outdated'].includes(
    diagnosticState.value,
  ),
)
const developerAppUrl = computed(() => {
  const id = applicationId.value.trim()
  return id
    ? `https://discord.com/developers/applications/${encodeURIComponent(id)}/information`
    : 'https://discord.com/developers/applications'
})
const developerBotUrl = computed(() => {
  const id = applicationId.value.trim()
  return id
    ? `https://discord.com/developers/applications/${encodeURIComponent(id)}/bot`
    : 'https://discord.com/developers/applications'
})
const installationUrl = computed(() => {
  const id = applicationId.value.trim()
  return id
    ? `https://discord.com/developers/applications/${encodeURIComponent(id)}/installation`
    : 'https://discord.com/developers/applications'
})

watch([applicationId, publicKey, botToken, workerUrl], () => {
  if (diagnosticState.value !== 'checking') diagnosticState.value = 'idle'
})

function applyCachedStatus(): void {
  const settings = loadDiscordSourceConnectionSettings()
  connectionState.value = settings.workerVerifiedAt ? 'connected' : 'idle'
  if (!settings.commandCheckedAt) {
    commandState.value = 'idle'
  } else {
    commandState.value = settings.commandRegistered ? 'registered' : 'missing'
  }
}

function openDiscordHandoffPaste(): void {
  window.dispatchEvent(new Event('srl:open-discord-handoff-paste'))
  emit('close')
}

onMounted(() => {
  const settings = loadDiscordSourceConnectionSettings()
  applicationId.value = settings.applicationId
  publicKey.value = settings.publicKey
  botToken.value = settings.botToken
  workerUrl.value = settings.workerBaseUrl
  credentialPersistence.value = settings.credentialPersistence === 'session' ? 'session' : 'local'
  applyCachedStatus()
  if (settings.workerBaseUrl) {
    void verifyWorker(true)
    if (settings.botToken) void checkCommandStatus(true)
  }
})

function normalizeWorkerDraft(): void {
  const normalized = normalizeDiscordWorkerBaseUrl(workerUrl.value)
  if (normalized) workerUrl.value = normalized
}

function payloadApplicationId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const candidate = (value as { applicationId?: unknown }).applicationId
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function assertApplicationIdMatches(payload: unknown): void {
  const localId = applicationId.value.trim()
  const remoteId = payloadApplicationId(payload)
  if (localId && remoteId && localId !== remoteId) {
    throw new Error(
      `Worker 使用的是 Application ID ${remoteId}，与当前填写的 ${localId} 不一致。请统一 Discord App 与 Worker 配置。`,
    )
  }
}

function missingDiscordVariables(payload: WorkerHealthPayload): string[] | undefined {
  const checks = payload.discordVariables
  if (!checks || typeof checks !== 'object') return undefined
  const names = [
    ['applicationId', 'DISCORD_APPLICATION_ID'],
    ['publicKey', 'DISCORD_PUBLIC_KEY'],
    ['botToken', 'DISCORD_BOT_TOKEN'],
  ] as const
  if (names.some(([key]) => typeof checks[key] !== 'boolean')) return undefined
  return names.filter(([key]) => checks[key] === false).map(([, name]) => name)
}

function cachedWorkerWasHealthy(): boolean {
  return Boolean(loadDiscordSourceConnectionSettings().workerVerifiedAt)
}

function cachedCommandWasRegistered(): boolean {
  const settings = loadDiscordSourceConnectionSettings()
  return Boolean(settings.commandCheckedAt && settings.commandRegistered)
}

async function persistSettings(): Promise<boolean> {
  normalizeWorkerDraft()
  let saved: Awaited<ReturnType<typeof saveDiscordSourceConnectionSettings>>
  try {
    saved = await saveDiscordSourceConnectionSettings({
      applicationId: applicationId.value,
      publicKey: publicKey.value,
      botToken: botToken.value,
      workerBaseUrl: workerUrl.value,
      credentialPersistence: credentialPersistence.value,
    })
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Bot Token 未能保存到本机。')
    connectionState.value = 'error'
    return false
  }
  applicationId.value = saved.applicationId
  publicKey.value = saved.publicKey
  botToken.value = saved.botToken
  workerUrl.value = saved.workerBaseUrl
  credentialPersistence.value = saved.credentialPersistence === 'session' ? 'session' : 'local'
  if (!saved.workerBaseUrl) {
    setStatus('请粘贴 Cloudflare 部署完成后得到的 workers.dev 链接。')
    connectionState.value = 'error'
    return false
  }
  if (!saved.workerVerifiedAt && connectionState.value !== 'testing') connectionState.value = 'idle'
  if (!saved.commandCheckedAt && commandState.value !== 'registering') commandState.value = 'idle'
  return true
}

async function copyText(value: string, successMessage: string): Promise<void> {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const input = document.createElement('textarea')
    input.value = value
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.append(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  showTransientStatus(successMessage)
}

async function verifyWorker(background = false): Promise<boolean> {
  if (!endpoints.value) return false
  const hadCachedSuccess = cachedWorkerWasHealthy()
  if (!background || !hadCachedSuccess) connectionState.value = 'testing'
  if (!background) setStatus('正在检查你自己的 Worker…')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 6_000)
  try {
    const response = await fetch(endpoints.value.healthUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    const payload = (await response.json()) as WorkerHealthPayload
    if (payload.database === false)
      throw new Error('D1 查询或 handoffs 迁移表检查失败。请检查绑定、Database ID 和迁移。')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (payload.database !== true) throw new Error('Worker 的 /health 响应缺少 D1 检查结果。')
    assertApplicationIdMatches(payload)
    saveDiscordSourceConnectionStatus({ workerVerifiedAt: Date.now() })
    connectionState.value = 'connected'
    if (!background) showTransientStatus('Worker 已连接。SRL 已自动生成 Discord 所需地址。')
    return true
  } catch (error) {
    connectionState.value = hadCachedSuccess ? 'stale' : 'error'
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'Worker 当前复查超时。'
        : `当前无法复查 Worker：${error instanceof Error ? error.message : '未知错误'}`
    if (!background || !hadCachedSuccess) {
      setStatus(
        hadCachedSuccess
          ? `${message} 上次真实检查正常，本机配置不会因此被重置。`
          : `${message} 请确认部署链接是否正确。`,
      )
    }
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

async function checkCommandStatus(background = false): Promise<boolean | undefined> {
  if (!endpoints.value || !botToken.value.trim()) return undefined
  const hadCachedRegistration = cachedCommandWasRegistered()
  if (!background || !hadCachedRegistration) commandState.value = 'checking'
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(endpoints.value.statusUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${botToken.value.trim()}` },
      signal: controller.signal,
    })
    if (response.status === 404) {
      throw new Error('当前 Bridge 版本还不支持真实命令状态检查，请更新并重新部署。')
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as CommandStatusPayload
    assertApplicationIdMatches(payload)
    if (payload.applicationIdMatches === false) {
      throw new Error('Cloudflare 中的 Application ID 与 Bot Token 所属的 Discord App 不一致。')
    }
    if (payload.publicKeyMatches === false) {
      throw new Error(
        'Cloudflare 中的 Public Key 与 Bot Token 所属 Discord App 的 Public Key 不一致。',
      )
    }
    if (typeof payload.commandRegistered !== 'boolean') {
      throw new Error('Worker 没有返回有效的消息命令状态。')
    }
    const checkedAt = Date.now()
    saveDiscordSourceConnectionStatus({
      workerVerifiedAt: checkedAt,
      commandCheckedAt: checkedAt,
      commandRegistered: payload.commandRegistered,
    })
    connectionState.value = 'connected'
    commandState.value = payload.commandRegistered ? 'registered' : 'missing'
    return payload.commandRegistered
  } catch (error) {
    commandState.value = hadCachedRegistration ? 'stale' : 'error'
    if (!background || !hadCachedRegistration) {
      setStatus(
        hadCachedRegistration
          ? `当前无法复查 Discord 消息命令：${error instanceof Error ? error.message : '未知错误'}。上次真实检查正常，不会要求你重复注册。`
          : `无法检查 Discord 消息命令：${error instanceof Error ? error.message : '未知错误'}`,
      )
    }
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}

async function testConnection(): Promise<void> {
  if (!(await persistSettings()) || !endpoints.value) return
  const connected = await verifyWorker(false)
  if (connected && botToken.value.trim()) void checkCommandStatus(true)
}

async function diagnoseConfiguration(): Promise<void> {
  if (!(await persistSettings()) || !endpoints.value) return
  diagnosticState.value = 'checking'
  setStatus('正在检查 Worker、D1 和 Discord 配置…')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15_000)
  try {
    const healthResponse = await fetch(endpoints.value.healthUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    let health: WorkerHealthPayload = {}
    try {
      health = (await healthResponse.json()) as WorkerHealthPayload
    } catch {
      throw new Error(`Worker /health 没有返回有效 JSON（HTTP ${healthResponse.status}）。`)
    }

    const missingVariables = missingDiscordVariables(health)
    if (health.database !== true) {
      connectionState.value = 'error'
      diagnosticState.value = 'd1-error'
      const missing = missingVariables?.length
        ? ` 同时发现 Worker 缺少：${missingVariables.join('、')}。`
        : ''
      setStatus(
        `Worker 已响应，但 D1 或 handoffs 迁移表检查失败（HTTP ${healthResponse.status}）。检查数据库是否创建在当前 Cloudflare 账号、Database ID 和 DB 绑定是否对应，并确认迁移已完成。${missing}`,
      )
      return
    }
    if (!healthResponse.ok || health.ok !== true) {
      throw new Error(`Worker /health 检查失败（HTTP ${healthResponse.status}）。`)
    }
    saveDiscordSourceConnectionStatus({ workerVerifiedAt: Date.now() })
    connectionState.value = 'connected'

    const workerApplicationId = payloadApplicationId(health)
    const localApplicationId = applicationId.value.trim()
    if (localApplicationId && workerApplicationId && localApplicationId !== workerApplicationId) {
      diagnosticState.value = 'discord-invalid'
      setStatus(
        `D1 正常，但 Worker 的 Application ID（${workerApplicationId}）与本机填写的 ID 不同。检查 wrangler.jsonc 是否来自同一个 Discord App。`,
      )
      return
    }

    if (!missingVariables) {
      diagnosticState.value = 'outdated'
      setStatus(
        health.discordConfigured === false
          ? 'D1 正常，但当前 Worker 版本未提供三项 Discord 变量的逐项检查。更新并重新部署 Bridge 后再检查。'
          : 'D1 正常，但当前 Worker 版本不支持完整配置核验。更新并重新部署 Bridge 后再检查。',
      )
      return
    }
    if (missingVariables.length || health.discordConfigured !== true) {
      diagnosticState.value = 'discord-missing'
      setStatus(
        missingVariables.length
          ? `D1 正常；Worker 缺少 Discord 变量：${missingVariables.join('、')}。检查 wrangler.jsonc 中的 Application ID / Public Key，并在 Cloudflare Production 添加 Bot Token Secret。`
          : 'D1 正常，但 Worker 报告 Discord 配置未完成；检查三个值是否已部署到 Production。',
      )
      return
    }
    if (!botToken.value.trim()) {
      diagnosticState.value = 'need-token'
      setStatus(
        'D1 正常，Worker 中三项 Discord 值均已填写；请在本机填入 Bot Token，才能向 Discord API 核验它们是否有效。',
      )
      return
    }

    const discordResponse = await fetch(endpoints.value.statusUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${botToken.value.trim()}` },
      signal: controller.signal,
    })
    let discord: CommandStatusPayload = {}
    try {
      discord = (await discordResponse.json()) as CommandStatusPayload
    } catch {
      discord = {}
    }
    if (discordResponse.status === 401) {
      diagnosticState.value = 'discord-invalid'
      setStatus('D1 正常，但本机 Bot Token 与 Cloudflare 中的 DISCORD_BOT_TOKEN Secret 不一致。')
      return
    }
    if (discordResponse.status === 404) {
      diagnosticState.value = 'outdated'
      setStatus('D1 正常，但当前 Worker 没有凭证核验接口。更新并重新部署 Bridge 后再检查。')
      return
    }
    if (!discordResponse.ok) {
      const detail =
        typeof discord.error === 'string' ? discord.error : `HTTP ${discordResponse.status}`
      diagnosticState.value = 'discord-invalid'
      setStatus(
        /\b401\b/u.test(detail)
          ? 'D1 正常，但 Discord 拒绝了 Bot Token。请确认 Token 来自当前 App 的 Bot 页面且未重置后仍使用旧值。'
          : `D1 正常，但 Discord 凭证核验失败：${detail}`,
      )
      return
    }
    if (
      typeof discord.applicationIdMatches !== 'boolean' ||
      typeof discord.publicKeyMatches !== 'boolean'
    ) {
      diagnosticState.value = 'outdated'
      setStatus(
        'D1 正常，但当前 Worker 版本没有返回 Application ID / Public Key 的真实性核验结果。更新并重新部署 Bridge 后再检查。',
      )
      return
    }
    if (!discord.applicationIdMatches) {
      diagnosticState.value = 'discord-invalid'
      setStatus('D1 正常，但 DISCORD_APPLICATION_ID 与 Bot Token 所属 App 不一致。')
      return
    }
    if (!discord.publicKeyMatches) {
      diagnosticState.value = 'discord-invalid'
      setStatus('D1 正常，但 DISCORD_PUBLIC_KEY 与 Bot Token 所属 App 的 Public Key 不一致。')
      return
    }
    if (typeof discord.commandRegistered === 'boolean') {
      const checkedAt = Date.now()
      saveDiscordSourceConnectionStatus({
        workerVerifiedAt: checkedAt,
        commandCheckedAt: checkedAt,
        commandRegistered: discord.commandRegistered,
      })
      commandState.value = discord.commandRegistered ? 'registered' : 'missing'
    }
    diagnosticState.value = 'ready'
    setStatus(
      discord.commandRegistered === false
        ? '核验通过：Worker 可访问、D1 查询成功，Bot Token 有效，Application ID 和 Public Key 匹配；消息命令还未注册。'
        : '核验通过：Worker 可访问、D1 查询成功，Bot Token 有效，Application ID 和 Public Key 与同一个 Discord App 匹配。',
    )
  } catch (error) {
    if (error instanceof Error && /Application ID/u.test(error.message)) {
      diagnosticState.value = 'discord-invalid'
    } else {
      diagnosticState.value = 'worker-error'
    }
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? '检查超时。'
        : error instanceof TypeError
          ? '无法访问 Worker /health。检查 Worker URL、workers.dev 是否启用，以及部署是否完成。'
          : error instanceof Error
            ? error.message
            : '未知错误'
    setStatus(message)
  } finally {
    window.clearTimeout(timer)
  }
}

async function registerCommand(): Promise<void> {
  if (!(await persistSettings()) || !endpoints.value || !botToken.value.trim()) return
  commandState.value = 'registering'
  setStatus('正在请求 Worker 注册 Discord 消息命令…')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(endpoints.value.registerUrl, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${botToken.value.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ applicationId: applicationId.value.trim() }),
      signal: controller.signal,
    })
    let payload: CommandStatusPayload = {}
    try {
      payload = (await response.json()) as CommandStatusPayload
    } catch {
      payload = {}
    }
    if (response.status === 409 && payload.error === 'application_id_mismatch') {
      assertApplicationIdMatches(payload)
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    assertApplicationIdMatches(payload)
    const checkedAt = Date.now()
    saveDiscordSourceConnectionStatus({
      workerVerifiedAt: checkedAt,
      commandCheckedAt: checkedAt,
      commandRegistered: true,
    })
    connectionState.value = 'connected'
    commandState.value = 'registered'
    showTransientStatus('帖子保存、资源下载与绑定命令已注册并确认。')
  } catch (error) {
    commandState.value = cachedCommandWasRegistered() ? 'stale' : 'error'
    setStatus(
      error instanceof DOMException && error.name === 'AbortError'
        ? '注册请求超时，请先确认 Worker 可以正常访问。'
        : `消息命令注册失败：${error instanceof Error ? error.message : '未知错误'}`,
    )
  } finally {
    window.clearTimeout(timer)
  }
}

async function clearBotToken(): Promise<void> {
  botToken.value = ''
  if (await persistSettings()) {
    connectionState.value = 'idle'
    commandState.value = 'idle'
    showTransientStatus('Discord Bot Token 已从本机清除。')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="resource-source-advanced-overlay mobile-dialog-viewport"
      role="presentation"
      @click.self="emit('close')"
    >
      <section
        class="resource-source-advanced"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-source-advanced-title"
      >
        <header class="resource-source-advanced__header">
          <div>
            <button class="resource-source-advanced__back" type="button" @click="emit('close')">
              ← {{ props.backLabel }}
            </button>
            <h2 id="resource-source-advanced-title">{{ props.title }}</h2>
            <p>配置你自己的 Discord App 与 Cloudflare Worker。配置只保存在本机。</p>
          </div>
        </header>

        <DiscordInboxPanel mode="pairing" />

        <div class="resource-source-status-strip" aria-label="Discord 来源状态">
          <span>
            <i :class="{ 'is-active': discordAppConfigured }"></i>
            Discord App
            <strong>{{ discordAppConfigured ? '已填写' : '待填写' }}</strong>
          </span>
          <span>
            <i
              :class="{
                'is-active': cloudflareStatusActive,
                'is-error': cloudflareStatusError,
                'is-checking': diagnosticState === 'checking',
              }"
            ></i>
            Cloudflare
            <strong>{{ cloudflareStatusLabel }}</strong>
          </span>
          <span>
            <i :class="{ 'is-active': ['registered', 'stale'].includes(commandState) }"></i>
            消息命令
            <strong>{{
              commandState === 'registering'
                ? '注册中'
                : commandState === 'checking'
                  ? '检查中'
                  : commandState === 'registered'
                    ? '正常'
                    : commandState === 'stale'
                      ? '上次正常'
                      : commandState === 'error'
                        ? '检查失败'
                        : commandState === 'missing'
                          ? '待注册'
                          : '待检查'
            }}</strong>
          </span>
        </div>

        <section class="resource-source-handoff">
          <div>
            <strong>从 Discord 领取分享</strong>
            <p>iOS 桌面 PWA 请回到这里粘贴临时链接，确保保存到这份资源库。</p>
          </div>
          <button type="button" @click="openDiscordHandoffPaste">粘贴领取链接</button>
        </section>

        <section class="resource-source-deploy" aria-labelledby="resource-source-deploy-title">
          <header>
            <span id="resource-source-deploy-title">部署 Discord Bridge</span>
            <p>三种方式都部署到你自己的 Cloudflare；SRL 不经过开发者公共 Worker。</p>
          </header>
          <div class="resource-source-deploy__choices">
            <button type="button" @click="githubDeployOpen = true">
              <strong>GitHub 仓库部署</strong>
              <small>推荐长期使用 · Fork 后可同步上游更新并自动部署</small>
              <span>›</span>
            </button>
            <button type="button" @click="oneClickDeployOpen = true">
              <strong>Cloudflare 一键部署</strong>
              <small>适合快速开始 · 上游版本需自己合并到副本</small>
              <span>›</span>
            </button>
            <button type="button" @click="manualDeployOpen = true">
              <strong>浏览器手动部署</strong>
              <small>打开逐步教程；不需要 GitHub / GitLab 或终端</small>
              <span>›</span>
            </button>
          </div>
          <a
            class="resource-source-deploy__source"
            :href="DISCORD_BRIDGE_PUBLIC_REPOSITORY_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            查看公开 Bridge 模板源码
          </a>
        </section>

        <div class="resource-source-advanced__form">
          <label>
            <span>Application ID</span>
            <div>
              <input
                v-model="applicationId"
                autocomplete="off"
                inputmode="numeric"
                maxlength="64"
              />
              <button type="button" @click="copyText(applicationId, '已复制 Application ID')">
                复制
              </button>
            </div>
          </label>

          <label>
            <span>Public Key</span>
            <div>
              <input v-model="publicKey" autocomplete="off" maxlength="256" />
              <button type="button" @click="copyText(publicKey, '已复制 Public Key')">复制</button>
            </div>
          </label>

          <label>
            <span>Bot Token</span>
            <div>
              <input
                v-model="botToken"
                :type="showToken ? 'text' : 'password'"
                autocomplete="off"
                maxlength="512"
              />
              <button type="button" @click="showToken = !showToken">
                {{ showToken ? '隐藏' : '显示' }}
              </button>
            </div>
            <small>默认由设备保护存储保存；普通资源导出和云备份默认不包含。</small>
          </label>

          <label>
            <span>Token 保存方式</span>
            <div>
              <select v-model="credentialPersistence">
                <option value="local">保存在本机（推荐）</option>
                <option value="session">仅本次使用</option>
              </select>
              <button type="button" @click="clearBotToken">清除本机 Token</button>
            </div>
          </label>

          <label>
            <span>Cloudflare 部署链接</span>
            <input
              v-model="workerUrl"
              inputmode="url"
              maxlength="2000"
              placeholder="https://你的-worker.workers.dev"
              @blur="normalizeWorkerDraft"
            />
            <small>
              只粘贴 Cloudflare 部署完成后给你的链接即可。即使误粘了 /interactions，SRL
              也会自动识别并整理。
            </small>
          </label>

          <section v-if="endpoints" class="resource-source-endpoint">
            <div>
              <span>Discord 最终地址</span>
              <strong>{{ endpoints.interactionsUrl }}</strong>
              <small>
                把这一条粘到 Discord 的 Interactions Endpoint URL。其他技术路径由 SRL 自动处理。
              </small>
            </div>
            <button
              type="button"
              @click="copyText(endpoints.interactionsUrl, '已复制 Discord 最终地址')"
            >
              复制地址
            </button>
          </section>

          <div class="resource-source-advanced__actions">
            <button
              class="button button--primary"
              type="button"
              :disabled="connectionState === 'testing'"
              @click="testConnection"
            >
              {{ connectionState === 'testing' ? '正在检查…' : '保存并测试连接' }}
            </button>
            <button
              class="button button--quiet"
              type="button"
              :disabled="!endpoints || diagnosticState === 'checking'"
              @click="diagnoseConfiguration"
            >
              {{ diagnosticState === 'checking' ? '正在核验…' : '检查部署配置' }}
            </button>
            <button
              class="button button--quiet"
              type="button"
              :disabled="
                !endpoints ||
                !botToken.trim() ||
                commandState === 'registering' ||
                commandState === 'checking'
              "
              @click="registerCommand"
            >
              {{ commandState === 'registering' ? '正在注册…' : '注册消息命令' }}
            </button>
          </div>

          <p v-if="statusMessage" class="resource-source-advanced__status" role="status">
            {{ statusMessage }}
          </p>
        </div>

        <footer class="resource-source-advanced__quick-links">
          <a :href="developerAppUrl" target="_blank" rel="noopener noreferrer">
            创建 / 打开 Discord App
          </a>
          <a :href="installationUrl" target="_blank" rel="noopener noreferrer">打开安装页面</a>
        </footer>

        <p class="resource-source-advanced__status">帖子收件和资源下载请到“功能 → 收件箱”查看。</p>
        <DiscordPendingSources
          v-if="props.contextResourceId"
          :context-resource-id="props.contextResourceId"
        />
      </section>
    </div>
  </Teleport>

  <DiscordSetupGuideDrawer
    :open="oneClickDeployOpen"
    :application-id="applicationId"
    :public-key="publicKey"
    :bot-token="botToken"
    :interactions-url="endpoints?.interactionsUrl"
    :installation-url="installationUrl"
    :developer-app-url="developerAppUrl"
    :developer-bot-url="developerBotUrl"
    @close="oneClickDeployOpen = false"
  />

  <DiscordSetupGuideDrawer
    :open="githubDeployOpen"
    deployment-mode="github"
    :application-id="applicationId"
    :public-key="publicKey"
    :bot-token="botToken"
    :interactions-url="endpoints?.interactionsUrl"
    :installation-url="installationUrl"
    :developer-app-url="developerAppUrl"
    :developer-bot-url="developerBotUrl"
    @close="githubDeployOpen = false"
  />

  <DiscordManualDeployDrawer
    :open="manualDeployOpen"
    :application-id="applicationId"
    :public-key="publicKey"
    :bot-token="botToken"
    :interactions-url="endpoints?.interactionsUrl"
    :installation-url="installationUrl"
    :developer-app-url="developerAppUrl"
    :developer-bot-url="developerBotUrl"
    @close="manualDeployOpen = false"
  />
</template>

<style scoped src="../styles/ResourceLinkAdvancedSettings.css"></style>
