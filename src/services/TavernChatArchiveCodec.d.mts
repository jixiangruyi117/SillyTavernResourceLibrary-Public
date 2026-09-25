export const REGEX_LIMIT: number
export interface ChatArchiveRegexContext {
  presetName?: string
  presetEnabled?: boolean
  characterEnabled?: boolean
  presetRules?: unknown[]
}
export function createChatArchive(
  card: File,
  chat: File,
  avatar: string,
  displayRules?: unknown[],
  regexContext?: ChatArchiveRegexContext,
): File
export function readChatArchive(file: File): Promise<{
  avatar: string
  card: File
  chat: File
  displayRules: Record<string, unknown>[]
  presetRules: Record<string, unknown>[]
  hasRegexSnapshot: boolean
  regexContext: ChatArchiveRegexContext
}>
