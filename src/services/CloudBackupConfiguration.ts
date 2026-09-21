import type { ArchivePortableData } from '../types/Backup'
import type {
  CloudBackupConfig,
  CloudBackupProvider,
  CloudBackupSnapshot,
  CloudBackupStatus,
  GitHubBackupConfig,
} from '../types/CloudBackup'
import { readJson } from './CloudBackupHttp'
import {
  normalizeContentSelection,
  normalizeProtection,
  normalizeRetention,
  normalizeSchedule,
} from './CloudBackupPolicy'
import { CloudCredentialStore } from './CloudCredentialStore'
import {
  clearNativeCloudCredential,
  invalidateNativeCloudCredential,
  isNativeCloudTransferAvailable,
  readNativeCloudCredential,
  saveNativeCloudCredential,
} from './NativeCloudTransfer'
const SETTINGS_KEY = 'srl.cloudBackup.settings.v1'

export const STATUS_KEY = 'srl.cloudBackup.status.v1'

const LOCAL_SECRETS_KEY = 'srl.cloudBackup.localSecrets.v1'

interface StoredCloudSettings {
  activeProvider?: CloudBackupProvider
  github?: GitHubBackupConfig
}

type StoredCloudSecrets = Partial<Record<CloudBackupProvider, string>>

/** Settings and the single credential lifecycle for one backup service. */
export class CloudBackupConfiguration {
  private readonly testConnection: (config: CloudBackupConfig, secret?: string) => Promise<string>
  constructor(testConnection: (config: CloudBackupConfig, secret?: string) => Promise<string>) {
    this.testConnection = testConnection
    this.credentialReady = this.loadCredentials()
  }
  private readonly credentialStore = new CloudCredentialStore()

  private readonly credentialCache: Partial<Record<CloudBackupProvider, string>> = {}

  private readonly credentialStates: Record<CloudBackupProvider, 'missing' | 'valid' | 'invalid'> =
    { github: 'missing' }

  private credentialReady?: Promise<void>

  async initializeCredentials(): Promise<void> {
    await this.credentialReady
  }

