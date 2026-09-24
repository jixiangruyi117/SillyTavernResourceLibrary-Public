<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useTransientStatus } from '../composables/UseTransientStatus'
import {
  DISCORD_BRIDGE_DEPLOY_URL,
  DISCORD_BRIDGE_PUBLIC_REPOSITORY_URL,
} from '../services/DiscordBridgeDeployService'
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
import DiscordPendingSources from './DiscordPendingSources.vue'
import DiscordSetupGuideDrawer from './DiscordSetupGuideDrawer.vue'

const props = defineProps<{ contextResourceId?: string }>()
const emit = defineEmits<{ close: [] }>()

type ConnectionState = 'idle' | 'testing' | 'connected' | 'stale' | 'error'
type CommandState =
  'idle' | 'checking' | 'registering' | 'registered' | 'missing' | 'stale' | 'error'

interface WorkerHealthPayload {
  ok?: unknown
  applicationId?: unknown
}

interface CommandStatusPayload {
  ok?: unknown
  applicationId?: unknown
  commandRegistered?: unknown
  error?: unknown
}

const applicationId = ref('')
const publicKey = ref('')
const botToken = ref('')
const credentialPersistence = ref<'local' | 'session'>('local')
const workerUrl = ref('')
const showToken = ref(false)
const guideOpen = ref(false)
const manualDeployOpen = ref(false)
const connectionState = ref<ConnectionState>('idle')
const commandState = ref<CommandState>('idle')
const { statusMessage, setStatus, showTransientStatus } = useTransientStatus()

const endpoints = computed(() => getDiscordWorkerEndpoints(workerUrl.value))
const discordAppConfigured = computed(() =>
  Boolean(applicationId.value.trim() && publicKey.value.trim() && botToken.value.trim()),
)
const developerAppUrl = computed(() => {
  const id = applicationId.value.trim()
  return id
    ? `https://discord.com/developers/applications/${encodeURIComponent(id)}/information`
    : 'https://discord.com/developers/applications'
})
const installationUrl = computed(() => {
  const id = applicationId.value.trim()
  return id
    ? `https://discord.com/developers/applications/${encodeURIComponent(id)}/installation`
    : 'https://discord.com/developers/applications'
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as WorkerHealthPayload
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
    showTransientStatus('“保存到资源库”消息命令已注册并确认。')
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
              ← 返回来源与链接
            </button>
            <h2 id="resource-source-advanced-title">来源链接高级设置</h2>
            <p>配置你自己的 Discord App 与 Cloudflare Worker。配置只保存在本机。</p>
          </div>
          <button class="resource-source-advanced__guide" type="button" @click="guideOpen = true">
            配置教程
          </button>
        </header>

        <div class="resource-source-status-strip" aria-label="Discord 来源状态">
          <span>
            <i :class="{ 'is-active': discordAppConfigured }"></i>
            Discord App
            <strong>{{ discordAppConfigured ? '已配置' : '待配置' }}</strong>
          </span>
          <span>
            <i :class="{ 'is-active': ['connected', 'stale'].includes(connectionState) }"></i>
            Cloudflare
            <strong>{{
              connectionState === 'testing'
                ? '检查中'
                : connectionState === 'connected'
                  ? '已连接'
                  : connectionState === 'stale'
                    ? '上次正常'
                    : connectionState === 'error'
                      ? '检查失败'
                      : '待检查'
            }}</strong>
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

        <section class="resource-source-deploy" aria-labelledby="resource-source-deploy-title">
          <header>
            <span id="resource-source-deploy-title">部署 Discord Bridge</span>
            <p>两种方式都部署到你自己的 Cloudflare；SRL 不经过开发者公共 Worker。</p>
          </header>
          <div class="resource-source-deploy__choices">
            <a :href="DISCORD_BRIDGE_DEPLOY_URL" target="_blank" rel="noopener noreferrer">
              <strong>一键部署到 Cloudflare</strong>
              <small>推荐 · 需要 GitHub 或 GitLab</small>
              <span>›</span>
            </a>
            <button type="button" @click="manualDeployOpen = true">
              <strong>只有 Cloudflare？浏览器手动部署</strong>
              <small>不需要 GitHub / GitLab，也不需要终端</small>
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

        <DiscordPendingSources :context-resource-id="props.contextResourceId" />
      </section>
    </div>
  </Teleport>

  <DiscordSetupGuideDrawer
    :open="guideOpen"
    :interactions-url="endpoints?.interactionsUrl"
    @close="guideOpen = false"
  />

  <DiscordManualDeployDrawer
    :open="manualDeployOpen"
    :application-id="applicationId"
    :public-key="publicKey"
    :bot-token="botToken"
    @close="manualDeployOpen = false"
  />
</template>

<style scoped src="../styles/ResourceLinkAdvancedSettings.css"></style>
