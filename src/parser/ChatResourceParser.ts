import type { ParsedResource } from '../types/Import'
import { RESOURCE_TYPE } from '../types/Resource'
import { isRecord } from '../utils/UnknownValue'
import type { ResourceParser } from './ResourceParser'
import type { ResourceByteSource } from '../types/ResourceReadSource'

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

export async function readJsonChatDocument(blob: ResourceByteSource): Promise<{
  header?: Record<string, unknown>
  messages: ChatMessage[]
}> {
  if (blob.size > 20 * 1024 * 1024)
    throw new Error('JSON 数组聊天超过 20 MiB，请使用酒馆 JSONL 导出')
  const value: unknown = JSON.parse(await blob.text())
  const messages = jsonChatRecords(value)
  if (!messages) throw new Error('未识别到 SillyTavern 聊天消息')
  const records = Array.isArray(value) ? value : isRecord(value) ? value.chat : undefined
  const first = Array.isArray(records) ? records[0] : undefined
  const header =
    isRecord(first) && isHeader(first)
      ? first
      : isRecord(value) && isHeader(value)
        ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'chat'))
        : undefined
  return { header, messages }
}

const CHUNK_BYTES = 256 * 1024
const MAX_LINE_CHARS = 4 * 1024 * 1024

export interface ChatLinePosition {
  byteOffset: number
  line: number
}

/** Read UTF-8 incrementally, preserving code points across byte chunk boundaries. No body cache. */
export async function* chatLines(
  blob: ResourceByteSource,
  start: ChatLinePosition = { byteOffset: 0, line: 1 },
): AsyncGenerator<ChatLinePosition & { text: string }> {
  // Keep BOM bytes visible to the parser so offsets always address the original file.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let pending = '',
    line = start.line - 1,
    byteOffset = start.byteOffset
  for (let offset = start.byteOffset; offset < blob.size; offset += CHUNK_BYTES) {
    const chunk = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer())
    pending += decoder.decode(chunk, { stream: true })
    let byteCursor = 0
    let end: number
    while ((end = pending.indexOf('\n')) !== -1) {
      const text = pending.slice(0, end).replace(/\r$/, '')
      pending = pending.slice(end + 1)
      if (text.length > MAX_LINE_CHARS) throw new Error(`第 ${line + 1} 行超过 4 MiB 字符读取上限`)
      const nextOffset = offset + chunk.indexOf(10, byteCursor) + 1
      byteCursor = nextOffset - offset
      const position = { byteOffset, line: ++line }
      byteOffset = nextOffset
      yield { text, ...position }
    }
    if (pending.length > MAX_LINE_CHARS) throw new Error(`第 ${line + 1} 行过长`)
  }
  pending += decoder.decode()
  if (pending) yield { text: pending, line: line + 1, byteOffset }
}

/** The same strict parser can resume at a previously validated JSONL message boundary. */
export async function* readChatMessageEntries(
  blob: ResourceByteSource,
  format = 'jsonl',
  start: ChatLinePosition = { byteOffset: 0, line: 1 },
): AsyncGenerator<{ message: ChatMessage; position?: ChatLinePosition; chars: number }> {
  if (format === 'json') {
    const { messages } = await readJsonChatDocument(blob)
    for (const message of messages) yield { message, chars: 0 }
    return
  }
  let first = start.byteOffset === 0
  for await (const { text, line, byteOffset } of chatLines(blob, start)) {
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
    yield { message: value, position: { line, byteOffset }, chars: text.length }
  }
}

export async function* readChatMessages(
  blob: ResourceByteSource,
  format = 'jsonl',
): AsyncGenerator<ChatMessage> {
  for await (const { message } of readChatMessageEntries(blob, format)) yield message
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
    description: `${messageCount} 楼 · 在读了么中阅读`,
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
