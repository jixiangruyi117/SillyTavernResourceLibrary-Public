import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../database/AppDatabase'
import {
  DEFAULT_DISCORD_INBOX_AUTOMATION_SETTINGS,
  DiscordInboxAutomationSettingsService,
} from './DiscordInboxAutomationSettings'

describe('Discord inbox automation settings', () => {
  it('persists independent switches and returns defensive snapshots', async () => {
    const database = new AppDatabase(`discord-inbox-settings-${crypto.randomUUID()}`)
    const service = new DiscordInboxAutomationSettingsService(database)
    try {
      expect(await service.load()).toEqual(DEFAULT_DISCORD_INBOX_AUTOMATION_SETTINGS)
      await service.save({
        bindSameName: true,
        bindSameAuthor: false,
        bindNextPng: true,
        bindForeground: true,
        preferPngContainer: true,
      })
      const loaded = await service.load()
      expect(loaded).toEqual({
        bindSameName: true,
        bindSameAuthor: false,
        bindNextPng: true,
        bindForeground: true,
        preferPngContainer: true,
      })
      loaded.bindSameName = false
      expect(await service.load()).toMatchObject({ bindSameName: true })
    } finally {
      database.close()
      await database.delete()
    }
  })
})
