import type { DiscordAttachmentMeta } from '../types/CommunitySource'

export type DiscordTextToken =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string; discordMessage: boolean }

export type DiscordMarkdownMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'spoiler'

export interface DiscordMarkdownToken {
  text: string
  marks: DiscordMarkdownMark[]
  href?: string
  discordMessage?: boolean
}

export type DiscordMarkdownBlock =
  | {
      type: 'line'
      kind: 'paragraph' | 'heading' | 'quote' | 'list-item' | 'blank'
      tokens: DiscordMarkdownToken[]
      level?: number
      marker?: string
    }
  | { type: 'code-block'; code: string; language?: string }

export interface DiscordEmbedFieldPresentation {
  name: string
  value: string
  inline: boolean
}

export interface DiscordEmbedPresentation {
  authorName?: string
  title?: string
  description?: string
  url?: string
  fields: DiscordEmbedFieldPresentation[]
  footerText?: string
  imageUrl?: string
  thumbnailUrl?: string
}

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'，。！？；：、（）【】《》「」『』]+/giu
const DISCORD_MESSAGE_URL_PATTERN =
  /^https?:\/\/(?:www\.)?(?:discord\.com|discordapp\.com)\/channels\/[^/\s]+\/[^/\s]+\/[^/?#\s]+/iu
const TRAILING_PUNCTUATION = /[),.!?;:，。！？；：】》」』]$/u
const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/iu
const INLINE_MARKERS: ReadonlyArray<{
  delimiter: string
  mark: DiscordMarkdownMark
}> = [
  { delimiter: '**', mark: 'bold' },
  { delimiter: '__', mark: 'underline' },
  { delimiter: '~~', mark: 'strike' },
  { delimiter: '||', mark: 'spoiler' },
  { delimiter: '*', mark: 'italic' },
  { delimiter: '_', mark: 'italic' },
]

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function safeHttpUrl(value: unknown): string | undefined {
  const text = asString(value)
  if (!text) return undefined
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : undefined
  } catch {
    return undefined
  }
}

function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  let url = raw
  let trailing = ''
  while (url && TRAILING_PUNCTUATION.test(url)) {
    trailing = `${url.slice(-1)}${trailing}`
    url = url.slice(0, -1)
  }
  return { url, trailing }
}

function appendMarkdownToken(tokens: DiscordMarkdownToken[], token: DiscordMarkdownToken): void {
  if (!token.text) return
  const previous = tokens.at(-1)
  if (
    previous &&
    previous.href === token.href &&
    previous.discordMessage === token.discordMessage &&
    previous.marks.join('|') === token.marks.join('|')
  ) {
    previous.text += token.text
    return
  }
  tokens.push(token)
}

function applyLink(
  tokens: DiscordMarkdownToken[],
  href: string,
  discordMessage: boolean,
): DiscordMarkdownToken[] {
  return tokens.map((token) => ({ ...token, href, discordMessage }))
}

