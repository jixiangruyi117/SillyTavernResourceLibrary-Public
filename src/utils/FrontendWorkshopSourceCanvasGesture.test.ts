import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { analyzeFrontendWorkshopSource } from './FrontendWorkshopSourceAnalysis'
import {
  createFrontendWorkshopSourceCanvasGesturePatch,
  FrontendWorkshopSourceCanvasGestureUnavailableError,
  getFrontendWorkshopSourceCanvasGestureCapabilities,
} from './FrontendWorkshopSourceCanvasGesture'
import { applyFrontendWorkshopSourcePatch } from './FrontendWorkshopSourcePatch'
import type { FrontendWorkshopResolvedSourceSelection } from './FrontendWorkshopSourceSelection'
import { resolveFrontendWorkshopSourceTransformTargets } from './FrontendWorkshopSourceTransform'

function exactHarness(authorSource: string) {
  const source = createFrontendWorkshopSourceDocument('project-source-gesture', authorSource, 100)
  const analysis = analyzeFrontendWorkshopSource(source)
  const startTag = analysis.sourceMap.entities.find(
    (entity) =>
      entity.semanticKind === 'html.start-tag' &&
      entity.provenance.kind === 'static-source' &&
      source.authorSource
        .slice(entity.provenance.anchor.range.start, entity.provenance.anchor.range.end)
        .includes('id="hero"'),
  )
  if (!startTag || startTag.provenance.kind !== 'static-source') {
    throw new Error('missing exact hero start tag')
  }
  const selection: FrontendWorkshopResolvedSourceSelection = {
    projectId: source.projectId,
    sourceRevision: source.revision,
    instanceId: 'instance-a',
    runtimeNonce: 'nonce-a',
    runtimeNodeId: 'runtime-node-1',
    tagName: 'div',
    elementId: 'hero',
    treeScope: 'document',
    mappingConfidence: 'exact',
    provenanceKind: 'static-source',
    sourceEntityId: startTag.id,
    sourceRange: { ...startTag.provenance.anchor.range },
  }
  const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)
  return { source, targets }
}

describe('FrontendWorkshopSourceCanvasGesture', () => {
  it('reports gesture capabilities only when every required exact Source field exists', () => {
    const complete = exactHarness(
      '<div id="hero" style="position:relative;left:10px;top:20px;width:100px;height:50px;transform:rotate(5deg)"></div>',
    )
    expect(getFrontendWorkshopSourceCanvasGestureCapabilities(complete.targets)).toEqual({
      move: true,
      resize: true,
      scale: true,
      rotate: true,
    })

    const partial = exactHarness(
      '<div id="hero" style="position:relative;left:10px;width:100px"></div>',
    )
    expect(getFrontendWorkshopSourceCanvasGestureCapabilities(partial.targets)).toEqual({
      move: false,
      resize: false,
      scale: false,
      rotate: false,
    })
  })

  it('turns one move gesture into one atomic left + top Patch while preserving surrounding Source', () => {
    const raw =
      '<div id="hero" style="position:relative;left : 10.5px ; top:20px; width:100px; height:50px; color:red"></div>'
    const { source, targets } = exactHarness(raw)
    const patch = createFrontendWorkshopSourceCanvasGesturePatch(source, targets, {
      mode: 'move',
      deltaX: 12.25,
      deltaY: -7.5,
    })
    if (!patch) throw new Error('missing move patch')

    expect(patch.edits).toHaveLength(2)
    expect(patch.edits.map((edit) => edit.expectedText)).toEqual(['10.5px', '20px'])
    expect(applyFrontendWorkshopSourcePatch(source, patch)).toBe(
      '<div id="hero" style="position:relative;left : 22.75px ; top:12.5px; width:100px; height:50px; color:red"></div>',
    )
  })

  it('turns resize and proportional scale gestures into bounded multi-range patches', () => {
    const raw = '<div id="hero" style="width:40.5px;height:20.25px"></div>'
    const { source, targets } = exactHarness(raw)

    const resize = createFrontendWorkshopSourceCanvasGesturePatch(source, targets, {
      mode: 'resize',
      deltaX: -35,
      deltaY: 10.5,
    })
    if (!resize) throw new Error('missing resize patch')
    expect(applyFrontendWorkshopSourcePatch(source, resize)).toBe(
      '<div id="hero" style="width:5.5px;height:30.75px"></div>',
    )

    const scale = createFrontendWorkshopSourceCanvasGesturePatch(source, targets, {
      mode: 'scale',
      handle: 'se',
      deltaX: 20,
      deltaY: 10,
    })
    if (!scale) throw new Error('missing scale patch')
    expect(scale.edits).toHaveLength(2)
    expect(applyFrontendWorkshopSourcePatch(source, scale)).not.toBe(raw)
  })

  it('uses the shared rotation math and commits rotation as one exact Source edit', () => {
    const { source, targets } = exactHarness(
      '<div id="hero" style="transform:rotate(10deg)"></div>',
    )
    const patch = createFrontendWorkshopSourceCanvasGesturePatch(source, targets, {
      mode: 'rotate',
      startAngle: 0,
      currentAngle: Math.PI / 2,
    })
    if (!patch) throw new Error('missing rotate patch')

    expect(patch.edits).toHaveLength(1)
    expect(applyFrontendWorkshopSourcePatch(source, patch)).toBe(
      '<div id="hero" style="transform:rotate(100deg)"></div>',
    )
  })

  it('returns no Patch for a no-op gesture and refuses to fabricate missing fields', () => {
    const complete = exactHarness(
      '<div id="hero" style="position:relative;left:10px;top:20px"></div>',
    )
    expect(
      createFrontendWorkshopSourceCanvasGesturePatch(complete.source, complete.targets, {
        mode: 'move',
        deltaX: 0,
        deltaY: 0,
      }),
    ).toBeUndefined()

    const missing = exactHarness('<div id="hero" style="position:relative;left:10px"></div>')
    expect(() =>
      createFrontendWorkshopSourceCanvasGesturePatch(missing.source, missing.targets, {
        mode: 'move',
        deltaX: 10,
        deltaY: 10,
      }),
    ).toThrow(FrontendWorkshopSourceCanvasGestureUnavailableError)
  })
})
