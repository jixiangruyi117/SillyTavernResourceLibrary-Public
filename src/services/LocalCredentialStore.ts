import { ProtectedCredentialStore } from './CloudCredentialStore'
import {
  clearNativeAppCredential,
  isNativeCloudTransferAvailable,
  readNativeAppCredential,
  saveNativeAppCredential,
} from './NativeCloudTransfer'

export interface LocalCredentialRepository {
  save(identifier: string, secret: string): Promise<void>
  read(identifier: string): Promise<string>
  clear(identifier: string): Promise<void>
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u

function normalizedIdentifier(value: string): string {
  const identifier = value.trim().toLowerCase()
  if (!IDENTIFIER_PATTERN.test(identifier)) throw new Error('本机凭据标识无效')
  return `app:${identifier}`
}

/**
 * 全应用敏感凭据的唯一持久化入口。
 * Web 使用 non-extractable 设备密钥加密，Android 使用 Keystore。
 */
export class LocalCredentialStore implements LocalCredentialRepository {
  private readonly webStore = new ProtectedCredentialStore()

  async save(identifier: string, secret: string): Promise<void> {
    const key = normalizedIdentifier(identifier)
    if (!secret.trim()) throw new Error('凭据不能为空')
    if (isNativeCloudTransferAvailable()) {
      await saveNativeAppCredential(key, secret)
      if ((await readNativeAppCredential(key)) !== secret) {
        throw new Error('Android Keystore 凭据写入后校验失败')
      }
      await this.webStore.save(key, secret)
      if ((await this.webStore.read(key)) !== secret) {
        throw new Error('Android Keystore 已保存凭据，但 IndexedDB 回滚副本校验失败')
      }
    } else await this.webStore.save(key, secret)
  }

  async read(identifier: string): Promise<string> {
    const key = normalizedIdentifier(identifier)
    if (!isNativeCloudTransferAvailable()) return this.webStore.read(key)
    const nativeSecret = await readNativeAppCredential(key)
    if (nativeSecret) return nativeSecret
    const browserState = await this.webStore.state(key)
    if (!browserState.present || !browserState.valid) return ''
    const legacySecret = await this.webStore.read(key)
    if (!legacySecret) return ''
    await saveNativeAppCredential(key, legacySecret)
    const migratedSecret = await readNativeAppCredential(key)
    if (migratedSecret !== legacySecret) throw new Error('旧凭据迁入 Android Keystore 后校验失败')
    return migratedSecret
  }

  async clear(identifier: string): Promise<void> {
    const key = normalizedIdentifier(identifier)
    if (isNativeCloudTransferAvailable()) {
      await clearNativeAppCredential(key)
      await this.webStore.clear(key)
    } else await this.webStore.clear(key)
  }
}

export const localCredentialStore = new LocalCredentialStore()
