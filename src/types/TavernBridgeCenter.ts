import type { TavernResourceKind } from '../services/TavernBridgeProtocol'
import type { TavernSendContent } from './BrowserPreferences'

import { type Category, type ResourceSummary } from '../types/Resource'

export type TavernBridgeCenterProps = {
  resources: ResourceSummary[]
  categories?: Category[]
  initialLocalIds?: string[]
  initialKind?: 'userPersona'
}

export type TavernBridgeCenterEvents = {
  back: []
  'import-files': [files: File[], onComplete?: () => void]
}

export type LocalSendFilter =
  | 'chat'
  | 'all'
  | 'character'
  | 'worldBook'
  | 'preset'
  | 'regex'
  | 'quickReply'
  | 'script'
  | 'theme'
  | 'userPersona'

export type TavernReceiveFilter = 'all' | TavernResourceKind

export interface TransferQueueItem {
  key: string
  name: string
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
  detail: string
  operationId?: string
  content?: TavernSendContent
  syncCharacterTags?: boolean
  readingScriptIds?: string[]
  carryReadingScripts?: boolean
}

export type PersonaAvatarMode = 'none' | 'missing' | 'replace'

export interface PersonaAvatarPlan {
  avatarId: string
  file: File
  exists: boolean
}

export interface PersonaSendPlan {
  skip?: boolean
  file?: File
  avatarId?: string
  characterTargets?: Map<string, Map<string, string>>
  missingCharacters?: Array<{
    personaAvatar: string
    sourceId: string
    avatarId: string
    name: string
    file?: File
    resourceId?: string
  }>
  sendMissingCharacters?: boolean
  identicalPersona?: boolean
  skipPersona?: boolean
  forceOverwritePersona?: boolean
}
