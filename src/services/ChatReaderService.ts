import { readChatMessages, type ChatMessage } from '../parser/ChatResourceParser'
import { RESOURCE_TYPE, getRelatedResourceIds, type Resource } from '../types/Resource'
import type { ResourceService } from './ResourceService'

export interface ChatReadPage {
  messages: Array<{ index: number; depth: number; message: ChatMessage }>
  nextOffset: number | null
  total: number
  contentHash: string
}

/** Chat originals live in ResourceService; this service owns only bounded reading and binding. */
export class ChatReaderService {
  private readonly resources: ResourceService
  constructor(resources: ResourceService) {
    this.resources = resources
  }

  async getChat(id: string): Promise<Resource> {
    const chat = await this.resources.get(id)
    if (!chat || chat.type !== RESOURCE_TYPE.CHAT) throw new Error('聊天记录不存在')
    return chat
  }

  async read(id: string, offset = 0, limit = 20): Promise<ChatReadPage> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new Error('聊天分页参数无效')
    const chat = await this.getChat(id)
    const total = Number(chat.metadata.messageCount)
    if (!Number.isSafeInteger(total) || total < 1)
      throw new Error('聊天解析信息缺失，请重新导入原件')
    const messages: ChatReadPage['messages'] = []
    let index = 0,
      visible = 0,
      bytes = 0
    for await (const message of readChatMessages(chat.originalBlob, String(chat.metadata.format))) {
      if (!message.is_system) visible++
      if (index >= offset) {
        const size = new TextEncoder().encode(JSON.stringify(message)).length
        // Bound each IPC response, while retaining a complete, valid message rather than truncating it.
        if (size > 4 * 1024 * 1024) throw new Error(`第 ${index + 1} 楼超过单楼读取上限`)
        if (messages.length && bytes + size > 512 * 1024) break
        bytes += size
        messages.push({
          index,
          depth: message.is_system ? -1 : Number(chat.metadata.visibleMessageCount) - visible,
          message,
        })
      }
      index++
      if (messages.length >= limit) break
    }
    return {
      messages,
      total,
      contentHash: chat.contentHash,
      nextOffset: index < total ? index : null,
    }
  }

  async search(id: string, query: string, offset = 0) {
    if (!query.trim() || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0)
      throw new Error('搜索参数无效')
    const chat = await this.getChat(id)
    const results: Array<{ floor: number; text: string }> = []
    let index = 0
    for await (const message of readChatMessages(chat.originalBlob, String(chat.metadata.format))) {
      const floor = index++
      if (floor < offset) continue
      const at = message.mes.indexOf(query)
      if (at >= 0)
        results.push({
          floor,
          text: message.mes.slice(Math.max(0, at - 25), at + query.length + 65),
        })
      if (results.length === 100) break
    }
    return { results, nextOffset: index < Number(chat.metadata.messageCount) ? index : null }
  }

  async chapters(id: string, offset = 0, limit = 50) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new Error('章节分页参数无效')
    const chat = await this.getChat(id)
    const items = []
    let index = 0
    for await (const message of readChatMessages(chat.originalBlob, String(chat.metadata.format))) {
      const floor = index++
      if (floor < offset) continue
      // Excerpts are a bounded plain-text projection, never executed or treated as chapter titles from AI.
      const excerpt = message.mes
        .slice(0, 64 * 1024)
        .replace(/```[\s\S]*?(?:```|$)/g, ' ')
        .replace(
          /<(script|style|thinking|think|details|status_top|status_bottom)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
          ' ',
        )
        .replace(/<[^>]*>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100)
      items.push({
        floor,
        name: message.name,
        isUser: message.is_user,
        text: excerpt || '状态栏或开场内容',
        replies: Array.isArray(message.swipes) ? message.swipes.length : 1,
      })
      if (items.length >= limit) break
    }
    const total = Number(chat.metadata.messageCount)
    return { items, total, nextOffset: index < total ? index : null, contentHash: chat.contentHash }
  }

  async variableReview(id: string, floor: number, replyOverrides: Record<string, unknown> = {}) {
    if (!Number.isSafeInteger(floor) || floor < 0) throw new Error('变量回顾楼层无效')
    const chat = await this.getChat(id)
    const total = Number(chat.metadata.messageCount)
    if (floor >= total) throw new Error('指定楼层不存在')
    const { selectChatReply, savedChatVariables } = await import('./ChatReaderRendering')
    const { compareChatVariables } = await import('./ChatVariableReview')
    let previous: { floor: number; replyId: number; data: Record<string, unknown> } | undefined
    let index = 0
    for await (const message of readChatMessages(chat.originalBlob, String(chat.metadata.format))) {
      const entry = selectChatReply({ index, depth: 0, message }, replyOverrides[String(index)])
      const data = savedChatVariables(entry)
      const replyId = Number.isSafeInteger(entry.message.swipe_id)
        ? Number(entry.message.swipe_id)
        : 0
      if (index === floor) {
        const comparison = data && previous ? compareChatVariables(previous.data, data) : null
        return {
          floor,
          replyId,
          total,
          contentHash: chat.contentHash,
          status: !data
            ? 'missing'
            : !previous
              ? 'initial'
              : comparison?.incompatible
                ? 'incompatible'
                : 'compared',
          baseline: previous ? { floor: previous.floor, replyId: previous.replyId } : null,
          missingFloors: previous ? floor - previous.floor - 1 : floor,
          kind: comparison?.kind,
          changes: comparison?.changes || [],
          truncated: comparison?.truncated || false,
        }
      }
      if (data) previous = { floor: index, replyId, data }
      index++
    }
    throw new Error('指定楼层不存在')
  }

  async bind(id: string, characterId: string): Promise<void> {
    const chat = await this.getChat(id)
    const character = await this.resources.get(characterId)
    if (!character || character.type !== RESOURCE_TYPE.CHARACTER_CARD)
      throw new Error('请选择有效的角色卡')
    const summaries = await this.resources.listResourceListSummaries()
    const characterIds = new Set(
      summaries.filter((r) => r.type === RESOURCE_TYPE.CHARACTER_CARD).map((r) => r.id),
    )
    await this.resources.updateDetails(chat, {
      name: chat.name,
      description: chat.description,
      type: chat.type,
      categoryIds: chat.categoryIds ?? (chat.categoryId ? [chat.categoryId] : []),
      relatedResourceIds: [
        ...getRelatedResourceIds(chat).filter((id) => !characterIds.has(id)),
        characterId,
      ],
      tags: chat.tags,
      sourceLinks: chat.sourceLinks,
    })
  }
}
