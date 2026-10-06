import { describe, expect, it, vi } from 'vitest'
import {
  savePlainSecretExportGrant,
  readPlainSecretExportGrant,
  clearPlainSecretExportGrant,
  selectCloudResources,
} from './PersonalResourceBackup'
const stored = vi.hoisted(() => new Map<string, string>())
vi.mock('./LocalCredentialStore', () => ({
  localCredentialStore: {
    save: async (key: string, value: string) => {
      stored.set(key, value)
    },
    read: async (key: string) => stored.get(key) ?? '',
    clear: async (key: string) => {
      stored.delete(key)
    },
  },
}))
describe('plaintext companion target consent', () => {
  it('does not carry an authorization to a different destination and clears it explicitly', async () => {
    const target = {
      provider: 'github' as const,
      owner: 'Owner',
      repository: 'private-backup',
      retention: 7,
      autoBackup: true,
    }
    await savePlainSecretExportGrant(target, 'viewing-password')
    expect(await readPlainSecretExportGrant({ ...target, owner: 'owner' })).toBe('viewing-password')
    expect(await readPlainSecretExportGrant({ ...target, repository: 'other' })).toBe('')
    await clearPlainSecretExportGrant(target)
    expect(await readPlainSecretExportGrant(target)).toBe('')
    expect(stored.size).toBe(0)
  })
})

describe('cloud resource selection', () => {
  it('按统一选择树的资源 ID 限制云快照内容', () => {
    const resources = [
      { id: 'card', type: 'characterCard', metadata: {} },
      { id: 'extra', type: 'extraStory', metadata: {} },
      { id: 'excluded', type: 'characterCard', metadata: { cloudBackupExcluded: true } },
    ] as never[]
    expect(
      selectCloudResources(resources, { resourceIds: ['extra'] }).map((item) => item.id),
    ).toEqual(['extra'])
  })
})
