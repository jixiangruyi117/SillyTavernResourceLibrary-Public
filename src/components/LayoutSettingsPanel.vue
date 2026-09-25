<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { platform } from '../core/PlatformService'
import { resetPerformanceMonitorPosition } from '../core/PerformanceMonitor'
import { forceRefresh, manualCheckForUpdate } from '../core/ServiceWorkerUpdate'
import {
  downloadFullOfflineResources,
  getOfflineResourceStatus,
  removeFullOfflineResources,
  type OfflineResourceStatus,
} from '../core/OfflineResources'
import { getNativeResourceStorageInfo } from '../storage/NativeResourceFileMirror'
import type { NativeSecurityState } from '../core/NativeSecurity'
import type { NativeSafBackupStatus } from '../core/NativeSafBackup'
import { isNativeHapticsEnabled, setNativeHapticsEnabled } from '../core/NativeHaptics'
import type { NativeSystemUiState } from '../core/NativeSystemUi'
import MainApiSettings from './MainApiSettings.vue'
import SecretProtectionSettings from './SecretProtectionSettings.vue'
import ResourceHealthCenter from './ResourceHealthCenter.vue'

const props = defineProps<{
  vaultEnabled: boolean
  allowRemotePreviews: boolean
  allowScriptPreviews: boolean
  preloadGreetingPreviews: boolean
  preloadBeautificationPreviews: boolean
  extractCharacterAssets: boolean
  hideCharacterAssets: boolean
  hideChatDisplayRegex: boolean
  showManuallyBoundResources: boolean
  blurThumbnails: boolean
  showPerformanceMonitor: boolean
  hiddenCharacterAssetCount: number
  historySnapshotLimit: number
  historySnapshotCount: number
}>()

const emit = defineEmits<{
  'library-changed': []
  'update:allowRemotePreviews': [value: boolean]
  'update:allowScriptPreviews': [value: boolean]
  'update:preloadGreetingPreviews': [value: boolean]
  'update:preloadBeautificationPreviews': [value: boolean]
  'update:extractCharacterAssets': [value: boolean]
  'update:hideCharacterAssets': [value: boolean]
  'update:hideChatDisplayRegex': [value: boolean]
  'update:showManuallyBoundResources': [value: boolean]
  'update:blurThumbnails': [value: boolean]
  'update:showPerformanceMonitor': [value: boolean]
  'update:historySnapshotLimit': [value: number]
  'manage-folders': []
  'open-vault': []
  'open-version-recognition': []
  'manual-check-update': []
  close: []
}>()

const snapshotLimitDraft = ref(props.historySnapshotLimit)
const updateCheckResult = ref('')
const isNativeApk = platform.update.isAndroidApk()
const nativeStorageInfo = ref<Awaited<ReturnType<typeof getNativeResourceStorageInfo>>>(null)
const nativeSecurityState = ref<NativeSecurityState | null>(null)
const nativeBiometricMessage = ref('')
const nativeNotificationMessage = ref('')
const nativeSafBackup = ref<NativeSafBackupStatus | null>(null)
const nativeHapticsEnabled = ref(isNativeHapticsEnabled())
const nativeSystemUiState = ref<NativeSystemUiState | null>(null)
const offlineResourceStatus = ref<OfflineResourceStatus | null>(null)
const offlineResourceMessage = ref('')
const offlineDownloadPercent = ref(0)
const isDownloadingOfflineResources = ref(false)
let offlineDownloadController: AbortController | undefined
onMounted(async () => {
  const [storage, security, saf, systemUi, offline] = await Promise.all([
    getNativeResourceStorageInfo().catch(() => null),
    platform.security.getState().catch(() => null),
    platform.backup.getStatus().catch(() => null),
    platform.systemUi.getState().catch(() => null),
    isNativeApk ? Promise.resolve(null) : getOfflineResourceStatus().catch(() => null),
  ])
  nativeStorageInfo.value = storage
  nativeSecurityState.value = security
  nativeSafBackup.value = saf
  nativeSystemUiState.value = systemUi
  offlineResourceStatus.value = offline
})
onBeforeUnmount(() => offlineDownloadController?.abort())
watch(
  () => props.historySnapshotLimit,
  (value) => {
    snapshotLimitDraft.value = value
  },
)

