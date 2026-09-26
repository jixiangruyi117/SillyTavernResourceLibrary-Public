import { requestSecretPassword } from './UseSecretPasswordPrompt'
import {
  readPlainSecretExportGrant,
  savePlainSecretExportGrant,
  clearPlainSecretExportGrant,
  plaintextSecretCopies,
} from '../services/PersonalResourceBackup'
import { resourceService } from '../core/AppContainer'
import { Capacitor } from '@capacitor/core'
import type { EmitFn } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import { cloudBackupService } from '../core/AppContainer'
import type { ArchivePortableData } from '../types/Backup'
import type {
  CloudBackupConfig,
  CloudBackupContentSelection,
  CloudBackupIntervalUnit,
  CloudBackupItem,
  CloudBackupMetrics,
  CloudBackupProtection,
  CloudBackupProvider,
  CloudBackupSchedule,
  GitHubBackupConfig,
  WebDavBackupConfig,
} from '../types/CloudBackup'
import type { GitHubRepositoryInspection } from '../services/CloudBackupService'
import {
  isUserPersonaAvatarAttachment,
  RESOURCE_TYPE_LABELS,
  type Category,
  type ResourceSummary,
} from '../types/Resource'
import {
  createDefaultBackupSelection,
  toCloudContentSelection,
  type BackupScopeId,
  type BackupSelectionTreeState,
} from '../services/BackupScopeRegistry'
import { downloadBlob } from '../utils/LibraryFormatting'
import { taskCenter } from '../core/TaskCenter'
import { requestNativeNotifications } from '../core/NativeSecurity'

export type CloudBackupCenterProps = {
  resourceCount: number
  resources: ResourceSummary[]
  categories?: Category[]
}

export type CloudBackupCenterEvents = { back: []; 'library-changed': [] }

