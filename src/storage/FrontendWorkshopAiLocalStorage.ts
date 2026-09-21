import type { AppDatabase } from '../database/AppDatabase'

const PREFIX = 'frontend-workshop-ai-local:'
const MAX_RECORD = 20_000_000
const MAX_TOTAL = 60_000_000
export interface FrontendWorkshopAiLocalStore {
  read(key: string): Promise<{ revision: number; data: unknown } | undefined>
  write(key: string, data: unknown, expectedRevision?: number): Promise<number>
}

/** Device-local working data. Uses the existing settings adapter boundary, not Source storage. */
export class FrontendWorkshopAiLocalStorage implements FrontendWorkshopAiLocalStore {
  private readonly database: AppDatabase
  constructor(database: AppDatabase) {
    this.database = database
  }

  async read(key: string): Promise<{ revision: number; data: unknown } | undefined> {
    const row = await this.database.settings.get(PREFIX + key)
    return row?.value as { revision: number; data: unknown } | undefined
  }

  async write(key: string, data: unknown, expectedRevision?: number): Promise<number> {
    const size = JSON.stringify(data).length
    if (size > MAX_RECORD) throw new Error('AI 本机恢复记录超过容量，当前回复仍保留在页面中')
    return this.database.transaction(
      'rw',
      this.database.settings,
      this.database.frontendWorkshopSourceDocuments,
      async () => {
        if (
          key.startsWith('session:') &&
          data !== null &&
          !(await this.database.frontendWorkshopSourceDocuments.get(key.slice(8)))
        )
          throw new Error('作品已删除，停止保存 AI 恢复记录')
        const current = await this.read(key)
        if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision)
          throw new Error('另一页面已更新 AI 恢复记录，请先保留当前回复再刷新')
        const rows = await this.database.settings.where('id').startsWith(PREFIX).toArray()
        const total = rows
          .filter((row) => row.id !== PREFIX + key)
          .reduce((sum, row) => sum + JSON.stringify(row.value).length, size)
        if (total > MAX_TOTAL) throw new Error('AI 本机恢复空间已满，请清理不再需要的对话')
        const revision = (current?.revision ?? 0) + 1
        await this.database.settings.put({
          id: PREFIX + key,
          value: { revision, data },
          updatedAt: Date.now(),
        })
        return revision
      },
    )
  }
}