function tokenizeDiscordMarkdownInline(
  content: string,
  marks: DiscordMarkdownMark[] = [],
  depth = 0,
): DiscordMarkdownToken[] {
  if (!content || depth > 8) return content ? [{ text: content, marks }] : []
  const tokens: DiscordMarkdownToken[] = []
  let cursor = 0

  while (cursor < content.length) {
    if (content[cursor] === '\\' && cursor + 1 < content.length) {
      appendMarkdownToken(tokens, { text: content[cursor + 1] ?? '', marks: [...marks] })
      cursor += 2
      continue
    }

    if (content[cursor] === '`') {
      const closing = content.indexOf('`', cursor + 1)
      if (closing > cursor + 1) {
        appendMarkdownToken(tokens, {
          text: content.slice(cursor + 1, closing),
          marks: [...marks, 'code'],
        })
        cursor = closing + 1
        continue
      }
    }

    if (content[cursor] === '[') {
      const labelEnd = content.indexOf('](', cursor + 1)
      const hrefEnd = labelEnd >= 0 ? content.indexOf(')', labelEnd + 2) : -1
      if (labelEnd > cursor + 1 && hrefEnd > labelEnd + 2) {
        const href = safeHttpUrl(content.slice(labelEnd + 2, hrefEnd))
        if (href) {
          const label = content.slice(cursor + 1, labelEnd)
          const discordMessage = DISCORD_MESSAGE_URL_PATTERN.test(href)
          const linked = applyLink(
            tokenizeDiscordMarkdownInline(label, [...marks], depth + 1),
            href,
            discordMessage,
          )
          for (const token of linked) appendMarkdownToken(tokens, token)
          cursor = hrefEnd + 1
          continue
        }
      }
    }

    let matchedMarker = false
    for (const { delimiter, mark } of INLINE_MARKERS) {
      if (!content.startsWith(delimiter, cursor)) continue
      const closing = content.indexOf(delimiter, cursor + delimiter.length)
      if (closing <= cursor + delimiter.length) continue
      const inner = content.slice(cursor + delimiter.length, closing)
      if (!inner.trim()) continue
      const nested = tokenizeDiscordMarkdownInline(inner, [...marks, mark], depth + 1)
      for (const token of nested) appendMarkdownToken(tokens, token)
      cursor = closing + delimiter.length
      matchedMarker = true
      break
    }
    if (matchedMarker) continue

    const rawUrl = content
      .slice(cursor)
      .match(/^https?:\/\/[^\s<>"'，。！？；：、（）【】《》「」『』]+/iu)?.[0]
    if (rawUrl) {
      const { url, trailing } = splitTrailingPunctuation(rawUrl)
      const href = safeHttpUrl(url)
      if (href) {
        const discordMessage = DISCORD_MESSAGE_URL_PATTERN.test(href)
        appendMarkdownToken(tokens, {
          text: discordMessage ? '在 Discord 中查看这条消息' : url,
          marks: [...marks],
          href,
          discordMessage,
        })
        if (trailing) appendMarkdownToken(tokens, { text: trailing, marks: [...marks] })
        cursor += rawUrl.length
        continue
      }
    }

    appendMarkdownToken(tokens, { text: content[cursor] ?? '', marks: [...marks] })
    cursor += 1
  }

  return tokens
}

export function parseDiscordMarkdown(content: string): DiscordMarkdownBlock[] {
  const lines = content.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: DiscordMarkdownBlock[] = []
  let multilineQuote = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const fence = line.match(/^\s*```([^`]*)$/u)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({
        type: 'code-block',
        code: code.join('\n'),
        ...(fence[1]?.trim() ? { language: fence[1].trim().slice(0, 32) } : {}),
      })
      continue
    }

    if (!line) {
      blocks.push({ type: 'line', kind: multilineQuote ? 'quote' : 'blank', tokens: [] })
      continue
    }

    const multilineQuoteStart = line.match(/^\s*>>>\s?(.*)$/u)
    if (multilineQuoteStart) {
      multilineQuote = true
      blocks.push({
        type: 'line',
        kind: 'quote',
        tokens: tokenizeDiscordMarkdownInline(multilineQuoteStart[1] ?? ''),
      })
      continue
    }
    if (multilineQuote) {
      blocks.push({
        type: 'line',
        kind: 'quote',
        tokens: tokenizeDiscordMarkdownInline(line),
      })
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/u)
    if (heading) {
      blocks.push({
        type: 'line',
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        tokens: tokenizeDiscordMarkdownInline(heading[2] ?? ''),
      })
      continue
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/u)
    if (quote) {
      blocks.push({
        type: 'line',
        kind: 'quote',
        tokens: tokenizeDiscordMarkdownInline(quote[1] ?? ''),
      })
      continue
    }

    const listItem = line.match(/^\s{0,3}((?:[-+*])|(?:\d+[.)]))\s+(.+)$/u)
    if (listItem) {
      blocks.push({
        type: 'line',
        kind: 'list-item',
        marker: listItem[1] ?? '•',
        tokens: tokenizeDiscordMarkdownInline(listItem[2] ?? ''),
      })
      continue
    }

    blocks.push({
      type: 'line',
      kind: 'paragraph',
      tokens: tokenizeDiscordMarkdownInline(line),
    })
  }

  return blocks
}

export function tokenizeDiscordText(content: string): DiscordTextToken[] {
  const tokens: DiscordTextToken[] = []
  let cursor = 0
  for (const match of content.matchAll(HTTP_URL_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) tokens.push({ type: 'text', text: content.slice(cursor, index) })
    const raw = match[0]
    const { url, trailing } = splitTrailingPunctuation(raw)
    const href = safeHttpUrl(url)
    if (href) {
      const discordMessage = DISCORD_MESSAGE_URL_PATTERN.test(href)
      tokens.push({
        type: 'link',
        text: discordMessage ? '在 Discord 中查看这条消息' : url,
        href,
        discordMessage,
      })
      if (trailing) tokens.push({ type: 'text', text: trailing })
    } else {
      tokens.push({ type: 'text', text: raw })
    }
    cursor = index + raw.length
  }
  if (cursor < content.length) tokens.push({ type: 'text', text: content.slice(cursor) })
  return tokens.length ? tokens : [{ type: 'text', text: content }]
}

export function presentDiscordEmbed(value: Record<string, unknown>): DiscordEmbedPresentation {
  const author = asRecord(value.author)
  const footer = asRecord(value.footer)
  const image = asRecord(value.image)
  const thumbnail = asRecord(value.thumbnail)
  const fields = Array.isArray(value.fields)
    ? value.fields.flatMap((entry) => {
        const field = asRecord(entry)
        const name = asString(field?.name)
        const fieldValue = asString(field?.value)
        return name && fieldValue
          ? [{ name, value: fieldValue, inline: field?.inline === true }]
          : []
      })
    : []
  return {
    authorName: asString(author?.name),
    title: asString(value.title),
    description: asString(value.description),
    url: safeHttpUrl(value.url),
    fields,
    footerText: asString(footer?.text),
    imageUrl: safeHttpUrl(image?.url),
    thumbnailUrl: safeHttpUrl(thumbnail?.url),
  }
}

export function isImageAttachment(attachment: DiscordAttachmentMeta): boolean {
  return Boolean(
    attachment.contentType?.toLowerCase().startsWith('image/') ||
    IMAGE_EXTENSION.test(attachment.name),
  )
}

export function previewDiscordMessage(input: {
  content: string
  embeds: Record<string, unknown>[]
}): string {
  const content = input.content.replace(/\s+/gu, ' ').trim()
  const embed = input.embeds.map(presentDiscordEmbed).find((item) => item.title || item.description)
  const fallback = [embed?.title, embed?.description].filter(Boolean).join(' · ')
  const value = content || fallback || '这条消息没有纯文本正文；已保存 Embed 或附件。'
  return value.length > 240 ? `${value.slice(0, 240)}…` : value
}
