export type TavernCapabilityAction =
  | 'upload'
  | 'setCurrentCharacter'
  | 'setPersona'
  | 'switchPreset'
  | 'enableWorldInfo'
  | 'enableRegex'
  | 'openChat'
  | 'sceneSwitcher'

export type TavernCapabilityMode =
  'automatic' | 'upload-only' | 'confirmation-required' | 'unsupported'

export type TavernCapabilities = Record<TavernCapabilityAction, TavernCapabilityMode>

function hasAny(raw: ReadonlySet<string>, values: string[]): boolean {
  return values.some((value) => raw.has(value))
}

export function negotiateTavernCapabilities(values: readonly string[]): TavernCapabilities {
  const raw = new Set(values)
  const upload = hasAny(raw, [
    'character',
    'worldBook',
    'preset',
    'regexGlobal',
    'quickReply',
    'theme',
    'userPersona',
  ])
  return {
    upload: upload ? 'automatic' : 'unsupported',
    setCurrentCharacter: raw.has('set-current-character-v1')
      ? 'automatic'
      : raw.has('character')
        ? 'upload-only'
        : 'unsupported',
    setPersona: raw.has('set-persona-v1')
      ? 'automatic'
      : raw.has('userPersona')
        ? 'upload-only'
        : 'unsupported',
    switchPreset: raw.has('switch-preset-v1')
      ? 'automatic'
      : raw.has('preset')
        ? 'upload-only'
        : 'unsupported',
    enableWorldInfo: raw.has('enable-world-info-v1')
      ? 'automatic'
      : raw.has('worldBook')
        ? 'upload-only'
        : 'unsupported',
    enableRegex: raw.has('enable-regex-v1')
      ? 'automatic'
      : hasAny(raw, ['regexGlobal', 'regexCharacter', 'regexPreset'])
        ? 'upload-only'
        : 'unsupported',
    openChat: raw.has('open-chat-v1') ? 'automatic' : 'confirmation-required',
    sceneSwitcher: raw.has('scene-switcher-v1') ? 'automatic' : 'confirmation-required',
  }
}
