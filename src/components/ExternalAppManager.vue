<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import { externalAppService } from '../core/AppContainer'
import {
  EXTERNAL_APP_PERMISSION_LEVEL_INFO,
  EXTERNAL_APP_PERMISSION_LABELS,
  EXTERNAL_APP_RUNTIME_MODE,
  type ExternalAppRuntimeMode,
  type ExternalAppPermission,
  type ExternalAppPreview,
  type InstalledExternalApp,
  type InstalledExternalAppSummary,
} from '../types/ExternalApp'
import { downloadBlob } from '../utils/LibraryFormatting'
import { getCapacitorPlatform } from '../utils/CapacitorDetection'
import FeatureAppHeader from './FeatureAppHeader.vue'
import ActionSheet, { type ActionSheetAction } from './ActionSheet.vue'

const emit = defineEmits<{
  back: []
  changed: []
  installed: [appId: string]
}>()

const apps = ref<InstalledExternalAppSummary[]>([])
const installing = ref(false)
const notice = ref('')
const errorMessage = ref('')
const fileInput = ref<HTMLInputElement>()
const preview = ref<ExternalAppPreview>()
const previewFiles = ref<File[]>([])
const previewFrame = ref<HTMLIFrameElement>()
const previewRuntimeMode = ref<ExternalAppRuntimeMode>(EXTERNAL_APP_RUNTIME_MODE.ISOLATED)
const headerMoreOpen = ref(false)
const selectedPermissions = ref<ExternalAppPermission[]>([])
const previewName = ref('')
const previewIcon = ref('')
const dragActive = ref(false)
const actionApp = ref<InstalledExternalApp>()
const actionHealth = ref<Awaited<ReturnType<typeof externalAppService.getHealth>>>()
const folderInput = ref<HTMLInputElement>()
const iconInput = ref<HTMLInputElement>()
const previewIconInput = ref<HTMLInputElement>()
const actionName = ref('')
const actionIcon = ref('')
const sourcePath = ref('')
const sourceText = ref('')
const actionPermissions = ref<ExternalAppPermission[]>([])
let previewPort: MessagePort | undefined

const appDataStorageLocation = computed(() => {
  const app = actionApp.value
  if (!app) return ''
  const record = `SillyTavernResourceLibrary / externalAppData / ${app.id}`
  return getCapacitorPlatform() === 'android'
    ? `APK 应用私有 WebView IndexedDB · ${record}`
    : `浏览器 IndexedDB · ${record}`
})

const previewRuntimeHtml = computed(() =>
  previewRuntimeMode.value === EXTERNAL_APP_RUNTIME_MODE.TRUSTED_COMPATIBLE
    ? preview.value?.compatibleRuntimeHtml
    : preview.value?.runtimeHtml,
)

async function reload(): Promise<void> {
  apps.value = await externalAppService.list()
}

async function openAppActions(app: InstalledExternalAppSummary): Promise<void> {
  const fullApp = await externalAppService.get(app.id)
  if (!fullApp) {
    errorMessage.value = '这个第三方 APP 已被卸载。'
    return
  }
  actionApp.value = fullApp
  actionName.value = fullApp.manifest.name
  actionIcon.value = fullApp.iconDataUrl ?? ''
  actionPermissions.value = [
    ...(fullApp.allowedPermissions ??
      fullApp.grantedPermissions ??
      fullApp.manifest.permissions ??
      []),
  ]
  const editablePaths = Object.keys(fullApp.packageFiles ?? {}).filter(
    (path) => path !== 'manifest.json' && /\.(?:html?|css|js|mjs|json)$/i.test(path),
  )
  sourcePath.value = editablePaths[0] ?? ''
  sourceText.value = sourcePath.value
    ? new TextDecoder().decode(fullApp.packageFiles?.[sourcePath.value])
    : ''
  actionHealth.value = undefined
  try {
    actionHealth.value = await externalAppService.getHealth(app.id)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法读取 APP 状态'
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

onMounted(() => {
  void reload()
})

onBeforeUnmount(() => {
  previewPort?.close()
})

function choosePackage(): void {
  fileInput.value?.click()
}

function chooseFolder(): void {
  folderInput.value?.click()
}

const headerMoreActions: readonly ActionSheetAction[] = [
  { id: 'file', label: '导入文件', description: 'HTML、ZIP 或 .srlapp' },
  { id: 'folder', label: '导入文件夹', description: '选择完整的第三方 APP 文件夹' },
]

function selectHeaderMore(action: ActionSheetAction): void {
  if (action.id === 'file') choosePackage()
  else if (action.id === 'folder') chooseFolder()
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  dragActive.value = true
}

function handleDragLeave(): void {
  dragActive.value = false
}

async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  dragActive.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) await inspectFiles(files)
}

