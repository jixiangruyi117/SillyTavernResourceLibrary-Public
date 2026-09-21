import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  analyzeFrontendWorkshopSource,
  type FrontendWorkshopSourceAnalysisSnapshot,
  type FrontendWorkshopSourceMapEntity,
} from './FrontendWorkshopSourceAnalysis'

function analyze(authorSource: string): FrontendWorkshopSourceAnalysisSnapshot {
  return analyzeFrontendWorkshopSource(
    createFrontendWorkshopSourceDocument('project-source-relations', authorSource, 100),
  )
}

function sourceSlice(authorSource: string, entity: FrontendWorkshopSourceMapEntity): string {
  if (entity.provenance.kind !== 'static-source') throw new Error('expected static Source entity')
  const { start, end } = entity.provenance.anchor.range
  return authorSource.slice(start, end)
}

function slicesByKind(
  authorSource: string,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
  semanticKind: string,
): string[] {
  return analysis.sourceMap.entities
    .filter((entity) => entity.semanticKind === semanticKind)
    .map((entity) => sourceSlice(authorSource, entity))
}

describe('FrontendWorkshopSourceRelations', () => {
  it('maps CSS rules, declarations and static HTML/CSS asset references without rewriting Source', () => {
    const authorSource = [
      '<style>',
      '.card, .x:hover { background:url("./bg.png"); color:red }',
      '@font-face { src: url(font.woff2); }',
      '@import "theme.css";',
      '</style>',
      '<img src="/a.png" srcset="a.png 1x, b.png 2x" ',
      'style="background-image:url(\'inline.png\'); color: red">',
    ].join('')
    const before = authorSource

    const analysis = analyze(authorSource)

    expect(authorSource).toBe(before)
    expect(slicesByKind(authorSource, analysis, 'css.selector')).toContain('.card, .x:hover')
    expect(slicesByKind(authorSource, analysis, 'css.property')).toEqual(
      expect.arrayContaining(['background', 'color', 'src', 'background-image']),
    )
    expect(slicesByKind(authorSource, analysis, 'asset.url-reference')).toEqual(
      expect.arrayContaining(['./bg.png', 'font.woff2', 'theme.css', '/a.png', 'inline.png']),
    )
    expect(slicesByKind(authorSource, analysis, 'asset.url-reference-list')).toEqual([
      'a.png 1x, b.png 2x',
    ])
    expect(
      analysis.sourceMap.entities.find(
        (entity) => entity.semanticKind === 'asset.url-reference-list',
      )?.confidence,
    ).toBe('partial')
    expect(analysis.editGraph.edges.some((edge) => edge.relation === 'references-asset')).toBe(true)
    expect(analysis.editGraph.edges.some((edge) => edge.relation === 'contains-style-rule')).toBe(
      true,
    )
  })

  it('records only direct quoted JS selector/id literals and keeps semantic edges inferred', () => {
    const authorSource = [
      '<script>',
      'document.querySelector(".card");',
      "document.getElementById('hero');",
      'const fake = "querySelector(\'.nope\')";',
      'querySelector(dynamic);',
      '</script>',
      '<button onclick="this.closest(\'.row\')">x</button>',
    ].join('')

    const analysis = analyze(authorSource)

    expect(slicesByKind(authorSource, analysis, 'js.selector-literal')).toEqual(['.card', '.row'])
    expect(slicesByKind(authorSource, analysis, 'js.element-id-literal')).toEqual(['hero'])
    expect(slicesByKind(authorSource, analysis, 'js.selector-literal')).not.toContain('.nope')
    const jsEdges = analysis.editGraph.edges.filter(
      (edge) =>
        edge.relation === 'references-selector-literal' ||
        edge.relation === 'references-element-id-literal',
    )
    expect(jsEdges).toHaveLength(3)
    expect(jsEdges.every((edge) => edge.confidence === 'inferred')).toBe(true)
  })

  it('keeps data/unknown script bodies lexical without inventing JavaScript relations', () => {
    const authorSource = [
      '<script type="application/json">{"selector":"querySelector(\\".json\\")"}</script>',
      '<script type="importmap">{"imports":{"querySelector(\\".map\\")":"./x.js"}}</script>',
      '<script type="text/x-custom">querySelector(".custom")</script>',
      '<script type="module">querySelector(".module")</script>',
    ].join('')

    const analysis = analyze(authorSource)

    expect(slicesByKind(authorSource, analysis, 'html.script-content')).toHaveLength(4)
    expect(slicesByKind(authorSource, analysis, 'js.script-body')).toEqual([
      'querySelector(".module")',
    ])
    expect(slicesByKind(authorSource, analysis, 'js.selector-literal')).toEqual(['.module'])
  })

  it('stops semantic JS guessing at template/regex ambiguity instead of fabricating exact mappings', () => {
    const templateSource =
      '<script>const tpl = `querySelector(".fake")`; document.querySelector(".later")</script>'
    const regexSource =
      '<script>const pattern = /querySelector\\(".fake"\\)/; document.querySelector(".later")</script>'

    expect(slicesByKind(templateSource, analyze(templateSource), 'js.selector-literal')).toEqual([])
    expect(slicesByKind(regexSource, analyze(regexSource), 'js.selector-literal')).toEqual([])
  })

  it('keeps valid CSS prefix relations when a later block becomes unprovable', () => {
    const authorSource =
      '<style>.ok{color:red}.broken{background:url("x"</style><div data-x="1">ok</div>'

    const analysis = analyze(authorSource)

    expect(slicesByKind(authorSource, analysis, 'css.selector')).toEqual(['.ok'])
    expect(slicesByKind(authorSource, analysis, 'css.property')).toEqual(['color'])
    expect(slicesByKind(authorSource, analysis, 'asset.url-reference')).not.toContain('x')
    expect(slicesByKind(authorSource, analysis, 'html.start-tag')).toContain('<div data-x="1">')
  })

  it('builds the Edit Graph only from revision-anchored Source Map entities', () => {
    const authorSource = '<style>.x{background:url(a.png)}</style><img src="b.png">'
    const analysis = analyze(authorSource)
    const sourceMapIds = new Set(analysis.sourceMap.entities.map((entity) => entity.id))

    expect(analysis.editGraph.nodes.map((node) => node.id)).toEqual([...sourceMapIds])
    for (const edge of analysis.editGraph.edges) {
      expect(sourceMapIds.has(edge.fromId)).toBe(true)
      expect(sourceMapIds.has(edge.toId)).toBe(true)
    }
    expect(analysis.editGraph.nodes.every((node) => node.provenance.kind === 'static-source')).toBe(
      true,
    )
  })
})
