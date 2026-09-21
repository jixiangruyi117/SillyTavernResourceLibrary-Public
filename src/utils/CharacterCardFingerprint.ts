import { isRecord } from './UnknownValue'
import { hashBytes } from '../services/HashService'

/**
 * 角色卡内容指纹。
 *
 * PNG 角色卡的数据块与导出的 JSON 承载同一份卡对象，只是封装不同。
 * 对卡数据做规范化（递归键排序）后取 SHA-256，可得到与封装无关的
 * 内容指纹，用于版本匹配与「同卡不同封装」查重：
 * - 完整指纹：整个卡对象一致 → 内容完全相同；
 * - 核心指纹：仅身份字段子集（名称、描述、性格、场景、开场白等）一致
 *   → 内容一致但导出工具附加了 create_date 等易变字段。
 * 指纹只写入资源 metadata，不修改卡数据本身。
 */

export interface CharacterCardFingerprints {
  full: string
  core: string
}

export const CHARACTER_CARD_FINGERPRINT_VERSION = 2

/** 参与核心指纹的身份字段（v2/v3 通用）。 */
const CORE_FIELDS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'alternate_greetings',
] as const

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

/** 从资源 metadata 提取卡对象并计算两级指纹；非角色卡返回 undefined。 */
export async function computeCardFingerprints(
  metadata: Record<string, unknown>,
): Promise<CharacterCardFingerprints | undefined> {
  const card = metadata.card
  if (!isRecord(card)) return undefined
  const data = readCardData(card)
  const core: Record<string, unknown> = {}
  for (const field of CORE_FIELDS) {
    if (data[field] !== undefined) core[field] = data[field]
  }
  const [full, coreHash] = await Promise.all([
    // v1 把卡字段放在根节点，v2/v3 使用 { spec, spec_version, data } 包装。
    // 版本语义只由实际卡数据决定；封装声明不能让同一内容产生不同完整指纹。
    sha256Hex(canonicalizeCardJson(data)),
    sha256Hex(canonicalizeCardJson(core)),
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
