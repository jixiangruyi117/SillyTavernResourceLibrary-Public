import { RESOURCE_TYPE, getRelatedResourceIds, type Resource } from '../types/Resource'
import { isRecord } from '../utils/UnknownValue'
import type { ResourceService } from './ResourceService'

/** Reading companions are chat metadata, never synthetic resources in the library. */
export function chatCharacterSummary(metadata: Record<string, unknown>) {
  const value = metadata.chatCharacter
  if (
    !isRecord(value) ||
    typeof value.hash !== 'string' ||
    !/^[a-f\d]{64}$/.test(value.hash) ||
    typeof value.name !== 'string'
  )
    return undefined
  return { id: `chat-character:${value.hash}`, name: value.name, hash: value.hash }
}

export async function resolveChatCharacter(
  chat: Resource,
  resources: Pick<ResourceService, 'get'>,
) {
  const cards: Resource[] = []
  for (const id of getRelatedResourceIds(chat)) {
    const resource = await resources.get(id)
    if (resource?.type === RESOURCE_TYPE.CHARACTER_CARD) cards.push(resource)
  }
  if (cards.length > 1) throw new Error('请先为此聊天明确绑定一张角色卡')
  const card = cards[0]
  if (card)
    return {
      id: card.id,
      name: card.name,
      contentHash: card.contentHash,
      fileName: card.fileName,
      card: isRecord(card.metadata.card) ? card.metadata.card : {},
    }
  const summary = chatCharacterSummary(chat.metadata)
  const companion = chat.metadata.chatCharacter
  if (!summary || !isRecord(companion) || !isRecord(companion.card))
    throw new Error('请先为此聊天明确绑定一张角色卡')
  return {
    id: summary.id,
    name: summary.name,
    contentHash: summary.hash,
    fileName: typeof companion.avatar === 'string' ? companion.avatar : '',
    card: companion.card,
  }
}

/** Only a bounded raster thumbnail is encoded; the full PNG/card is never embedded. */
export async function chatCharacterThumbnailData(
  blob: Blob | undefined,
): Promise<string | undefined> {
  if (!blob || blob.size > 128 * 1024 || !/^image\/(png|jpeg|webp)$/.test(blob.type))
    return undefined
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:${blob.type};base64,${btoa(binary)}`
}

export function chatCharacterThumbnail(metadata: Record<string, unknown>): Blob | undefined {
  const value = isRecord(metadata.chatCharacter) ? metadata.chatCharacter.thumbnail : undefined
  if (typeof value !== 'string' || value.length > 180_000) return undefined
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z\d+/=]+)$/.exec(value)
  if (!match) return undefined
  try {
    return new Blob([Uint8Array.from(atob(match[2]!), (char) => char.charCodeAt(0))], {
      type: match[1],
    })
  } catch {
    return undefined
  }
}
