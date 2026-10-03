import type {
  UserPersonaCharacterVariant,
  UserPersonaCharacterVariantVersion,
  UserPersonaProfile,
  UserPersonaProfileSection,
  UserPersonaSectionOverride,
} from '../types/UserPersona'
import { isRecord } from './UnknownValue'

export const USER_PERSONA_PROFILE_FIELD = 'srl_persona_profile'

export function createUserPersonaProfile(description = ''): UserPersonaProfile {
  return {
    version: 1,
    sections: [{ id: 'base', name: '基础设定', text: description }],
    variants: {},
  }
}

function normalizeOverrides(value: unknown): Record<string, UserPersonaSectionOverride> {
  const overrides: Record<string, UserPersonaSectionOverride> = {}
  if (isRecord(value)) {
    for (const [sectionId, rawOverride] of Object.entries(value)) {
      if (!isRecord(rawOverride)) continue
      if (rawOverride.mode === 'disable') overrides[sectionId] = { mode: 'disable' }
      else if (rawOverride.mode === 'replace' && typeof rawOverride.text === 'string')
        overrides[sectionId] = { mode: 'replace', text: rawOverride.text }
    }
  }
  return overrides
}

function normalizeVariantVersion(
  value: unknown,
  fallbackName: string,
): UserPersonaCharacterVariantVersion {
  return {
    name:
      isRecord(value) && typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : fallbackName,
    overrides: isRecord(value) ? normalizeOverrides(value.overrides) : {},
    addition: isRecord(value) && typeof value.addition === 'string' ? value.addition : '',
  }
}

export function createUserPersonaVariantVersion(
  name = '版本 1',
): UserPersonaCharacterVariantVersion {
  return { name, overrides: {}, addition: '' }
}

export function createUserPersonaCharacterVariant(name = '版本 1'): UserPersonaCharacterVariant {
  const versionId = `version-${crypto.randomUUID()}`
  return {
    versions: { [versionId]: createUserPersonaVariantVersion(name) },
    defaultVersionId: versionId,
  }
}

export function normalizeUserPersonaProfile(
  value: unknown,
  fallbackDescription = '',
): UserPersonaProfile {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sections))
    return createUserPersonaProfile(fallbackDescription)

  const sections: UserPersonaProfileSection[] = value.sections
    .filter(
      (section): section is Record<string, unknown> =>
        isRecord(section) &&
        typeof section.id === 'string' &&
        typeof section.name === 'string' &&
        typeof section.text === 'string',
    )
    .map((section) => ({
      id: section.id as string,
      name: section.name as string,
      text: section.text as string,
    }))
  if (!sections.length) sections.push({ id: 'base', name: '基础设定', text: fallbackDescription })

  const variants: UserPersonaProfile['variants'] = {}
  if (isRecord(value.variants)) {
    for (const [characterId, rawVariant] of Object.entries(value.variants)) {
      if (!characterId || !isRecord(rawVariant)) continue
      let versions: UserPersonaCharacterVariant['versions'] = {}
      if (isRecord(rawVariant.versions)) {
        for (const [versionId, rawVersion] of Object.entries(rawVariant.versions)) {
          if (!versionId || !isRecord(rawVersion)) continue
          versions[versionId] = normalizeVariantVersion(
            rawVersion,
            `版本 ${Object.keys(versions).length + 1}`,
          )
        }
      } else {
        // Upgrade the original single-version shape without losing its content.
        versions = {
          default: {
            ...normalizeVariantVersion(rawVariant, '默认版本'),
            name: '默认版本',
          },
        }
      }
      if (!Object.keys(versions).length) continue
      const requestedDefault =
        typeof rawVariant.defaultVersionId === 'string' ? rawVariant.defaultVersionId : ''
      const defaultVersionId = versions[requestedDefault]
        ? requestedDefault
        : Object.keys(versions)[0]!
      const chatVersions: Record<string, string> = {}
      if (isRecord(rawVariant.chatVersions)) {
        for (const [chatId, versionId] of Object.entries(rawVariant.chatVersions))
          if (typeof versionId === 'string' && versions[versionId]) chatVersions[chatId] = versionId
      }
      variants[characterId] = {
        versions,
        defaultVersionId,
        ...(Object.keys(chatVersions).length ? { chatVersions } : {}),
      }
    }
  }
  return { version: 1, sections, variants }
}

export function serializeUserPersonaProfile(profile: UserPersonaProfile): string {
  return profile.sections
    .map((section) => section.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function compileUserPersonaVariant(
  profile: UserPersonaProfile,
  characterId: string,
  versionId?: string,
): string {
  const characterVariant = profile.variants[characterId]
  const variant = characterVariant?.versions[versionId ?? characterVariant.defaultVersionId]
  if (!variant) return ''

  const instructions: string[] = []
  for (const section of profile.sections) {
    const override = variant.overrides[section.id]
    if (!override) continue
    if (override.mode === 'disable') {
      instructions.push(`- ${section.name}：本角色卡下不采用全局设定中的这一项。`)
    } else if (override.text?.trim()) {
      instructions.push(
        `- ${section.name}：本角色卡下改为“${override.text.trim()}”，以此覆盖全局设定。`,
      )
    }
  }

  const addition = variant.addition.trim()
  if (!instructions.length && !addition) return ''
  return [
    '【当前角色卡下的用户人设调整】',
    ...instructions,
    ...(addition ? ['【仅对此角色卡追加】', addition] : []),
  ].join('\n')
}

export function resolveUserPersonaProfile(
  profile: UserPersonaProfile,
  characterId = '',
  versionId?: string,
): string {
  const characterVariant = profile.variants[characterId]
  const variant = characterVariant?.versions[versionId ?? characterVariant.defaultVersionId]
  const sections = profile.sections
    .map((section) => resolveSection(section, variant))
    .filter(Boolean)
  if (variant?.addition.trim()) sections.push(variant.addition.trim())
  return sections.join('\n')
}

function resolveSection(
  section: UserPersonaProfileSection,
  variant?: UserPersonaCharacterVariantVersion,
): string {
  const override = variant?.overrides[section.id]
  if (override?.mode === 'disable') return ''
  return override?.mode === 'replace' ? (override.text?.trim() ?? '') : section.text.trim()
}

export function compareUserPersonaVersions(
  profile: UserPersonaProfile,
  characterId: string,
  beforeId: string,
  afterId: string,
): Array<{ name: string; before: string; after: string }> {
  const versions = profile.variants[characterId]?.versions
  const before = versions?.[beforeId]
  const after = versions?.[afterId]
  if (!before || !after) return []
  const differences = profile.sections.flatMap((section) => {
    const beforeText = resolveSection(section, before)
    const afterText = resolveSection(section, after)
    return beforeText === afterText
      ? []
      : [{ name: section.name, before: beforeText, after: afterText }]
  })
  if (before.addition.trim() !== after.addition.trim())
    differences.push({
      name: '角色专属追加',
      before: before.addition.trim(),
      after: after.addition.trim(),
    })
  return differences
}
