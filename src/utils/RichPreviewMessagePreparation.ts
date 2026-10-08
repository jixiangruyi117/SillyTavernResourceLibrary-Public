import type { PreviewPolicy } from '../services/BrowserStorageService'

import { applyCharacterGreetingRegex } from './CharacterGreetingRegex'

import { prepareTavernPreviewSource } from './OpeningPreviewContent'

import { formatSillyTavernMessage } from './SillyTavernMessageFormatter'

export interface PreviewMacroContext {
  charName?: string
  userName?: string
  chatId?: string
}

export const PICK_MACRO_PATTERN = /{{pick\s?::?([^}]+)}}/gi

export function hashPreviewSeed(value: string): number {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  return hash >>> 0
}

export function splitPreviewPickList(value: string): string[] {
  if (value.includes('::')) return value.split('::')

  const items: string[] = []
  let current = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && value[index + 1] === ',') {
      current += ','
      index += 1
      continue
    }
    if (value[index] === ',') {
      items.push(current.trim())
      current = ''
      continue
    }
    current += value[index]
  }
  items.push(current.trim())
  return items
}

export function replacePreviewPickMacros(
  value: string,
  rawContent: string,
  previewChatId: string,
): string {
  let documentSeed: number | undefined
  return value.replace(PICK_MACRO_PATTERN, (_match, listString: string, offset: number) => {
    const list = splitPreviewPickList(listString)
    if (!list.length) return ''
    documentSeed ??= hashPreviewSeed(`${previewChatId}\u0000${rawContent}`)
    const choiceSeed = hashPreviewSeed(`${documentSeed}:${offset}`)
    return list[choiceSeed % list.length] ?? ''
  })
}

export function replacePreviewMacros(source: string, context: PreviewMacroContext = {}): string {
  const rawContent = source
  let result = source
  const charName = context.charName?.trim()
  const userName = context.userName?.trim()
  if (charName) {
    result = result.replace(/<BOT>|<CHAR>/gi, charName).replace(/\{\{\s*char\s*\}\}/gi, charName)
  }
  if (userName) {
    result = result.replace(/<USER>/gi, userName).replace(/\{\{\s*user\s*\}\}/gi, userName)
  }
  result = result.replace(/\{\{\s*newline\s*\}\}/gi, '\n')
  return replacePreviewPickMacros(
    result,
    rawContent,
    context.chatId?.trim() || charName || 'srl-preview-chat',
  )
}

export function preprocessResourceMessage(
  source: string,
  options: RichContentPreviewOptions,
): string {
  const previewSource = prepareTavernPreviewSource(source, options.sourceKind)
  const macroSource = replacePreviewMacros(previewSource, {
    charName: options.macroCharName,
    userName: options.macroUserName,
  })
  if (!options.displayRegexRules?.length) return macroSource
  return (
    applyCharacterGreetingRegex([macroSource], options.displayRegexRules, {
      charName: options.macroCharName,
      userName: options.macroUserName,
    }).contents[0] ?? macroSource
  )
}

export function prepareRichContentPreviewMessage(
  source: string,
  policy: PreviewPolicy,
  options: Pick<
    RichContentPreviewOptions,
    'sourceKind' | 'macroCharName' | 'macroUserName' | 'displayRegexRules'
  > = {},
): PreparedRichContentPreviewMessage {
  const previewSource = prepareTavernPreviewSource(source, options.sourceKind)
  const substitutedSource = preprocessResourceMessage(source, options)
  return {
    source,
    previewSource,
    substitutedSource,
    formatted: formatSillyTavernMessage(substitutedSource, {
      allowExternalMedia: policy.allowRemoteResources,
    }),
  }
}
import type {
  RichContentPreviewOptions,
  PreparedRichContentPreviewMessage,
} from './RichContentPreview'
