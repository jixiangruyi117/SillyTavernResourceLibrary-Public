import { isSillyTavernPersonaBackup } from '../parser/SillyTavernPersonaBackup'
import type { SillyTavernPersonaBackup } from '../types/UserPersona'
import { canonicalizeCardJson } from './CharacterCardFingerprint'

export function personaContentMatches(
  local: SillyTavernPersonaBackup,
  remote: unknown,
  avatarId: string,
): boolean {
  if (!isSillyTavernPersonaBackup(remote)) return false
  return (
    canonicalizeCardJson([local.personas[avatarId], local.persona_descriptions[avatarId] ?? {}]) ===
    canonicalizeCardJson([remote.personas[avatarId], remote.persona_descriptions[avatarId] ?? {}])
  )
}

export function copyPersonaForTavern(
  backup: SillyTavernPersonaBackup,
  sourceAvatarId: string,
  nextAvatarId: string,
): SillyTavernPersonaBackup {
  const name = backup.personas[sourceAvatarId]
  if (typeof name !== 'string') throw new Error('要发送的人设不存在')
  if (!/^persona-[a-f0-9-]{36}\.png$/iu.test(nextAvatarId)) {
    throw new Error('新的人设头像标识无效')
  }
  return {
    personas: { [nextAvatarId]: name },
    persona_descriptions: {
      [nextAvatarId]: structuredClone(backup.persona_descriptions[sourceAvatarId] ?? {}),
    },
    // 不设置 default_persona：另存一份不能擅自切换酒馆当前使用的人设。
  }
}

/** Keep only role-specific persona variants that have a matching/imported Tavern card. */
export function mapPersonaCharacterVariantsForTavern(
  backup: SillyTavernPersonaBackup,
  targetAvatarByPersona: ReadonlyMap<string, ReadonlyMap<string, string>>,
): SillyTavernPersonaBackup {
  const next = structuredClone(backup)
  for (const [personaAvatar, rawDescriptor] of Object.entries(next.persona_descriptions)) {
    if (!rawDescriptor || typeof rawDescriptor !== 'object' || Array.isArray(rawDescriptor))
      continue
    const descriptor = rawDescriptor as Record<string, unknown>
    const profile = descriptor.srl_persona_profile
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue
    const profileRecord = profile as Record<string, unknown>
    const variants = profileRecord.variants
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) continue

    const avatarMap = targetAvatarByPersona.get(personaAvatar) ?? new Map<string, string>()
    const sourceVariants = variants as Record<string, unknown>
    const mappedVariants: Record<string, unknown> = {}
    const originalIds = Object.keys(sourceVariants)
    for (const sourceId of originalIds) {
      const targetId = avatarMap.get(sourceId)
      if (targetId) mappedVariants[targetId] = sourceVariants[sourceId]
    }
    profileRecord.variants = mappedVariants

    const rawBindings = descriptor.srl_persona_character_bindings
    if (rawBindings && typeof rawBindings === 'object' && !Array.isArray(rawBindings)) {
      const bindings = rawBindings as Record<string, unknown>
      const remappedBindings = { ...bindings }
      const nativeIds = new Set(
        Array.isArray(descriptor.connections)
          ? descriptor.connections
              .filter(
                (connection): connection is { type: string; id: string } =>
                  !!connection &&
                  typeof connection === 'object' &&
                  (connection as { type?: unknown }).type === 'character' &&
                  typeof (connection as { id?: unknown }).id === 'string',
              )
              .map((connection) => connection.id)
          : [],
      )
      for (const sourceId of originalIds) {
        const targetId = avatarMap.get(sourceId)
        const snapshot = bindings[sourceId]
        if (targetId && snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
          const record = snapshot as Record<string, unknown>
          remappedBindings[targetId] = { ...record, avatar: targetId }
        }
        if (!nativeIds.has(sourceId)) delete remappedBindings[sourceId]
      }
      descriptor.srl_persona_character_bindings = remappedBindings
    }
  }
  return next
}