function saveSnapshotLimit(): void {
  const value = Number(snapshotLimitDraft.value)
  if (!Number.isFinite(value)) return
  emit('update:historySnapshotLimit', value)
}

async function handleCheckUpdate(): Promise<void> {
  updateCheckResult.value = '正在检查…'
  try {
    updateCheckResult.value = isNativeApk
      ? 'APK 由部署者自行构建和安装更新。'
      : await manualCheckForUpdate()
  } catch (error) {
    updateCheckResult.value = `检查失败：${error instanceof Error ? error.message : '未知错误'}`
  }
}

async function toggleSecureScreen(event: Event): Promise<void> {
  const enabled = (event.target as HTMLInputElement).checked
  await platform.security.setSecureScreen(enabled)
  if (nativeSecurityState.value) nativeSecurityState.value.secureScreen = enabled
}

async function verifyDeviceOwner(): Promise<void> {
  try {
    nativeBiometricMessage.value = (await platform.security.verifyDeviceOwner())
      ? '本机身份验证成功'
      : '本机身份验证未完成'
  } catch (error) {
    nativeBiometricMessage.value = error instanceof Error ? error.message : '本机身份验证未完成'
  }
}

async function enableNativeNotifications(): Promise<void> {
  const granted = await platform.security.requestNotifications().catch(() => false)
  if (nativeSecurityState.value) nativeSecurityState.value.notificationsGranted = granted
  nativeNotificationMessage.value = granted
    ? '系统任务通知已允许'
    : '未授予通知权限；后台导入和备份仍会执行'
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes < 0) return '系统未提供'
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

async function chooseSafBackupDirectory(): Promise<void> {
  nativeSafBackup.value = await platform.backup.chooseDirectory().catch(() => nativeSafBackup.value)
}

async function clearSafBackupDirectory(): Promise<void> {
  await platform.backup.clearDirectory()
  nativeSafBackup.value = await platform.backup.getStatus().catch(() => null)
}

function toggleNativeHaptics(event: Event): void {
  nativeHapticsEnabled.value = (event.target as HTMLInputElement).checked
  setNativeHapticsEnabled(nativeHapticsEnabled.value)
}

async function toggleNativeStatusBar(event: Event): Promise<void> {
  const show = (event.target as HTMLInputElement).checked
  nativeSystemUiState.value = await platform.systemUi.setStatusBarVisible(show)
}

async function downloadOfflineResources(): Promise<void> {
  if (isDownloadingOfflineResources.value) return
  isDownloadingOfflineResources.value = true
  offlineDownloadPercent.value = 0
  offlineResourceMessage.value = '正在准备完整离线资源…'
  offlineDownloadController = new AbortController()
  try {
    offlineResourceStatus.value = await downloadFullOfflineResources({
      signal: offlineDownloadController.signal,
      onProgress: (progress) => {
        offlineDownloadPercent.value = progress.total
          ? Math.round((progress.completed / progress.total) * 100)
          : 100
        offlineResourceMessage.value = `正在缓存 ${progress.completed}/${progress.total}（${offlineDownloadPercent.value}%）`
      },
    })
    offlineResourceMessage.value = '完整离线资源已更新'
  } catch (error) {
    offlineResourceMessage.value =
      error instanceof DOMException && error.name === 'AbortError'
        ? '已停止下载；已完成的文件会在下次继续复用'
        : `下载失败：${error instanceof Error ? error.message : '未知错误'}`
  } finally {
    offlineDownloadController = undefined
    isDownloadingOfflineResources.value = false
  }
}

function cancelOfflineDownload(): void {
  offlineDownloadController?.abort()
}

async function clearOfflineResources(): Promise<void> {
  await removeFullOfflineResources()
  offlineResourceStatus.value = await getOfflineResourceStatus().catch(() => null)
  offlineResourceMessage.value = '已移除主动下载的完整离线资源；应用壳离线能力仍保留'
}
</script>

