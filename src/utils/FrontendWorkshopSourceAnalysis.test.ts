import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  analyzeFrontendWorkshopSource,
  createFrontendWorkshopRuntimeDynamicProvenance,
  createFrontendWorkshopSourceAnchor,
  FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT,
  isFrontendWorkshopSourceRevisionCurrent,
} from './FrontendWorkshopSourceAnalysis'

const rawSource = [
  '  <odd-profile-widget data-x="1">',
  '<style>.x{position:fixed;top:7px}</style>',
  '<button onclick="window.__clicked=true">go</button>',
  "<script>customElements.define('odd-profile-widget',class extends HTMLElement{})</script>",
  "<script>document.querySelector('odd-profile-widget')?.attachShadow({mode:'open'})</script>",
  '</odd-profile-widget>  ',
].join('\r\n')

function sourceDocument(authorSource = rawSource) {
  return createFrontendWorkshopSourceDocument('project-source-analysis', authorSource, 100)
}

describe('FrontendWorkshopSourceAnalysis', () => {
  it('preserves unsupported Author Source as an explicit unknown island', () => {
    const unknownSource = '<?srl-template payload?>'
    const source = sourceDocument(unknownSource)
    const before = structuredClone(source)

    const analysis = analyzeFrontendWorkshopSource(source)

    expect(source).toEqual(before)
    expect(source.authorSource).toBe(unknownSource)
    expect(analysis.projectId).toBe(source.projectId)
    expect(analysis.sourceRevision).toBe(source.revision)
    expect(analysis.sourceMap.entities).toEqual([])
    expect(analysis.editGraph.nodes).toEqual([])
    expect(analysis.editGraph.edges).toEqual([])
    expect(analysis.sourceMap.unknownIslands).toHaveLength(1)
    const island = analysis.sourceMap.unknownIslands[0]!
    expect(island.reason).toBe('unsupported-processing-instruction')
    expect(island.provenance.kind).toBe('static-source')
    expect(island.provenance.anchor.range).toEqual({ start: 0, end: unknownSource.length })
    expect(
      unknownSource.slice(island.provenance.anchor.range.start, island.provenance.anchor.range.end),
    ).toBe(unknownSource)
  })

  it('uses UTF-16 half-open ranges without normalizing CRLF or non-BMP characters', () => {
    const source = sourceDocument('A😀B\r\nC')
    const emoji = createFrontendWorkshopSourceAnchor(source, { start: 1, end: 3 })
    const whole = analyzeFrontendWorkshopSource(source).sourceMap
    const text = whole.entities.find((entity) => entity.semanticKind === 'html.text')

    expect(emoji.offsetUnit).toBe(FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT)
    expect(source.authorSource.slice(emoji.range.start, emoji.range.end)).toBe('😀')
    expect(whole.sourceLength).toBe(source.authorSource.length)
    expect(whole.unknownIslands).toEqual([])
    expect(text?.provenance.kind).toBe('static-source')
    if (text?.provenance.kind !== 'static-source')
      throw new Error('expected static text provenance')
    expect(text.provenance.anchor.range).toEqual({ start: 0, end: source.authorSource.length })
    expect(
      source.authorSource.slice(
        text.provenance.anchor.range.start,
        text.provenance.anchor.range.end,
      ),
    ).toBe(source.authorSource)
  })

  it('rejects ranges that are not valid for the current Source revision text', () => {
    const source = sourceDocument('abc')

    expect(() => createFrontendWorkshopSourceAnchor(source, { start: -1, end: 1 })).toThrow()
    expect(() => createFrontendWorkshopSourceAnchor(source, { start: 2, end: 1 })).toThrow()
    expect(() => createFrontendWorkshopSourceAnchor(source, { start: 0.5, end: 1 })).toThrow()
    expect(() => createFrontendWorkshopSourceAnchor(source, { start: 0, end: 4 })).toThrow()
  })

  it('marks analysis from another project or Source revision as stale', () => {
    const source = sourceDocument()
    const analysis = analyzeFrontendWorkshopSource(source)
    const nextRevision = { ...source, revision: source.revision + 1 }
    const otherProject = { ...source, projectId: 'other-project' }

    expect(isFrontendWorkshopSourceRevisionCurrent(analysis, source)).toBe(true)
    expect(isFrontendWorkshopSourceRevisionCurrent(analysis, nextRevision)).toBe(false)
    expect(isFrontendWorkshopSourceRevisionCurrent(analysis, otherProject)).toBe(false)
  })

  it('does not fabricate a static Source range for runtime-created DOM provenance', () => {
    const source = sourceDocument()
    const provenance = createFrontendWorkshopRuntimeDynamicProvenance(source, 'instance-a')

    expect(provenance).toEqual({
      kind: 'runtime-dynamic',
      projectId: source.projectId,
      sourceRevision: source.revision,
      runtimeInstanceId: 'instance-a',
    })
    expect(provenance).not.toHaveProperty('anchor')
    expect(provenance).not.toHaveProperty('range')
  })

  it('does not invent unknown islands for an empty Source document', () => {
    const analysis = analyzeFrontendWorkshopSource(sourceDocument(''))

    expect(analysis.sourceMap.sourceLength).toBe(0)
    expect(analysis.sourceMap.unknownIslands).toEqual([])
  })
})
