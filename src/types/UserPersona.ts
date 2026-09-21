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

export interface UserPersonaDescriptor extends Record<string, unknown> {
  description?: unknown
  position?: unknown
  depth?: unknown
  role?: unknown
  lorebook?: unknown
  connections?: unknown
  title?: unknown
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
  invalidConnectionCount: number
  descriptorExists: boolean
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
}

export interface UserPersonaTemplate {
  id: string
  name: string
  description: string
}
