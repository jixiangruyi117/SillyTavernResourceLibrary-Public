import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  resolveFrontendWorkshopExactSourceWriteRange,
  type FrontendWorkshopExactSourceWriteRange,
  type FrontendWorkshopExactSourceWriteTarget,
} from './FrontendWorkshopSourceWriteback'

export const FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS = 64

export interface FrontendWorkshopSourcePatchEdit {
  target: FrontendWorkshopExactSourceWriteTarget
  expectedText: string
  replacement: string
}

export interface FrontendWorkshopSourcePatch {
  projectId: string
  sourceRevision: number
  edits: readonly FrontendWorkshopSourcePatchEdit[]
}

export interface FrontendWorkshopSourcePatchChange {
  beforeRange: FrontendWorkshopExactSourceWriteRange
  beforeText: string
  afterRange: FrontendWorkshopExactSourceWriteRange
  afterText: string
}

export interface FrontendWorkshopPreparedSourcePatch {
  authorSource: string
  changes: readonly FrontendWorkshopSourcePatchChange[]
}

interface ResolvedPatchEdit {
  index: number
  range: FrontendWorkshopExactSourceWriteRange
  expectedText: string
  replacement: string
}

function assertPatchIdentity(
  source: Pick<FrontendWorkshopSourceDocument, 'projectId' | 'revision'>,
  patch: FrontendWorkshopSourcePatch,
): void {
  if (!patch.projectId || patch.projectId !== source.projectId) {
    throw new Error('Source Patch projectId 不匹配')
  }
  if (!Number.isInteger(patch.sourceRevision) || patch.sourceRevision < 1) {
    throw new Error('Source Patch sourceRevision 必须是正整数')
  }
  if (patch.sourceRevision !== source.revision) {
    throw new Error('Source Patch revision 已失效')
  }
}

function resolvePatchEdits(
  source: Pick<FrontendWorkshopSourceDocument, 'projectId' | 'revision' | 'authorSource'>,
  patch: FrontendWorkshopSourcePatch,
): ResolvedPatchEdit[] {
  if (!Array.isArray(patch.edits) || patch.edits.length < 1) {
    throw new Error('Source Patch 至少需要一个 edit')
  }
  if (patch.edits.length > FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS) {
    throw new Error(`Source Patch 单次最多 ${FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS} 个 edits`)
  }

  const resolved = patch.edits.map((edit, index) => {
    if (typeof edit.expectedText !== 'string') {
      throw new Error(`Source Patch edit ${index} expectedText 必须是字符串`)
    }
    if (typeof edit.replacement !== 'string') {
      throw new Error(`Source Patch edit ${index} replacement 必须是字符串`)
    }
    const range = resolveFrontendWorkshopExactSourceWriteRange(source, edit.target)
    if (source.authorSource.slice(range.start, range.end) !== edit.expectedText) {
      throw new Error(`Source Patch edit ${index} expectedText 已失效`)
    }
    return {
      index,
      range,
      expectedText: edit.expectedText,
      replacement: edit.replacement,
    }
  })

  resolved.sort(
    (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
  )
  for (let index = 1; index < resolved.length; index += 1) {
    const previous = resolved[index - 1]!
    const current = resolved[index]!
    if (current.range.start < previous.range.end || current.range.start === previous.range.start) {
      throw new Error(`Source Patch edits 重叠或重复：${previous.index} 与 ${current.index}`)
    }
  }
  return resolved
}

/**
 * Validate and prepare one bounded Source Patch together with reversible range/text evidence.
 * `changes` are ordered left-to-right. `afterRange` refers to the resulting Author Source after all
 * edits have been applied, including cumulative length deltas from earlier edits.
 */
export function prepareFrontendWorkshopSourcePatch(
  source: Pick<FrontendWorkshopSourceDocument, 'projectId' | 'revision' | 'authorSource'>,
  patch: FrontendWorkshopSourcePatch,
): FrontendWorkshopPreparedSourcePatch {
  assertPatchIdentity(source, patch)
  const edits = resolvePatchEdits(source, patch)
  let cumulativeDelta = 0
  const changes = edits.map((edit): FrontendWorkshopSourcePatchChange => {
    const afterStart = edit.range.start + cumulativeDelta
    const afterEnd = afterStart + edit.replacement.length
    cumulativeDelta += edit.replacement.length - (edit.range.end - edit.range.start)
    return {
      beforeRange: { ...edit.range },
      beforeText: edit.expectedText,
      afterRange: { start: afterStart, end: afterEnd },
      afterText: edit.replacement,
    }
  })

  let authorSource = source.authorSource
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]!
    authorSource =
      authorSource.slice(0, edit.range.start) +
      edit.replacement +
      authorSource.slice(edit.range.end)
  }
  return { authorSource, changes }
}

/**
 * S5 bounded multi-range Patch primitive.
 *
 * Every edit is validated against the same current Source revision and its expected raw text before
 * any output is produced. The result is assembled from right to left so replacement length changes
 * never shift unresolved ranges. This function is pure: persistence, revision CAS, history and Undo
 * remain separate owners.
 */
export function applyFrontendWorkshopSourcePatch(
  source: Pick<FrontendWorkshopSourceDocument, 'projectId' | 'revision' | 'authorSource'>,
  patch: FrontendWorkshopSourcePatch,
): string {
  return prepareFrontendWorkshopSourcePatch(source, patch).authorSource
}
