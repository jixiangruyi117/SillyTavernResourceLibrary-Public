import { describe, expect, it } from 'vitest'

import { segmentFrontendWorkshopAuthorSource } from './FrontendWorkshopSourceHtmlSegmentation'

function slicesFor(
  source: string,
  semanticKind: string,
  segmentation = segmentFrontendWorkshopAuthorSource(source),
): string[] {
  return segmentation.segments
    .filter((segment) => segment.semanticKind === semanticKind)
    .map((segment) => source.slice(segment.range.start, segment.range.end))
}

describe('FrontendWorkshopSourceHtmlSegmentation', () => {
  it('maps custom elements, attributes, inline handlers, style and script ranges without whitelists', () => {
    const source = [
      '<!doctype html>',
      '<odd-card data-x="1" onclick="go()">',
      '<style>.x{position:fixed;top:7px}</style>',
      `<script>const tpl='<fake-node data-z="2">';customElements.define('odd-card',class extends HTMLElement{})</script>`,
      '</odd-card>',
    ].join('\r\n')

    const segmentation = segmentFrontendWorkshopAuthorSource(source)

    expect(segmentation.unknownSlices).toEqual([])
    expect(slicesFor(source, 'html.start-tag', segmentation)).toEqual([
      '<odd-card data-x="1" onclick="go()">',
      '<style>',
      '<script>',
    ])
    expect(slicesFor(source, 'html.attribute-name', segmentation)).toEqual(['data-x', 'onclick'])
    expect(slicesFor(source, 'html.attribute-value', segmentation)).toEqual(['1', 'go()'])
    expect(slicesFor(source, 'html.style-content', segmentation)).toEqual([
      '.x{position:fixed;top:7px}',
    ])
    expect(slicesFor(source, 'html.script-content', segmentation)).toEqual([
      `const tpl='<fake-node data-z="2">';customElements.define('odd-card',class extends HTMLElement{})`,
    ])
    expect(slicesFor(source, 'html.start-tag', segmentation)).not.toContain(
      '<fake-node data-z="2">',
    )
    expect(slicesFor(source, 'html.end-tag', segmentation)).toEqual([
      '</style>',
      '</script>',
      '</odd-card>',
    ])
  })

  it('keeps unsupported islands while continuing to map later valid Source', () => {
    const source = '<div data-a="1">before</div><?srl x?><span>after</span>'

    const segmentation = segmentFrontendWorkshopAuthorSource(source)

    expect(segmentation.unknownSlices).toHaveLength(1)
    const unknown = segmentation.unknownSlices[0]!
    expect(unknown.reason).toBe('unsupported-processing-instruction')
    expect(source.slice(unknown.range.start, unknown.range.end)).toBe('<?srl x?>')
    expect(slicesFor(source, 'html.start-tag', segmentation)).toEqual([
      '<div data-a="1">',
      '<span>',
    ])
    expect(slicesFor(source, 'html.text', segmentation)).toEqual(['before', 'after'])
  })

  it('stops only at an unterminated tag and preserves the recognized prefix', () => {
    const source = 'before<div data-x="oops'

    const segmentation = segmentFrontendWorkshopAuthorSource(source)

    expect(slicesFor(source, 'html.text', segmentation)).toEqual(['before'])
    expect(segmentation.unknownSlices).toHaveLength(1)
    const unknown = segmentation.unknownSlices[0]!
    expect(unknown.reason).toBe('unterminated-start-tag')
    expect(source.slice(unknown.range.start, unknown.range.end)).toBe('<div data-x="oops')
  })

  it('recognizes doctype and comments while keeping a literal less-than sign as text', () => {
    const source = '<!DOCTYPE html><!--x-->2 < 3'

    const segmentation = segmentFrontendWorkshopAuthorSource(source)

    expect(segmentation.unknownSlices).toEqual([])
    expect(slicesFor(source, 'html.doctype', segmentation)).toEqual(['<!DOCTYPE html>'])
    expect(slicesFor(source, 'html.comment', segmentation)).toEqual(['<!--x-->'])
    expect(slicesFor(source, 'html.text', segmentation)).toEqual(['2 < 3'])
  })

  it('does not invent nested markup inside RCDATA content', () => {
    const source = '<textarea><b>not markup</b></textarea>'

    const segmentation = segmentFrontendWorkshopAuthorSource(source)

    expect(segmentation.unknownSlices).toEqual([])
    expect(slicesFor(source, 'html.start-tag', segmentation)).toEqual(['<textarea>'])
    expect(slicesFor(source, 'html.rcdata-content', segmentation)).toEqual(['<b>not markup</b>'])
    expect(slicesFor(source, 'html.end-tag', segmentation)).toEqual(['</textarea>'])
  })
})
