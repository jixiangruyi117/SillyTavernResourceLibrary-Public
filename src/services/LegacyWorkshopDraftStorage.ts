import type {
  WorkshopChatMessage,
  WorkshopDraft,
  WorkshopVersion,
} from '../types/FrontendWorkshopLegacyApp'
export const STORAGE_KEY = 'srl.frontendWorkshop.versions.v1'
export const DRAFT_STORAGE_KEY = 'srl.frontendWorkshop.drafts.v1'
export const RECOVERY_STORAGE_KEY = 'srl.frontendWorkshop.recovery.v1'
export const CONVERSATION_STORAGE_KEY = 'srl.frontendWorkshop.conversation.v1'
export function loadVersions(): WorkshopVersion[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? (value as WorkshopVersion[]).slice(-20) : []
  } catch {
    return []
  }
}

export function loadDrafts(): WorkshopDraft[] {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? (value as WorkshopDraft[]).slice(0, 8) : []
  } catch {
    return []
  }
}

export function loadConversation(): WorkshopChatMessage[] {
  try {
    const value = JSON.parse(localStorage.getItem(CONVERSATION_STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value
      .filter(
        (item): item is WorkshopChatMessage =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as WorkshopChatMessage).id === 'string' &&
          ((item as WorkshopChatMessage).role === 'user' ||
            (item as WorkshopChatMessage).role === 'assistant') &&
          typeof (item as WorkshopChatMessage).content === 'string' &&
          typeof (item as WorkshopChatMessage).createdAt === 'number',
      )
      .slice(-30)
  } catch {
    return []
  }
}
