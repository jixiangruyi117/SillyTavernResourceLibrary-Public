import type { FrontendWorkshopAiLocalStore } from '../storage/FrontendWorkshopAiLocalStorage'

type Entry = { url: string; text: string; fetchedAt: number }
export interface FrontendWorkshopSourceAiReferenceCacheOwner {
  get(url: string): Promise<string | undefined>
  put(url: string, text: string): Promise<void>
}

/** Bounded official-file cache: exact repository/version/path keys, seven-day retention. */
export class FrontendWorkshopSourceAiReferenceCache implements FrontendWorkshopSourceAiReferenceCacheOwner {
  private readonly storage: FrontendWorkshopAiLocalStore
  private queue: Promise<void> = Promise.resolve()
  constructor(storage: FrontendWorkshopAiLocalStore) {
    this.storage = storage
  }
  private async entries(): Promise<Entry[]> {
    const value = (await this.storage.read('references'))?.data
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is Entry =>
            typeof entry?.url === 'string' &&
            typeof entry.text === 'string' &&
            Number.isFinite(entry.fetchedAt) &&
            entry.fetchedAt <= Date.now() &&
            Date.now() - entry.fetchedAt < 7 * 24 * 3600_000,
        )
      : []
  }
  async get(url: string): Promise<string | undefined> {
    try {
      return (await this.entries()).find((entry) => entry.url === url)?.text
    } catch {
      return undefined
    }
  }
  async put(url: string, text: string): Promise<void> {
    if (
      !/^https:\/\/raw\.githubusercontent\.com\/(?:N0VI028\/JS-Slash-Runner|SillyTavern\/SillyTavern)\//.test(
        url,
      ) ||
      text.length > 160_000
    )
      return
    this.queue = this.queue
      .then(async () => {
        const entries = [
          ...(await this.entries()).filter((entry) => entry.url !== url),
          { url, text, fetchedAt: Date.now() },
        ]
        while (
          entries.length > 16 ||
          entries.reduce((sum, entry) => sum + entry.text.length, 0) > 1_000_000
        )
          entries.shift()
        await this.storage.write('references', entries)
      })
      .catch(() => undefined) // Cache loss never invalidates a freshly read official response.
    await this.queue
  }
}
