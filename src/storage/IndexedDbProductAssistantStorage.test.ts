/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbProductAssistantStorage } from './IndexedDbProductAssistantStorage'

let database: AppDatabase
let storage: IndexedDbProductAssistantStorage

beforeEach(() => {
  database = new AppDatabase(`assistant-backup-test-${crypto.randomUUID()}`)
  storage = new IndexedDbProductAssistantStorage(database)
})

afterEach(async () => {
  await database.delete()
})

it('exports only assistant-owned local settings', async () => {
  await database.settings.bulkPut([
    { id: 'assistant.preferences', value: { theme: 'dark' }, updatedAt: 1 },
    { id: 'assistant.chat:one', value: { messages: ['private'] }, updatedAt: 2 },
    { id: 'product-assistant:custom-api', value: { key: 'credential' }, updatedAt: 3 },
    { id: 'srl.ui.customCss', value: '.private {}', updatedAt: 4 },
  ])

  await expect(storage.exportPortableState()).resolves.toEqual([
    { id: 'assistant.chat:one', value: { messages: ['private'] }, updatedAt: 2 },
    { id: 'assistant.preferences', value: { theme: 'dark' }, updatedAt: 1 },
  ])
})

it('restores only valid assistant rows and preserves unrelated settings', async () => {
  await database.settings.put({ id: 'shared-setting', value: 'keep', updatedAt: 1 })

  await storage.importPortableState([
    { id: 'assistant.preferences', value: { theme: 'light' }, updatedAt: 2 },
    { id: 'shared-setting', value: 'overwrite attempt', updatedAt: 3 },
    { id: 'assistant.bad-time', value: {}, updatedAt: Number.NaN },
  ])

  expect((await database.settings.get('assistant.preferences'))?.value).toEqual({ theme: 'light' })
  expect((await database.settings.get('shared-setting'))?.value).toBe('keep')
  expect(await database.settings.get('assistant.bad-time')).toBeUndefined()
})
