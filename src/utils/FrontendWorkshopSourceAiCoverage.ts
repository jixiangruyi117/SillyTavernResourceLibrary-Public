import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT,
  type FrontendWorkshopSourceAnalysisSnapshot,
  type FrontendWorkshopSourceMapEntity,
  type FrontendWorkshopSourceRange,
} from './FrontendWorkshopSourceAnalysis'
import { FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS } from './FrontendWorkshopSourcePatch'
import type { FrontendWorkshopResolvedSourceSelection } from './FrontendWorkshopSourceSelection'
import {
  type FrontendWorkshopSourceAiWriteScopeRequest,
  type FrontendWorkshopSourceAiResolvedWriteScope,
  type FrontendWorkshopSourceAiSourceChunk,
  type FrontendWorkshopSourceAiSourceCoverage,
  type ResolvedContextOptions,
  type SourceRangeCandidate,
} from '../types/FrontendWorkshopSourceAiContext'

export function assertSource(source: FrontendWorkshopSourceDocument): void {
  if (!source.projectId) throw new Error('AI Context 缺少 Source projectId')
  if (!Number.isInteger(source.revision) || source.revision < 1) {
    throw new Error('AI Context Source revision 必须是正整数')
  }
  if (typeof source.authorSource !== 'string')
    throw new Error('AI Context Author Source 必须是字符串')
}

export function validRange(range: FrontendWorkshopSourceRange, sourceLength: number): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start &&
    range.end <= sourceLength
  )
}

export function requireRange(
  range: FrontendWorkshopSourceRange,
  sourceLength: number,
): FrontendWorkshopSourceRange {
  if (!validRange(range, sourceLength)) throw new Error('AI Context write scope range 非法')
  return { start: range.start, end: range.end }
}

export function mergeRanges(
  ranges: readonly FrontendWorkshopSourceRange[],
): FrontendWorkshopSourceRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: FrontendWorkshopSourceRange[] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

export function currentSelections(
  source: FrontendWorkshopSourceDocument,
  selections: readonly FrontendWorkshopResolvedSourceSelection[] | undefined,
): FrontendWorkshopResolvedSourceSelection[] {
  const values = selections ?? []
  if (
    values.some(
      (selection) =>
        selection.projectId !== source.projectId || selection.sourceRevision !== source.revision,
    )
  ) {
    return []
  }
  return values.map((selection) => ({
    ...selection,
    ...(selection.sourceRange ? { sourceRange: { ...selection.sourceRange } } : {}),
  }))
}

export function currentAnalysis(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot | undefined,
): FrontendWorkshopSourceAnalysisSnapshot | undefined {
  if (!analysis) return undefined
  return analysis.projectId === source.projectId && analysis.sourceRevision === source.revision
    ? analysis
    : undefined
}

export function staticEntityRange(
  source: FrontendWorkshopSourceDocument,
  entity: FrontendWorkshopSourceMapEntity | undefined,
): FrontendWorkshopSourceRange | undefined {
  if (!entity || entity.provenance.kind !== 'static-source') return undefined
  const anchor = entity.provenance.anchor
  if (anchor.projectId !== source.projectId || anchor.sourceRevision !== source.revision) {
    return undefined
  }
  return validRange(anchor.range, source.authorSource.length) ? { ...anchor.range } : undefined
}

export function windowAroundRange(
  range: FrontendWorkshopSourceRange,
  padding: number,
  maximum: number,
  sourceLength: number,
): FrontendWorkshopSourceRange {
  let start = Math.max(0, range.start - padding)
  let end = Math.min(sourceLength, range.end + padding)
  if (end - start <= maximum) return { start, end }

  const rangeLength = Math.min(maximum, range.end - range.start)
  const remaining = Math.max(0, maximum - rangeLength)
  start = Math.max(0, range.start - Math.floor(remaining / 2))
  end = Math.min(
    sourceLength,
    Math.max(range.end, range.start + rangeLength) + Math.ceil(remaining / 2),
  )
  if (end - start > maximum) start = Math.max(0, end - maximum)
  if (end - start > maximum) end = start + maximum
  return { start, end }
}

