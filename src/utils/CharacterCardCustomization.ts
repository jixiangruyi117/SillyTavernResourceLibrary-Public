import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { isRecord } from './UnknownValue'
import { prepareUserPersonaAvatar } from './UserPersonaAvatar'
import { hashBlob } from '../services/HashService'
import { parseGreetingResource } from '../types/GreetingResource'
import { mergeGreetingScripts, type GreetingScriptChoice } from './GreetingScriptMerge'

export interface CharacterCardOverrides {
  regexEnabled?: Record<string, boolean>
  worldBookResourceId?: string
  greetingResourceId?: string
}

export interface CharacterReplacementContent {
  worldBook?: Record<string, unknown>
  greetings?: string[]
  companionScripts?: Record<string, unknown>[]
  scriptChoice?: GreetingScriptChoice
}

const PNG_SIGNATURE_LENGTH = 8
const PNG_CHUNK_OVERHEAD = 12

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeRegexEnabled(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, boolean] => Boolean(entry[0]) && typeof entry[1] === 'boolean',
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function readCharacterCardOverrides(
  metadata: Record<string, unknown>,
): CharacterCardOverrides {
  const value = isRecord(metadata.characterOverrides) ? metadata.characterOverrides : undefined
  if (!value) return {}
  const regexEnabled = normalizeRegexEnabled(value.regexEnabled)
  const worldBookResourceId =
    typeof value.worldBookResourceId === 'string' && value.worldBookResourceId
      ? value.worldBookResourceId
      : undefined
  const greetingResourceId =
    typeof value.greetingResourceId === 'string' && value.greetingResourceId
      ? value.greetingResourceId
      : undefined
  return {
    ...(regexEnabled ? { regexEnabled } : {}),
    ...(worldBookResourceId ? { worldBookResourceId } : {}),
    ...(greetingResourceId ? { greetingResourceId } : {}),
  }
}

export function normalizeCharacterCardOverrides(
  value: CharacterCardOverrides,
  relatedResourceIds?: Iterable<string>,
): CharacterCardOverrides {
  const allowedIds = relatedResourceIds ? new Set(relatedResourceIds) : undefined
  const regexEnabled = normalizeRegexEnabled(value.regexEnabled)
  const worldBookResourceId =
    value.worldBookResourceId && (!allowedIds || allowedIds.has(value.worldBookResourceId))
      ? value.worldBookResourceId
      : undefined
  const greetingResourceId =
    value.greetingResourceId && (!allowedIds || allowedIds.has(value.greetingResourceId))
      ? value.greetingResourceId
      : undefined
  return {
    ...(regexEnabled ? { regexEnabled } : {}),
    ...(worldBookResourceId ? { worldBookResourceId } : {}),
    ...(greetingResourceId ? { greetingResourceId } : {}),
  }
}

export function hasCharacterCardOverrides(value: CharacterCardOverrides): boolean {
  return Boolean(
    Object.keys(value.regexEnabled ?? {}).length ||
    value.worldBookResourceId ||
    value.greetingResourceId,
  )
}

export function characterRegexKey(script: Record<string, unknown>, index: number): string {
  const id = readString(script.id).trim()
  return id ? `id:${id}` : `index:${index}`
}

export async function inspectCharacterReplacementResource(
  resource: Resource,
): Promise<CharacterReplacementContent> {
  let root: unknown
  try {
    root = JSON.parse(await resource.originalBlob.text())
  } catch {
    root = resource.metadata.card
  }
  if (!isRecord(root)) return {}
  if (root.format === 'srl-greeting') {
    const greeting = parseGreetingResource(root)
    return {
      greetings: [greeting.first_mes, ...greeting.alternate_greetings],
      companionScripts: greeting.companion_scripts.map((script, index) => ({
        ...script,
        id:
          typeof script.id === 'string' && script.id.trim()
            ? script.id
            : `srl-greeting-${resource.id}-${index}`,
        enabled: false,
      })),
    }
  }

  const cardData = isRecord(root.data) ? root.data : root
  const worldBook = isRecord(cardData.character_book)
    ? cardData.character_book
    : isRecord(root.entries) || Array.isArray(root.entries)
      ? root
      : undefined

  const primary = readString(
    cardData.first_mes ?? cardData.firstMessage ?? cardData.opening_message,
  ).trim()
  const alternateSource = cardData.alternate_greetings ?? cardData.greetings
  const alternates = Array.isArray(alternateSource)
    ? alternateSource
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
  const quickReplies = Array.isArray(root.qrList)
    ? root.qrList
        .filter(isRecord)
        .map((item) => readString(item.message ?? item.content).trim())
        .filter(Boolean)
    : []
  const greetings =
    primary || alternates.length ? [primary, ...alternates].filter(Boolean) : quickReplies

  return {
    ...(worldBook ? { worldBook: cloneJson(worldBook) } : {}),
    ...(greetings.length ? { greetings } : {}),
  }
}