async function handlePaste(event: ClipboardEvent): Promise<void> {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  await inspectFiles(files)
}

async function inspectPackage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await inspectFiles(files)
}

async function inspectFiles(files: File[]): Promise<void> {
  if (!files.length || installing.value) return
  installing.value = true
  notice.value = ''
  errorMessage.value = ''
  preview.value = undefined
  previewFiles.value = []
  previewRuntimeMode.value = EXTERNAL_APP_RUNTIME_MODE.ISOLATED
  try {
    preview.value = await externalAppService.inspect(files.length === 1 ? files[0] : files)
    selectedPermissions.value = [...preview.value.requestedPermissions]
    previewName.value = preview.value.manifest.name
    previewIcon.value = preview.value.iconDataUrl ?? ''
    previewFiles.value = files
    notice.value = '网页已通过检查。预览不会保存 APP 数据，确认后才会安装到本机。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法预览 APP 安装包'
  } finally {
    installing.value = false
  }
}

async function confirmInstall(): Promise<void> {
  if (!previewFiles.value.length || !preview.value || installing.value) return
  installing.value = true
  errorMessage.value = ''
  try {
    const normalizedName = previewName.value.trim()
    if (!normalizedName) throw new Error('APP 名称不能为空')
    preview.value.manifest.name = normalizedName.slice(0, 80)
    preview.value.iconDataUrl = previewIcon.value || preview.value.iconDataUrl
    preview.value.allowedPermissions = [...selectedPermissions.value]
    const installed = await externalAppService.install(preview.value, previewRuntimeMode.value)
    await reload()
    emit('changed')
    preview.value = undefined
    previewFiles.value = []
    notice.value = `已安装“${installed.manifest.name}”。现在可在“功能”中作为第三方 APP 打开。`
    emit('installed', installed.id)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安装 APP 失败'
  } finally {
    installing.value = false
  }
}

function cancelPreview(): void {
  preview.value = undefined
  previewFiles.value = []
  selectedPermissions.value = []
  previewName.value = ''
  previewIcon.value = ''
  notice.value = ''
  errorMessage.value = ''
  previewPort?.close()
  previewPort = undefined
}

async function saveAllowedPermissions(app: InstalledExternalApp): Promise<void> {
  await externalAppService.setAllowedPermissions(app.id, actionPermissions.value)
  const refreshed = await externalAppService.get(app.id)
  if (refreshed) actionApp.value = refreshed
  await reload()
  notice.value = 'APP 权限范围已更新；被关闭的权限立即失效。'
  emit('changed')
}

async function revokeAppPermissions(app: InstalledExternalApp): Promise<void> {
  await externalAppService.revokePersistentPermission(app.id)
  await reload()
  actionApp.value = undefined
  notice.value = `已撤销“${app.manifest.name}”的后续权限授权；下次调用会重新询问。`
}

async function exportApp(app: InstalledExternalApp): Promise<void> {
  const file = await externalAppService.exportPackage(app.id)
  await downloadBlob(file, file.name)
  notice.value = `已导出“${app.manifest.name}”的 .srlapp 包。`
}

async function exportPreviewPackage(): Promise<void> {
  if (!preview.value) return
  const file = await externalAppService.exportPreviewPackage(preview.value)
  await downloadBlob(file, file.name)
  notice.value = '已生成可分享的标准 .srlapp 包；它尚未安装到资源库。'
}

function connectPreview(): void {
  previewPort?.close()
  const target = previewFrame.value?.contentWindow
  if (!target) return
  const channel = new MessageChannel()
  previewPort = channel.port1
  previewPort.onmessage = (event) => {
    const request = event.data
    if (!request || request.type !== 'srl:request' || typeof request.id !== 'string') return
    const allow = request.method === 'storage.get' || request.method === 'ui.notify'
    previewPort?.postMessage({
      type: 'srl:response',
      id: request.id,
      ok: allow,
      ...(allow
        ? { value: request.method === 'storage.get' ? null : undefined }
        : { error: '预览不会保存 APP 数据，请先安装。' }),
    })
  }
  previewPort.start()
  target.postMessage({ type: 'srl:connect', protocolVersion: 1 }, '*', [channel.port2])
}

