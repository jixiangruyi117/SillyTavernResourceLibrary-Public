import type { ParsedResource } from '../types/Import'
import { RESOURCE_TYPE } from '../types/Resource'
import { isRecord } from '../utils/UnknownValue'
import type { ResourceParser } from './ResourceParser'

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const PNG_CHUNK_HEADER_SIZE = 8
const PNG_CHUNK_CRC_SIZE = 4
const MAX_TEXT_CHUNK_SIZE = 32 * 1024 * 1024
const CHARACTER_CHUNK_V2 = 'chara'
const CHARACTER_CHUNK_V3 = 'ccv3'

interface PngTextChunk {
  keyword: string
  text: string
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readCardField(card: Record<string, unknown>, field: string): unknown {
  const data = isRecord(card.data) ? card.data : undefined
  return data?.[field] ?? card[field]
}

function readTags(card: Record<string, unknown>): string[] {
  const tags = readCardField(card, 'tags')
  if (!Array.isArray(tags)) return []

  return Array.from(
    new Set(
      tags
        .filter((tag): tag is string => typeof tag === 'string')
        .flatMap((tag) => tag.split(/[,，\n]/))
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  )
}

function readChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  )
}

function readTextChunk(data: Uint8Array): PngTextChunk | undefined {
  const separatorIndex = data.indexOf(0)
  if (separatorIndex <= 0) return undefined

  return {
    keyword: new TextDecoder('latin1').decode(data.subarray(0, separatorIndex)),
    text: new TextDecoder('latin1').decode(data.subarray(separatorIndex + 1)),
  }
}

async function extractCharacterChunk(file: File): Promise<PngTextChunk | undefined> {
  let legacy: PngTextChunk | undefined
  let modern: PngTextChunk | undefined
  let offset = PNG_SIGNATURE.length
  let foundEnd = false

  while (offset < file.size) {
    if (offset + PNG_CHUNK_HEADER_SIZE + PNG_CHUNK_CRC_SIZE > file.size) {
      throw new Error('PNG 数据块不完整')
    }

    const header = new Uint8Array(
      await file.slice(offset, offset + PNG_CHUNK_HEADER_SIZE).arrayBuffer(),
    )
    const length = new DataView(header.buffer).getUint32(0)
    const type = readChunkType(header, 4)
    const dataStart = offset + PNG_CHUNK_HEADER_SIZE
    const chunkEnd = dataStart + length + PNG_CHUNK_CRC_SIZE

    if (chunkEnd > file.size) {
      throw new Error('PNG 数据块长度无效')
    }

    if (type === 'tEXt') {
      if (length > MAX_TEXT_CHUNK_SIZE) {
        throw new Error('角色卡元数据超过 32 MB 限制')
      }

      // PNG keywords are at most 79 bytes. Skip unrelated text without retaining its payload.
      const prefix = new Uint8Array(
        await file.slice(dataStart, dataStart + Math.min(length, 80)).arrayBuffer(),
      )
      const separator = prefix.indexOf(0)
      const keyword =
        separator > 0
          ? new TextDecoder('latin1').decode(prefix.subarray(0, separator)).toLowerCase()
          : ''
      if (
        (!modern && keyword === CHARACTER_CHUNK_V3) ||
        (!legacy && keyword === CHARACTER_CHUNK_V2)
      ) {
        const chunk = readTextChunk(
          new Uint8Array(await file.slice(dataStart, dataStart + length).arrayBuffer()),
        )
        if (keyword === CHARACTER_CHUNK_V3) modern = chunk
        else legacy = chunk
      }
    }

    offset = chunkEnd
    if (type === 'IEND') {
      foundEnd = true
      break
    }
  }

  if (!foundEnd) {
    throw new Error('PNG 缺少结束数据块')
  }

  return modern ?? legacy
}

function decodeCardData(encoded: string): Record<string, unknown> {
  let binary: string

  try {
    binary = atob(encoded.replace(/\s/g, ''))
  } catch {
    throw new Error('角色卡元数据不是有效 Base64')
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  let json: string

  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('角色卡元数据不是有效 UTF-8')
  }

  let card: unknown
  try {
    card = JSON.parse(json)
  } catch {
    throw new Error('角色卡元数据不是有效 JSON')
  }

  if (!isRecord(card)) {
    throw new Error('角色卡元数据顶层必须是对象')
  }

  return card
}

export class PngResourceParser implements ResourceParser {
  supports(file: File): boolean {
    return file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
  }

  async parse(file: File): Promise<ParsedResource> {
    const bytes = new Uint8Array(await file.slice(0, PNG_SIGNATURE.length).arrayBuffer())
    const isPng = PNG_SIGNATURE.every((value, index) => bytes[index] === value)

    if (!isPng) {
      throw new Error('文件扩展名为 PNG，但内容不是有效 PNG')
    }

    const characterChunk = await extractCharacterChunk(file)

    if (!characterChunk) {
      throw new Error('PNG 中未找到 SillyTavern 角色卡元数据')
    }

    const card = decodeCardData(characterChunk.text)
    const fallbackName = file.name.replace(/\.png$/i, '')
    const name = readString(readCardField(card, 'name')).trim() || fallbackName
    const description = readString(readCardField(card, 'description'))
    const tags = readTags(card)
    const spec = readString(card.spec) || 'tavern_card_v1'
    const specVersion = readString(card.spec_version) || '1.0'

    return {
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name,
      description,
      tags,
      metadata: {
        format: 'png',
        parserVersion: 2,
        characterCardChunk: characterChunk.keyword.toLowerCase(),
        characterCardSpec: spec,
        characterCardSpecVersion: specVersion,
        creator: readString(readCardField(card, 'creator')),
        characterVersion: readString(readCardField(card, 'character_version')),
        card,
      },
    }
  }
}
