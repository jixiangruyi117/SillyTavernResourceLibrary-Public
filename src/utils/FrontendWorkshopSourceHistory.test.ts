import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { analyzeFrontendWorkshopSource } from './FrontendWorkshopSourceAnalysis'
import {
  applyFrontendWorkshopSourcePatch,
  prepareFrontendWorkshopSourcePatch,
  type FrontendWorkshopSourcePatch,
} from './FrontendWorkshopSourcePatch'
import {
  countFrontendWorkshopSourceHistoryTextUnits,
  createFrontendWorkshopSourceHistoryPatch,
} from './FrontendWorkshopSourceHistory'

function sourceDocument(authorSource: string, revision: number) {
  const source = createFrontendWorkshopSourceDocument('project-history', authorSource, 100)
  source.revision = revision
  return source
}

function exactTarget(source: ReturnType<typeof sourceDocument>, raw: string) {
  const entity = analyzeFrontendWorkshopSource(source).sourceMap.entities.find(
    (candidate) =>
      candidate.semanticKind === 'css.value' &&
      candidate.provenance.kind === 'static-source' &&
      source.authorSource.slice(
        candidate.provenance.anchor.range.start,
        candidate.provenance.anchor.range.end,
      ) === raw,
  )
  if (!entity) throw new Error(`missing css.value ${raw}`)
  return entity
}

function forwardPatch(source: ReturnType<typeof sourceDocument>): FrontendWorkshopSourcePatch {
  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    edits: [
      { target: exactTarget(source, '10px'), expectedText: '10px', replacement: '123.5px' },
      { target: exactTarget(source, '20px'), expectedText: '20px', replacement: '0px' },
    ],
  }
}

describe('FrontendWorkshopSourceHistory', () => {
  it('records before/after ranges in their respective Source states even when lengths change', () => {
    const before = sourceDocument('<div style="left:10px;top:20px;color:red"></div>', 1)
    const prepared = prepareFrontendWorkshopSourcePatch(before, forwardPatch(before))

    expect(prepared.authorSource).toBe('<div style="left:123.5px;top:0px;color:red"></div>')
    expect(prepared.changes).toHaveLength(2)
    for (const change of prepared.changes) {
      expect(before.authorSource.slice(change.beforeRange.start, change.beforeRange.end)).toBe(
        change.beforeText,
      )
      expect(prepared.authorSource.slice(change.afterRange.start, change.afterRange.end)).toBe(
        change.afterText,
      )
    }
    expect(prepared.changes[1]!.afterRange.start).not.toBe(prepared.changes[1]!.beforeRange.start)
  })

  it('re-anchors the same change-set for monotonic-revision Undo then Redo', () => {
    const before = sourceDocument('<div style="left:10px;top:20px"></div>', 1)
    const prepared = prepareFrontendWorkshopSourcePatch(before, forwardPatch(before))
    const afterForward = sourceDocument(prepared.authorSource, 2)

    const undoPatch = createFrontendWorkshopSourceHistoryPatch(
      afterForward,
      prepared.changes,
      'undo',
    )
    expect(undoPatch.sourceRevision).toBe(2)
    const undoneText = applyFrontendWorkshopSourcePatch(afterForward, undoPatch)
    expect(undoneText).toBe(before.authorSource)

    const afterUndo = sourceDocument(undoneText, 3)
    const redoPatch = createFrontendWorkshopSourceHistoryPatch(afterUndo, prepared.changes, 'redo')
    expect(redoPatch.sourceRevision).toBe(3)
    expect(applyFrontendWorkshopSourcePatch(afterUndo, redoPatch)).toBe(prepared.authorSource)
  })

  it('keeps expected-text protection when history is re-anchored onto a changed Source', () => {
    const before = sourceDocument('<div style="left:10px;top:20px"></div>', 1)
    const prepared = prepareFrontendWorkshopSourcePatch(before, forwardPatch(before))
    const corrupted = sourceDocument(prepared.authorSource.replace('123.5px', '999px'), 2)
    const undoPatch = createFrontendWorkshopSourceHistoryPatch(corrupted, prepared.changes, 'undo')

    expect(() => applyFrontendWorkshopSourcePatch(corrupted, undoPatch)).toThrow(/expectedText/u)
  })

  it('counts only reversible before/after text toward the bounded history budget', () => {
    const before = sourceDocument('<div style="left:10px;top:20px"></div>', 1)
    const changes = prepareFrontendWorkshopSourcePatch(before, forwardPatch(before)).changes

    expect(countFrontendWorkshopSourceHistoryTextUnits(changes)).toBe(
      changes.reduce((sum, change) => sum + change.beforeText.length + change.afterText.length, 0),
    )
  })
})