function choosePreviewIcon(): void {
  previewIconInput.value?.click()
}

async function readPreviewIcon(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/') || file.size > 1024 * 1024) {
    errorMessage.value = '请选择不超过 1 MiB 的图片文件'
    return
  }
  previewIcon.value = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('无法读取图标图片'))
    reader.readAsDataURL(file)
  })
}

function selectSourceFile(app: InstalledExternalApp): void {
  sourceText.value = sourcePath.value
    ? new TextDecoder().decode(app.packageFiles?.[sourcePath.value])
    : ''
}

async function saveSourceFile(app: InstalledExternalApp): Promise<void> {
  if (!sourcePath.value) return
  errorMessage.value = ''
  try {
    const updated = await externalAppService.updateSourceFile(
      app.id,
      sourcePath.value,
      sourceText.value,
    )
    actionApp.value = updated
    await reload()
    notice.value = `已保存 ${sourcePath.value}；APP 运行代码已重新构建，持久权限会重新确认。`
    emit('changed')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存 APP 源码失败'
  }
}

async function savePresentation(app: InstalledExternalApp): Promise<void> {
  errorMessage.value = ''
  try {
    await externalAppService.updatePresentation(
      app.id,
      actionName.value,
      actionIcon.value || undefined,
    )
    await reload()
    const refreshed = await externalAppService.get(app.id)
    if (refreshed) actionApp.value = refreshed
    notice.value = 'APP 名称和图标已保存。'
    emit('changed')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存 APP 外观失败'
  }
}

function chooseAppIcon(): void {
  iconInput.value?.click()
}

async function readAppIcon(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    errorMessage.value = '请选择图片文件'
    return
  }
  if (file.size > 1024 * 1024) {
    errorMessage.value = '图标图片不能超过 1 MiB'
    return
  }
  actionIcon.value = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('无法读取图标图片'))
    reader.readAsDataURL(file)
  })
}

async function toggleApp(app: InstalledExternalApp): Promise<void> {
  errorMessage.value = ''
  try {
    await externalAppService.setEnabled(app.id, !app.enabled)
    await reload()
    emit('changed')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新 APP 状态失败'
  }
}

async function uninstallApp(app: InstalledExternalApp): Promise<void> {
  const confirmed = await confirmAction({
    title: '卸载第三方 APP',
    message: `卸载“${app.manifest.name}”吗？只会移除 APP；它的本地数据会保留，资源库不受影响。`,
    confirmLabel: '卸载 APP',
    danger: true,
  })
  if (!confirmed) return
  errorMessage.value = ''
  try {
    await externalAppService.uninstall(app.id)
    await reload()
    emit('changed')
    actionApp.value = undefined
    notice.value = `已卸载“${app.manifest.name}”，本地数据仍保留。`
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '卸载 APP 失败'
  }
}

async function clearAppData(app: InstalledExternalApp): Promise<void> {
  const confirmed = await confirmAction({
    title: '清除 APP 数据',
    message: `清除“${app.manifest.name}”保存的本地数据吗？此操作无法撤销，不会删除 APP，也不会影响资源库。`,
    confirmLabel: '清除数据',
    danger: true,
  })
  if (!confirmed) return
  errorMessage.value = ''
  try {
    await externalAppService.clearData(app.id)
    actionApp.value = undefined
    notice.value = `已清除“${app.manifest.name}”的本地数据。`
    await reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '清除 APP 数据失败'
  }
}
</script>

