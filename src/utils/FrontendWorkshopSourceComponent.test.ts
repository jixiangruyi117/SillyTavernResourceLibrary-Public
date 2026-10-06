import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopResolvedSourceSelection } from './FrontendWorkshopSourceSelection'
import {
  createFrontendWorkshopSourceComponentPreviewDocument,
  createFrontendWorkshopSourceComponentInsertionPatch,
  extractFrontendWorkshopSourceComponentHtml,
  renderFrontendWorkshopSourceComponentFragment,
} from './FrontendWorkshopSourceComponent'

function exactSelection(
  projectId: string,
  sourceRevision: number,
  range: { start: number; end: number },
): FrontendWorkshopResolvedSourceSelection {
  return {
    projectId,
    sourceRevision,
    instanceId: 'instance-1',
    runtimeNonce: 'nonce-1',
    runtimeNodeId: 'runtime-node-1',
    tagName: 'div',
    treeScope: 'document',
    mappingConfidence: 'exact',
    provenanceKind: 'static-source',
    sourceRange: range,
  }
}

describe('FrontendWorkshopSourceComponent new-only model', () => {
  it('projects one component revision into the existing Source Runtime without a second source owner', () => {
    const component = createFrontendWorkshopSourceComponent(
      {
        name: '预览卡片',
        source: {
          html: '<article><img src="https://cdn.example.com/avatar.png"></article>',
          css: 'article { color: teal; }',
          javascript: 'document.body.dataset.ready = "true"',
        },
        root: { tagName: 'article' },
        dependencies: [
          {
            kind: 'external-resource',
            specifier: 'https://cdn.example.com/avatar.png',
          },
        ],
        preview: { viewportWidth: 375, colorScheme: 'dark' },
        provenance: { origin: 'manual' },
      },
      'component-preview',
      20,
    )
    component.revision = 4
    component.updatedAt = 40

    const preview = createFrontendWorkshopSourceComponentPreviewDocument(component)

    expect(preview).toMatchObject({
      projectId: 'source-component-preview-component-preview',
      revision: 4,
      createdAt: 20,
      updatedAt: 40,
    })
    expect(preview.authorSource).toContain(':root{color-scheme:dark;}')
    expect(preview.authorSource).toContain(
      '<article><img src="https://cdn.example.com/avatar.png"></article>',
    )
    expect(preview.authorSource).toContain('article { color: teal; }')
    expect(preview.authorSource).toContain('document.body.dataset.ready = "true"')
    expect(preview.authorSource).not.toContain('srl-source-component-assets:')
  })

  it('extracts the exact raw outer HTML including same-tag nesting', () => {
    const authorSource = '<main>\n<div id="card"> A <div>inner</div> Z </div>\n</main>'
    const source = createFrontendWorkshopSourceDocument('project-1', authorSource, 1)
    const start = authorSource.indexOf('<div id="card">')
    const end = start + '<div id="card">'.length

    expect(
      extractFrontendWorkshopSourceComponentHtml(
        source,
        exactSelection(source.projectId, source.revision, { start, end }),
      ),
    ).toEqual({
      html: '<div id="card"> A <div>inner</div> Z </div>',
      range: { start, end: authorSource.lastIndexOf('</div>') + '</div>'.length },
      tagName: 'div',
    })
  })

  it('preserves a void element without searching for an end tag', () => {
    const authorSource = '<section><img src="https://cdn.example.com/x.png"></section>'
    const source = createFrontendWorkshopSourceDocument('project-1', authorSource, 1)
    const start = authorSource.indexOf('<img')
    const end = authorSource.indexOf('>', start) + 1

    expect(
      extractFrontendWorkshopSourceComponentHtml(
        source,
        exactSelection(source.projectId, source.revision, { start, end }),
      ).html,
    ).toBe('<img src="https://cdn.example.com/x.png">')
  })

  it('fails closed for stale or malformed selections', () => {
    const source = createFrontendWorkshopSourceDocument('project-1', '<div>broken', 1)

    expect(() =>
      extractFrontendWorkshopSourceComponentHtml(
        source,
        exactSelection('another-project', source.revision, { start: 0, end: 5 }),
      ),
    ).toThrow('当前 revision')
    expect(() =>
      extractFrontendWorkshopSourceComponentHtml(
        source,
        exactSelection(source.projectId, source.revision, { start: 0, end: 5 }),
      ),
    ).toThrow('没有可证明的闭合标签')
  })

  it('builds an exact insertion patch before body without rewriting surrounding source', () => {
    const source = createFrontendWorkshopSourceDocument(
      'project-1',
      '<!doctype html><body><p>keep</p></body>',
      1,
    )
    const component = createFrontendWorkshopSourceComponent(
      {
        name: '状态卡',
        source: {
          html: '<article class="status-card">ok</article>',
          css: '.status-card { color: red; }',
          javascript: 'document.currentScript?.previousElementSibling?.setAttribute("ready", "")',
        },
        root: { tagName: 'article', selector: '.status-card' },
        provenance: { origin: 'manual' },
      },
      'component-1',
      2,
    )

    const patch = createFrontendWorkshopSourceComponentInsertionPatch(source, component)

    expect(patch.projectId).toBe(source.projectId)
    expect(patch.sourceRevision).toBe(source.revision)
    expect(patch.edits).toHaveLength(1)
    expect(patch.edits[0]?.expectedText).toBe('')
    expect(patch.edits[0]?.replacement).toContain('<article class="status-card">ok</article>')
    expect(patch.edits[0]?.replacement).not.toContain('srl-source-component-assets:')
    expect(patch.edits[0]?.target.provenance).toMatchObject({
      kind: 'static-source',
      anchor: {
        range: {
          start: source.authorSource.indexOf('</body>'),
          end: source.authorSource.indexOf('</body>'),
        },
      },
    })
  })

  it('refuses an unsafe raw closing tag instead of changing stored component source', () => {
    const component = createFrontendWorkshopSourceComponent(
      {
        name: '危险片段',
        source: { html: '<div></div>', css: '/* </style> */', javascript: '' },
        root: { tagName: 'div' },
        provenance: { origin: 'manual' },
      },
      'component-unsafe',
      2,
    )

    expect(() => renderFrontendWorkshopSourceComponentFragment(component)).toThrow('</style>')
    expect(component.source.css).toBe('/* </style> */')
  })
})
