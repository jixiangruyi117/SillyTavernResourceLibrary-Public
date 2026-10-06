import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  analyzeFrontendWorkshopSource,
  createFrontendWorkshopRuntimeDynamicProvenance,
  type FrontendWorkshopSourceMapEntity,
} from './FrontendWorkshopSourceAnalysis'
import {
  applyFrontendWorkshopSourcePatch,
  FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS,
  type FrontendWorkshopSourcePatch,
} from './FrontendWorkshopSourcePatch'

function sourceDocument(authorSource: string, revision = 1) {
  const source = createFrontendWorkshopSourceDocument('project-patch', authorSource, 100)
  source.revision = revision
  return source
}

function exactEntityByRaw(
  source: ReturnType<typeof sourceDocument>,
  semanticKind: string,
  raw: string,
): FrontendWorkshopSourceMapEntity {
  const analysis = analyzeFrontendWorkshopSource(source)
  const entity = analysis.sourceMap.entities.find(
    (candidate) =>
      candidate.semanticKind === semanticKind &&
      candidate.provenance.kind === 'static-source' &&
      source.authorSource.slice(
        candidate.provenance.anchor.range.start,
        candidate.provenance.anchor.range.end,
      ) === raw,
  )
  if (!entity) throw new Error(`missing ${semanticKind}: ${raw}`)
  return entity
}

describe('FrontendWorkshopSourcePatch', () => {
  it('applies multiple exact ranges atomically from right to left without shifting later offsets', () => {
    const source = sourceDocument(
      '<div id="hero" style="left:10px;top:20px;color:red"> keep </div>',
    )
    const before = source.authorSource
    const left = exactEntityByRaw(source, 'css.value', '10px')
    const top = exactEntityByRaw(source, 'css.value', '20px')

    const next = applyFrontendWorkshopSourcePatch(source, {
      projectId: source.projectId,
      sourceRevision: source.revision,
      edits: [
        { target: left, expectedText: '10px', replacement: '123.5px' },
        { target: top, expectedText: '20px', replacement: '0px' },
      ],
    })

    expect(source.authorSource).toBe(before)
    expect(next).toBe('<div id="hero" style="left:123.5px;top:0px;color:red"> keep </div>')
  })

  it('rejects overlapping or duplicate exact ranges before producing a Patch result', () => {
    const source = sourceDocument('<div id="hero" style="left:10px"></div>')
    const startTag = exactEntityByRaw(source, 'html.start-tag', '<div id="hero" style="left:10px">')
    const attribute = exactEntityByRaw(source, 'html.attribute', 'id="hero"')
    const left = exactEntityByRaw(source, 'css.value', '10px')

    expect(() =>
      applyFrontendWorkshopSourcePatch(source, {
        projectId: source.projectId,
        sourceRevision: source.revision,
        edits: [
          {
            target: startTag,
            expectedText: '<div id="hero" style="left:10px">',
            replacement: '<section id="hero" style="left:10px">',
          },
          { target: attribute, expectedText: 'id="hero"', replacement: 'id="next"' },
        ],
      }),
    ).toThrow(/重叠|重复/u)

    expect(() =>
      applyFrontendWorkshopSourcePatch(source, {
        projectId: source.projectId,
        sourceRevision: source.revision,
        edits: [
          { target: left, expectedText: '10px', replacement: '11px' },
          { target: left, expectedText: '10px', replacement: '12px' },
        ],
      }),
    ).toThrow(/重叠|重复/u)
    expect(source.authorSource).toBe('<div id="hero" style="left:10px"></div>')
  })

  it('rejects an edit whose expected raw text no longer matches its proven range', () => {
    const source = sourceDocument('<div style="left:10px;top:20px"></div>')
    const left = exactEntityByRaw(source, 'css.value', '10px')
    const top = exactEntityByRaw(source, 'css.value', '20px')

    expect(() =>
      applyFrontendWorkshopSourcePatch(source, {
        projectId: source.projectId,
        sourceRevision: source.revision,
        edits: [
          { target: left, expectedText: '10px', replacement: '11px' },
          { target: top, expectedText: '999px', replacement: '21px' },
        ],
      }),
    ).toThrow(/expectedText/u)
    expect(source.authorSource).toBe('<div style="left:10px;top:20px"></div>')
  })

  it('rejects stale, inferred, runtime-only and mismatched Patch identity', () => {
    const first = sourceDocument('<div id="hero" style="left:10px"></div>', 1)
    const current = sourceDocument(first.authorSource, 2)
    const left = exactEntityByRaw(first, 'css.value', '10px')

    expect(() =>
      applyFrontendWorkshopSourcePatch(current, {
        projectId: current.projectId,
        sourceRevision: 1,
        edits: [{ target: left, expectedText: '10px', replacement: '20px' }],
      }),
    ).toThrow(/revision/u)

    expect(() =>
      applyFrontendWorkshopSourcePatch(first, {
        projectId: 'project-other',
        sourceRevision: first.revision,
        edits: [{ target: left, expectedText: '10px', replacement: '20px' }],
      }),
    ).toThrow(/projectId/u)

    expect(() =>
      applyFrontendWorkshopSourcePatch(first, {
        projectId: first.projectId,
        sourceRevision: first.revision,
        edits: [
          {
            target: { ...left, confidence: 'inferred' },
            expectedText: '10px',
            replacement: '20px',
          },
        ],
      }),
    ).toThrow(/exact/u)

    expect(() =>
      applyFrontendWorkshopSourcePatch(first, {
        projectId: first.projectId,
        sourceRevision: first.revision,
        edits: [
          {
            target: {
              confidence: 'exact',
              provenance: createFrontendWorkshopRuntimeDynamicProvenance(
                { projectId: first.projectId, revision: first.revision },
                'instance-a',
              ),
            },
            expectedText: '10px',
            replacement: '20px',
          },
        ],
      }),
    ).toThrow(/static-source/u)
  })

  it('enforces a non-empty bounded edit list and string preconditions/replacements', () => {
    const source = sourceDocument('<div style="left:10px"></div>')
    const left = exactEntityByRaw(source, 'css.value', '10px')

    expect(() =>
      applyFrontendWorkshopSourcePatch(source, {
        projectId: source.projectId,
        sourceRevision: source.revision,
        edits: [],
      }),
    ).toThrow(/至少/u)

    const tooMany = Array.from({ length: FRONTEND_WORKSHOP_SOURCE_PATCH_MAX_EDITS + 1 }, () => ({
      target: left,
      expectedText: '10px',
      replacement: '11px',
    }))
    expect(() =>
      applyFrontendWorkshopSourcePatch(source, {
        projectId: source.projectId,
        sourceRevision: source.revision,
        edits: tooMany,
      }),
    ).toThrow(/最多/u)

    const invalidExpectedText = {
      projectId: source.projectId,
      sourceRevision: source.revision,
      edits: [{ target: left, expectedText: 42 as unknown as string, replacement: '11px' }],
    } satisfies FrontendWorkshopSourcePatch
    expect(() => applyFrontendWorkshopSourcePatch(source, invalidExpectedText)).toThrow(
      /expectedText/u,
    )

    const invalidReplacement = {
      projectId: source.projectId,
      sourceRevision: source.revision,
      edits: [{ target: left, expectedText: '10px', replacement: 42 as unknown as string }],
    } satisfies FrontendWorkshopSourcePatch
    expect(() => applyFrontendWorkshopSourcePatch(source, invalidReplacement)).toThrow(
      /replacement/u,
    )
  })
})