export function subtractCovered(
  range: FrontendWorkshopSourceRange,
  covered: readonly FrontendWorkshopSourceRange[],
): FrontendWorkshopSourceRange[] {
  let pieces: FrontendWorkshopSourceRange[] = [{ ...range }]
  for (const owner of covered) {
    const next: FrontendWorkshopSourceRange[] = []
    for (const piece of pieces) {
      if (owner.end <= piece.start || owner.start >= piece.end) {
        next.push(piece)
        continue
      }
      if (owner.start > piece.start) next.push({ start: piece.start, end: owner.start })
      if (owner.end < piece.end) next.push({ start: owner.end, end: piece.end })
    }
    pieces = next
    if (pieces.length === 0) break
  }
  return pieces.filter((piece) => piece.end > piece.start)
}

export function relatedCandidates(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot | undefined,
  selection: FrontendWorkshopResolvedSourceSelection | undefined,
  options: ResolvedContextOptions,
): SourceRangeCandidate[] {
  if (!analysis || !selection) return []
  const sourceIds = new Set(
    [selection.sourceEntityId, selection.sourceCandidateEntityId].filter((value): value is string =>
      Boolean(value),
    ),
  )
  if (sourceIds.size === 0) return []

  const relatedIds: string[] = []
  for (const edge of analysis.editGraph.edges) {
    let relatedId: string | undefined
    if (sourceIds.has(edge.fromId)) relatedId = edge.toId
    if (sourceIds.has(edge.toId)) relatedId = edge.fromId
    if (!relatedId || sourceIds.has(relatedId) || relatedIds.includes(relatedId)) continue
    relatedIds.push(relatedId)
    if (relatedIds.length >= options.maxRelatedChunks) break
  }

  return relatedIds.flatMap((id) => {
    const entity = analysis.sourceMap.entities.find((candidate) => candidate.id === id)
    const range = staticEntityRange(source, entity)
    if (!range) return []
    return [
      {
        range: windowAroundRange(
          range,
          options.relationPadding,
          options.maxSourceChunkTextUnits,
          source.authorSource.length,
        ),
        reason: `edit-graph:${id}`,
      },
    ]
  })
}

export function distributedCandidates(
  sourceLength: number,
  options: ResolvedContextOptions,
): SourceRangeCandidate[] {
  if (sourceLength <= 0) return []
  const count = Math.max(
    1,
    Math.min(
      options.maxSourceChunks,
      Math.ceil(
        Math.min(sourceLength, options.maxSourceTextUnits) / options.maxSourceChunkTextUnits,
      ),
    ),
  )
  const windowLength = Math.min(options.maxSourceChunkTextUnits, sourceLength)
  return Array.from({ length: count }, (_, index) => {
    const center = Math.round(((index + 0.5) * sourceLength) / count)
    const start = Math.max(
      0,
      Math.min(sourceLength - windowLength, center - Math.floor(windowLength / 2)),
    )
    return {
      range: { start, end: start + windowLength },
      reason: 'distributed-source',
    }
  })
}

