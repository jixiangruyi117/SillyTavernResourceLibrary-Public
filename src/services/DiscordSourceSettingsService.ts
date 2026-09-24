import { normalizeDiscordWorkerBaseUrl } from './DiscordSourceConnectionService'
import { localCredentialStore, type LocalCredentialRepository } from './LocalCredentialStore'

export interface DiscordSourceConnectionSettings {
  applicationId: string
  publicKey: string
  botToken: string
  workerBaseUrl: string
  credentialPersistence?: 'local' | 'session'
  /** 最近一次真实 /health 成功时间；只用于本机状态恢复，不代表当前时刻必然在线。 */
  workerVerifiedAt?: number
  /** 最近一次向 Discord API 核验消息命令的时间。 */
  commandCheckedAt?: number
  /** 最近一次真实核验时消息命令是否存在。 */
  commandRegistered?: boolean
}

export interface DiscordSourceConnectionStatusPatch {
  workerVerifiedAt?: number
  commandCheckedAt?: number
  commandRegistered?: boolean
}

const STORAGE_KEY = 'srl.discord-source.connection.v1'
const CREDENTIAL_IDENTIFIER = 'discord-source:bot-token'

const EMPTY_SETTINGS: DiscordSourceConnectionSettings = {
  applicationId: '',
  publicKey: '',
  botToken: '',
  workerBaseUrl: '',
  credentialPersistence: 'local',
}

let currentSettings: DiscordSourceConnectionSettings | undefined

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function readString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function readOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function normalizeSettings(
  value: Partial<DiscordSourceConnectionSettings>,
): DiscordSourceConnectionSettings {
  return {
    applicationId: readString(value.applicationId, 64),
    publicKey: readString(value.publicKey, 256),
    botToken: readString(value.botToken, 512),
    workerBaseUrl: normalizeDiscordWorkerBaseUrl(readString(value.workerBaseUrl, 2_000)),
    credentialPersistence: value.credentialPersistence === 'session' ? 'session' : 'local',
    workerVerifiedAt: readOptionalTimestamp(value.workerVerifiedAt),
    commandCheckedAt: readOptionalTimestamp(value.commandCheckedAt),
    commandRegistered:
      typeof value.commandRegistered === 'boolean' ? value.commandRegistered : undefined,
  }
}

function readStoredSettings(): DiscordSourceConnectionSettings {
  const target = storage()
  if (!target) return { ...EMPTY_SETTINGS }
  try {
    return normalizeSettings(
      JSON.parse(target.getItem(STORAGE_KEY) ?? '{}') as Partial<DiscordSourceConnectionSettings>,
    )
  } catch {
    return { ...EMPTY_SETTINGS }
  }
}

function writeSanitizedSettings(value: DiscordSourceConnectionSettings): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify({ ...value, botToken: '' }))
}

function connectionIdentityChanged(
  previous: DiscordSourceConnectionSettings,
  next: DiscordSourceConnectionSettings,
): boolean {
  return (
    previous.applicationId !== next.applicationId ||
    previous.workerBaseUrl !== next.workerBaseUrl ||
    previous.botToken !== next.botToken
  )
}

export async function initializeDiscordSourceCredentials(
  credentialStore: LocalCredentialRepository = localCredentialStore,
): Promise<void> {
  const settings = currentSettings ?? readStoredSettings()
  if (settings.credentialPersistence === 'session') {
    await credentialStore.clear(CREDENTIAL_IDENTIFIER)
  } else if (settings.botToken) {
    // 旧明文只有在受保护存储成功后才会从 localStorage 删除。
    await credentialStore.save(CREDENTIAL_IDENTIFIER, settings.botToken)
  } else {
    settings.botToken = await credentialStore.read(CREDENTIAL_IDENTIFIER)
  }
  currentSettings = settings
  writeSanitizedSettings(settings)
}

export function loadDiscordSourceConnectionSettings(): DiscordSourceConnectionSettings {
  currentSettings ??= readStoredSettings()
  return { ...currentSettings }
}

export async function saveDiscordSourceConnectionSettings(
  value: DiscordSourceConnectionSettings,
  credentialStore: LocalCredentialRepository = localCredentialStore,
): Promise<DiscordSourceConnectionSettings> {
  const previous = currentSettings ?? readStoredSettings()
  const normalized = normalizeSettings(value)
  const changedIdentity = connectionIdentityChanged(previous, normalized)
  if (!changedIdentity) {
    normalized.workerVerifiedAt ??= previous.workerVerifiedAt
    normalized.commandCheckedAt ??= previous.commandCheckedAt
    normalized.commandRegistered ??= previous.commandRegistered
  } else {
    normalized.workerVerifiedAt = undefined
    normalized.commandCheckedAt = undefined
    normalized.commandRegistered = undefined
  }

  if (normalized.credentialPersistence === 'local' && normalized.botToken) {
    await credentialStore.save(CREDENTIAL_IDENTIFIER, normalized.botToken)
  } else {
    await credentialStore.clear(CREDENTIAL_IDENTIFIER)
  }
  currentSettings = normalized
  writeSanitizedSettings(normalized)
  return { ...normalized }
}

export function saveDiscordSourceConnectionStatus(
  patch: DiscordSourceConnectionStatusPatch,
): DiscordSourceConnectionSettings {
  const current = currentSettings ?? readStoredSettings()
  const next = normalizeSettings({
    ...current,
    ...(patch.workerVerifiedAt !== undefined ? { workerVerifiedAt: patch.workerVerifiedAt } : {}),
    ...(patch.commandCheckedAt !== undefined ? { commandCheckedAt: patch.commandCheckedAt } : {}),
    ...(patch.commandRegistered !== undefined
      ? { commandRegistered: patch.commandRegistered }
      : {}),
  })
  currentSettings = next
  writeSanitizedSettings(next)
  return { ...next }
}

export async function clearDiscordSourceConnectionSettings(
  credentialStore: LocalCredentialRepository = localCredentialStore,
): Promise<void> {
  await credentialStore.clear(CREDENTIAL_IDENTIFIER)
  currentSettings = { ...EMPTY_SETTINGS }
  storage()?.removeItem(STORAGE_KEY)
}