<template>
  <main
    class="external-app-manager"
    :class="{ 'external-app-manager--dragging': dragActive }"
    tabindex="0"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @paste="handlePaste"
  >
    <FeatureAppHeader title="扩展" back-label="返回功能桌面" @back="emit('back')">
      <template #actions>
        <button
          class="feature-header-action feature-header-action--icon external-app-manager__add"
          type="button"
          aria-label="添加第三方 APP"
          :disabled="installing"
          @click="headerMoreOpen = true"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </template>
    </FeatureAppHeader>
    <ActionSheet
      v-model:open="headerMoreOpen"
      title="添加第三方 APP"
      :actions="headerMoreActions"
      @select="selectHeaderMore"
    />

    <input
      ref="fileInput"
      class="external-app-manager__file"
      type="file"
      accept=".srlapp,.zip,.html,.htm,application/zip,text/html"
      multiple
      @change="inspectPackage"
    />
    <input
      ref="previewIconInput"
      class="external-app-manager__file"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
      @change="readPreviewIcon"
    />
    <input
      ref="iconInput"
      class="external-app-manager__file"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
      @change="readAppIcon"
    />
    <input
      ref="folderInput"
      class="external-app-manager__file"
      type="file"
      multiple
      webkitdirectory
      @change="inspectPackage"
    />

    <section class="external-app-manager__notice" aria-live="polite">
      <p v-if="notice" class="external-app-manager__notice--success">{{ notice }}</p>
      <p v-if="errorMessage" class="external-app-manager__notice--error">{{ errorMessage }}</p>
    </section>

    <section v-if="preview" class="external-app-manager__preview" aria-label="待安装 APP 预览">
      <header>
        <div>
          <div class="external-app-manager__preview-title">
            <img v-if="preview.iconDataUrl" :src="preview.iconDataUrl" alt="" />
            <h2>{{ preview.manifest.name }}</h2>
          </div>
        </div>
        <em
          >v{{ preview.manifest.version
          }}{{ preview.manifest.author ? ` · ${preview.manifest.author}` : '' }}</em
        >
      </header>
      <dl class="external-app-manager__manifest-summary">
        <div>
          <dt>入口</dt>
          <dd>{{ preview.manifest.entry }}</dd>
        </div>
        <div>
          <dt>素材</dt>
          <dd>{{ preview.packageFiles ? Object.keys(preview.packageFiles).length : 1 }} 个</dd>
        </div>
        <div v-if="preview.manifest.immersive">
          <dt>启动</dt>
          <dd>沉浸式</dd>
        </div>
        <div v-if="preview.manifest.orientation && preview.manifest.orientation !== 'auto'">
          <dt>方向</dt>
          <dd>{{ preview.manifest.orientation }}</dd>
        </div>
      </dl>
      <section class="external-app-manager__install-identity" aria-label="安装名称和图标">
        <label>
          <span>名称</span>
          <input v-model="previewName" maxlength="80" />
        </label>
        <label>
          <span>图标 URL</span>
          <span class="external-app-manager__icon-field">
            <input v-model="previewIcon" inputmode="url" placeholder="保持默认或输入图片 URL" />
            <button type="button" @click="choosePreviewIcon">本机图片</button>
          </span>
        </label>
      </section>
      <div class="external-app-manager__preview-frame">
        <iframe
          ref="previewFrame"
          :srcdoc="previewRuntimeHtml"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          :title="`${preview.manifest.name} 安装前预览`"
          @load="connectPreview"
        ></iframe>
      </div>
      <section class="external-app-manager__runtime-mode" aria-label="运行模式">
        <strong>运行模式</strong>
        <label title="仅运行本地素材，外部脚本、网络与跳转默认关闭。">
          <input
            v-model="previewRuntimeMode"
            type="radio"
            :value="EXTERNAL_APP_RUNTIME_MODE.ISOLATED"
          />
          <span>标准隔离</span>
        </label>
        <label title="保留 HTTPS 外链、CDN 与页面网络能力；不交出宿主账号、密钥、DOM 或数据库。">
          <input
            v-model="previewRuntimeMode"
            type="radio"
            :value="EXTERNAL_APP_RUNTIME_MODE.TRUSTED_COMPATIBLE"
          />
          <span>信任兼容</span>
        </label>
      </section>
      <section
        class="external-app-manager__permissions"
        :class="`external-app-manager__permissions--${EXTERNAL_APP_PERMISSION_LEVEL_INFO[preview.permissionLevel].risk}`"
        aria-label="APP 权限申请"
      >
        <header>
          <div>
            <h3>{{ EXTERNAL_APP_PERMISSION_LEVEL_INFO[preview.permissionLevel].label }}</h3>
          </div>
          <span>{{ EXTERNAL_APP_PERMISSION_LEVEL_INFO[preview.permissionLevel].risk }} 风险</span>
        </header>
        <div
          v-if="preview.requestedPermissions.length"
          class="external-app-manager__permission-list"
        >
          <label v-for="permission in preview.requestedPermissions" :key="permission">
            <input v-model="selectedPermissions" type="checkbox" :value="permission" />
            <span>{{ EXTERNAL_APP_PERMISSION_LABELS[permission] }}</span>
          </label>
        </div>
        <p v-else>未申请额外权限。</p>
        <p v-if="preview.requiresReauthorization" class="external-app-manager__permissions-warning">
          此版本新增了权限；不会沿用之前的同意，必须重新确认。
        </p>
        <p
          v-if="preview.requestedPermissions.length"
          class="external-app-manager__permission-accept"
        >
          实际调用时再授权。
        </p>
      </section>
      <details
        v-if="preview.compatibility.length"
        class="external-app-manager__compatibility"
        aria-label="兼容性预检"
      >
        <summary>兼容性预检（{{ preview.compatibility.length }}）</summary>
        <div class="external-app-manager__compatibility-notices">
          <p v-for="compatibilityNotice in preview.compatibility" :key="compatibilityNotice.code">
            {{ compatibilityNotice.level === 'warning' ? '注意：' : '提示：' }}
            {{ compatibilityNotice.message }}
          </p>
        </div>
      </details>
      <div class="external-app-manager__preview-actions">
        <button type="button" @click="cancelPreview">取消</button>
        <button
          class="external-app-manager__confirm"
          type="button"
          :disabled="installing"
          @click="confirmInstall"
        >
          {{ installing ? '正在安装' : '安装 APP' }}
        </button>
        <details v-if="preview.sourceKind !== 'srlapp'" class="external-app-manager__preview-tools">
          <summary>更多</summary>
          <button type="button" :disabled="installing" @click="exportPreviewPackage">
            生成 .srlapp
          </button>
        </details>
      </div>
    </section>

    <section v-if="apps.length" class="external-app-manager__list" aria-label="已安装第三方 APP">
      <article
        v-for="app in apps"
        :key="app.id"
        class="external-app-card"
        :class="{ 'external-app-card--disabled': !app.enabled }"
        role="button"
        tabindex="0"
        @click="openAppActions(app)"
        @keydown.enter="openAppActions(app)"
      >
        <img v-if="app.iconDataUrl" class="external-app-card__icon" :src="app.iconDataUrl" alt="" />
        <div v-else class="external-app-card__badge" aria-hidden="true">
          {{ app.manifest.name.slice(0, 1) }}
        </div>
        <div class="external-app-card__copy">
          <h2>{{ app.manifest.name }}</h2>
          <em
            >v{{ app.manifest.version
            }}{{ app.manifest.author ? ` · ${app.manifest.author}` : '' }} ·
            {{ app.enabled ? '已启用' : '已禁用' }}</em
          >
        </div>
        <svg class="external-app-card__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </article>
    </section>
    <section v-else class="external-app-manager__empty">
      <strong>还没有第三方 APP</strong>
    </section>

    <Teleport to="body">
      <section
        v-if="actionApp"
        class="external-app-manager__sheet"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`external-app-actions-${actionApp.id}`"
        @click.self="actionApp = undefined"
      >
        <div class="external-app-manager__sheet-panel external-app-manager__action-sheet">
          <header>
            <h2 :id="`external-app-actions-${actionApp.id}`">{{ actionApp.manifest.name }}</h2>
            <button type="button" aria-label="关闭 APP 管理" @click="actionApp = undefined">
              ×
            </button>
          </header>
          <section
            class="external-app-manager__identity"
            :class="{ 'external-app-manager__identity--without-icon': !actionIcon }"
            aria-label="APP 名称和图标"
          >
            <img v-if="actionIcon" :src="actionIcon" alt="" />
            <div class="external-app-manager__identity-fields">
              <label>
                <span>名称</span>
                <input v-model="actionName" maxlength="80" />
              </label>
              <label>
                <span>图标 URL</span>
                <input
                  v-model="actionIcon"
                  inputmode="url"
                  placeholder="https://… 或选择本机图片"
                />
              </label>
            </div>
            <div class="external-app-manager__identity-actions">
              <button type="button" @click="chooseAppIcon">本机图片</button>
              <button type="button" @click="savePresentation(actionApp)">保存</button>
            </div>
          </section>
          <section class="external-app-manager__permission-editor" aria-label="APP 权限">
            <header>
              <div>
                <h3>权限</h3>
                <p>作者声明的权限；关闭后立即禁止 APP 调用。</p>
              </div>
              <button
                type="button"
                :disabled="!actionApp.manifest.permissions?.length"
                @click="saveAllowedPermissions(actionApp)"
              >
                应用更改
              </button>
            </header>
            <ul v-if="actionApp.manifest.permissions?.length">
              <li v-for="permission in actionApp.manifest.permissions" :key="permission">
                <label>
                  <input v-model="actionPermissions" type="checkbox" :value="permission" />
                  <span>
                    <strong>{{ EXTERNAL_APP_PERMISSION_LABELS[permission] }}</strong>
                    <small>作者声明</small>
                  </span>
                </label>
                <em :class="{ 'is-disabled': !actionPermissions.includes(permission) }">
                  {{ actionPermissions.includes(permission) ? '已允许' : '已关闭' }}
                </em>
              </li>
            </ul>
            <p v-else class="external-app-manager__permission-empty">作者未声明额外权限。</p>
          </section>
          <details
            v-if="
              Object.keys(actionApp.packageFiles ?? {}).some(
                (path) => path !== 'manifest.json' && /\\.(?:html?|css|js|mjs|json)$/i.test(path),
              )
            "
            class="external-app-manager__source"
          >
            <summary>源码</summary>
            <div>
              <select v-model="sourcePath" @change="selectSourceFile(actionApp)">
                <option
                  v-for="path in Object.keys(actionApp.packageFiles ?? {}).filter(
                    (path) =>
                      path !== 'manifest.json' && /\\.(?:html?|css|js|mjs|json)$/i.test(path),
                  )"
                  :key="path"
                  :value="path"
                >
                  {{ path }}
                </option>
              </select>
              <button type="button" @click="saveSourceFile(actionApp)">保存源码</button>
            </div>
            <textarea v-model="sourceText" spellcheck="false"></textarea>
          </details>
          <p class="external-app-manager__audit-summary">
            {{
              actionApp.runtimeMode === EXTERNAL_APP_RUNTIME_MODE.TRUSTED_COMPATIBLE
                ? '信任兼容模式'
                : '标准隔离模式'
            }}
            · 已保存 {{ actionApp.persistentPermissionGrants?.length ?? 0 }} 项后续授权 · 最近
            {{ actionApp.permissionAudit?.length ?? 0 }} 条请求记录
          </p>
          <p v-if="actionHealth?.disabledByWatchdog" class="external-app-manager__health-error">
            运行守护已自动停用此 APP；重新启用前建议先查看运行诊断，必要时清除 APP 数据。
          </p>
          <section
            v-if="actionHealth"
            class="external-app-manager__health"
            aria-label="APP 存储和健康状态"
          >
            <strong>本机状态</strong>
            <p>
              安装包 {{ formatBytes(actionHealth.packageBytes) }} · APP 数据
              {{ formatBytes(actionHealth.dataBytes) }} /
              {{ formatBytes(actionHealth.dataLimitBytes) }} · {{ actionHealth.dataEntries }} 项
            </p>
            <p class="external-app-manager__storage-location">
              <span>数据位置</span><code>{{ appDataStorageLocation }}</code>
            </p>
            <p v-if="actionHealth.lastLaunchedAt">
              最近启动：{{ new Date(actionHealth.lastLaunchedAt).toLocaleString() }}
            </p>
            <p v-if="actionHealth.lastError" class="external-app-manager__health-error">
              最近异常（连续 {{ actionHealth.consecutiveFailures }} 次）：{{
                actionHealth.lastError
              }}
            </p>
          </section>
          <details v-if="actionApp.permissionAudit?.length" class="external-app-manager__audit-log">
            <summary>查看最近权限记录</summary>
            <ul>
              <li
                v-for="entry in actionApp.permissionAudit"
                :key="`${entry.createdAt}-${entry.method}`"
              >
                {{ entry.decision }} · {{ EXTERNAL_APP_PERMISSION_LABELS[entry.permission] }} ·
                {{ entry.summary }}
              </li>
            </ul>
          </details>
          <section class="external-app-manager__controls" aria-label="APP 操作">
            <button
              class="external-app-manager__primary-action"
              type="button"
              @click="toggleApp(actionApp)"
            >
              {{ actionApp.enabled ? '禁用 APP' : '启用 APP' }}
            </button>
            <details class="external-app-manager__action-options">
              <summary>更多操作</summary>
              <div>
                <button type="button" @click="exportApp(actionApp)">导出为 .srlapp</button>
                <button type="button" @click="revokeAppPermissions(actionApp)">
                  撤销后续权限授权
                </button>
              </div>
            </details>
            <details
              class="external-app-manager__action-options external-app-manager__action-options--danger"
            >
              <summary>数据与卸载</summary>
              <div>
                <button type="button" @click="clearAppData(actionApp)">清除 APP 数据</button>
                <button
                  class="external-app-manager__danger"
                  type="button"
                  @click="uninstallApp(actionApp)"
                >
                  卸载 APP
                </button>
              </div>
            </details>
          </section>
        </div>
      </section>
    </Teleport>
  </main>
</template>

<style scoped src="../styles/ExternalAppManager.css"></style>
