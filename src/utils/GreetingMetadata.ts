export interface GreetingMetadata {
  title: string
  description: string
  group: string
  theme: string
  content: string
}

const LEADING_COMMENT_PATTERN =
  /^<!--\s*(title|desc|description|group|theme)\s*[:：]\s*([\s\S]*?)\s*-->\s*/i

function cleanMetadataValue(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}…` : normalized
}

/**
 * Reads the lightweight inline-comment convention used by some community cards:
 * <!--title:...-->, <!--desc:...-->, <!--group:...-->, <!--theme:...-->
 *
 * Only consecutive comments at the beginning of the greeting are consumed. The card source
 * itself is never mutated; callers receive a display-only body without those comments.
 */
export function parseGreetingMetadata(source: string): GreetingMetadata {
  const metadata: GreetingMetadata = {
    title: '',
    description: '',
    group: '',
    theme: '',
    content: source,
  }
  let cursor = source.charCodeAt(0) === 0xfeff ? 1 : 0
  cursor += source.slice(cursor).match(/^\s*/)?.[0].length ?? 0
  let matched = false

  while (cursor < source.length) {
    const comment = source.slice(cursor).match(LEADING_COMMENT_PATTERN)
    if (!comment) break
    matched = true
    const key = comment[1]?.toLowerCase()
    const value = comment[2] ?? ''
    if (key === 'title') metadata.title = cleanMetadataValue(value, 160)
    else if (key === 'group') metadata.group = cleanMetadataValue(value, 160)
    else if (key === 'theme') metadata.theme = cleanMetadataValue(value, 160)
    else metadata.description = cleanMetadataValue(value, 600)
    cursor += comment[0].length
  }

  if (matched) metadata.content = source.slice(cursor).trimStart()
  return metadata
}
