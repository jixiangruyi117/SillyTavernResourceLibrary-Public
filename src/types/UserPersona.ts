export const USER_PERSONA_POSITIONS = {
  IN_PROMPT: 0,
  AFTER_CHARACTER_LEGACY: 1,
  TOP_AUTHORS_NOTE: 2,
  BOTTOM_AUTHORS_NOTE: 3,
  AT_DEPTH: 4,
  NONE: 9,
} as const

export const USER_PERSONA_ROLES = {
  SYSTEM: 0,
  USER: 1,
  ASSISTANT: 2,
} as const

export type UserPersonaConnectionType = 'character' | 'group'

export interface UserPersonaConnection {
  type: UserPersonaConnectionType
  id: string
}

export interface UserPersonaCharacterBindingSnapshot {
  avatar: string
  name: string
  hash: string
}

export interface UserPersonaDescriptor extends Record<string, unknown> {
  description?: unknown
  position?: unknown
  depth?: unknown
  role?: unknown
  lorebook?: unknown
  connections?: unknown
  srl_persona_character_bindings?: unknown
  title?: unknown
  srl_persona_profile?: unknown
}

export interface UserPersonaProfileSection {
  id: string
  name: string
  text: string
}

export interface UserPersonaSectionOverride {
  mode: 'replace' | 'disable'
  text?: string
}

export interface UserPersonaCharacterVariant {
  versions: Record<string, UserPersonaCharacterVariantVersion>
  defaultVersionId: string
  chatVersions?: Record<string, string>
}

export interface UserPersonaCharacterVariantVersion {
  name: string
  overrides: Record<string, UserPersonaSectionOverride>
  addition: string
}

export interface UserPersonaProfile {
  version: 1
  sections: UserPersonaProfileSection[]
  variants: Record<string, UserPersonaCharacterVariant>
}

export interface SillyTavernPersonaBackup extends Record<string, unknown> {
  personas: Record<string, unknown>
  persona_descriptions: Record<string, unknown>
  default_persona?: unknown
}

export interface UserPersonaEntry {
  avatarId: string
  name: string
  title: string
  description: string
  position: number
  depth: number
  role: number
  lorebook: string
  connections: UserPersonaConnection[]
  characterBindings: Record<string, UserPersonaCharacterBindingSnapshot>
  invalidConnectionCount: number
  descriptorExists: boolean
  profile: UserPersonaProfile
}

export interface UserPersonaBackupView {
  raw: SillyTavernPersonaBackup
  entries: UserPersonaEntry[]
  defaultPersona: string
  warnings: string[]
}

export interface UserPersonaDraft {
  avatarId: string
  name: string
  title: string
  description: string
  position: number
  depth: number
  role: number
  lorebook: string
  connections: UserPersonaConnection[]
  characterBindings: Record<string, UserPersonaCharacterBindingSnapshot>
  profile: UserPersonaProfile
}

export interface UserPersonaTemplate {
  id: string
  name: string
  description: string
}
