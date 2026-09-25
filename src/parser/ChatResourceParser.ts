import type { ParsedResource } from '../types/Import'
import { RESOURCE_TYPE } from '../types/Resource'
import { isRecord } from '../utils/UnknownValue'
import type { ResourceParser } from './ResourceParser'

export interface ChatMessage extends Record<string, unknown> {
  name: string
  mes: string
  is_user: boolean
  is_system?: boolean | ''
}

export function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.mes === 'string' &&
    typeof value.is_user === 'boolean' &&
    // Saved ST chats can contain an empty flag; ST checks its truthiness during display.
    (value.is_system === undefined ||
      value.is_system === '' ||
      typeof value.is_system === 'boolean')
  )
}

function isHeader(value: unknown): boolean {
  return (
    isRecord(value) &&
    !('mes' in value) &&
    (isRecord(value.chat_metadata) ||
      typeof value.user_name === 'string' ||
      typeof value.character_name === 'string')
  )
}

/** Strict recognition: generic JSON arrays, OpenAI messages and character cards are not chats. */
export function jsonChatRecords(value: unknown): ChatMessage[] | undefined {
  const records = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.chat)
      ? value.chat
      : undefined
  if (!records?.length) return undefined
  const messages = isHeader(records[0]) ? records.slice(1) : records
  return messages.length && messages.every(isChatMessage) ? messages : undefined
}

const CHUNK_BYTES = 256 * 1024
const MAX_LINE_CHARS = 4 * 1024 * 1024

/** Read UTF-8 incrementally, preserving code points across byte chunk boundaries. No body cache. */
export async function* chatLines(blob: Blob): AsyncGenerator<{ text: string; line: number }> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = '',
    line = 0
  for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
    pending += decoder.decode(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer(), {
      stream: true,
    })
    let end: number
    while ((end = pending.indexOf('\n')) !== -1) {
      const text = pending.slice(0, end).replace(/\r$/, '')
      pending = pending.slice(end + 1)
      if (text.length > MAX_LINE_CHARS) throw new Error(`第 ${line + 1} 行超过 4 MiB 字符读取上限`)
      yield { text, line: ++line }
    }
    if (pending.length > MAX_LINE_CHARS) throw new Error(`第 ${line + 1} 行过长`)
  }
  pending += decoder.decode()
  if (pending) yield { text: pending, line: line + 1 }
}

export async function* readChatMessages(blob: Blob, format = 'jsonl'): AsyncGenerator<ChatMessage> {
  if (format === 'json') {
    if (blob.size > 20 * 1024 * 1024)
      throw new Error('JSON 数组聊天超过 20 MiB，请使用酒馆 JSONL 导出')
    const messages = jsonChatRecords(JSON.parse(await blob.text()))
    if (!messages) throw new Error('未识别到 SillyTavern 聊天消息')
    yield* messages
    return
  }
  let first = true
  for await (const { text, line } of chatLines(blob)) {
    const source = text.replace(/^\uFEFF/, '').trim()
    if (!source) continue
    let value: unknown
    try {
      value = JSON.parse(source)
    } catch {
      throw new Error(`聊天记录第 ${line} 行 JSON 格式无效`)
    }
    if (first && isHeader(value)) {
      first = false
      continue
    }
    first = false
    if (!isChatMessage(value))
      throw new Error(`聊天记录第 ${line} 行不是有效消息（需要 name、mes、is_user）`)
    yield value
  }
}

export async function summarizeChat(file: File, format: 'json' | 'jsonl'): Promise<ParsedResource> {
  let messageCount = 0,
    visibleMessageCount = 0
  const users = new Set<string>(),
    characters = new Set<string>()
  for await (const message of readChatMessages(file, format)) {
    messageCount++
    if (!message.is_system) visibleMessageCount++
    const names = message.is_user ? users : characters
    if (!message.is_system && message.name.trim() && names.size < 64)
      names.add(message.name.trim().slice(0, 160))
  }
  if (!messageCount) throw new Error('聊天记录中没有消息')
  return {
    type: RESOURCE_TYPE.CHAT,
    name: file.name.replace(/\.(jsonl|json)$/i, ''),
    description: `${messageCount} 楼 · 请在读了么中绑定角色卡`,
    metadata: {
      format,
      parserVersion: 1,
      detectedVariant: 'sillyTavernChat',
      itemCount: messageCount,
      messageCount,
      visibleMessageCount,
      chatUserNames: [...users],
      chatCharacterNames: [...characters],
    },
  }
}

export class ChatResourceParser implements ResourceParser {
  supports(file: File): boolean {
    return /\.jsonl$/i.test(file.name) || file.type === 'application/x-ndjson'
  }
  parse(file: File): Promise<ParsedResource> {
    return summarizeChat(file, 'jsonl')
  }
}
