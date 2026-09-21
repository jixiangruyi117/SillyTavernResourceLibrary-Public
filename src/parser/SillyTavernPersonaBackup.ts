import {
  USER_PERSONA_POSITIONS,
  USER_PERSONA_ROLES,
  type SillyTavernPersonaBackup,
  type UserPersonaBackupView,
  type UserPersonaConnection,
  type UserPersonaDescriptor,
  type UserPersonaDraft,
  type UserPersonaEntry,
} from '../types/UserPersona'
import { isRecord } from '../utils/UnknownValue'

const DEFAULT_DEPTH = 2
const DEFAULT_ROLE = USER_PERSONA_ROLES.SYSTEM

function isObjectLike(value: unknown): value is Record<string, unknown> {
  // SillyTavern 1.18.0 的恢复入口只检查 typeof === 'object'，数组也会被接受。
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readConnections(value: unknown): {
  connections: UserPersonaConnection[]
  invalidCount: number
} {
  if (!Array.isArray(value)) return { connections: [], invalidCount: value === undefined ? 0 : 1 }
  const connections: UserPersonaConnection[] = []
  let invalidCount = 0
  for (const item of value) {
    if (
      isRecord(item) &&
      (item.type === 'character' || item.type === 'group') &&
      typeof item.id === 'string' &&
      item.id.trim()
    ) {
      connections.push({ type: item.type, id: item.id })
    } else {
      invalidCount += 1
    }
  }
  return { connections, invalidCount }
}

export function isSillyTavernPersonaBackup(value: unknown): value is SillyTavernPersonaBackup {
  return isRecord(value) && isObjectLike(value.personas) && isObjectLike(value.persona_descriptions)
}

export function parseSillyTavernPersonaBackup(value: unknown): UserPersonaBackupView {
  if (!isSillyTavernPersonaBackup(value)) {
    throw new Error('不是 SillyTavern 用户人设备份：缺少 personas 或 persona_descriptions')
  }

  const entries: UserPersonaEntry[] = []
  const warnings: string[] = []
  for (const [avatarId, rawName] of Object.entries(value.personas)) {
    const rawDescriptor = value.persona_descriptions[avatarId]
    const descriptor = isRecord(rawDescriptor) ? (rawDescriptor as UserPersonaDescriptor) : {}
    const { connections, invalidCount } = readConnections(descriptor.connections)
    const name = readString(rawName)
    if (!name) warnings.push(`人设 ${avatarId} 的名称不是有效字符串`)
    if (!isRecord(rawDescriptor)) warnings.push(`人设 ${avatarId} 缺少有效描述对象`)
    if (invalidCount) warnings.push(`人设 ${avatarId} 有 ${invalidCount} 条无法识别的连接`)

    entries.push({
      avatarId,
      name,
      title: readString(descriptor.title),
      description: readString(descriptor.description),
      position: readNumber(descriptor.position, USER_PERSONA_POSITIONS.IN_PROMPT),
      depth: readNumber(descriptor.depth, DEFAULT_DEPTH),
      role: readNumber(descriptor.role, DEFAULT_ROLE),
      lorebook: readString(descriptor.lorebook),
      connections,
      invalidConnectionCount: invalidCount,
      descriptorExists: isRecord(rawDescriptor),
    })
  }

  const defaultPersona = readString(value.default_persona)
  if (defaultPersona && !Object.prototype.hasOwnProperty.call(value.personas, defaultPersona)) {
    warnings.push(`默认人设 ${defaultPersona} 不存在，酒馆恢复时会跳过该默认设置`)
  }

  return { raw: value, entries, defaultPersona, warnings }
}

export function createEmptyPersonaBackup(draft: UserPersonaDraft): SillyTavernPersonaBackup {
  const avatarId = draft.avatarId.trim()
  if (!avatarId) throw new Error('头像文件名不能为空')
  return {
    personas: { [avatarId]: draft.name.trim() },
    persona_descriptions: {
      [avatarId]: {
        description: draft.description,
        position: draft.position,
        depth: draft.depth,
        role: draft.role,
        lorebook: draft.lorebook,
        connections: draft.connections,
        title: draft.title.trim(),
      },
    },
    default_persona: avatarId,
  }
}

export function updatePersonaInBackup(
  backup: SillyTavernPersonaBackup,
  originalAvatarId: string,
  draft: UserPersonaDraft,
): SillyTavernPersonaBackup {
  const avatarId = draft.avatarId.trim()
  const name = draft.name.trim()
  if (!avatarId) throw new Error('头像文件名不能为空')
  if (!name) throw new Error('人设名称不能为空')
  if (
    avatarId !== originalAvatarId &&
    Object.prototype.hasOwnProperty.call(backup.personas, avatarId)
  ) {
    throw new Error(`头像文件名 ${avatarId} 已被另一个人设使用`)
  }

  const personas = { ...backup.personas }
  const descriptions = { ...backup.persona_descriptions }
  const previous = isRecord(descriptions[originalAvatarId]) ? descriptions[originalAvatarId] : {}
  delete personas[originalAvatarId]
  delete descriptions[originalAvatarId]
  personas[avatarId] = name
  descriptions[avatarId] = {
    ...previous,
    description: draft.description,
    position: draft.position,
    depth: draft.depth,
    role: draft.role,
    lorebook: draft.lorebook,
    connections: draft.connections.map((item) => ({ ...item })),
    title: draft.title.trim(),
  }

  return {
    ...backup,
    personas,
    persona_descriptions: descriptions,
    default_persona:
      backup.default_persona === originalAvatarId ? avatarId : backup.default_persona,
  }
}

export function addPersonaToBackup(
  backup: SillyTavernPersonaBackup,
  draft: UserPersonaDraft,
): SillyTavernPersonaBackup {
  const avatarId = draft.avatarId.trim()
  if (Object.prototype.hasOwnProperty.call(backup.personas, avatarId)) {
    throw new Error(`头像文件名 ${avatarId} 已存在`)
  }
  const single = createEmptyPersonaBackup(draft)
  return {
    ...backup,
    personas: { ...backup.personas, ...single.personas },
    persona_descriptions: {
      ...backup.persona_descriptions,
      ...single.persona_descriptions,
    },
    default_persona: backup.default_persona || avatarId,
  }
}

export function duplicatePersonaInBackup(
  backup: SillyTavernPersonaBackup,
  sourceAvatarId: string,
  nextAvatarId: string,
): SillyTavernPersonaBackup {
  const sourceName = backup.personas[sourceAvatarId]
  if (sourceName === undefined) throw new Error('要复制的人设不存在')
  if (Object.prototype.hasOwnProperty.call(backup.personas, nextAvatarId)) {
    throw new Error(`头像文件名 ${nextAvatarId} 已存在`)
  }
  const sourceDescriptor = isRecord(backup.persona_descriptions[sourceAvatarId])
    ? backup.persona_descriptions[sourceAvatarId]
    : {}
  return {
    ...backup,
    personas: { ...backup.personas, [nextAvatarId]: `${readString(sourceName)} 副本` },
    persona_descriptions: {
      ...backup.persona_descriptions,
      // 编辑器把当前备份放入 Vue ref 后会得到 Proxy；用户人设备份本来就是 JSON，
      // 因此用 JSON 深拷贝既保留酒馆字段，也能安全剥离响应式代理。
      [nextAvatarId]: JSON.parse(JSON.stringify(sourceDescriptor)) as UserPersonaDescriptor,
    },
  }
}

export function removePersonaFromBackup(
  backup: SillyTavernPersonaBackup,
  avatarId: string,
): SillyTavernPersonaBackup {
  const personas = { ...backup.personas }
  const descriptions = { ...backup.persona_descriptions }
  delete personas[avatarId]
  delete descriptions[avatarId]
  const nextDefault =
    backup.default_persona === avatarId
      ? (Object.keys(personas)[0] ?? null)
      : backup.default_persona
  return {
    ...backup,
    personas,
    persona_descriptions: descriptions,
    default_persona: nextDefault,
  }
}

export function setDefaultPersonaInBackup(
  backup: SillyTavernPersonaBackup,
  avatarId: string,
): SillyTavernPersonaBackup {
  if (!Object.prototype.hasOwnProperty.call(backup.personas, avatarId)) {
    throw new Error('要设为默认的人设不存在')
  }
  return { ...backup, default_persona: avatarId }
}

export function serializeSillyTavernPersonaBackup(backup: SillyTavernPersonaBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}
