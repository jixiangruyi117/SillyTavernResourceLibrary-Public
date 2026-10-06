import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { analyzeFrontendWorkshopSource } from './FrontendWorkshopSourceAnalysis'
import type { FrontendWorkshopResolvedSourceSelection } from './FrontendWorkshopSourceSelection'
import {
  formatFrontendWorkshopSourceTransformValue,
  resolveFrontendWorkshopSourceTransformTargets,
} from './FrontendWorkshopSourceTransform'
import { applyFrontendWorkshopExactSourceWriteback } from './FrontendWorkshopSourceWriteback'

function sourceDocument(authorSource: string, revision = 1) {
  const source = createFrontendWorkshopSourceDocument('project-transform', authorSource, 100)
  source.revision = revision
  return source
}

function exactSelection(authorSource: string) {
  const source = sourceDocument(authorSource)
  const analysis = analyzeFrontendWorkshopSource(source)
  const startTag = analysis.sourceMap.entities.find(
    (entity) =>
      entity.semanticKind === 'html.start-tag' &&
      entity.provenance.kind === 'static-source' &&
      source.authorSource
        .slice(entity.provenance.anchor.range.start, entity.provenance.anchor.range.end)
        .includes('id="hero"'),
  )
  if (!startTag || startTag.provenance.kind !== 'static-source')
    throw new Error('missing start tag')
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
  return { source, analysis, selection }
}

describe('FrontendWorkshopSourceTransform', () => {
  it('不会把静态定位的 left/top 暴露为可移动能力', () => {
    const { source, analysis, selection } = exactSelection(
      '<div id="hero" style="left:10px;top:20px;width:100px"></div>',
    )
    const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)
    expect(targets.fields.x).toBeUndefined()
    expect(targets.fields.y).toBeUndefined()
    expect(targets.fields.width?.value).toBe(100)
  })

  it('resolves only exact simple inline transform declarations and preserves their numeric values', () => {
    const { source, analysis, selection } = exactSelection(
      '<div id="hero" style="position:relative;left : 10px ; top:20.5px; width:100px; height: 50px; transform: rotate(-15deg); color:red"></div>',
    )

    const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)

    expect(targets.fields.x?.value).toBe(10)
    expect(targets.fields.y?.value).toBe(20.5)
    expect(targets.fields.width?.value).toBe(100)
    expect(targets.fields.height?.value).toBe(50)
    expect(targets.fields.rotation?.value).toBe(-15)
    expect(targets.fields.rotation?.cssProperty).toBe('transform')
    expect(targets.inlineStyleTarget?.provenance.kind).toBe('static-source')
  })

  it('writes one proven declaration value without reformatting surrounding inline CSS', () => {
    const raw =
      '<div id="hero" style="position:relative;left : 10px ; top:20px; width:100px; color : rgb(1, 2, 3) ;"></div>'
    const { source, analysis, selection } = exactSelection(raw)
    const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)
    const x = targets.fields.x
    if (!x) throw new Error('missing x target')

    const replacement = formatFrontendWorkshopSourceTransformValue(x, 42.25)
    const next = applyFrontendWorkshopExactSourceWriteback(source, x.target, replacement)

    expect(next).toBe(
      '<div id="hero" style="position:relative;left : 42.25px ; top:20px; width:100px; color : rgb(1, 2, 3) ;"></div>',
    )
  })

  it('keeps stylesheet rules outside the selected element non-writable', () => {
    const raw = '<style>#hero{left:10px;top:20px}</style><div id="hero"></div>'
    const { source, analysis, selection } = exactSelection(raw)

    const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)

    expect(targets.inlineStyleTarget).toBeUndefined()
    expect(targets.fields).toEqual({})
  })

  it('rejects duplicate style attributes instead of choosing one ambiguous owner', () => {
    const raw =
      '<div id="hero" style="position:relative;left:10px" style="position:relative;left:20px"></div>'
    const { source, analysis, selection } = exactSelection(raw)

    const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)

    expect(targets.inlineStyleTarget).toBeUndefined()
    expect(targets.fields).toEqual({})
  })

  it('rejects duplicate, computed, important and compound transform declarations', () => {
    const raw = [
      '<div id="hero" style="',
      'left:10px;left:20px;',
      'top:var(--y);',
      'width:calc(100% - 2px);',
      'height:40px !important;',
      'transform:translateX(2px) rotate(10deg)',
      '"></div>',
    ].join('')
    const { source, analysis, selection } = exactSelection(raw)

    const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)

    expect(targets.inlineStyleTarget).toBeDefined()
    expect(targets.fields.x).toBeUndefined()
    expect(targets.fields.y).toBeUndefined()
    expect(targets.fields.width).toBeUndefined()
    expect(targets.fields.height).toBeUndefined()
    expect(targets.fields.rotation).toBeUndefined()
  })

  it('does not expose writable transform targets for inferred or runtime-only selections', () => {
    const { source, analysis, selection } = exactSelection(
      '<div id="hero" style="position:relative;left:10px;top:20px"></div>',
    )

    expect(
      resolveFrontendWorkshopSourceTransformTargets(source, analysis, {
        ...selection,
        mappingConfidence: 'inferred',
        provenanceKind: 'runtime-observed',
      }).fields,
    ).toEqual({})
    expect(
      resolveFrontendWorkshopSourceTransformTargets(source, analysis, {
        ...selection,
        mappingConfidence: 'partial',
        provenanceKind: 'runtime-dynamic',
        sourceEntityId: undefined,
      }).fields,
    ).toEqual({})
  })

  it('rejects stale selection entities after the Source revision changes', () => {
    const first = exactSelection('<div id="hero" style="position:relative;left:10px"></div>')
    const current = sourceDocument(first.source.authorSource, 2)
    const currentAnalysis = analyzeFrontendWorkshopSource(current)

    const targets = resolveFrontendWorkshopSourceTransformTargets(
      current,
      currentAnalysis,
      first.selection,
    )

    expect(targets.fields).toEqual({})
    expect(targets.inlineStyleTarget).toBeUndefined()
  })

  it('formats rotation narrowly and rejects non-finite transform values', () => {
    const { source, analysis, selection } = exactSelection(
      '<div id="hero" style="transform:rotate(10deg)"></div>',
    )
    const rotation = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)
      .fields.rotation
    if (!rotation) throw new Error('missing rotation target')

    expect(formatFrontendWorkshopSourceTransformValue(rotation, -0)).toBe('rotate(0deg)')
    expect(formatFrontendWorkshopSourceTransformValue(rotation, 33.5)).toBe('rotate(33.5deg)')
    expect(() => formatFrontendWorkshopSourceTransformValue(rotation, Number.NaN)).toThrow(
      /有限数字/u,
    )
  })
})
