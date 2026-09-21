/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'

import type { CategoryService } from './CategoryService'
import { CloudBackupService } from './CloudBackupService'
import { STATUS_KEY } from './CloudBackupConfiguration'
import type { ExportService } from './ExportService'
import type { ResourceService } from './ResourceService'
import type { RestoreService } from './RestoreService'
import type { CloudBackupStatus } from '../types/CloudBackup'

function createService(): CloudBackupService {
  return new CloudBackupService(
    {} as ResourceService,
    {} as CategoryService,
    {} as ExportService,
    {} as RestoreService,
  )
}

describe('CloudBackup status semantics', () => {
  beforeEach(() => localStorage.clear())

  it('keeps successful maintenance notices separate from backup errors', () => {
    const service = createService() as unknown as {
      writeStatus(update: CloudBackupStatus): void
    }
    service.writeStatus({
      provider: 'github',
      lastAttemptAt: 1,
      lastSuccessAt: 1,
      lastError: undefined,
      lastWarning: '已按保留份数自动清理 1 份旧云端快照。',
    })

    const stored = JSON.parse(localStorage.getItem(STATUS_KEY) ?? '{}') as CloudBackupStatus
    expect(stored.lastSuccessAt).toBe(1)
    expect(stored.lastError).toBeUndefined()
    expect(stored.lastWarning).toContain('自动清理 1 份旧云端快照')
  })

  it('clears a stale maintenance notice when a real failure is recorded', () => {
    const service = createService() as unknown as {
      writeStatus(update: CloudBackupStatus): void
    }
    service.writeStatus({ lastSuccessAt: 1, lastWarning: '旧提示', lastError: undefined })
    service.writeStatus({ lastAttemptAt: 2, lastError: '上传失败', lastWarning: undefined })

    const stored = JSON.parse(localStorage.getItem(STATUS_KEY) ?? '{}') as CloudBackupStatus
    expect(stored.lastError).toBe('上传失败')
    expect(stored.lastWarning).toBeUndefined()
  })
})
