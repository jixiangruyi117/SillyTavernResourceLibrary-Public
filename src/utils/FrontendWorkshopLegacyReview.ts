// Preserve original prompt snapshots while compacting repeated legacy review requirements.
import type {
  WorkshopPromptSnapshot,
  WorkshopVersion,
  WorkshopDraft,
} from '../types/FrontendWorkshopLegacyApp'

export const EXPANDED_REVIEW_INTRO = '请在保持未提及区域不变的前提下，执行以下已选审美建议：'

export function compactExpandedReviewRequirements(
  value: string,
  seenBodies = new Set<string>(),
): { value: string; removed: number } {
  const escapedIntro = EXPANDED_REVIEW_INTRO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(`\\n*${escapedIntro}\\n([\\s\\S]*?)(?=\\n+${escapedIntro}|$)`, 'g')
  const matches = Array.from(value.matchAll(expression))
  if (!matches.length) return { value, removed: 0 }
  const ranges: Array<{ start: number; end: number }> = []
  for (const match of matches) {
    const body = match[1]?.trim() ?? ''
    if (!body) continue
    if (seenBodies.has(body)) {
      ranges.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })
    } else {
      seenBodies.add(body)
    }
  }

  const first = matches[0]!
  const firstBody = first[1]?.trim() ?? ''
  const prefix = value.slice(0, first.index ?? 0).trimEnd()
  if (firstBody && prefix.endsWith(firstBody)) {
    ranges.push({ start: prefix.length - firstBody.length, end: first.index ?? 0 })
  }
  if (!ranges.length) return { value, removed: 0 }

  const compacted = ranges
    .sort((left, right) => right.start - left.start)
    .reduce((result, range) => `${result.slice(0, range.start)}${result.slice(range.end)}`, value)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { value: compacted, removed: ranges.length }
}

export function compactReviewRequirementText(
  value: string,
  seen: Set<string>,
): {
  value: string
  removed: number
} {
  let removed = 0
  const markedCompacted = value
    .replace(/\n*【已选审美建议】[\s\S]*?【已选审美建议结束】/g, (requirement) => {
      const normalized = requirement.trim()
      if (seen.has(normalized)) {
        removed += 1
        return ''
      }
      seen.add(normalized)
      return requirement
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const expanded = compactExpandedReviewRequirements(markedCompacted, seen)
  return { value: expanded.value, removed: removed + expanded.removed }
}

export function compactPromptSnapshot(snapshot?: WorkshopPromptSnapshot): {
  snapshot?: WorkshopPromptSnapshot
  cleaned: boolean
} {
  if (!snapshot) return { snapshot, cleaned: false }
  let cleaned = false
  const messages = snapshot.messages.map((message) => {
    if (message.role !== 'user') return message
    const result = compactReviewRequirementText(message.content, new Set<string>())
    if (!result.removed) return message
    cleaned = true
    return {
      ...message,
      content: result.value,
      originalContent: message.originalContent ?? message.content,
      label: message.label.includes('（已去重展示）')
        ? message.label
        : `${message.label}（已去重展示）`,
    }
  })
  return { snapshot: cleaned ? { ...snapshot, messages } : snapshot, cleaned }
}

export function compactWorkshopVersions(source: WorkshopVersion[]): {
  versions: WorkshopVersion[]
  removed: number
  snapshotCleaned: boolean
} {
  const seen = new Set<string>()
  let removed = 0
  let snapshotCleaned = false
  const compacted = source.map((version) => {
    const refinement = compactReviewRequirementText(version.refinement, seen)
    const promptSnapshot = compactPromptSnapshot(version.promptSnapshot)
    removed += refinement.removed
    snapshotCleaned ||= promptSnapshot.cleaned
    if (!refinement.removed && !promptSnapshot.cleaned) return version
    return { ...version, refinement: refinement.value, promptSnapshot: promptSnapshot.snapshot }
  })
  return { versions: compacted, removed, snapshotCleaned }
}

export function compactWorkshopDraft(draft: WorkshopDraft): {
  draft: WorkshopDraft
  removed: number
  snapshotCleaned: boolean
} {
  const versionsResult = compactWorkshopVersions(draft.versions)
  const refinement = compactReviewRequirementText(draft.refinement, new Set<string>())
  if (!versionsResult.removed && !versionsResult.snapshotCleaned && !refinement.removed) {
    return { draft, removed: 0, snapshotCleaned: false }
  }
  return {
    draft: { ...draft, versions: versionsResult.versions, refinement: refinement.value },
    removed: versionsResult.removed + refinement.removed,
    snapshotCleaned: versionsResult.snapshotCleaned,
  }
}
