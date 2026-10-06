import type { AppDatabase } from '../database/AppDatabase'

export const DISCORD_INBOX_AUTOMATION_SETTING_ID = 'discordInbox.automation.v1'

export interface DiscordInboxAutomationSettings {
  bindSameName: boolean
  bindSameAuthor: boolean
  bindNextPng: boolean
  bindForeground: boolean
  preferPngContainer: boolean
}

export const DEFAULT_DISCORD_INBOX_AUTOMATION_SETTINGS: DiscordInboxAutomationSettings = {
  bindSameName: false,
  bindSameAuthor: false,
  bindNextPng: false,
  bindForeground: false,
  preferPngContainer: false,
}

export class DiscordInboxAutomationSettingsService {
  private readonly database: AppDatabase
  private cached?: DiscordInboxAutomationSettings
  private loading?: Promise<DiscordInboxAutomationSettings>

  constructor(database: AppDatabase) {
    this.database = database
  }

  async load(): Promise<DiscordInboxAutomationSettings> {
    if (this.cached) return { ...this.cached }
    if (!this.loading) {
      this.loading = this.read().finally(() => {
        this.loading = undefined
      })
    }
    return { ...(await this.loading) }
  }

  async save(settings: DiscordInboxAutomationSettings): Promise<void> {
    const normalized = {
      bindSameName: settings.bindSameName === true,
      bindSameAuthor: settings.bindSameAuthor === true,
      bindNextPng: settings.bindNextPng === true,
      bindForeground: settings.bindForeground === true,
      preferPngContainer: settings.preferPngContainer === true,
    }
    await this.database.settings.put({
      id: DISCORD_INBOX_AUTOMATION_SETTING_ID,
      value: normalized,
      updatedAt: Date.now(),
    })
    this.cached = normalized
  }

  private async read(): Promise<DiscordInboxAutomationSettings> {
    const value = (await this.database.settings.get(DISCORD_INBOX_AUTOMATION_SETTING_ID))?.value
    const record =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Partial<DiscordInboxAutomationSettings>)
        : undefined
    this.cached = {
      bindSameName: record?.bindSameName === true,
      bindSameAuthor: record?.bindSameAuthor === true,
      bindNextPng: record?.bindNextPng === true,
      bindForeground: record?.bindForeground === true,
      preferPngContainer: record?.preferPngContainer === true,
    }
    return this.cached
  }
}