export function buildSourceCoverage(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot | undefined,
  selections: readonly FrontendWorkshopResolvedSourceSelection[],
  writeScope: FrontendWorkshopSourceAiResolvedWriteScope,
  options: ResolvedContextOptions,
): FrontendWorkshopSourceAiSourceCoverage {
  const sourceLength = source.authorSource.length
  const fullSourceCapacity = options.maxSourceChunkTextUnits * options.maxSourceChunks
  if (sourceLength <= options.maxSourceTextUnits && sourceLength <= fullSourceCapacity) {
    const chunks: FrontendWorkshopSourceAiSourceChunk[] = []
    if (sourceLength === 0) {
      chunks.push({ range: { start: 0, end: 0 }, reasons: ['full-source'], text: '' })
    } else {
      for (
        let start = 0;
        start < sourceLength && chunks.length < options.maxSourceChunks;
        start += options.maxSourceChunkTextUnits
      ) {
        const end = Math.min(sourceLength, start + options.maxSourceChunkTextUnits)
        chunks.push({
          range: { start, end },
          reasons: ['full-source'],
          text: source.authorSource.slice(start, end),
        })
      }
    }
    return {
      sourceLength,
      complete: true,
      coveredTextUnits: sourceLength,
      omittedTextUnits: 0,
      chunks,
    }
  }

  const candidates: SourceRangeCandidate[] = []
  for (const selection of selections) {
    if (!selection.sourceRange || !validRange(selection.sourceRange, sourceLength)) continue
    candidates.push({
      range: windowAroundRange(
        selection.sourceRange,
        options.selectionPadding,
        options.maxSourceChunkTextUnits,
        sourceLength,
      ),
      reason: 'selected-source',
    })
  }
  for (const range of writeScope.allowedRanges) {
    candidates.push({
      range: windowAroundRange(
        range,
        options.selectionPadding,
        options.maxSourceChunkTextUnits,
        sourceLength,
      ),
      reason: 'write-scope',
    })
  }
  for (const selection of selections) {
    candidates.push(...relatedCandidates(source, analysis, selection, options))
  }
  candidates.push(...distributedCandidates(sourceLength, options))

  const chunks: Array<{ range: FrontendWorkshopSourceRange; reasons: string[]; text: string }> = []
  const covered: FrontendWorkshopSourceRange[] = []
  let remaining = options.maxSourceTextUnits
  for (const candidate of candidates) {
    if (remaining <= 0 || chunks.length >= options.maxSourceChunks) break
    for (const piece of subtractCovered(candidate.range, covered)) {
      if (remaining <= 0 || chunks.length >= options.maxSourceChunks) break
      const end = Math.min(
        piece.end,
        piece.start + options.maxSourceChunkTextUnits,
        piece.start + remaining,
      )
      if (end <= piece.start) continue
      const range = { start: piece.start, end }
      chunks.push({
        range,
        reasons: [candidate.reason],
        text: source.authorSource.slice(range.start, range.end),
      })
      covered.push(range)
      remaining -= range.end - range.start
    }
  }

  chunks.sort((left, right) => left.range.start - right.range.start)
  const coveredTextUnits = mergeRanges(chunks.map((chunk) => chunk.range)).reduce(
    (total, range) => total + range.end - range.start,
    0,
  )
  return {
    sourceLength,
    complete: coveredTextUnits === sourceLength,
    coveredTextUnits,
    omittedTextUnits: Math.max(0, sourceLength - coveredTextUnits),
    chunks: chunks.map((chunk) => ({
      range: { ...chunk.range },
      reasons: [...chunk.reasons],
      text: chunk.text,
    })),
  }
}

export function normalizeWriteScope(
  source: FrontendWorkshopSourceDocument,
  request: FrontendWorkshopSourceAiWriteScopeRequest | undefined,
): FrontendWorkshopSourceAiResolvedWriteScope {
  const scope = request ?? { kind: 'read-only' as const }
  if (scope.kind === 'read-only') {
    return {
      kind: 'read-only' as const,
      projectId: source.projectId,
      sourceRevision: source.revision,
      sourceCreatedAt: source.createdAt,
      offsetUnit: FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT,
      allowedRanges: [] as FrontendWorkshopSourceRange[],
      maxEdits: 0,
      application: 'proposal-only',
    }
  }

  const allowedRanges =
    scope.kind === 'whole-source'
      ? [{ start: 0, end: source.authorSource.length }]
      : mergeRanges(scope.ranges.map((range) => requireRange(range, source.authorSource.length)))
  if (allowedRanges.length === 0) throw new Error('AI Context writable ranges 不能为空')
  return {
    kind: scope.kind,
    projectId: source.projectId,
    sourceRevision: source.revision,
    sourceCreatedAt: source.createdAt,
    offsetUnit: FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT,
    allowedRanges,
    maxEdits: FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS,
    application:
      'proposal-only; application must rebuild current-revision exact static provenance and revalidate expectedText through Patch / History / CAS',
  }
}

export function selectionSummary(selection: FrontendWorkshopResolvedSourceSelection) {
  return {
    tagName: selection.tagName,
    ...(selection.elementId ? { elementId: selection.elementId } : {}),
    mappingConfidence: selection.mappingConfidence,
    provenanceKind: selection.provenanceKind,
    ...(selection.sourceRange ? { sourceRange: { ...selection.sourceRange } } : {}),
    ...(selection.sourceEntityId ? { sourceEntityId: selection.sourceEntityId } : {}),
    ...(selection.sourceCandidateEntityId
      ? { sourceCandidateEntityId: selection.sourceCandidateEntityId }
      : {}),
  }
}