export function applyCharacterCardOverrides(
  sourceCard: Record<string, unknown>,
  overrides: CharacterCardOverrides,
  replacements: CharacterReplacementContent = {},
): Record<string, unknown> {
  const card = cloneJson(sourceCard)
  const data = isRecord(card.data) ? card.data : card
  const extensions = isRecord(data.extensions) ? data.extensions : undefined
  const scripts = Array.isArray(extensions?.regex_scripts) ? extensions.regex_scripts : undefined

  if (scripts && overrides.regexEnabled) {
    scripts.forEach((script, index) => {
      if (!isRecord(script)) return
      const enabled = overrides.regexEnabled?.[characterRegexKey(script, index)]
      if (typeof enabled !== 'boolean') return
      script.disabled = !enabled
      if ('enabled' in script) script.enabled = enabled
    })
  }

  if (overrides.worldBookResourceId && replacements.worldBook) {
    data.character_book = cloneJson(replacements.worldBook)
  }
  if (overrides.greetingResourceId && replacements.greetings?.length) {
    data.first_mes = replacements.greetings[0] ?? ''
    data.alternate_greetings = replacements.greetings.slice(1)
    mergeGreetingScripts(data, replacements.companionScripts ?? [], replacements.scriptChoice)
  }
  return card
}

function encodeBase64Utf8(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function replacePngCharacterChunk(
  source: Blob,
  keyword: string,
  card: Record<string, unknown>,
): Promise<Blob> {
  const chunks: BlobPart[] = [source.slice(0, PNG_SIGNATURE_LENGTH)]
  let offset = PNG_SIGNATURE_LENGTH
  let replaced = false

  while (offset + PNG_CHUNK_OVERHEAD <= source.size) {
    const header = new Uint8Array(await source.slice(offset, offset + 8).arrayBuffer())
    const length = new DataView(header.buffer).getUint32(0)
    const end = offset + PNG_CHUNK_OVERHEAD + length
    if (end > source.size) throw new Error('角色卡 PNG 数据块不完整')
    const type = new TextDecoder('latin1').decode(header.subarray(4, 8))
    // PNG text keywords are at most 79 bytes. Image pixels never enter a JS buffer.
    const data =
      type === 'tEXt'
        ? new Uint8Array(
            await source.slice(offset + 8, offset + 8 + Math.min(length, 80)).arrayBuffer(),
          )
        : new Uint8Array()
    const separator = type === 'tEXt' ? data.indexOf(0) : -1
    const chunkKeyword =
      separator > 0
        ? new TextDecoder('latin1').decode(data.subarray(0, separator)).toLocaleLowerCase()
        : ''

    const createCharacterChunk = (): Uint8Array<ArrayBuffer> => {
      const typeBytes = new TextEncoder().encode('tEXt')
      const dataBytes = new TextEncoder().encode(`${keyword}\0${encodeBase64Utf8(card)}`)
      const chunk = new Uint8Array(dataBytes.length + PNG_CHUNK_OVERHEAD)
      const chunkView = new DataView(chunk.buffer)
      chunkView.setUint32(0, dataBytes.length)
      chunk.set(typeBytes, 4)
      chunk.set(dataBytes, 8)
      chunkView.setUint32(8 + dataBytes.length, crc32(chunk.subarray(4, 8 + dataBytes.length)))
      return chunk
    }

    if (!replaced && type === 'tEXt' && chunkKeyword === keyword.toLocaleLowerCase()) {
      chunks.push(createCharacterChunk())
      replaced = true
    } else {
      if (!replaced && type === 'IEND') {
        chunks.push(createCharacterChunk())
        replaced = true
      }
      chunks.push(source.slice(offset, end))
    }
    offset = end
    if (type === 'IEND') break
  }

  if (!replaced) throw new Error('角色卡 PNG 中没有找到可修改的角色数据块')
  return new Blob(chunks, { type: 'image/png' })
}

/**
 * 用用户选择的图片生成新的酒馆角色卡 PNG。图片和来源角色卡都不会被改写；
 * 新文件写入当前卡的完整数据块，供同一逻辑版本作为另一份卡面封装保存。
 */
export async function createCharacterCardArtworkFile(
  resource: Resource,
  artwork: Blob,
): Promise<File> {
  if (resource.type !== RESOURCE_TYPE.CHARACTER_CARD) throw new Error('只有角色卡可以更换卡面')
  const card = isRecord(resource.metadata.card) ? resource.metadata.card : undefined
  if (!card) throw new Error(`“${resource.name}”缺少可写入新卡面的角色卡数据`)
  const baseName = resource.fileName.replace(/\.[^.]+$/u, '') || resource.name || 'character'
  let prepared: File
  try {
    prepared = await prepareUserPersonaAvatar(artwork, `${baseName}-自定义卡面-${Date.now()}.png`)
  } catch (error) {
    const message =
      error instanceof Error ? error.message.replaceAll('头像', '卡面') : '卡面图片无效'
    throw new Error(message, { cause: error })
  }
  const keyword =
    typeof resource.metadata.characterCardChunk === 'string'
      ? resource.metadata.characterCardChunk
      : 'chara'
  const bytes = await replacePngCharacterChunk(prepared, keyword, card)
  return new File([bytes], prepared.name, { type: 'image/png' })
}

async function sha256(blob: Blob): Promise<string> {
  return hashBlob(blob)
}

export async function createModifiedCharacterResource(
  resource: Resource,
  relatedResources: Resource[],
  scriptChoice?: GreetingScriptChoice,
): Promise<Resource> {
  if (resource.type !== RESOURCE_TYPE.CHARACTER_CARD) return resource
  const overrides = readCharacterCardOverrides(resource.metadata)
  if (!hasCharacterCardOverrides(overrides)) return resource
  const sourceCard = isRecord(resource.metadata.card) ? resource.metadata.card : undefined
  if (!sourceCard) throw new Error(`“${resource.name}”缺少可修改的角色卡数据`)

  const replacementContent: CharacterReplacementContent = {}
  if (overrides.worldBookResourceId) {
    const source = relatedResources.find((item) => item.id === overrides.worldBookResourceId)
    if (!source) throw new Error(`“${resource.name}”绑定的替换世界书已不存在`)
    replacementContent.worldBook = (await inspectCharacterReplacementResource(source)).worldBook
    if (!replacementContent.worldBook) throw new Error(`“${source.name}”不是可用的世界书资源`)
  }
  if (overrides.greetingResourceId) {
    const source = relatedResources.find((item) => item.id === overrides.greetingResourceId)
    if (!source) throw new Error(`“${resource.name}”绑定的替换开场白已不存在`)
    const greetingContent = await inspectCharacterReplacementResource(source)
    replacementContent.greetings = greetingContent.greetings
    replacementContent.companionScripts = greetingContent.companionScripts
    replacementContent.scriptChoice = scriptChoice
    if (!replacementContent.greetings?.length) throw new Error(`“${source.name}”没有可用的开场白`)
  }

  const modifiedCard = applyCharacterCardOverrides(sourceCard, overrides, replacementContent)
  const isPng = resource.mimeType === 'image/png' || /\.png$/i.test(resource.fileName)
  const modifiedPngBytes = isPng
    ? await replacePngCharacterChunk(
        resource.originalBlob,
        typeof resource.metadata.characterCardChunk === 'string'
          ? resource.metadata.characterCardChunk
          : 'chara',
        modifiedCard,
      )
    : undefined
  const outputBlob = modifiedPngBytes
    ? modifiedPngBytes
    : new Blob([JSON.stringify(modifiedCard, null, 2)], {
        type: resource.mimeType || 'application/json',
      })
  const metadata = cloneJson(resource.metadata)
  metadata.card = modifiedCard
  delete metadata.characterOverrides
  return {
    ...resource,
    metadata,
    originalBlob: outputBlob,
    fileSize: outputBlob.size,
    contentHash: await sha256(outputBlob),
  }
}
