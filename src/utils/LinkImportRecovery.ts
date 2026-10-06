const RECOVERY_PREFIX = 'srl.link-import-recovery.v1.'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface LinkImportRecovery {
  id: string
  urls: string[]
  completed: number[]
  createdAt: number
}

function planKey(id: string): string {
  return `${RECOVERY_PREFIX}${id}`
}

function itemKey(id: string, index: number): string {
  return `${RECOVERY_PREFIX}${id}.${index}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readPlan(storage: Storage, id: string): Omit<LinkImportRecovery, 'completed'> | undefined {
  const raw = storage.getItem(planKey(id))
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      value.id !== id ||
      !Array.isArray(value.urls) ||
      !value.urls.every((url) => typeof url === 'string') ||
      typeof value.createdAt !== 'number'
    )
      return undefined
    if (Date.now() - value.createdAt > MAX_AGE_MS) {
      clearLinkImportRecovery(storage, id)
      return undefined
    }
    return {
      id,
      urls: value.urls,
      createdAt: value.createdAt,
    }
  } catch {
    return undefined
  }
}

export function beginLinkImportRecovery(
  storage: Storage,
  urls: string[],
  id: string = crypto.randomUUID(),
  createdAt = Date.now(),
): LinkImportRecovery {
  const staleKeys: string[] = []
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)
    if (key?.startsWith(RECOVERY_PREFIX)) staleKeys.push(key)
  }
  for (const key of staleKeys) storage.removeItem(key)
  storage.setItem(planKey(id), JSON.stringify({ version: 1, id, urls, createdAt }))
  return { id, urls: [...urls], completed: [], createdAt }
}

export function readLinkImportRecovery(storage: Storage): LinkImportRecovery | undefined {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)
    if (!key?.startsWith(RECOVERY_PREFIX) || key.slice(RECOVERY_PREFIX.length).includes('.'))
      continue
    const id = key.slice(RECOVERY_PREFIX.length)
    const plan = readPlan(storage, id)
    if (!plan) continue
    const completed: number[] = []
    for (let itemIndex = 0; itemIndex < plan.urls.length; itemIndex++) {
      if (storage.getItem(itemKey(id, itemIndex)) === '1') completed.push(itemIndex)
    }
    return { ...plan, completed }
  }
  return undefined
}

export function markLinkImportItemCompleted(storage: Storage, id: string, index: number): void {
  storage.setItem(itemKey(id, index), '1')
}

export function pendingLinkImportUrls(recovery: LinkImportRecovery): string[] {
  const completed = new Set(recovery.completed)
  return recovery.urls.filter((_, index) => !completed.has(index))
}

export function clearLinkImportRecovery(storage: Storage, id: string): void {
  const prefix = `${RECOVERY_PREFIX}${id}`
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)
    if (key === prefix || key?.startsWith(`${prefix}.`)) storage.removeItem(key)
  }
}
