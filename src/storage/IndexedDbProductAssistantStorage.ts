import type { AppDatabase } from '../database/AppDatabase'
import type { AppSetting } from '../types/Resource'
import type {
  ProductAssistantStorage,
  AssistantPreferences,
  AssistantConversation,
  AssistantConversationSummary,
  AssistantMemory,
  AssistantMessageMatch,
  AssistantProject,
  AssistantProjectSummary,
  AssistantProjectReference,
  AssistantTaskTemplate,
} from '../services/ProductAssistantWorkspaceService'
const chatPrefix = 'assistant.chat:'
const summaryPrefix = 'assistant.summary:'
const activeId = 'assistant.active'
const preferencesId = 'assistant.preferences'
const memoriesId = 'assistant.memories'
const messagePrefix = 'assistant.message:'
const projectPrefix = 'assistant.project:'
const projectSummaryPrefix = 'assistant.project-summary:'
const templatesId = 'assistant.templates'
type IndexedSummary = AssistantConversationSummary & { searchVersion?: number }
type MessageIndex = Omit<AssistantMessageMatch, 'title'> & { role: 'user' | 'assistant' }
/** Chat bodies and drafts are local settings, read only when opening a conversation. */
export class IndexedDbProductAssistantStorage implements ProductAssistantStorage {
  private readonly database: AppDatabase
  constructor(database: AppDatabase) {
    this.database = database
  }
  async exportPortableState(): Promise<AppSetting[]> {
    return (await this.database.settings.where('id').startsWith('assistant.').toArray()).map(
      ({ id, value, updatedAt }) => ({ id, value, updatedAt }),
    )
  }
  async importPortableState(value: unknown): Promise<void> {
    if (!Array.isArray(value)) return
    const records = value.filter(
      (record): record is AppSetting =>
        Boolean(record) &&
        typeof record === 'object' &&
        typeof record.id === 'string' &&
        record.id.startsWith('assistant.') &&
        record.id.length <= 512 &&
        Number.isFinite(record.updatedAt),
    )
    for (let offset = 0; offset < records.length; offset += 500)
      await this.database.settings.bulkPut(records.slice(offset, offset + 500))
  }
  async preferences() {
    return (await this.database.settings.get(preferencesId))?.value as
      AssistantPreferences | undefined
  }
  async savePreferences(value: AssistantPreferences) {
    await this.database.settings.put({ id: preferencesId, value, updatedAt: Date.now() })
  }
  async memories(): Promise<AssistantMemory[]> {
    return (
      ((await this.database.settings.get(memoriesId))?.value as AssistantMemory[] | undefined) ?? []
    )
  }
  async saveMemories(value: AssistantMemory[]) {
    await this.database.settings.put({ id: memoriesId, value, updatedAt: Date.now() })
  }
  async active() {
    return (await this.database.settings.get(activeId))?.value as string | undefined
  }
  async read(id: string) {
    const [body, metadata] = await this.database.settings.bulkGet([
      chatPrefix + id,
      summaryPrefix + id,
    ])
    const chat = body?.value as AssistantConversation | undefined
    const summary = metadata?.value as AssistantConversationSummary | undefined
    if (chat?.projectId) {
      const project = await this.project(chat.projectId)
      if (!project) throw new Error('APP 项目读取失败，聊天原文仍保留')
      chat.draft = project.draft
      chat.projectVersion = project.version
    }
    return chat && summary?.customTitle
      ? { ...chat, title: summary.customTitle, customTitle: summary.customTitle }
      : chat
  }
  async save(value: AssistantConversation, activate = false) {
    return this.database.transaction('rw', this.database.settings, async () => {
      // A previously captured autosave must never undo a manual rename.
      const previous = (await this.database.settings.get(summaryPrefix + value.id))?.value as
        AssistantConversationSummary | undefined
      const customTitle = previous?.customTitle || value.customTitle
      const chat = { ...value, ...(customTitle ? { customTitle, title: customTitle } : {}) }
      let reference: AssistantProjectReference | undefined
      if (chat.draft) {
        const id = chat.draft.manifest.id
        const stored = await this.project(id)
        const contents = (draft: AssistantProject['draft']) =>
          JSON.stringify({ manifest: draft.manifest, source: draft.source, tasks: draft.tasks })
        const changed = !stored || contents(stored.draft) !== contents(chat.draft)
        if (stored && changed && (chat.projectId !== id || chat.projectVersion !== stored.version))
          throw new Error('项目已有更新，本次草稿未覆盖。请保留当前内容，再重新打开项目核对')
        const project: AssistantProject = changed
          ? {
              id,
              name: chat.draft.manifest.name,
              updatedAt: chat.updatedAt,
              version: (stored?.version ?? 0) + 1,
              draft: chat.draft,
            }
          : stored!
        if (changed) {
          const { draft: _draft, ...metadata } = project
          await this.database.settings.bulkPut([
            { id: projectPrefix + id, value: project, updatedAt: project.updatedAt },
            { id: projectSummaryPrefix + id, value: metadata, updatedAt: project.updatedAt },
          ])
        }
        reference = { projectId: id, projectVersion: project.version }
        Object.assign(chat, reference)
        delete chat.draft
      } else if (chat.projectId) {
        const project = await this.project(chat.projectId)
        if (!project) throw new Error('项目读取失败，未保存空草稿')
        reference = { projectId: project.id, projectVersion: project.version }
        Object.assign(chat, reference)
      }
      const summary: IndexedSummary = {
        id: chat.id,
        title: chat.title,
        ...(customTitle ? { customTitle } : {}),
        updatedAt: chat.updatedAt,
        searchVersion: 1,
      }
      await this.indexMessages(chat)
      await this.database.settings.bulkPut([
        { id: chatPrefix + value.id, value: chat, updatedAt: value.updatedAt },
        { id: summaryPrefix + value.id, value: summary, updatedAt: value.updatedAt },
        ...(activate ? [{ id: activeId, value: value.id, updatedAt: value.updatedAt }] : []),
      ])
      return reference
    })
  }
  async project(id: string): Promise<AssistantProject | undefined> {
    return (await this.database.settings.get(projectPrefix + id))?.value as
      AssistantProject | undefined
  }
  async projects(offset: number, limit: number) {
    // Sort only lightweight metadata; never load project source for this list.
    const rows = await this.database.settings.where('id').startsWith(projectSummaryPrefix).toArray()
    const summaries = rows
      .map((row) => row.value as AssistantProjectSummary)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { items: summaries.slice(offset, offset + limit), total: summaries.length }
  }
  async templates(): Promise<AssistantTaskTemplate[]> {
    return (
      ((await this.database.settings.get(templatesId))?.value as
        AssistantTaskTemplate[] | undefined) ?? []
    )
  }
  async putTemplate(value: AssistantTaskTemplate) {
    await this.database.transaction('rw', this.database.settings, async () => {
      const items = await this.templates()
      const index = items.findIndex((item) => item.id === value.id)
      if (index < 0) {
        if (items.length >= 30) throw new Error('最多保存 30 个任务模板')
        items.push(value)
      } else items[index] = value
      await this.database.settings.put({ id: templatesId, value: items, updatedAt: Date.now() })
    })
  }
  async removeTemplate(id: string) {
    await this.database.transaction('rw', this.database.settings, async () => {
      const items = (await this.templates()).filter((item) => item.id !== id)
      await this.database.settings.put({ id: templatesId, value: items, updatedAt: Date.now() })
    })
  }
  private async indexMessages(chat: AssistantConversation) {
    const prefix = messagePrefix + chat.id + ':'
    const existing = new Map<string, MessageIndex>()
    await this.database.settings
      .where('id')
      .startsWith(prefix)
      .each((row) => {
        existing.set(row.id, row.value as MessageIndex)
      })
    for (const [position, turn] of chat.history.entries()) {
      const turnId = turn.id || `legacy-${position}`
      const id = prefix + turnId
      const value: MessageIndex = {
        conversationId: chat.id,
        turnId,
        text: turn.text,
        role: turn.role,
        updatedAt: chat.updatedAt,
        favorite: turn.favorite === true,
      }
      const previous = existing.get(id)
      // Store text only. Images, CSS state, APP files and tool data are never indexed.
      if (!previous || previous.text !== value.text || previous.favorite !== value.favorite)
        await this.database.settings.put({ id, value, updatedAt: chat.updatedAt })
      existing.delete(id)
    }
    if (existing.size) await this.database.settings.bulkDelete([...existing.keys()])
  }
  private async upgradeSearchIndex() {
    // Old conversations are migrated once, one body at a time in bounded summary pages.
    let offset = 0
    for (;;) {
      const rows = await this.database.settings
        .where('id')
        .startsWith(summaryPrefix)
        .offset(offset)
        .limit(20)
        .toArray()
      for (const row of rows) {
        if ((row.value as IndexedSummary).searchVersion === 1) continue
        await this.database.transaction('rw', this.database.settings, async () => {
          const latest = await this.database.settings.get(row.id)
          if (!latest || (latest.value as IndexedSummary).searchVersion === 1) return
          const body = (
            await this.database.settings.get(chatPrefix + (latest.value as IndexedSummary).id)
          )?.value as AssistantConversation | undefined
          if (!body) return
          await this.indexMessages(body)
          await this.database.settings.put({
            ...latest,
            value: { ...(latest.value as IndexedSummary), searchVersion: 1 },
          })
        })
      }
      if (rows.length < 20) break
      offset += rows.length
    }
  }
  async search(query: string, favorites: boolean, offset: number, limit: number) {
    await this.upgradeSearchIndex()
    const needle = query.toLocaleLowerCase()
    const matches: AssistantMessageMatch[] = []
    let total = 0
    const keep = (value: AssistantMessageMatch) => {
      total++
      matches.push(value)
      matches.sort(
        (a, b) => b.updatedAt - a.updatedAt || (a.turnId ?? '').localeCompare(b.turnId ?? ''),
      )
      if (matches.length > offset + Math.min(20, limit)) matches.pop()
    }
    if (!favorites && needle)
      await this.database.settings
        .where('id')
        .startsWith(summaryPrefix)
        .each((row) => {
          const summary = row.value as IndexedSummary
          if (summary.title.toLocaleLowerCase().includes(needle))
            keep({
              conversationId: summary.id,
              title: summary.title,
              text: '',
              updatedAt: summary.updatedAt,
            })
        })
    await this.database.settings
      .where('id')
      .startsWith(messagePrefix)
      .each((row) => {
        const message = row.value as MessageIndex
        if (
          (!favorites || message.favorite) &&
          (!needle || message.text.toLocaleLowerCase().includes(needle))
        )
          keep({ ...message, title: '' })
      })
    const items = matches.slice(offset)
    const titles = await this.database.settings.bulkGet(
      items.map((item) => summaryPrefix + item.conversationId),
    )
    return {
      total,
      items: items.map((item, index) => ({
        ...item,
        title: (titles[index]?.value as IndexedSummary | undefined)?.title || item.title,
      })),
    }
  }
  async rename(id: string, title: string) {
    await this.database.transaction('rw', this.database.settings, async () => {
      const row = await this.database.settings.get(summaryPrefix + id)
      if (!row) throw new Error('这条对话已不存在')
      const summary = { ...(row.value as AssistantConversationSummary), title, customTitle: title }
      await this.database.settings.put({ ...row, value: summary })
    })
  }
  async list(offset: number, limit: number) {
    const summaries = (await this.database.settings.where('id').startsWith(summaryPrefix).toArray())
      .map((row) => row.value as AssistantConversationSummary)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { items: summaries.slice(offset, offset + Math.min(20, limit)), total: summaries.length }
  }
  async remove(id: string) {
    await this.database.transaction('rw', this.database.settings, async () => {
      if ((await this.active()) === id) throw new Error('请先切换对话再删除')
      await this.database.settings.bulkDelete([chatPrefix + id, summaryPrefix + id])
      await this.database.settings
        .where('id')
        .startsWith(messagePrefix + id + ':')
        .delete()
    })
  }
}
