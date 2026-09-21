import type { CloudBackupProvider } from '../types/CloudBackup'

const DATABASE_NAME = 'srl-cloud-jobs-v3'
const DATABASE_VERSION = 2

export type CloudBackupObjectJobState = 'pending' | 'verified' | 'failed'

export interface CloudBackupJobRecord {
  id: string
  provider: CloudBackupProvider
  planHash: string
  status: 'running' | 'completed' | 'failed'
  objects: Record<string, CloudBackupObjectJobState>
  manifestName?: string
  error?: string
  updatedAt: number
}

interface CloudBackupOrphanRecord {
  id: string
  scope: string
  identity: string
  firstSeenAt: number
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('浏览器云备份任务数据库操作失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器云备份任务事务已中止'))
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器云备份任务事务失败'))
  })
}

export class CloudBackupJobStore {
  private database?: Promise<IDBDatabase>

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('jobs')) {
          request.result.createObjectStore('jobs', { keyPath: 'id' })
        }
        if (!request.result.objectStoreNames.contains('orphans')) {
          request.result.createObjectStore('orphans', { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('无法打开浏览器云备份任务数据库'))
    })
    return this.database
  }

  private id(provider: CloudBackupProvider, planHash: string): string {
    return `${provider}:${planHash}`
  }

  async begin(
    provider: CloudBackupProvider,
    planHash: string,
    objectNames: Iterable<string>,
  ): Promise<CloudBackupJobRecord> {
    const database = await this.open()
    const id = this.id(provider, planHash)
    const existing = (await requestResult(
      database.transaction('jobs', 'readonly').objectStore('jobs').get(id),
    )) as CloudBackupJobRecord | undefined
    const objects = Object.fromEntries([...objectNames].map((name) => [name, 'pending'])) as Record<
      string,
      CloudBackupObjectJobState
    >
    for (const [name, state] of Object.entries(existing?.objects ?? {})) {
      if (name in objects && state === 'verified') objects[name] = state
    }
    const record: CloudBackupJobRecord = {
      id,
      provider,
      planHash,
      status: 'running',
      objects,
      updatedAt: Date.now(),
    }
    await this.put(record)
    return record
  }

  async markObject(
    job: CloudBackupJobRecord,
    objectName: string,
    state: CloudBackupObjectJobState,
  ): Promise<void> {
    job.objects[objectName] = state
    job.status = state === 'failed' ? 'failed' : 'running'
    job.updatedAt = Date.now()
    await this.put(job)
  }

  async complete(job: CloudBackupJobRecord, manifestName: string): Promise<void> {
    job.status = 'completed'
    job.manifestName = manifestName
    job.error = undefined
    job.updatedAt = Date.now()
    await this.put(job)
  }

  async fail(job: CloudBackupJobRecord, error: unknown): Promise<void> {
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : String(error)
    job.updatedAt = Date.now()
    await this.put(job)
  }

  async read(
    provider: CloudBackupProvider,
    planHash: string,
  ): Promise<CloudBackupJobRecord | undefined> {
    const database = await this.open()
    return (await requestResult(
      database.transaction('jobs', 'readonly').objectStore('jobs').get(this.id(provider, planHash)),
    )) as CloudBackupJobRecord | undefined
  }

  async eligibleOrphans(
    scope: string,
    identities: Iterable<string>,
    now: number,
    graceMs: number,
  ): Promise<string[]> {
    const database = await this.open()
    const transaction = database.transaction('orphans', 'readwrite')
    const store = transaction.objectStore('orphans')
    const existing = (await requestResult(store.getAll())) as CloudBackupOrphanRecord[]
    const candidates = new Set(identities)
    const byIdentity = new Map(
      existing
        .filter((record) => record.scope === scope)
        .map((record) => [record.identity, record]),
    )
    for (const record of existing) {
      if (record.scope === scope && !candidates.has(record.identity)) store.delete(record.id)
    }
    const eligible: string[] = []
    for (const identity of candidates) {
      const record = byIdentity.get(identity)
      if (!record) {
        store.put({
          id: `${scope}\u0000${identity}`,
          scope,
          identity,
          firstSeenAt: now,
        } satisfies CloudBackupOrphanRecord)
      } else if (record.firstSeenAt <= now - graceMs) {
        eligible.push(identity)
      }
    }
    await transactionDone(transaction)
    return eligible
  }

  async clearOrphan(scope: string, identity: string): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction('orphans', 'readwrite')
    transaction.objectStore('orphans').delete(`${scope}\u0000${identity}`)
    await transactionDone(transaction)
  }

  /** Pending candidates are rechecked against retained manifests before any later deletion. */
  async pendingOrphans(scope: string): Promise<string[]> {
    const database = await this.open()
    const records = (await requestResult(
      database.transaction('orphans', 'readonly').objectStore('orphans').getAll(),
    )) as CloudBackupOrphanRecord[]
    return records.filter((record) => record.scope === scope).map((record) => record.identity)
  }

  private async put(record: CloudBackupJobRecord): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction('jobs', 'readwrite')
    transaction.objectStore('jobs').put(record)
    await transactionDone(transaction)
  }
}
