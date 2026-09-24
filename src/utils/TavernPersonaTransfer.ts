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
