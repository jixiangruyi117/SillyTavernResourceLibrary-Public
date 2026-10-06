import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { confirmAction, useConfirmDialogState } from './UseConfirmDialog'
import { SRL_BACK_REQUEST_EVENT, type SrlBackRequestDetail } from './UseBackStack'
import { externalAppService } from '../core/AppContainer'
import {
  EXTERNAL_APP_RUNTIME_MODE,
  EXTERNAL_APP_SDK_VERSION,
  type ExternalAppRuntimeMode,
  type ExternalAppPermission,
  type ExternalAppPreview,
  type InstalledExternalApp,
  type InstalledExternalAppSummary,
  type RetainedExternalAppData,
} from '../types/ExternalApp'
import { downloadBlob } from '../utils/LibraryFormatting'
import { getCapacitorPlatform } from '../utils/CapacitorDetection'
import { seedOpaquePreviewDocument } from '../utils/OpaquePreviewDocument'
import { type ActionSheetAction } from '../components/ActionSheet.vue'
import type { EmitFn } from 'vue'

export function useExternalAppManager(
  props: {
    sharedFiles?: File[]
    embedded?: boolean
  },
  emit: EmitFn<{
    back: []
    changed: []
    installed: [appId: string]
    open: [appId: string]
    'shared-files-consumed': []
    busy: [value: boolean]
    'preview-cancelled': []
  }>,
) {
  const { activeDialog: confirmation, respond: respondToConfirmation } = useConfirmDialogState()
  const apps = ref<InstalledExternalAppSummary[]>([])
  const retainedData = ref<RetainedExternalAppData[]>([])
  const installing = ref(false)
  watch(installing, (value) => emit('busy', value))
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
  const originalPreview = ref<ExternalAppPreview>()
  const updateAppId = ref('')
  const previewEntry = ref('')
  const showPreview = ref(false)
  const trialHtml = ref('')
  const trialGeneration = ref(0)
  const trialStatus = ref('')
  const trialError = ref('')
  const trialMessages = ref<string[]>([])
  const trialLoading = ref('')
  const trialStorage = new Map<string, unknown>()
  const installedApp = ref<InstalledExternalAppSummary>()
  const actionSection = ref<
    'overview' | 'more' | 'data' | 'identity' | 'permissions' | 'runtime' | 'source' | 'health'
  >('overview')
  const actionHistory = ref<Array<typeof actionSection.value>>([])
  const actionMode = ref<ExternalAppRuntimeMode>(EXTERNAL_APP_RUNTIME_MODE.ISOLATED)
  const actionBusy = ref(false)
  const overlayPanel = ref<HTMLElement>()

  let previewNonce = ''

  let lastPreviewSequence = 0

  let previewPort: MessagePort | undefined

  let overlayReturnFocus: HTMLElement | undefined
  const appDataStorageLocation = computed(() =>
    getCapacitorPlatform() === 'android' ? '当前 APK 的应用私有存储' : '当前浏览器的本机站点存储',
  )
  const editablePaths = computed(() =>
    Object.keys(actionApp.value?.packageFiles ?? {}).filter(
      (path) => path !== 'manifest.json' && /\.(?:html?|css|js|mjs|json)$/i.test(path),
    ),
  )
  const htmlEntries = computed(() =>
    Object.keys(preview.value?.packageFiles ?? {}).filter((path) => /\.html?$/i.test(path)),
  )
  const installLabel = computed(() =>
    !preview.value?.previousInstallation
      ? '安装 APP'
      : preview.value.contentChanged
        ? '更新 APP'
        : '重新安装',
  )
  const sectionTitles = {
    overview: 'APP 管理',
    more: '更多操作',
    data: '数据与卸载',
    identity: '名称与图标',
    permissions: '权限管理',
    runtime: '运行设置',
    source: '源码编辑',
    health: '运行诊断',
  }
  const permissionDecisions = { once: '仅同意这次', always: '已记住授权', denied: '已拒绝' }
  const draftChanged = computed(() => {
    const app = actionApp.value
    if (!app) return false
    if (actionSection.value === 'identity')
      return actionName.value !== app.manifest.name || actionIcon.value !== (app.iconDataUrl ?? '')
    if (actionSection.value === 'permissions')
      return (
        [...actionPermissions.value].sort().join() !==
        [...(app.allowedPermissions ?? app.grantedPermissions ?? app.manifest.permissions ?? [])]
          .sort()
          .join()
      )
    if (actionSection.value === 'runtime')
      return actionMode.value !== (app.runtimeMode ?? EXTERNAL_APP_RUNTIME_MODE.ISOLATED)
    return (
      actionSection.value === 'source' &&
      sourceText.value !==
        (sourcePath.value ? new TextDecoder().decode(app.packageFiles?.[sourcePath.value]) : '')
    )
  })
  async function reload(): Promise<void> {
    apps.value = await externalAppService.list()
    retainedData.value = await externalAppService.listRetainedData()
  }
  async function openAppActions(app: InstalledExternalAppSummary): Promise<void> {
    if (installing.value || actionBusy.value || preview.value || actionApp.value) return
    await runAction(async () => {
      const fullApp = await externalAppService.get(app.id)
      if (!fullApp) {
        errorMessage.value = '这个第三方 APP 已被卸载。'
        return
      }
      actionApp.value = fullApp
      actionSection.value = 'overview'
      actionHistory.value = []
      actionMode.value = fullApp.runtimeMode ?? EXTERNAL_APP_RUNTIME_MODE.ISOLATED
      actionName.value = fullApp.manifest.name
      actionIcon.value = fullApp.iconDataUrl ?? ''
      actionPermissions.value = [
        ...(fullApp.allowedPermissions ??
          fullApp.grantedPermissions ??
          fullApp.manifest.permissions ??
          []),
      ]
      actionHealth.value = undefined
      actionHealth.value = await externalAppService.getHealth(app.id)
    })
  }
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  }

  onMounted(() => {
    void reload().catch((error: unknown) => {
      errorMessage.value = error instanceof Error ? error.message : '无法读取 APP 列表'
    })
    window.addEventListener('keydown', handleOverlayKeydown, true)
    window.addEventListener(SRL_BACK_REQUEST_EVENT, handleOverlayBack, true)
  })

  onBeforeUnmount(() => {
    stopPreview()
    document.documentElement.classList.remove('external-app-manager-open')
    window.removeEventListener('keydown', handleOverlayKeydown, true)
    window.removeEventListener(SRL_BACK_REQUEST_EVENT, handleOverlayBack, true)
  })

  watch(
    () => Boolean(preview.value || actionApp.value),
    (open) => {
      document.documentElement.classList.toggle('external-app-manager-open', open)
      if (open) {
        overlayReturnFocus =
          document.activeElement instanceof HTMLElement ? document.activeElement : undefined
        void nextTick(() => overlayPanel.value?.focus({ preventScroll: true }))
      } else {
        overlayReturnFocus?.focus({ preventScroll: true })
        overlayReturnFocus = undefined
      }
    },
  )
  function handleOverlayKeydown(event: KeyboardEvent): void {
    if (
      event.key === 'Tab' &&
      (preview.value || actionApp.value) &&
      !confirmation.value &&
      !document.body.classList.contains('modal-open')
    ) {
      const panel = overlayPanel.value
      const controls = Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, iframe',
        ) ?? [],
      ).filter((control) => control.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (
        first &&
        last &&
        ((event.shiftKey &&
          (document.activeElement === first || document.activeElement === panel)) ||
          (!event.shiftKey &&
            (document.activeElement === last || document.activeElement === panel)))
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
      return
    }
    if (
      event.key !== 'Escape' ||
      (!preview.value && !actionApp.value) ||
      headerMoreOpen.value ||
      confirmation.value ||
      document.body.classList.contains('modal-open')
    )
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    void closeOverlay()
  }
  function handleOverlayBack(event: Event): void {
    const detail = (event as CustomEvent<SrlBackRequestDetail>).detail
    if (
      !detail ||
      detail.handled ||
      (!preview.value && !actionApp.value) ||
      headerMoreOpen.value ||
      document.body.classList.contains('modal-open')
    )
      return
    detail.handled = true
    event.stopImmediatePropagation()
    if (confirmation.value) {
      respondToConfirmation('cancel')
      return
    }
    void closeOverlay()
  }
  async function leaveSection(): Promise<boolean> {
    return (
      !draftChanged.value ||
      (await confirmAction({
        title: '放弃未保存的更改',
        message: '当前更改尚未保存。放弃这些更改吗？',
        confirmLabel: '放弃更改',
      }))
    )
  }
  async function closeOverlay(): Promise<void> {
    if (installing.value || actionBusy.value) return
    if (preview.value) {
      cancelPreview()
      return
    }
    if (!(await leaveSection())) return
    if (actionSection.value !== 'overview') {
      actionSection.value = actionHistory.value.pop() ?? 'overview'
      void nextTick(() => overlayPanel.value?.focus({ preventScroll: true }))
      return
    }
    actionApp.value = undefined
    errorMessage.value = ''
  }
  function openApp(app: InstalledExternalApp | InstalledExternalAppSummary): void {
    if (!app.enabled) return
    actionApp.value = undefined
    emit('open', app.id)
  }
  async function runAction(operation: () => Promise<void>): Promise<void> {
    if (actionBusy.value) return
    actionBusy.value = true
    errorMessage.value = ''
    notice.value = ''
    try {
      await operation()
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '操作失败，请重试'
    } finally {
      actionBusy.value = false
    }
  }
  async function refreshAction(): Promise<void> {
    await reload()
    const app = actionApp.value
    if (!app) return
    const summary = apps.value.find((item) => item.id === app.id)
    if (summary) actionApp.value = { ...app, ...summary }
    else actionApp.value = undefined
  }
  function openSection(section: typeof actionSection.value): void {
    const app = actionApp.value
    if (!app || actionBusy.value) return
    actionName.value = app.manifest.name
    actionIcon.value = app.iconDataUrl ?? ''
    actionPermissions.value = [
      ...(app.allowedPermissions ?? app.grantedPermissions ?? app.manifest.permissions ?? []),
    ]
    actionMode.value = app.runtimeMode ?? EXTERNAL_APP_RUNTIME_MODE.ISOLATED
    if (section === 'source') {
      sourcePath.value = editablePaths.value.includes(app.manifest.entry)
        ? app.manifest.entry
        : (editablePaths.value[0] ?? '')
      sourceText.value = sourcePath.value
        ? new TextDecoder().decode(app.packageFiles?.[sourcePath.value])
        : ''
    }
    actionHistory.value.push(actionSection.value)
    actionSection.value = section
    void nextTick(() => overlayPanel.value?.focus({ preventScroll: true }))
    errorMessage.value = ''
    notice.value = ''
  }
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
  async function inspectFiles(files: File[]): Promise<boolean> {
    if (!files.length || installing.value || actionBusy.value || preview.value || actionApp.value)
      return false
    installing.value = true
    notice.value = ''
    errorMessage.value = ''
    preview.value = undefined
    previewFiles.value = []
    previewRuntimeMode.value = EXTERNAL_APP_RUNTIME_MODE.ISOLATED
    try {
      preview.value = await externalAppService.inspect(files.length === 1 ? files[0] : files)
      originalPreview.value = preview.value
      updateAppId.value = ''
      previewEntry.value = preview.value.manifest.entry
      installedApp.value = undefined
      previewRuntimeMode.value =
        preview.value.previousInstallation?.runtimeMode ?? EXTERNAL_APP_RUNTIME_MODE.ISOLATED
      selectedPermissions.value = [...preview.value.requestedPermissions]
      previewName.value = preview.value.manifest.name
      previewIcon.value = preview.value.iconDataUrl ?? ''
      previewFiles.value = files
      notice.value = ''
      return true
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '无法预览 APP 安装包'
      return false
    } finally {
      installing.value = false
    }
  }

  watch(
    () => props.sharedFiles,
    (files) => {
      if (!files?.length) return
      void inspectFiles([...files]).then((valid) => {
        if (valid) emit('shared-files-consumed')
      })
    },
    { immediate: true },
  )
  async function confirmInstall(): Promise<void> {
    if (!previewFiles.value.length || !preview.value || installing.value) return
    installing.value = true
    errorMessage.value = ''
    try {
      const previous = (await externalAppService.list()).find(
        (app) => app.id === preview.value!.manifest.id,
      )
      if (
        previous &&
        !(await confirmAction({
          title: '更新第三方 APP',
          message: `将“${previous.manifest.name}”从${previous.manifest.version}更新为${preview.value.manifest.version}。保留应用数据，按本次选择重新授权。`,
          confirmLabel: '确认更新',
          cancelLabel: '继续查看',
          centered: true,
        }))
      )
        return
      const normalizedName = previewName.value.trim()
      if (!normalizedName) throw new Error('APP 名称不能为空')
      preview.value.manifest.name = normalizedName.slice(0, 80)
      preview.value.iconDataUrl = previewIcon.value
      preview.value.allowedPermissions = [...selectedPermissions.value]
      const installed = await externalAppService.install(preview.value, previewRuntimeMode.value)
      await reload()
      emit('changed')
      stopPreview()
      preview.value = undefined
      originalPreview.value = undefined
      previewFiles.value = []
      notice.value = `已安装“${installed.manifest.name}”。现在可在“功能”中作为第三方 APP 打开。`
      installedApp.value = apps.value.find((app) => app.id === installed.id)
      emit('installed', installed.id)
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '安装 APP 失败'
    } finally {
      installing.value = false
    }
  }
  function cancelPreview(): void {
    emit('preview-cancelled')
    stopPreview()
    preview.value = undefined
    previewFiles.value = []
    selectedPermissions.value = []
    previewName.value = ''
    previewIcon.value = ''
    notice.value = ''
    errorMessage.value = ''
    originalPreview.value = undefined
  }
  async function configureInstall(): Promise<void> {
    const original = originalPreview.value
    if (!original || installing.value) return
    installing.value = true
    errorMessage.value = ''
    stopPreview()
    try {
      preview.value = await externalAppService.configurePreview(original, {
        updateAppId: updateAppId.value || undefined,
        entry: previewEntry.value,
      })
      previewRuntimeMode.value =
        preview.value.previousInstallation?.runtimeMode ?? EXTERNAL_APP_RUNTIME_MODE.ISOLATED
    } catch (error) {
      updateAppId.value =
        preview.value?.previousInstallation?.id === original.manifest.id
          ? ''
          : (preview.value?.previousInstallation?.id ?? '')
      previewEntry.value = preview.value?.manifest.entry ?? original.manifest.entry
      errorMessage.value = error instanceof Error ? error.message : '无法配置安装目标'
    } finally {
      installing.value = false
    }
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
    await refreshAction()
    notice.value = `已撤销“${app.manifest.name}”的后续权限授权；下次调用会重新询问。`
  }
  async function exportApp(app: InstalledExternalApp): Promise<void> {
    const file = await externalAppService.exportPackage(app.id)
    await downloadBlob(file, file.name)
    notice.value = `已导出“${app.manifest.name}”的 .srlapp 包。`
  }
  async function exportPreviewPackage(): Promise<void> {
    if (!preview.value || installing.value) return
    installing.value = true
    errorMessage.value = ''
    try {
      preview.value.manifest.name =
        previewName.value.trim().slice(0, 80) || preview.value.manifest.name
      preview.value.iconDataUrl = previewIcon.value
      const file = await externalAppService.exportPreviewPackage(preview.value)
      await downloadBlob(file, file.name)
      notice.value = '已生成 .srlapp 安装包；尚未安装到本机。'
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '无法生成安装包'
    } finally {
      installing.value = false
    }
  }
  function connectPreview(): void {
    previewPort?.close()
    const target = previewFrame.value?.contentWindow
    if (!target) return
    if (
      previewRuntimeMode.value === EXTERNAL_APP_RUNTIME_MODE.TRUSTED_COMPATIBLE &&
      previewFrame.value &&
      seedOpaquePreviewDocument(previewFrame.value, trialHtml.value)
    )
      return
    const channel = new MessageChannel()
    const nonce = crypto.randomUUID()
    previewNonce = nonce
    lastPreviewSequence = 0
    trialStorage.clear()
    previewPort = channel.port1
    const port = previewPort
    trialStatus.value = '试运行中'
    previewPort.onmessage = (event) => {
      const request = event.data
      if (previewNonce !== nonce || !showPreview.value) return
      if (request?.type === 'srl:diagnostic') {
        const message = String(request.message ?? 'APP 运行异常').slice(0, 500)
        trialMessages.value = [...trialMessages.value.slice(-9), message]
        if (request.level === 'error') {
          trialError.value = message
          trialStatus.value = '试运行异常'
        }
        return
      }
      if (!request || request.type !== 'srl:request' || typeof request.id !== 'string') return
      if (
        request.nonce !== nonce ||
        !Number.isSafeInteger(request.sequence) ||
        request.sequence <= lastPreviewSequence
      )
        return
      lastPreviewSequence = request.sequence
      let allow = true
      let value: unknown
      const payload = request.payload ?? {}
      switch (request.method) {
        case 'sdk.capabilities':
          value = {
            apiVersion: EXTERNAL_APP_SDK_VERSION,
            permissions: selectedPermissions.value.filter(
              (permission) => permission === 'app.storage',
            ),
            permissionLevel: 'isolated',
            preview: true,
          }
          break
        case 'storage.get':
          value = trialStorage.get(String(payload.key)) ?? null
          break
        case 'storage.set': {
          const encoded = JSON.stringify(payload.value)
          if (
            typeof encoded !== 'string' ||
            encoded.length > 100 * 1024 ||
            trialStorage.size >= 10
          ) {
            allow = false
            break
          }
          trialStorage.set(String(payload.key), payload.value)
          break
        }
        case 'storage.remove':
          trialStorage.delete(String(payload.key))
          break
        case 'ui.notify':
          trialMessages.value = [
            ...trialMessages.value.slice(-9),
            String(payload.message ?? '').slice(0, 500),
          ]
          break
        case 'ui.title':
          break
        case 'ui.loading':
          trialLoading.value = String(payload.label ?? '').slice(0, 120)
          break
        case 'ui.exitFullscreen':
          break
        default:
          allow = false
      }
      if (
        String(request.method).startsWith('storage.') &&
        !selectedPermissions.value.includes('app.storage')
      )
        allow = false
      port.postMessage({
        type: 'srl:response',
        nonce,
        id: request.id,
        ok: allow,
        ...(allow
          ? { value }
          : { error: '试运行不访问资源库、文件或设备，也不保存数据；安装后可申请对应能力。' }),
      })
    }
    previewPort.start()
    target.postMessage({ type: 'srl:connect', protocolVersion: 2, nonce }, '*', [channel.port2])
  }
  function stopPreview(): void {
    showPreview.value = false
    previewNonce = ''
    previewPort?.close()
    previewPort = undefined
    trialStorage.clear()
    trialHtml.value = ''
    trialLoading.value = ''
  }
  function startPreview(): void {
    if (!preview.value) return
    stopPreview()
    trialError.value = ''
    trialMessages.value = []
    trialStatus.value = '正在加载试运行页面'
    try {
      trialHtml.value =
        previewRuntimeMode.value === EXTERNAL_APP_RUNTIME_MODE.TRUSTED_COMPATIBLE
          ? preview.value.compatibleRuntimeHtml
          : preview.value.runtimeHtml
      showPreview.value = true
      trialGeneration.value += 1
    } catch (error) {
      trialError.value = error instanceof Error ? error.message : '无法构建试运行页面'
      trialStatus.value = '无法试运行'
    }
  }

  watch(previewRuntimeMode, () => {
    if (showPreview.value) startPreview()
  })
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
    errorMessage.value = ''
    try {
      previewIcon.value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('无法读取图标图片'))
        reader.readAsDataURL(file)
      })
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '无法读取图标图片'
    }
  }
  async function selectSourceFile(app: InstalledExternalApp, event: Event): Promise<void> {
    const input = event.target as HTMLSelectElement
    if (!(await leaveSection())) {
      input.value = sourcePath.value
      return
    }
    sourcePath.value = input.value
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
      await externalAppService.updatePresentation(app.id, actionName.value, actionIcon.value)
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
    errorMessage.value = ''
    try {
      actionIcon.value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('无法读取图标图片'))
        reader.readAsDataURL(file)
      })
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '无法读取图标图片'
    }
  }
  async function toggleApp(app: InstalledExternalApp): Promise<void> {
    errorMessage.value = ''
    try {
      await externalAppService.setEnabled(app.id, !app.enabled)
      await refreshAction()
      emit('changed')
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '更新 APP 状态失败'
    }
  }
  async function saveRuntimeMode(app: InstalledExternalApp): Promise<void> {
    await externalAppService.setRuntimeMode(app.id, actionMode.value)
    const refreshed = await externalAppService.get(app.id)
    if (refreshed) actionApp.value = refreshed
    await reload()
    notice.value = '运行模式已保存；可返回管理首页打开 APP 测试，资源权限会按需重新询问。'
    emit('changed')
  }
  async function exportAppData(appId: string): Promise<void> {
    const file = await externalAppService.exportData(appId)
    await downloadBlob(file, file.name)
    notice.value = '已导出 APP 数据。文件可能包含此 APP 保存的私有内容，请自行保管。'
  }
  async function clearRetainedData(data: RetainedExternalAppData): Promise<void> {
    if (
      !(await confirmAction({
        title: '清除已卸载 APP 的数据',
        message: `清除 ${data.appId} 的 ${data.dataEntries} 项数据（${formatBytes(data.dataBytes)}）吗？清除后无法通过重装恢复，资源库不受影响。`,
        confirmLabel: '清除数据',
        danger: true,
      }))
    )
      return
    await externalAppService.clearRetainedData(data.appId)
    await reload()
    notice.value = '已清除所选 APP 的保留数据。'
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
      actionHealth.value = await externalAppService.getHealth(app.id)
      notice.value = `已清除“${app.manifest.name}”的本地数据。`
      await reload()
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '清除 APP 数据失败'
    }
  }
  return {
    apps,
    retainedData,
    installing,
    notice,
    errorMessage,
    preview,
    previewRuntimeMode,
    headerMoreOpen,
    selectedPermissions,
    previewName,
    previewIcon,
    dragActive,
    actionApp,
    actionHealth,
    actionName,
    actionIcon,
    sourcePath,
    sourceText,
    actionPermissions,
    updateAppId,
    previewEntry,
    showPreview,
    trialHtml,
    trialGeneration,
    trialStatus,
    trialError,
    trialMessages,
    trialLoading,
    installedApp,
    actionSection,
    actionHistory,
    actionMode,
    actionBusy,
    appDataStorageLocation,
    editablePaths,
    htmlEntries,
    installLabel,
    sectionTitles,
    permissionDecisions,
    draftChanged,
    openAppActions,
    formatBytes,
    closeOverlay,
    openApp,
    runAction,
    openSection,
    choosePackage,
    headerMoreActions,
    selectHeaderMore,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    inspectPackage,
    confirmInstall,
    cancelPreview,
    configureInstall,
    saveAllowedPermissions,
    revokeAppPermissions,
    exportApp,
    exportPreviewPackage,
    connectPreview,
    stopPreview,
    startPreview,
    choosePreviewIcon,
    readPreviewIcon,
    selectSourceFile,
    saveSourceFile,
    savePresentation,
    chooseAppIcon,
    readAppIcon,
    toggleApp,
    saveRuntimeMode,
    exportAppData,
    clearRetainedData,
    uninstallApp,
    clearAppData,
    fileInput,
    folderInput,
    previewIconInput,
    iconInput,
    overlayPanel,
    previewFrame,
  }
}
