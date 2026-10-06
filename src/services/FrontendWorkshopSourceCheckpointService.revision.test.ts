/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import { FrontendWorkshopSourceCheckpointService } from './FrontendWorkshopSourceCheckpointService'
import {
  FrontendWorkshopSourceDocumentService,
  FrontendWorkshopSourceRevisionConflictError,
} from './FrontendWorkshopSourceDocumentService'
import { FrontendWorkshopSourceHistoryService } from './FrontendWorkshopSourceHistoryService'
import { FrontendWorkshopSourcePatchService } from './FrontendWorkshopSourcePatchService'

const databases: AppDatabase[] = []

afterEach(async () => {
  const opened = databases.splice(0)
  const names = Array.from(new Set(opened.map((database) => database.name)))
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

function createHarness() {
  const database = new AppDatabase(
    `frontend-workshop-source-checkpoint-revision-${crypto.randomUUID()}`,
  )
  databases.push(database)
  const storage = new IndexedDbFrontendWorkshopSourceDocumentStorage(database)
  const sourceService = new FrontendWorkshopSourceDocumentService(storage)
  const patchService = new FrontendWorkshopSourcePatchService(sourceService)
  const historyService = new FrontendWorkshopSourceHistoryService(sourceService, patchService)
  const checkpointService = new FrontendWorkshopSourceCheckpointService(
    sourceService,
    historyService,
    { createCheckpointId: () => 'checkpoint-revision' },
  )
  return { sourceService, checkpointService }
}

describe('FrontendWorkshopSourceCheckpointService visible-revision guards', () => {
  it('refuses create and restore when the caller is looking at an older Source revision', async () => {
    const { sourceService, checkpointService } = createHarness()
    const first = await sourceService.saveAuthorSource(
      'project-checkpoint-visible-revision',
      'one',
      {
        now: 100,
      },
    )
    const checkpoint = await checkpointService.create(first.projectId, {
      expectedRevision: first.revision,
      expectedSourceCreatedAt: first.createdAt,
    })
    const second = await sourceService.saveAuthorSourceAtRevision(
      first.projectId,
      first.revision,
      'two',
    )

    await expect(
      checkpointService.create(first.projectId, {
        expectedRevision: first.revision,
        expectedSourceCreatedAt: first.createdAt,
      }),
    ).rejects.toBeInstanceOf(FrontendWorkshopSourceRevisionConflictError)
    await expect(
      checkpointService.restore(first.projectId, checkpoint.id, {
        expectedRevision: first.revision,
        expectedSourceCreatedAt: first.createdAt,
      }),
    ).rejects.toBeInstanceOf(FrontendWorkshopSourceRevisionConflictError)
    expect(await sourceService.get(first.projectId)).toEqual(second)
  })
})
