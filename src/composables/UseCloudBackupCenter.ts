import type { EmitFn } from 'vue'
import { computed, onMounted, ref } from 'vue'
import { cloudBackupService } from '../core/AppContainer'
import type { CloudBackupItem, GitHubBackupConfig } from '../types/CloudBackup'
import type { ResourceSummary } from '../types/Resource'

export type CloudBackupCenterProps = { resourceCount: number; resources: ResourceSummary[] }
export type CloudBackupCenterEvents = { back: []; 'library-changed': [] }

export function useCloudBackupCenter(
  emit: EmitFn<CloudBackupCenterEvents>,
  resources: readonly ResourceSummary[] = [],
) {
  const snapshot = ref(cloudBackupService.getSnapshot())
  const owner = ref(snapshot.value.github?.owner ?? '')
  const repository = ref(snapshot.value.github?.repository ?? '')
  const token = ref('')
  const retention = ref(snapshot.value.github?.retention ?? 7)
  const backups = ref<CloudBackupItem[]>([])
  const busy = ref(false)
  const message = ref('')
  const error = ref('')
  const config = computed<GitHubBackupConfig>(() => ({
    provider: 'github',
    owner: owner.value.trim(),
    repository: repository.value.trim(),
    retention: Math.max(1, Math.min(100, Number(retention.value) || 7)),
    autoBackup: true,
    contentSelection: { credentials: false },
  }))

  async function connect(): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = ''
    message.value = ''
    try {
      snapshot.value = await cloudBackupService.saveConfig(config.value, token.value.trim(), true)
      token.value = ''
      message.value = 'GitHub 私有仓库连接成功，令牌只保存在本机凭据存储。'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'GitHub 连接失败'
    } finally {
      busy.value = false
    }
  }

  async function refreshBackups(): Promise<void> {
    error.value = ''
    try {
      backups.value = await cloudBackupService.listBackups()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '读取 GitHub 备份失败'
    }
  }

  async function createBackup(): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = ''
    message.value = ''
    try {
      const item = await cloudBackupService.createBackup()
      backups.value = [item, ...backups.value.filter((entry) => entry.id !== item.id)]
      message.value = `备份完成：${item.archiveName ?? item.objectKey}`
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '创建备份失败'
    } finally {
      busy.value = false
    }
  }

  async function download(item: CloudBackupItem): Promise<void> {
    try {
      const blob = await cloudBackupService.downloadBackup(item)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = item.archiveName ?? `${item.objectKey}.zip`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '下载备份失败'
    }
  }

  async function restore(item: CloudBackupItem): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await cloudBackupService.restoreBackup(item)
      message.value = '备份已恢复，本地资源列表将刷新。'
      emit('library-changed')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '恢复备份失败'
    } finally {
      busy.value = false
    }
  }

  onMounted(() => {
    void cloudBackupService.initializeCredentials().then(() => void refreshBackups())
  })

  return {
    owner,
    repository,
    token,
    retention,
    backups,
    busy,
    message,
    error,
    connect,
    createBackup,
    refreshBackups,
    download,
    restore,
    resourceCount: resources.length,
  }
}
