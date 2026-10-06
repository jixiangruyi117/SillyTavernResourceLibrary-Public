import { isRecord } from './UnknownValue'
import { hashBytes } from '../services/HashService'

/**
 * 角色卡内容指纹。
 *
 * PNG 角色卡的数据块与导出的 JSON 承载同一份卡对象，只是封装不同。
 * 对卡数据做规范化（递归键排序）后取 SHA-256，作为候选索引与快速去重依据：
 * - 完整指纹：整个卡对象一致 → 内容完全相同；
 * - 核心指纹：名称、描述、性格、场景、示例对话一致 → 同一设定的版本候选；
 *   开场白变化仍由完整指纹区分，不会被当作重复内容。
 * 版本识别最终直接比较规范化后的卡数据，不把哈希相等当作语义结论。
 * 指纹只写入资源 metadata，不修改卡数据本身。
 */

export interface CharacterCardFingerprints {
  full: string
  core: string
}

export const CHARACTER_CARD_FINGERPRINT_VERSION = 4

/** 参与核心指纹的身份字段（v2/v3 通用）。 */
const CORE_FIELDS = ['name', 'description', 'personality', 'scenario', 'mes_example'] as const

/** 递归键排序的规范化 JSON：键顺序差异不影响指纹。 */
export function canonicalizeCardJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeCardJson(item)).join(',')}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalizeCardJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256Hex(text: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(text))
}

function readCardData(card: Record<string, unknown>): Record<string, unknown> {
  const data = card.data
  return isRecord(data) ? data : card
}

function normalizeCardWorldBook(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data }
  const book = isRecord(normalized.character_book) ? { ...normalized.character_book } : undefined
  if (!book) return normalized

  const entries = book.entries
  const normalizedEntries = Array.isArray(entries)
    ? entries.filter(isRecord)
    : isRecord(entries)
      ? Object.values(entries).filter(isRecord)
      : []
  const semanticEntries = normalizedEntries.map((entry) => {
    const value = { ...entry }
    delete value.uid
    delete value.id
    delete value.__recordKey
    return value
  })
  semanticEntries.sort((left, right) => {
    const leftJson = canonicalizeCardJson(left)
    const rightJson = canonicalizeCardJson(right)
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0
  })

  if (semanticEntries.length) book.entries = semanticEntries
  else delete book.entries
  if (Object.keys(book).length) normalized.character_book = book
  else delete normalized.character_book
  return normalized
}

function readCoreData(data: Record<string, unknown>): Record<string, unknown> {
  const core: Record<string, unknown> = {}
  for (const field of CORE_FIELDS) {
    if (data[field] !== undefined) core[field] = data[field]
  }
  if (
    !CORE_FIELDS.some(
      (field) => field !== 'name' && typeof data[field] === 'string' && data[field].trim(),
    )
  ) {
    for (const field of ['first_mes', 'alternate_greetings']) {
      if (data[field] !== undefined) core[field] = data[field]
    }
  }
  return core
}

export function canonicalizeCharacterCardContent(
  metadata: Record<string, unknown>,
): string | undefined {
  const card = metadata.card
  if (!isRecord(card)) return undefined
  return canonicalizeCardJson(normalizeCardWorldBook(readCardData(card)))
}

export function canonicalizeCharacterCardCore(
  metadata: Record<string, unknown>,
): string | undefined {
  const card = metadata.card
  if (!isRecord(card)) return undefined
  return canonicalizeCardJson(readCoreData(readCardData(card)))
}

/** 从资源 metadata 提取卡对象并计算两级指纹；非角色卡返回 undefined。 */
export async function computeCardFingerprints(
  metadata: Record<string, unknown>,
): Promise<CharacterCardFingerprints | undefined> {
  const card = metadata.card
  if (!isRecord(card)) return undefined
  const fullContent = canonicalizeCharacterCardContent(metadata)!
  const coreContent = canonicalizeCharacterCardCore(metadata)!
  const [full, coreHash] = await Promise.all([
    // v1 把卡字段放在根节点，v2/v3 使用 { spec, spec_version, data } 包装。
    // 版本语义只由实际卡数据决定；封装声明不能让同一内容产生不同完整指纹。
    sha256Hex(fullContent),
    sha256Hex(coreContent),
  ])
  return { full, core: coreHash }
}

export function readStoredFingerprints(
  metadata: Record<string, unknown>,
): Partial<CharacterCardFingerprints> {
  return {
    full: typeof metadata.cardContentHash === 'string' ? metadata.cardContentHash : undefined,
    core: typeof metadata.cardCoreHash === 'string' ? metadata.cardCoreHash : undefined,
  }
}