export function useCloudBackupCenter(
  emit: EmitFn<CloudBackupCenterEvents>,
  resources: readonly ResourceSummary[] = [],
) {
  const KOOFR_URL = 'https://app.koofr.net/dav/Koofr'

  const DEFAULT_SCHEDULE: CloudBackupSchedule = { mode: 'interval', value: 1, unit: 'days' }

  const DEFAULT_PROTECTION: CloudBackupProtection = {
    wifiOnly: false,
    chargingOnly: false,
  }

  const DEFAULT_CONTENT_SELECTION: CloudBackupContentSelection = {
    credentials: false,
    aiTaggingState: false,
    externalApps: false,
    chatReader: true,
    stitchWork: false,
  }

  const nativeTransport = Capacitor.isNativePlatform()
  const androidNativeTransport =
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

  const snapshot = ref(cloudBackupService.getSnapshot())

  const activeProvider = ref<CloudBackupProvider>(snapshot.value.activeProvider ?? 'github')

  const github = ref<
    GitHubBackupConfig & {
      schedule: CloudBackupSchedule
      protection: CloudBackupProtection
      contentSelection: CloudBackupContentSelection
    }
  >(
    snapshot.value.github
      ? {
          ...snapshot.value.github,
          schedule: snapshot.value.github.schedule ?? { ...DEFAULT_SCHEDULE },
          protection: snapshot.value.github.protection ?? { ...DEFAULT_PROTECTION },
          contentSelection: snapshot.value.github.contentSelection ?? {
            ...DEFAULT_CONTENT_SELECTION,
          },
        }
      : {
          provider: 'github',
          owner: '',
          repository: '',
          retention: 7,
          autoBackup: true,
          schedule: { ...DEFAULT_SCHEDULE },
          protection: { ...DEFAULT_PROTECTION },
          contentSelection: { ...DEFAULT_CONTENT_SELECTION },
        },
  )

  const webdav = ref<
    WebDavBackupConfig & {
      schedule: CloudBackupSchedule
      protection: CloudBackupProtection
      contentSelection: CloudBackupContentSelection
    }
  >(
    snapshot.value.webdav
      ? {
          ...snapshot.value.webdav,
          baseUrl: KOOFR_URL,
          schedule: snapshot.value.webdav.schedule ?? { ...DEFAULT_SCHEDULE },
          protection: snapshot.value.webdav.protection ?? { ...DEFAULT_PROTECTION },
          contentSelection: snapshot.value.webdav.contentSelection ?? {
            ...DEFAULT_CONTENT_SELECTION,
          },
        }
      : {
          provider: 'webdav',
          baseUrl: KOOFR_URL,
          folder: 'SRL-Backups',
          username: '',
          retention: 7,
          autoBackup: true,
          schedule: { ...DEFAULT_SCHEDULE },
          protection: { ...DEFAULT_PROTECTION },
          contentSelection: { ...DEFAULT_CONTENT_SELECTION },
        },
  )

  const githubToken = ref('')

  const githubRepositoryInspection = ref<
    (GitHubRepositoryInspection & { target: string }) | undefined
  >()

  const communityBackupConfirmedTarget = ref<Record<CloudBackupProvider, string | undefined>>({
    github: undefined,
    webdav: undefined,
  })

  const webdavPassword = ref('')

  const editingCredential = ref<Record<CloudBackupProvider, boolean>>({
    github: snapshot.value.credentials.github !== 'valid',
    webdav: snapshot.value.credentials.webdav !== 'valid',
  })

  const credentialBackupConfirmedTarget = ref<Record<CloudBackupProvider, string | undefined>>({
    github:
      snapshot.value.github?.contentSelection?.credentials === true
        ? credentialBackupTarget(snapshot.value.github)
        : undefined,
    webdav:
      snapshot.value.webdav?.contentSelection?.credentials === true
        ? credentialBackupTarget(snapshot.value.webdav)
        : undefined,
  })

  const backups = ref<CloudBackupItem[]>([])

  const restorePicker = ref<{ item: CloudBackupItem; resources: ResourceSummary[] }>()
  const selectedRestoreKeys = ref(new Set<string>())

  const busyAction = ref('')

  const nativeBackupActive = ref(false)

  const message = ref('')

  const now = ref(Date.now())

  const tutorialPreview = ref<{ source: string; alt: string }>()

  const tutorialCloseButton = useTemplateRef<HTMLButtonElement>('tutorialCloseButton')

  let tutorialTrigger: HTMLElement | undefined

  let clock: number | undefined

  let nativeJobPoll: number | undefined

  const activeConfig = computed<CloudBackupConfig>(() =>
    activeProvider.value === 'github' ? github.value : webdav.value,
  )

  const githubTarget = computed(
    () =>
      `${github.value.owner.trim().toLowerCase()}/${github.value.repository.trim().toLowerCase()}`,
  )

  watch(githubToken, (value) => {
    if (!value) return
    githubRepositoryInspection.value = undefined
    cloudBackupService.invalidateGitHubPrivacyVerification(githubTarget.value)
  })

  const githubPrivateVerified = computed(
    () =>
      githubRepositoryInspection.value?.target === githubTarget.value &&
      githubRepositoryInspection.value?.isPrivate === true,
  )

  const communitySourcesEnabled = computed(
    () => activeProvider.value === 'webdav' || githubPrivateVerified.value,
  )

  const communitySourcesDisabledReason = computed(() => {
    if (activeProvider.value !== 'github') return undefined
    if (
      githubRepositoryInspection.value?.target === githubTarget.value &&
      !githubRepositoryInspection.value.isPrivate
    )
      return '目标是公开仓库，已阻止上传'
    return '先测试连接并确认目标为私有仓库'
  })

  const activeProtection = computed<CloudBackupProtection>(
    () => activeConfig.value.protection ?? DEFAULT_PROTECTION,
  )

  const activeContentSelection = computed<CloudBackupContentSelection>(
    () => activeConfig.value.contentSelection ?? DEFAULT_CONTENT_SELECTION,
  )

  function selectionModelForConfig(config: CloudBackupConfig): BackupSelectionTreeState {
    const defaults = createDefaultBackupSelection(resources, 'cloud')
    const configured = config.contentSelection ?? {}
    const scopes = new Set(defaults.scopes)
    const setScope = (id: BackupScopeId, enabled: boolean | undefined, fallback: boolean) => {
      if (enabled ?? fallback) scopes.add(id)
      else scopes.delete(id)
    }
    setScope('resource.extraStory', configured.personalResources?.extraStory, true)
    setScope('resource.pocketPhone', configured.personalResources?.pocketPhone, true)
    setScope('resource.secret', configured.personalResources?.secret, false)
    setScope('extra.plaintextSecretCopy', configured.plaintextSecretCopy, false)
    setScope('extra.credentials', configured.credentials, false)
    setScope('extra.aiTaggingState', configured.aiTaggingState, false)
    setScope('extra.externalApps', configured.externalApps, false)
    setScope('extra.chatReader', configured.chatReader, true)
    setScope('extra.stitchWork', configured.stitchWork, false)
    setScope('extra.communitySources', configured.communitySources, false)
    setScope('extra.appearance', configured.appearance, true)
    setScope('extra.cloudBackup', configured.cloudBackup, true)
    setScope('extra.characterDraw', configured.characterDraw, true)
    setScope('extra.generalPreferences', configured.generalPreferences, true)
    return {
      resourceIds: new Set(configured.resourceIds ?? defaults.resourceIds),
      scopes,
    }
  }

  const cloudScopeModel = ref<{
    resourceIds: string[]
    scopeIds: BackupScopeId[]
  }>(
    (() => {
      const model = selectionModelForConfig(activeConfig.value)
      return { resourceIds: [...model.resourceIds], scopeIds: [...model.scopes] }
    })(),
  )

  function setCloudScopeModel(next: { resourceIds: string[]; scopeIds: BackupScopeId[] }): void {
    cloudScopeModel.value = next
    const selectedIds = new Set(next.resourceIds)
    const allResourcesSelected =
      resources.length > 0 && resources.every((resource) => selectedIds.has(resource.id))
    activeConfig.value.contentSelection = {
      ...activeContentSelection.value,
      ...toCloudContentSelection({
        resourceIds: selectedIds,
        scopes: new Set(next.scopeIds),
      }),
      resourceIds: allResourcesSelected ? undefined : [...selectedIds],
    }
  }

  const personalBackupSelection = computed(() => {
    const selection = activeContentSelection.value
    selection.personalResources ??= { extraStory: true, pocketPhone: true, secret: false }
    return selection.personalResources
  })

  const backupContentSummary = computed(() => {
    const labels: string[] = []
    if (personalBackupSelection.value.extraStory) labels.push('番外')
    if (personalBackupSelection.value.pocketPhone) labels.push('小手机')
    if (personalBackupSelection.value.secret) labels.push('加密密钥')
    if (activeContentSelection.value.plaintextSecretCopy) labels.push('明文密钥副本')
    if (activeContentSelection.value.credentials) labels.push('API 配置与本机密钥')
    if (activeContentSelection.value.aiTaggingState) labels.push('AI 标签草稿')
    if (activeContentSelection.value.stitchWork) labels.push('预设缝合草稿')
    if (activeContentSelection.value.externalApps) labels.push('第三方 APP 数据')
    if (activeContentSelection.value.chatReader) labels.push('读了么阅读数据')
    if (activeContentSelection.value.communitySources) labels.push('Discord 社区内容')
    if (activeContentSelection.value.appearance) labels.push('外观与 CSS')
    if (activeContentSelection.value.generalPreferences) labels.push('常用偏好')
    if (activeContentSelection.value.characterDraw) labels.push('抽了么记录')
    if (activeContentSelection.value.cloudBackup) labels.push('云备份配置')
    return labels.length ? `额外携带：${labels.join('、')}` : '额外携带：无'
  })

  const activeSecret = computed(() =>
    activeProvider.value === 'github' ? githubToken.value : webdavPassword.value,
  )

  const status = computed(() => snapshot.value.status)

  const lastMetrics = computed(() => status.value.lastMetrics)

  const excessBackupCount = computed(() =>
    Math.max(0, backups.value.length - Math.max(1, Number(activeConfig.value.retention) || 1)),
  )

  const excessBackupBytes = computed(() => {
    const keep = Math.max(1, Number(activeConfig.value.retention) || 1)
    return backups.value.slice(keep).reduce((total, item) => total + item.size, 0)
  })

  function refreshSnapshot(): void {
    snapshot.value = cloudBackupService.getSnapshot()
  }

  function formatMetricDuration(value: number): string {
    return value >= 1_000 ? `${(value / 1_000).toFixed(1)} 秒` : `${Math.round(value)} 毫秒`
  }

  function formatMetricBytes(value: number): string {
    if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`
    return `${Math.round(value)} B`
  }

  function metricSpeed(metrics: CloudBackupMetrics): string {
    return metrics.uploadedBytes && metrics.totalMs
      ? `任务平均 ${(metrics.uploadedBytes / 1024 / 1024 / (metrics.totalMs / 1_000)).toFixed(1)} MiB/s`
      : '未记录成功上传量'
  }

  function validateConfig(config: CloudBackupConfig): string {
    if (config.provider === 'github') {
      if (!config.owner.trim() || !config.repository.trim()) return '请填写 GitHub 用户名和仓库名'
    } else {
      if (!/^https:\/\//i.test(config.baseUrl.trim())) return 'WebDAV 地址必须使用 HTTPS'
      if (!config.username.trim()) return '请填写 Koofr 注册邮箱'
    }
    return ''
  }

  function credentialBackupTarget(config: CloudBackupConfig): string {
    if (config.provider === 'github') {
      return JSON.stringify([
        config.provider,
        config.owner.trim().toLowerCase(),
        config.repository.trim().toLowerCase(),
      ])
    }
    return JSON.stringify([
      config.provider,
      config.baseUrl.trim().replace(/\/+$/, ''),
      config.folder.trim().replace(/^\/+|\/+$/g, ''),
      config.username.trim().toLowerCase(),
    ])
  }

  function credentialBackupTargetLabel(config: CloudBackupConfig): string {
    return config.provider === 'github'
      ? `GitHub 仓库 ${config.owner.trim()}/${config.repository.trim()}`
      : `Koofr 账号 ${config.username.trim()} 的 /${config.folder.trim().replace(/^\/+/, '')} 目录`
  }

  async function ensureCommunitySourcesSafe(): Promise<boolean> {
    const target = credentialBackupTarget(activeConfig.value)
    const githubConfig = activeConfig.value as GitHubBackupConfig
    if (activeProvider.value === 'github') {
      try {
        const inspection =
          githubRepositoryInspection.value?.target === githubTarget.value
            ? githubRepositoryInspection.value
            : await cloudBackupService
                .inspectGitHubRepository(githubConfig, activeSecret.value || undefined)
                .then((value) => {
                  const next = { ...value, target: githubTarget.value }
                  githubRepositoryInspection.value = next
                  return next
                })
        if (!inspection.isPrivate) {
          message.value = `GitHub 仓库 ${inspection.fullName} 是公开仓库，已阻止上传 Discord 社区内容。请先把仓库改为 Private，再重新测试连接。`
          return false
        }
      } catch (error) {
        message.value = error instanceof Error ? error.message : '无法确认 GitHub 仓库是否私有'
        return false
      }
    }
    if (communityBackupConfirmedTarget.value[activeProvider.value] !== target) {
      const confirmed = await confirmAction({
        title: '确认备份 Discord 社区内容',
        message:
          activeProvider.value === 'github'
            ? `社区帖子、评论、作者信息和已保存附件可能包含其他人的个人信息。当前目标已确认是私有 GitHub 仓库 ${githubConfig.owner}/${githubConfig.repository}；请确认你有权保存并迁移这些内容。`
            : `社区帖子、评论、作者信息和已保存附件可能包含其他人的个人信息。Koofr 目录是否公开分享无法由应用完全判断，请确认当前目录未公开共享，并确认你有权保存并迁移这些内容。`,
        confirmLabel: '确认并允许备份',
        danger: true,
      })
      if (!confirmed) return false
      communityBackupConfirmedTarget.value[activeProvider.value] = target
    }
    return true
  }

  async function saveConfig(requireSecret = false): Promise<boolean> {
    const error = validateConfig(activeConfig.value)
    if (error) {
      message.value = error
      return false
    }
    const hasCredential = cloudBackupService.hasCredential(activeProvider.value)
    if (requireSecret && !activeSecret.value && !hasCredential) {
      message.value =
        activeProvider.value === 'github' ? '请填写 GitHub 令牌' : '请填写 Koofr 应用密码'
      return false
    }
    if (activeContentSelection.value.communitySources && !(await ensureCommunitySourcesSafe()))
      return false
    const credentialTarget = activeContentSelection.value.credentials
      ? credentialBackupTarget(activeConfig.value)
      : undefined
    if (
      credentialTarget &&
      credentialBackupConfirmedTarget.value[activeProvider.value] !== credentialTarget
    ) {
      const confirmed = await confirmAction({
        title: '将凭据写入云备份',
        message: `后续备份会把主 API、生图、图床、Discord 及云备份凭据写入 ${credentialBackupTargetLabel(activeConfig.value)}。备份本身未额外加密，拥有远端读取权限的人可使用这些密钥。确认保存这个选择吗？`,
        confirmLabel: '允许携带凭据',
        danger: true,
      })
      if (!confirmed) return false
    }
    try {
      if (
        activeContentSelection.value.plaintextSecretCopy &&
        personalBackupSelection.value.secret
      ) {
        if (!(await readPlainSecretExportGrant(activeConfig.value))) {
          if (
            !(await confirmAction({
              title: '允许明文密钥副本',
              message: `后续备份会将所选密钥卡的私密字段明文写入 ${credentialBackupTargetLabel(activeConfig.value)}。远端读取者可以看到这些值；本机将受保护保存此目标的解锁授权以便自动备份。`,
              confirmLabel: '允许此目标携带明文副本',
              danger: true,
            }))
          )
            return false
          const password = await requestSecretPassword(
            '输入查看密码。授权仅用于当前云备份目标；关闭明文副本会清除该目标的授权。',
          )
          if (!password) return false
          const secrets = []
          for (const summary of await resourceService.listSummaries()) {
            if (summary.type !== 'secret' || summary.metadata.cloudBackupExcluded === true) continue
            const resource = await resourceService.get(summary.id)
            if (resource) secrets.push(resource)
          }
          await plaintextSecretCopies(secrets, password)
          await savePlainSecretExportGrant(activeConfig.value, password)
        }
      } else await clearPlainSecretExportGrant(activeConfig.value)
      snapshot.value = await cloudBackupService.saveConfig(
        activeConfig.value,
        activeSecret.value,
        true,
      )
      credentialBackupConfirmedTarget.value[activeProvider.value] = credentialTarget
      if (activeSecret.value) {
        if (activeProvider.value === 'github') githubToken.value = ''
        else webdavPassword.value = ''
        editingCredential.value[activeProvider.value] = false
      }
      message.value = nativeTransport
        ? '配置已保存；凭据由 Android Keystore 保护并会自动使用'
        : '配置已保存；凭据已由本机浏览器设备密钥加密并会自动使用'
      return true
    } catch (error) {
      message.value = error instanceof Error ? error.message : '配置保存失败'
      refreshSnapshot()
      return false
    }
  }

  async function testConnection(): Promise<void> {
    busyAction.value = 'test'
    message.value = ''
    try {
      if (activeSecret.value) {
        if (!(await saveConfig(true))) return
        if (activeProvider.value === 'github') {
          const githubConfig = activeConfig.value as GitHubBackupConfig
          const inspection =
            githubRepositoryInspection.value?.target === githubTarget.value
              ? githubRepositoryInspection.value
              : await cloudBackupService.inspectGitHubRepository(githubConfig)
          githubRepositoryInspection.value = { ...inspection, target: githubTarget.value }
          message.value = `已连接 ${inspection.fullName}${inspection.isPrivate ? '（私有仓库）' : '（公开仓库，社区内容将被阻止）'}；新凭据已原子替换并正在使用`
        } else message.value = '连接成功；新凭据已原子替换并正在使用'
      } else {
        if (!(await saveConfig(true))) return
        if (activeProvider.value === 'github') {
          const inspection = await cloudBackupService.inspectGitHubRepository(
            activeConfig.value as GitHubBackupConfig,
          )
          githubRepositoryInspection.value = { ...inspection, target: githubTarget.value }
          message.value = `已连接 ${inspection.fullName}${inspection.isPrivate ? '（私有仓库）' : '（公开仓库，社区内容将被阻止）'}`
        } else message.value = await cloudBackupService.testConnection(activeConfig.value)
      }
    } catch (error) {
      message.value = error instanceof Error ? error.message : '连接测试失败'
    } finally {
      busyAction.value = ''
      refreshSnapshot()
    }
  }

  function refillCredential(provider: CloudBackupProvider): void {
    editingCredential.value[provider] = true
    if (provider === 'github') {
      githubToken.value = ''
      githubRepositoryInspection.value = undefined
      cloudBackupService.invalidateGitHubPrivacyVerification(githubTarget.value)
    } else webdavPassword.value = ''
  }

  function cancelCredentialRefill(provider: CloudBackupProvider): void {
    editingCredential.value[provider] = false
    if (provider === 'github') githubToken.value = ''
    else webdavPassword.value = ''
  }

  async function createBackup(): Promise<void> {
    if (!(await saveConfig(true))) return
    let notificationWarning = ''
    if (androidNativeTransport) {
      const granted = await requestNativeNotifications().catch(() => false)
      if (!granted) {
        notificationWarning = '系统通知未开启，后台完成提醒可能不会出现在通知栏。'
      }
    }
    busyAction.value = 'backup'
    message.value = '正在检查本机变化与远端对象，请不要关闭页面…'
    try {
      const item = await cloudBackupService.createBackup(
        activeConfig.value,
        activeSecret.value || undefined,
        (progress) => {
          message.value = progress
        },
      )
      const resultMessage = item.unchanged
        ? `本机内容与上次成功备份完全一致，已核对远端清单，无需重新上传：${item.objectKey}`
        : item.maintenanceWarning
          ? `备份成功：${item.objectKey}\n${item.maintenanceWarning}`
          : `备份成功：${item.objectKey}`
      message.value = [resultMessage, notificationWarning].filter(Boolean).join('\n')
      backups.value = [
        item,
        ...backups.value.filter((backup) => backup.objectKey !== item.objectKey),
      ]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, activeConfig.value.retention)
      refreshSnapshot()
    } catch (error) {
      message.value = [error instanceof Error ? error.message : '云端备份失败', notificationWarning]
        .filter(Boolean)
        .join('\n')
    } finally {
      busyAction.value = ''
      refreshSnapshot()
    }
  }

  async function cancelNativeBackup(): Promise<void> {
    if (!(await cloudBackupService.cancelActiveNativeBackup())) return
    nativeBackupActive.value = false
    message.value = '已请求 Android 取消本次备份；未提交快照清单，旧备份不会受影响'
  }

  async function refreshNativeBackupState(): Promise<void> {
    if (!nativeTransport) return
    nativeBackupActive.value = await cloudBackupService.hasActiveNativeBackup()
    if (!nativeBackupActive.value) {
      await cloudBackupService.reconcileNativeJob()
      refreshSnapshot()
    }
  }

  async function loadBackups(): Promise<void> {
    if (!(await saveConfig(true))) return
    busyAction.value = 'list'
    try {
      backups.value = await cloudBackupService.listBackups(
        activeConfig.value,
        activeSecret.value || undefined,
        (progress) => {
          message.value = progress
        },
      )
      message.value = backups.value.length
        ? `已读取 ${backups.value.length} 个云端备份${
            excessBackupCount.value
              ? `；比当前保留份数多 ${excessBackupCount.value} 个，可点击“清理到 ${activeConfig.value.retention} 份”`
              : ''
          }`
        : '云端暂无备份'
    } catch (error) {
      message.value = error instanceof Error ? error.message : '云端列表读取失败'
    } finally {
      busyAction.value = ''
    }
  }

  async function cleanupRetention(): Promise<void> {
    if (!(await saveConfig(true))) return
    if (
      !(await confirmAction({
        title: '清理旧云备份',
        message: `预计最多释放 ${formatMetricBytes(excessBackupBytes.value)}（旧快照清单）。只会删除名称和 SHA-256 格式均可验证、且未被任何当前或历史快照引用的旧分块；用途无法证明的对象一律保留。确定继续吗？`,
        confirmLabel: `清理到 ${activeConfig.value.retention} 份`,
        danger: true,
      }))
    )
      return
    busyAction.value = 'prune'
    message.value = '正在核对快照引用并清理旧备份…'
    try {
      const result = await cloudBackupService.enforceRetention(
        activeConfig.value,
        activeSecret.value || undefined,
      )
      await loadBackups()
      message.value = result.removed
        ? `已删除 ${result.removed} 份旧备份，现在最多保留 ${result.remaining} 份`
        : `无需清理，当前未超过 ${result.remaining} 份`
    } catch (error) {
      message.value = error instanceof Error ? error.message : '旧备份清理失败'
    } finally {
      busyAction.value = ''
    }
  }

  async function restore(item: CloudBackupItem): Promise<void> {
    if (!restorePicker.value || restorePicker.value.item.id !== item.id) {
      if (!(await saveConfig(true))) return
      busyAction.value = `restore:${item.id}`
      message.value = '正在读取云端资源清单…'
      try {
        const resources = await cloudBackupService.listBackupResources(item)
        restorePicker.value = { item, resources }
        selectedRestoreKeys.value = new Set(resources.map((resource) => resource.id))
        message.value = resources.length
          ? '请选择要导入的资源；历史版本会随所属资源一起导入。'
          : '这个备份没有可导入的资源'
      } catch (error) {
        message.value = error instanceof Error ? error.message : '读取云端资源清单失败'
      } finally {
        busyAction.value = ''
      }
      return
    }
    const selectedKeys = [...selectedRestoreKeys.value]
    if (!selectedKeys.length) {
      message.value = '请至少选择一项资源'
      return
    }
    if (
      !(await confirmAction({
        title: '从云端导入',
        message: `将从“${item.objectKey}”导入选中的 ${selectedKeys.length} 项资源吗？历史版本会随所属资源一起导入；重复文件会跳过，不会清空现有资源。${activeContentSelection.value.credentials ? '该备份可能包含你明确选择迁移的 API 凭据，恢复后会写入本机受保护存储。' : ''}`,
        confirmLabel: '导入',
      }))
    )
      return
    if (!(await saveConfig(true))) return
    busyAction.value = `restore:${item.id}`
    message.value = '正在下载、校验并合并备份…'
    try {
      const count = await cloudBackupService.restoreBackup(
        item,
        confirmPortableCredentialImport,
        selectedKeys,
      )
      message.value = count ? `已从云端加入 ${count} 项新资源` : '导入完成，没有发现新的资源'
      emit('library-changed')
      restorePicker.value = undefined
      selectedRestoreKeys.value = new Set()
    } catch (error) {
      message.value = error instanceof Error ? error.message : '云端导入失败'
    } finally {
      busyAction.value = ''
    }
  }

  function toggleRestoreResource(resource: ResourceSummary): void {
    const key = resource.id
    const next = new Set(selectedRestoreKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selectedRestoreKeys.value = next
  }

  function selectAllRestoreResources(): void {
    selectedRestoreKeys.value = new Set(
      restorePicker.value?.resources.map((resource) => resource.id) ?? [],
    )
  }

  function clearRestoreResources(): void {
    selectedRestoreKeys.value = new Set()
  }

  function restoreResourceType(resource: ResourceSummary): string {
    return isUserPersonaAvatarAttachment(resource)
      ? '用户人设头像附件'
      : RESOURCE_TYPE_LABELS[resource.type]
  }

  async function confirmPortableCredentialImport(
    data: ArchivePortableData,
  ): Promise<ArchivePortableData> {
    const labels = [
      data.mainApiProfiles?.profiles.some((profile) => profile.apiKey) ? '主 API 密钥' : '',
      data.credentials?.imageGeneration?.length ? '生图 API 密钥' : '',
      data.credentials?.imageHosting ? '自建图床 Token' : '',
      data.credentials?.legacyFrontendWorkshopApi?.apiKey ? '旧状态项目专用 API 密钥' : '',
      data.credentials?.discordSource?.botToken ? 'Discord Bot Token' : '',
      data.credentials?.cloudBackup && Object.keys(data.credentials.cloudBackup).length
        ? '云备份凭据'
        : '',
    ].filter(Boolean)
    if (!labels.length) return data
    const confirmed = await confirmAction({
      title: '导入云备份中的凭据',
      message: `这个云备份实际包含：${labels.join('、')}。导入后会写入当前设备的受保护存储，确认继续吗？`,
      confirmLabel: '导入凭据',
    })
    return confirmed ? data : { ...data, mainApiProfiles: undefined, credentials: undefined }
  }

  async function download(item: CloudBackupItem): Promise<void> {
    if (!(await saveConfig(true))) return
    busyAction.value = `download:${item.id}`
    message.value = '正在读取、下载并生成备份归档…'
    const operationId = taskCenter.start({ name: '下载云备份', phase: '读取、下载并生成归档' })
    try {
      const blob = await cloudBackupService.downloadBackup(item)
      taskCenter.update(operationId, { phase: '等待保存或系统分享' })
      message.value = '归档已生成，正在交给系统保存或分享…'
      await downloadBlob(blob, item.archiveName ?? item.objectKey)
      taskCenter.complete(operationId)
      message.value = nativeTransport
        ? '已交给系统分享；请在目标应用中确认保存'
        : '已交给浏览器下载；保存结果请查看浏览器下载列表'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') taskCenter.cancelled(operationId)
      else taskCenter.fail(operationId, error)
      message.value = error instanceof Error ? error.message : '下载失败'
    } finally {
      busyAction.value = ''
    }
  }

  function selectProvider(provider: CloudBackupProvider): void {
    if (busyAction.value) return
    activeProvider.value = provider
    if (provider === 'webdav') applyKoofrPreset(false)
    const model = selectionModelForConfig(provider === 'github' ? github.value : webdav.value)
    cloudScopeModel.value = { resourceIds: [...model.resourceIds], scopeIds: [...model.scopes] }
    backups.value = []
    restorePicker.value = undefined
    selectedRestoreKeys.value = new Set()
    message.value = ''
    refreshSnapshot()
  }

  function applyKoofrPreset(showMessage = true): void {
    webdav.value.baseUrl = KOOFR_URL
    if (!webdav.value.folder.trim()) webdav.value.folder = 'SRL-Backups'
    if (showMessage) message.value = 'Koofr 地址和备份文件夹已经配好；只需填写注册邮箱和应用密码'
  }

  function setScheduleMode(mode: CloudBackupSchedule['mode']): void {
    activeConfig.value.schedule =
      mode === 'daily' ? { mode: 'daily', time: '02:00' } : { ...DEFAULT_SCHEDULE }
  }

  function updateScheduleValue(event: Event): void {
    const schedule = activeConfig.value.schedule
    if (schedule?.mode !== 'interval') return
    activeConfig.value.schedule = {
      ...schedule,
      value: Number((event.target as HTMLInputElement).value),
    }
  }

  function updateScheduleUnit(event: Event): void {
    const schedule = activeConfig.value.schedule
    if (schedule?.mode !== 'interval') return
    activeConfig.value.schedule = {
      ...schedule,
      unit: (event.target as HTMLSelectElement).value as CloudBackupIntervalUnit,
    }
  }

  function updateScheduleTime(event: Event): void {
    activeConfig.value.schedule = {
      mode: 'daily',
      time: (event.target as HTMLInputElement).value,
    }
  }

  function formatBytes(value: number): string {
    if (!value) return '未知大小'
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  }

  function formatTime(value?: number): string {
    if (!value) return '尚未成功备份'
    const elapsed = Math.max(0, now.value - value)
    if (elapsed < 60_000) return '刚刚'
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`
    return `${Math.floor(elapsed / 86_400_000)} 天前`
  }

  function openTutorialPreview(source: string, alt: string, event: MouseEvent): void {
    tutorialTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
    tutorialPreview.value = { source, alt }
  }

  function closeTutorialPreview(): void {
    if (!tutorialPreview.value) return
    tutorialPreview.value = undefined
    void nextTick(() => tutorialTrigger?.focus({ preventScroll: true }))
  }

  function handleTutorialKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !tutorialPreview.value) return
    closeTutorialPreview()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  watch(tutorialPreview, async (preview) => {
    document.body.classList.toggle('tutorial-preview-open', Boolean(preview))
    if (!preview) return
    await nextTick()
    tutorialCloseButton.value?.focus({ preventScroll: true })
  })

  watch(
    () => github.value.contentSelection.credentials,
    (enabled, previous) => {
      if (enabled && !previous) credentialBackupConfirmedTarget.value.github = undefined
    },
  )

  watch(
    () => webdav.value.contentSelection.credentials,
    (enabled, previous) => {
      if (enabled && !previous) credentialBackupConfirmedTarget.value.webdav = undefined
    },
  )

  onMounted(() => {
    clock = window.setInterval(() => (now.value = Date.now()), 60_000)
    window.addEventListener('keydown', handleTutorialKeydown, true)
    if (nativeTransport) {
      void refreshNativeBackupState()
      nativeJobPoll = window.setInterval(() => void refreshNativeBackupState(), 5_000)
    }
    void cloudBackupService.initializeCredentials().then(() => {
      refreshSnapshot()
      editingCredential.value.github = snapshot.value.credentials.github !== 'valid'
      editingCredential.value.webdav = snapshot.value.credentials.webdav !== 'valid'
    })
  })

  onUnmounted(() => {
    if (clock !== undefined) window.clearInterval(clock)
    if (nativeJobPoll !== undefined) window.clearInterval(nativeJobPoll)
    window.removeEventListener('keydown', handleTutorialKeydown, true)
    document.body.classList.remove('tutorial-preview-open')
  })
  return {
    status,
    formatTime,
    snapshot,
    activeProvider,
    selectProvider,
    busyAction,
    createBackup,
    nativeTransport,
    nativeBackupActive,
    cancelNativeBackup,
    loadBackups,
    message,
    lastMetrics,
    metricSpeed,
    formatMetricDuration,
    formatMetricBytes,
    excessBackupCount,
    excessBackupBytes,
    cleanupRetention,
    activeConfig,
    backups,
    restorePicker,
    selectedRestoreKeys,
    toggleRestoreResource,
    selectAllRestoreResources,
    clearRestoreResources,
    restoreResourceType,
    formatBytes,
    download,
    restore,
    saveConfig,
    github,
    openTutorialPreview,
    editingCredential,
    refillCredential,
    githubToken,
    cancelCredentialRefill,
    webdav,
    KOOFR_URL,
    webdavPassword,
    setScheduleMode,
    updateScheduleValue,
    updateScheduleUnit,
    updateScheduleTime,
    activeProtection,
    activeContentSelection,
    cloudScopeModel,
    setCloudScopeModel,
    communitySourcesEnabled,
    communitySourcesDisabledReason,
    backupScopeResources: resources,
    personalBackupSelection,
    backupContentSummary,
    testConnection,
    tutorialPreview,
    closeTutorialPreview,
  }
}
