import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopStaticSourceProvenance } from './FrontendWorkshopSourceAnalysis'
import type {
  FrontendWorkshopSourcePatch,
  FrontendWorkshopSourcePatchChange,
} from './FrontendWorkshopSourcePatch'

export type FrontendWorkshopSourceHistoryDirection = 'undo' | 'redo'

export function countFrontendWorkshopSourceHistoryTextUnits(
  changes: readonly FrontendWorkshopSourcePatchChange[],
): number {
  return changes.reduce(
    (total, change) => total + change.beforeText.length + change.afterText.length,
    0,
  )
}

/**
 * Re-anchor a previously proven Patch change-set onto the current Source revision.
 *
 * This does not infer provenance from Runtime DOM. The ranges come directly from a successful Source
 * Patch transaction. `expectedText` is rechecked by the normal Patch contract before persistence, so
 * stale or externally changed history cannot silently overwrite current Author Source.
 */
export function createFrontendWorkshopSourceHistoryPatch(
  source: Pick<FrontendWorkshopSourceDocument, 'projectId' | 'revision' | 'authorSource'>,
  changes: readonly FrontendWorkshopSourcePatchChange[],
  direction: FrontendWorkshopSourceHistoryDirection,
): FrontendWorkshopSourcePatch {
  if (changes.length < 1) throw new Error('Source History 缺少可逆 changes')

  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    edits: changes.map((change) => {
      const range = direction === 'undo' ? change.afterRange : change.beforeRange
      const expectedText = direction === 'undo' ? change.afterText : change.beforeText
      const replacement = direction === 'undo' ? change.beforeText : change.afterText
      return {
        target: {
          confidence: 'exact',
          provenance: createFrontendWorkshopStaticSourceProvenance(source, range),
        },
        expectedText,
        replacement,
      }
    }),
  }
}
