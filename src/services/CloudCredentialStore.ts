import type { CloudBackupProvider } from '../types/CloudBackup'

const DATABASE_NAME = 'srl-cloud-credentials-v3'
const DATABASE_VERSION = 1
const DEVICE_KEY_ID = 'device-key'

interface StoredCredential {
  provider: string
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  status: 'valid' | 'invalid'
  updatedAt: number
}

export interface CloudCredentialState {
  present: boolean
  valid: boolean
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('浏览器凭据数据库操作失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器凭据数据库事务已中止'))
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器凭据数据库事务失败'))
  })
}

function isSupported(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined'
  )
}

export class ProtectedCredentialStore {
  private database?: Promise<IDBDatabase>
  private deviceKeyValue?: Promise<CryptoKey>

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    if (!isSupported()) {
      return Promise.reject(new Error('当前环境不支持浏览器本机凭据存储'))
    }
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains('keys')) database.createObjectStore('keys')
        if (!database.objectStoreNames.contains('credentials')) {
          database.createObjectStore('credentials', { keyPath: 'provider' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('无法打开浏览器凭据数据库'))
    })
    return this.database
  }

  private deviceKey(): Promise<CryptoKey> {
    if (this.deviceKeyValue) return this.deviceKeyValue
    this.deviceKeyValue = this.loadOrCreateDeviceKey().catch((error) => {
      this.deviceKeyValue = undefined
      throw error
    })
    return this.deviceKeyValue
  }

  private async loadOrCreateDeviceKey(): Promise<CryptoKey> {
    const database = await this.open()
    const existing = await requestResult(
      database.transaction('keys', 'readonly').objectStore('keys').get(DEVICE_KEY_ID),
    )
    if (existing) return existing as CryptoKey
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const transaction = database.transaction('keys', 'readwrite')
    try {
      await requestResult(transaction.objectStore('keys').add(key, DEVICE_KEY_ID))
      await transactionDone(transaction)
      return key
    } catch (error) {
      await transactionDone(transaction).catch(() => undefined)
      const winner = await requestResult(
        database.transaction('keys', 'readonly').objectStore('keys').get(DEVICE_KEY_ID),
      )
      if (winner) return winner as CryptoKey
      throw error
    }
  }

  async save(identifier: string, secret: string): Promise<void> {
    if (!identifier) throw new Error('凭据标识不能为空')
    if (!secret) throw new Error('凭据不能为空')
    if (!isSupported()) throw new Error('当前环境不支持浏览器本机凭据存储')
    const key = await this.deviceKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(secret),
    )
    const database = await this.open()
    const transaction = database.transaction('credentials', 'readwrite')
    transaction.objectStore('credentials').put({
      provider: identifier,
      iv: iv.buffer,
      ciphertext,
      status: 'valid',
      updatedAt: Date.now(),
    } satisfies StoredCredential)
    await transactionDone(transaction)
  }

  async read(identifier: string): Promise<string> {
    if (!isSupported()) return ''
    const database = await this.open()
    const record = (await requestResult(
      database.transaction('credentials', 'readonly').objectStore('credentials').get(identifier),
    )) as StoredCredential | undefined
    if (!record || record.status !== 'valid') return ''
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
        await this.deviceKey(),
        record.ciphertext,
      )
      return new TextDecoder().decode(plaintext)
    } catch (error) {
      throw new Error('本机浏览器凭据无法解密；请重新填写密钥', { cause: error })
    }
  }

  async state(identifier: string): Promise<CloudCredentialState> {
    if (!isSupported()) return { present: false, valid: false }
    const database = await this.open()
    const record = (await requestResult(
      database.transaction('credentials', 'readonly').objectStore('credentials').get(identifier),
    )) as StoredCredential | undefined
    return { present: Boolean(record), valid: record?.status === 'valid' }
  }

  async markInvalid(identifier: string): Promise<void> {
    if (!isSupported()) return
    const database = await this.open()
    const transaction = database.transaction('credentials', 'readwrite')
    const store = transaction.objectStore('credentials')
    const record = (await requestResult(store.get(identifier))) as StoredCredential | undefined
    if (record) store.put({ ...record, status: 'invalid', updatedAt: Date.now() })
    await transactionDone(transaction)
  }

  async clear(identifier: string): Promise<void> {
    if (!isSupported()) return
    const database = await this.open()
    const transaction = database.transaction('credentials', 'readwrite')
    transaction.objectStore('credentials').delete(identifier)
    await transactionDone(transaction)
  }
}

/** 云备份兼容 facade；底层与其它本机凭据共用同一个受保护存储 Owner。 */
export class CloudCredentialStore {
  private readonly store = new ProtectedCredentialStore()

  save(provider: CloudBackupProvider, secret: string): Promise<void> {
    return this.store.save(provider, secret)
  }

  read(provider: CloudBackupProvider): Promise<string> {
    return this.store.read(provider)
  }

  state(provider: CloudBackupProvider): Promise<CloudCredentialState> {
    return this.store.state(provider)
  }

  markInvalid(provider: CloudBackupProvider): Promise<void> {
    return this.store.markInvalid(provider)
  }

  clear(provider: CloudBackupProvider): Promise<void> {
    return this.store.clear(provider)
  }
}
