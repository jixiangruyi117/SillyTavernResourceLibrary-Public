export interface PresetPromptAnalysis {
  contentHash: string
  normalized: string
  grams: Set<string>
  setVariables: string[]
}

function contentHash(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
  }
  return `${value.length.toString(36)}-${first.toString(36)}-${second.toString(36)}`
}

function analyze(content: string): PresetPromptAnalysis {
  const normalized = content.toLocaleLowerCase().replace(/\s+/gu, '')
  const grams = new Set<string>()
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2))
  }
  const variables = new Set<string>()
  for (const match of content.matchAll(/\{\{\s*set(?:global)?var::\s*([^:}]+?)\s*::/giu)) {
    const name = match[1]?.trim()
    if (name) variables.add(name)
  }
  return { contentHash: contentHash(content), normalized, grams, setVariables: [...variables] }
}

export function estimateCachedPromptSimilarity(
  left: PresetPromptAnalysis,
  right: PresetPromptAnalysis,
): number {
  if (!left.normalized || !right.normalized) return 0
  if (left.normalized === right.normalized) return 1
  if (left.normalized.includes(right.normalized) || right.normalized.includes(left.normalized)) {
    return (
      Math.min(left.normalized.length, right.normalized.length) /
      Math.max(left.normalized.length, right.normalized.length)
    )
  }
  let shared = 0
  for (const gram of left.grams) if (right.grams.has(gram)) shared += 1
  return shared / Math.max(left.grams.size + right.grams.size - shared, 1)
}

export class PresetPromptAnalysisCache {
  private readonly values = new Map<string, { source: string; analysis: PresetPromptAnalysis }>()

  get(content: string): PresetPromptAnalysis {
    const hash = contentHash(content)
    const cached = this.values.get(hash)
    if (cached?.source === content) return cached.analysis
    const analysis = analyze(content)
    this.values.set(hash, { source: content, analysis })
    return analysis
  }

  retain(contents: Iterable<string>): void {
    const keep = new Set(Array.from(contents, contentHash))
    for (const key of this.values.keys()) if (!keep.has(key)) this.values.delete(key)
  }

  get size(): number {
    return this.values.size
  }
}