  async loadCredentials(): Promise<void> {
    const legacy = readJson<StoredCloudSecrets>(localStorage, LOCAL_SECRETS_KEY, {})
    for (const provider of ['github'] as const) {
      if (isNativeCloudTransferAvailable()) {
        const credential = await readNativeCloudCredential(provider).catch(() => ({
          state: 'missing' as const,
          secret: '',
        }))
        this.credentialStates[provider] = credential.state
        if (credential.state === 'valid') {
          this.credentialCache[provider] = credential.secret
        }
        continue
      }
      if (legacy[provider]) {
        await this.credentialStore.save(provider, legacy[provider]!)
      }
      const state = await this.credentialStore.state(provider)
      this.credentialStates[provider] = state.present
        ? state.valid
          ? 'valid'
          : 'invalid'
        : 'missing'
      if (state.valid) this.credentialCache[provider] = await this.credentialStore.read(provider)
    }
    // AppContainer constructs this service at module load. In tests or other non-window
    // runtimes the jsdom globals may already be torn down by the time async credential
    // migration finishes, so cleanup must not dereference missing Web Storage globals.
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LOCAL_SECRETS_KEY)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('srl.cloudBackup.secret.github')
    }
  }

  getSnapshot(): CloudBackupSnapshot {
    const settings = readJson<StoredCloudSettings>(localStorage, SETTINGS_KEY, {})
    return {
      ...settings,
      status: readJson<CloudBackupStatus>(localStorage, STATUS_KEY, {}),
      credentials: { ...this.credentialStates },
    }
  }

  exportPortableSettings(): NonNullable<ArchivePortableData['cloudBackup']> {
    const settings = readJson<StoredCloudSettings>(localStorage, SETTINGS_KEY, {})
    return {
      activeProvider: settings.activeProvider,
      github: settings.github,
    }
  }

  importPortableSettings(value: NonNullable<ArchivePortableData['cloudBackup']>): void {
    const github =
      value.github?.provider === 'github'
        ? {
            ...value.github,
            owner: String(value.github.owner ?? '').trim(),
            repository: String(value.github.repository ?? '').trim(),
            retention: normalizeRetention(value.github.retention),
            schedule: normalizeSchedule(value.github.schedule),
            protection: normalizeProtection(value.github.protection),
            contentSelection: {
              ...normalizeContentSelection(value.github.contentSelection),
              plaintextSecretCopy: false,
            },
          }
        : undefined
    const activeProvider = value.activeProvider === 'github' && github ? 'github' : undefined
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ activeProvider, github }))
  }

  async exportPortableCredentials(): Promise<Partial<Record<CloudBackupProvider, string>>> {
    await this.initializeCredentials()
    return Object.fromEntries(
      (['github'] as const)
        .map((provider) => [provider, this.getSecret(provider)] as const)
        .filter((entry) => Boolean(entry[1])),
    )
  }

  async importPortableCredentials(
    value: Partial<Record<CloudBackupProvider, string>>,
  ): Promise<void> {
    await this.initializeCredentials()
    for (const provider of ['github'] as const) {
      const secret = String(value[provider] ?? '').trim()
      if (secret) await this.setSecret(provider, secret)
    }
  }

  async saveConfig(
    config: CloudBackupConfig,
    secret: string,
    activate = true,
  ): Promise<CloudBackupSnapshot> {
    await this.initializeCredentials()
    if (secret) {
      await this.testConnection(config, secret)
      await this.setSecret(config.provider, secret)
    } else if (!this.getSecret(config.provider)) {
      throw new Error('请先填写并验证云端凭据')
    }
    const current = readJson<StoredCloudSettings>(localStorage, SETTINGS_KEY, {})
    const normalized: GitHubBackupConfig = {
      ...config,
      owner: config.owner.trim(),
      repository: config.repository.trim(),
      retention: normalizeRetention(config.retention),
      schedule: normalizeSchedule(config.schedule),
      protection: normalizeProtection(config.protection),
      contentSelection: normalizeContentSelection(config.contentSelection),
    }
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...current,
        activeProvider: activate ? config.provider : current.activeProvider,
        [config.provider]: normalized,
      }),
    )
    return this.getSnapshot()
  }

  async clearCredential(provider: CloudBackupProvider): Promise<void> {
    delete this.credentialCache[provider]
    this.credentialStates[provider] = 'missing'
    if (!isNativeCloudTransferAvailable()) await this.credentialStore.clear(provider)
    else await clearNativeCloudCredential(provider)
  }

  hasCredential(provider: CloudBackupProvider): boolean {
    return Boolean(this.getSecret(provider))
  }

  getActiveConfig(): CloudBackupConfig {
    const snapshot = this.getSnapshot()
    const provider = snapshot.activeProvider
    const config = provider ? snapshot[provider] : undefined
    if (!config) throw new Error('请先保存并启用一种云端备份方式')
    return config
  }

  getSecret(provider: CloudBackupProvider): string {
    return this.credentialStates[provider] === 'valid' ? (this.credentialCache[provider] ?? '') : ''
  }

  private async setSecret(provider: CloudBackupProvider, secret: string): Promise<void> {
    if (isNativeCloudTransferAvailable()) await saveNativeCloudCredential(provider, secret)
    else await this.credentialStore.save(provider, secret)
    this.credentialCache[provider] = secret
    this.credentialStates[provider] = 'valid'
  }

  private async markCredentialInvalid(provider: CloudBackupProvider): Promise<void> {
    delete this.credentialCache[provider]
    this.credentialStates[provider] = 'invalid'
    if (isNativeCloudTransferAvailable()) await invalidateNativeCloudCredential(provider)
    else await this.credentialStore.markInvalid(provider)
  }

  async invalidateCredentialOnConfirmed401(
    provider: CloudBackupProvider,
    error: unknown,
  ): Promise<void> {
    const structured = error as { status?: unknown; code?: unknown } | null
    if (structured?.status === 401 || structured?.code === 'HTTP_401') {
      await this.markCredentialInvalid(provider)
    }
  }

  requireSecret(provider: CloudBackupProvider): string {
    const secret = this.getSecret(provider)
    if (!secret) throw new Error('本机没有保存云端凭证，请重新输入并保存配置')
    return secret
  }
}
