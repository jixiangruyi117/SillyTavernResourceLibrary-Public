import { describe, expect, it } from 'vitest'
import {
  beginLinkImportRecovery,
  clearLinkImportRecovery,
  markLinkImportItemCompleted,
  pendingLinkImportUrls,
  readLinkImportRecovery,
} from './LinkImportRecovery'

function createStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key)
    },
    setItem: (key, value) => {
      entries.set(key, value)
    },
  }
}

describe('link import recovery', () => {
  it('resumes only links without a durable completion checkpoint', () => {
    const storage = createStorage()
    const recovery = beginLinkImportRecovery(
      storage,
      ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
      'run-1',
      Date.now(),
    )
    markLinkImportItemCompleted(storage, recovery.id, 0)
    markLinkImportItemCompleted(storage, recovery.id, 2)

    const restored = readLinkImportRecovery(storage)

    expect(restored?.completed).toEqual([0, 2])
    expect(restored && pendingLinkImportUrls(restored)).toEqual(['https://example.com/b'])
  })

  it('clears the plan and all per-link checkpoints', () => {
    const storage = createStorage()
    beginLinkImportRecovery(storage, ['https://example.com/a'], 'run-2')
    markLinkImportItemCompleted(storage, 'run-2', 0)

    clearLinkImportRecovery(storage, 'run-2')

    expect(readLinkImportRecovery(storage)).toBeUndefined()
    expect(storage.length).toBe(0)
  })

  it('replaces an older interrupted run when a new import starts', () => {
    const storage = createStorage()
    beginLinkImportRecovery(storage, ['https://example.com/old'], 'old-run')
    beginLinkImportRecovery(storage, ['https://example.com/new'], 'new-run')

    expect(readLinkImportRecovery(storage)?.id).toBe('new-run')
    expect(storage.length).toBe(1)
  })
})