<template>
  <div
    class="editor-overlay layout-settings-overlay"
    role="presentation"
    @click.self="emit('close')"
  >
    <section
      class="layout-settings-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="layout-settings-title"
    >
      <header class="editor-sheet__header layout-settings__header">
        <div>
          <h2 id="layout-settings-title">设置</h2>
          <p>管理导入、预览安全和本地数据。外观与排版已移至“功能 → 外观”。</p>
        </div>
        <button
          class="editor-sheet__close"
          type="button"
          aria-label="关闭设置"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="settings-sections">
        <SecretProtectionSettings />
        <MainApiSettings />
        <section class="settings-section settings-section--preview-safety">
          <header>
            <div>
              <h3>HTML / CSS 预览安全</h3>
            </div>
            <span>全局生效</span>
          </header>
          <label
            class="settings-switch-row"
            :class="{ 'settings-switch-row--disabled': allowScriptPreviews }"
          >
            <span>
              <strong>允许远程资源</strong>
              <small
                >可加载 URL 直链背景、图片、样式与字体。远程服务器可能记录你的
                IP、访问时间、浏览器信息和来源地址；不会执行 JavaScript。</small
              >
            </span>
            <input
              type="checkbox"
              :checked="allowRemotePreviews"
              :disabled="allowScriptPreviews"
              @change="
                emit('update:allowRemotePreviews', ($event.target as HTMLInputElement).checked)
              "
            />
            <i aria-hidden="true"></i>
          </label>
          <label class="settings-switch-row settings-switch-row--danger">
            <span>
              <strong>完整运行隔离 JavaScript</strong>
              <small
                >执行完整内联/远程脚本，并允许 URL 图片、音频、字体和联网请求。未知代码可能暴露
                IP、诱导跳转、持续运算或让页面卡顿；仍禁止同源权限、表单提交和访问资源库、IndexedDB
                或主页面。</small
              >
            </span>
            <input
              type="checkbox"
              :checked="allowScriptPreviews"
              @change="
                emit('update:allowScriptPreviews', ($event.target as HTMLInputElement).checked)
              "
            />
            <i aria-hidden="true"></i>
          </label>
          <label
            v-if="isNativeApk"
            class="settings-switch-row"
            :class="{ 'settings-switch-row--disabled': !allowRemotePreviews }"
          >
            <span>
              <strong>开场白：Android 后台缓存</strong>
              <small
                >优先显示当前页的图片、背景和字体；Android APK
                会在后台缓存可读取的资源，不会因缓存失败阻塞预览。</small
              >
            </span>
            <input
              type="checkbox"
              :checked="preloadGreetingPreviews"
              :disabled="!allowRemotePreviews"
              @change="
                emit('update:preloadGreetingPreviews', ($event.target as HTMLInputElement).checked)
              "
            />
            <i aria-hidden="true"></i>
          </label>
          <label
            v-if="isNativeApk"
            class="settings-switch-row"
            :class="{ 'settings-switch-row--disabled': !allowRemotePreviews }"
          >
            <span>
              <strong>美化：Android 后台缓存</strong>
              <small
                >优先显示主题场景的图片、背景和字体；Android APK
                会在后台缓存可读取的资源，不会因缓存失败阻塞预览。</small
              >
            </span>
            <input
              type="checkbox"
              :checked="preloadBeautificationPreviews"
              :disabled="!allowRemotePreviews"
              @change="
                emit(
                  'update:preloadBeautificationPreviews',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            <i aria-hidden="true"></i>
          </label>
        </section>

        <section class="settings-section">
          <header>
            <div>
              <h3>性能观测</h3>
            </div>
            <span>仅此设备</span>
          </header>
          <label class="settings-switch-row">
            <span>
              <strong>显示性能胶囊</strong>
              <small>悬浮显示首屏、列表、滚动和长任务读数；关闭后同时停止本页的性能观测。</small>
            </span>
            <input
              type="checkbox"
              :checked="showPerformanceMonitor"
              @change="
                emit('update:showPerformanceMonitor', ($event.target as HTMLInputElement).checked)
              "
            />
            <i aria-hidden="true"></i>
          </label>
          <button
            class="settings-action-row"
            type="button"
            @click="resetPerformanceMonitorPosition"
          >
            <span>
              <strong>恢复性能胶囊位置</strong>
              <small>收起胶囊并恢复默认位置，保留本次诊断记录。</small>
            </span>
            <i aria-hidden="true">↺</i>
          </button>
        </section>

        <section class="settings-section">
          <header>
            <div>
              <h3>角色卡配套资源</h3>
            </div>
            <span>导入时生效</span>
          </header>
          <label class="settings-switch-row">
            <span>
              <strong>自动拆分配套资源</strong>
              <small>
                将角色卡或预设内嵌的世界书、整组正则保存为独立资源并双向绑定。原文件不会被修改。
              </small>
            </span>
            <input
              type="checkbox"
              :checked="extractCharacterAssets"
              @change="
                emit('update:extractCharacterAssets', ($event.target as HTMLInputElement).checked)
              "
            />
            <i aria-hidden="true"></i>
          </label>
          <label class="settings-switch-row">
            <span>
              <strong>在资源库隐藏自动拆分项</strong>
              <small>
                当前
                {{ hiddenCharacterAssetCount }}
                项。只从普通列表隐藏，关联、搜索绑定、导出与备份仍会保留。
              </small>
            </span>
            <input
              type="checkbox"
              :checked="hideCharacterAssets"
              @change="
                emit('update:hideCharacterAssets', ($event.target as HTMLInputElement).checked)
              "
            />
            <i aria-hidden="true"></i>
          </label>
          <label class="settings-switch-row">
            <span
              ><strong>隐藏聊天记录配套正则</strong
              ><small
                >只隐藏随聊天关联的显示正则；读了么、导出与备份仍可使用，独立正则不受影响。</small
              ></span
            >
            <input
              type="checkbox"
              :checked="hideChatDisplayRegex"
              @change="
                emit('update:hideChatDisplayRegex', ($event.target as HTMLInputElement).checked)
              "
            />
            <i aria-hidden="true"></i>
          </label>
          <label class="settings-switch-row">
            <span>
              <strong>是否显示手动绑定资源</strong>
              <small
                >关闭后隐藏手动选中的配套项，保留主资源；关联查看、导出与备份不受影响。旧关系没有方向记录，可解除后重新绑定。</small
              >
            </span>
            <input
              type="checkbox"
              :checked="showManuallyBoundResources"
              @change="
                emit(
                  'update:showManuallyBoundResources',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            <i aria-hidden="true"></i>
          </label>
          <label class="settings-switch-row">
            <span>
              <strong>默认模糊角色卡缩略图</strong>
              <small>
                开启后角色卡缩略图默认显示模糊态，点击后才清晰展示。关闭则默认直接显示清晰图片。
              </small>
            </span>
            <input
              type="checkbox"
              :checked="blurThumbnails"
              @change="emit('update:blurThumbnails', ($event.target as HTMLInputElement).checked)"
            />
            <i aria-hidden="true"></i>
          </label>
        </section>

        <section v-if="!isNativeApk" class="settings-section" aria-labelledby="offline-title">
          <header>
            <div>
              <h3 id="offline-title">离线资源</h3>
            </div>
            <span>网页端</span>
          </header>
          <div class="settings-number-row">
            <span>
              <strong>完整离线资源</strong>
              <small v-if="offlineResourceStatus">
                预计大小 {{ formatBytes(offlineResourceStatus.estimatedBytes) }} · 已缓存版本
                {{ offlineResourceStatus.cachedVersion || '尚未下载' }} · 最后更新
                {{
                  offlineResourceStatus.lastUpdatedAt
                    ? new Date(offlineResourceStatus.lastUpdatedAt).toLocaleString('zh-CN')
                    : '尚无'
                }}
              </small>
              <small v-else>
                当前只默认缓存应用壳；进入过的功能与教程会按需缓存，不拖慢首次打开。
              </small>
              <small v-if="offlineResourceMessage" role="status">{{
                offlineResourceMessage
              }}</small>
            </span>
            <span class="settings-number-row__control">
              <button
                v-if="isDownloadingOfflineResources"
                type="button"
                @click="cancelOfflineDownload"
              >
                停止 {{ offlineDownloadPercent }}%
              </button>
              <button v-else type="button" @click="downloadOfflineResources">
                {{ offlineResourceStatus?.cachedVersion ? '更新完整离线资源' : '下载完整离线资源' }}
              </button>
              <button
                v-if="offlineResourceStatus?.cachedVersion && !isDownloadingOfflineResources"
                type="button"
                @click="clearOfflineResources"
              >
                移除
              </button>
            </span>
          </div>
        </section>

        <section class="settings-section settings-section--links">
          <header>
            <div>
              <h3>本地管理</h3>
            </div>
          </header>
          <ResourceHealthCenter @library-changed="emit('library-changed')" />
          <form class="settings-number-row" @submit.prevent="saveSnapshotLimit">
            <span>
              <strong>历史快照保留数量</strong>
              <small>
                当前已有 {{ historySnapshotCount }} 个，最多可保留 30
                个。调小后会删除最旧快照；接近浏览器容量上限时会自动减少或停止创建。
              </small>
            </span>
            <span class="settings-number-row__control">
              <input
                v-model.number="snapshotLimitDraft"
                type="number"
                inputmode="numeric"
                min="1"
                max="30"
                step="1"
                aria-label="历史快照保留数量"
              />
              <button type="submit" :disabled="snapshotLimitDraft === historySnapshotLimit">
                保存
              </button>
            </span>
          </form>
          <button type="button" @click="emit('manage-folders')">
            <span>
              <strong>资源文件夹</strong>
              <small>新建、改名和整理文件夹</small>
            </span>
            <i>→</i>
          </button>
          <button type="button" @click="emit('open-vault')">
            <span>
              <strong>数据保护与历史版本</strong>
              <small>{{ vaultEnabled ? '本地加密已开启' : '备份、恢复与本地加密' }}</small>
            </span>
            <i>→</i>
          </button>
          <div v-if="isNativeApk" class="settings-number-row">
            <span>
              <strong>Android 本地资源目录</strong>
              <small v-if="vaultEnabled">本地保险库已开启，明文文件镜像已停用。</small>
              <small v-else-if="nativeStorageInfo">
                当前资源 {{ nativeStorageInfo.currentCount }} 项，历史版本
                {{ nativeStorageInfo.versionCount }} 项，共用
                {{ nativeStorageInfo.objectCount }} 个去重原件（{{
                  (nativeStorageInfo.objectBytes / 1024 / 1024).toFixed(1)
                }}
                MiB）。目录：{{ nativeStorageInfo.path }}
              </small>
              <small v-else>正在读取 Android 本地目录…</small>
            </span>
          </div>
          <section
            v-if="isNativeApk"
            class="settings-number-row"
            aria-labelledby="saf-backup-title"
          >
            <span>
              <strong id="saf-backup-title">系统文件夹备份</strong>
              <small v-if="!nativeSafBackup?.configured">
                尚未选择文件夹。选择后，SRL 完整导出会直接保存到该文件夹，不申请全盘文件权限。
              </small>
              <small v-else-if="!nativeSafBackup.available">
                “{{ nativeSafBackup.name || '已选文件夹' }}”的授权已失效或不可写；请重新选择，SRL
                不会静默换目录。
              </small>
              <small v-else>
                {{ nativeSafBackup.name || '系统备份文件夹' }} · 最近备份
                {{
                  nativeSafBackup.lastBackupAt
                    ? new Date(nativeSafBackup.lastBackupAt).toLocaleString('zh-CN')
                    : '尚无'
                }}
                · 剩余空间 {{ formatBytes(nativeSafBackup.availableBytes) }}
              </small>
            </span>
            <div class="settings-number-row__control">
              <button type="button" @click="chooseSafBackupDirectory">
                {{ nativeSafBackup?.configured ? '重新选择' : '选择文件夹' }}
              </button>
              <button
                v-if="nativeSafBackup?.configured"
                type="button"
                @click="clearSafBackupDirectory"
              >
                取消授权
              </button>
            </div>
          </section>
          <label v-if="isNativeApk && nativeSystemUiState" class="settings-switch-row">
            <span>
              <strong>显示 Android 状态栏</strong>
              <small>在普通页面显示时间、电量和系统状态；关闭时保持沉浸式布局。</small>
            </span>
            <input
              type="checkbox"
              :checked="nativeSystemUiState.showStatusBar"
              @change="toggleNativeStatusBar"
            />
            <i aria-hidden="true"></i>
          </label>
          <template v-if="isNativeApk && nativeSecurityState">
            <label class="settings-switch-row">
              <span>
                <strong>原生触觉反馈</strong>
                <small>导入、保存和危险操作确认时提供轻微震动；可随时关闭。</small>
              </span>
              <input
                type="checkbox"
                :checked="nativeHapticsEnabled"
                @change="toggleNativeHaptics"
              />
              <i aria-hidden="true"></i>
            </label>
            <label class="settings-switch-row">
              <span>
                <strong>禁止截图、录屏和任务预览</strong>
                <small
                  >开启后，当前页面不能被截图或录屏，“最近任务”也不会显示页面内容。查看私密资源或账号信息时再开启；开启后你自己也无法截图。</small
                >
              </span>
              <input
                type="checkbox"
                :checked="nativeSecurityState.secureScreen"
                @change="toggleSecureScreen"
              />
              <i aria-hidden="true"></i>
            </label>
            <button
              v-if="nativeSecurityState.biometricAvailable"
              type="button"
              @click="verifyDeviceOwner"
            >
              <span>
                <strong>测试指纹 / 锁屏验证</strong>
                <small>{{
                  nativeBiometricMessage || '调用 Android 系统身份验证，不把生物信息交给 SRL'
                }}</small>
              </span>
              <i>→</i>
            </button>
            <button
              v-if="!nativeSecurityState.notificationsGranted"
              type="button"
              @click="enableNativeNotifications"
            >
              <span>
                <strong>允许系统任务通知</strong>
                <small>{{
                  nativeNotificationMessage || '显示后台导入、上传进度和完成/失败结果'
                }}</small>
              </span>
              <i>→</i>
            </button>
          </template>
          <button type="button" @click="emit('open-version-recognition')">
            <span>
              <strong>版本识别与清理</strong>
              <small>清理时间线内已存版本，或并入尚未归组的跨资源版本</small>
            </span>
            <i>→</i>
          </button>
          <button type="button" @click="handleCheckUpdate">
            <span>
              <strong>{{ isNativeApk ? '检查 APK 版本更新' : '检查网页更新' }}</strong>
              <small>{{
                updateCheckResult ||
                (isNativeApk ? '检查并下载新版 APK' : '自动检测服务器是否有新版本')
              }}</small>
            </span>
            <i>↻</i>
          </button>
          <button type="button" class="settings-force-refresh" @click="forceRefresh">
            <span>
              <strong>{{ isNativeApk ? '重新加载应用页面' : '强制刷新（跳过所有缓存）' }}</strong>
              <small>{{
                isNativeApk
                  ? '清空页面临时缓存后重新加载。不会删除角色卡数据。'
                  : '注销 Service Worker、清空所有缓存后重新加载。不会删除角色卡数据。'
              }}</small>
            </span>
            <i>↺</i>
          </button>
        </section>
      </div>

      <footer class="layout-settings__footer">
        <span>
          {{ isNativeApk ? '偏好已自动保存在当前设备' : '偏好已自动保存在当前浏览器' }}
        </span>
        <button class="button button--primary" type="button" @click="emit('close')">完成</button>
      </footer>
    </section>
  </div>
</template>
