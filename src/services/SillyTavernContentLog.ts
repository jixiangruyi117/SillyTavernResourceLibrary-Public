const SEEDED_DIRECTORY_MAP: Readonly<Record<string, string>> = {
  characters: 'characters',
  worlds: 'worlds',
  themes: 'themes',
  quickreplies: 'QuickReplies',
  'quick replies': 'QuickReplies',
  'openai settings': 'OpenAI Settings',
  'novelai settings': 'NovelAI Settings',
  'koboldai settings': 'KoboldAI Settings',
  'textgen settings': 'TextGen Settings',
  regex: 'regex',
  scripts: 'scripts',
  backgrounds: 'backgrounds',
  'user avatars': 'User Avatars',
}

const PRESET_DIRECTORY_MAP: Readonly<Record<string, string>> = {
  kobold: 'KoboldAI Settings',
  novel: 'NovelAI Settings',
  openai: 'OpenAI Settings',
  textgen: 'TextGen Settings',
  'quick-replies': 'QuickReplies',
}

function normalizePath(value: string): string {
  return value
    .replace(/^\uFEFF/u, '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^default\/(?:content|scaffold)\//iu, '')
    .replace(/^content\//iu, '')
    .replace(/\/+/gu, '/')
    .replace(/^\//u, '')
}

function mappedSeedPath(value: string): string | undefined {
  const normalized = normalizePath(value)
  if (!normalized || normalized === 'content.log') return undefined

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 1) {
    if (/^default_(?:seraphina|character)\.(?:png|json)$/iu.test(normalized))
      return `characters/${normalized}`
    if (/^eldoria\.json$/iu.test(normalized)) return `worlds/${normalized}`
    return undefined
  }

  if (parts[0] === 'presets' && parts.length >= 3) {
    const target = PRESET_DIRECTORY_MAP[parts[1]!.toLowerCase()]
    return target ? [target, ...parts.slice(2)].join('/') : undefined
  }

  const target = SEEDED_DIRECTORY_MAP[parts[0]!.toLowerCase()]
  return target ? [target, ...parts.slice(1)].join('/') : undefined
}

/** Converts SillyTavern's seed log entries to paths found in a user backup. */
export function parseSillyTavernContentLog(text: string): Set<string> {
  const result = new Set<string>()
  for (const line of text.split(/\r?\n/u)) {
    const path = mappedSeedPath(line)
    if (path) result.add(path.toLowerCase())
  }
  return result
}

/** Matches archive roots nested below a user directory without matching user subfolders. */
export function isSillyTavernSeededPath(path: string, seededPaths: ReadonlySet<string>): boolean {
  const normalized = normalizePath(path).toLowerCase()
  for (const seeded of seededPaths) {
    if (normalized === seeded || normalized.endsWith(`/${seeded}`)) return true
  }
  return false
}
