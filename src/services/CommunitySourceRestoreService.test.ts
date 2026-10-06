import { describe, expect, it, vi } from 'vitest'

import type { ArchiveStorageAdapter } from '../storage/ArchiveStorageAdapter'
import { MemoryRestoreStagingStore } from '../storage/RestoreStagingStore'
import type { PreparedRestore } from '../types/Backup'
import type { CommunitySourceBackupData } from '../types/CommunitySource'
import { CommunitySourceRestoreService } from './CommunitySourceRestoreService'

function prepared(communitySourceData?: CommunitySourceBackupData): PreparedRestore {
  return {
    preview: {
      fileName: 'backup.zip',
      mode: 'full',
      createdAt: '2026-08-27T00:00:00.000Z',
      archiveResourceCount: 0,
      resourcesToAdd: 0,
      duplicatesToSkip: 0,
      conflictsToPreserve: 0,
      categoriesToCreate: 0,
      categoriesToReuse: 0,
    },
    resources: [],
    versions: [],
    categories: [],
    communitySourceData,
  }
}

function createService() {
  const storage: ArchiveStorageAdapter = {
    restore: vi.fn(async () => undefined),
    replace: vi.fn(async () => undefined),
  }
  const sourceOwner = {
    restoreBackup: vi.fn(async () => undefined),
    replaceAll: vi.fn(async () => undefined),
  }
  return {
    storage,
    sourceOwner,
    service: new CommunitySourceRestoreService(
      storage,
      new MemoryRestoreStagingStore(),
      sourceOwner,
    ),
  }
}

describe('CommunitySourceRestoreService', () => {
  it('preserves current community sources when a full replacement backup omitted them', async () => {
    const { service, sourceOwner } = createService()

    await service.replace(prepared())

    expect(sourceOwner.restoreBackup).not.toHaveBeenCalled()
    expect(sourceOwner.replaceAll).not.toHaveBeenCalled()
  })

  it('uses the archived community sources when the full replacement backup contains them', async () => {
    const { service, sourceOwner } = createService()
    const data: CommunitySourceBackupData = {
      version: 1,
      sources: [],
      messages: [],
      bindings: [],
    }

    await service.replace(prepared(data))

    expect(sourceOwner.restoreBackup).toHaveBeenCalledWith(data, 'replace')
    expect(sourceOwner.replaceAll).not.toHaveBeenCalled()
  })
})
