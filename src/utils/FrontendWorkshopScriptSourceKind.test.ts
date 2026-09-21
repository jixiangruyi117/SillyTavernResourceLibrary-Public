import { describe, expect, it } from 'vitest'

import { segmentFrontendWorkshopAuthorSource } from './FrontendWorkshopSourceHtmlSegmentation'
import { shouldAnalyzeFrontendWorkshopScriptAsJavaScript } from './FrontendWorkshopScriptSourceKind'

function classify(source: string): boolean[] {
  const segmentation = segmentFrontendWorkshopAuthorSource(source)
  return segmentation.segments
    .filter((segment) => segment.semanticKind === 'html.script-content')
    .map((segment) =>
      shouldAnalyzeFrontendWorkshopScriptAsJavaScript(source, segmentation, segment.range),
    )
}

describe('FrontendWorkshopScriptSourceKind', () => {
  it('accepts classic, module, and explicit JavaScript MIME script bodies', () => {
    const source = [
      '<script>querySelector(".classic")</script>',
      '<script type="">querySelector(".empty")</script>',
      '<script type="module">querySelector(".module")</script>',
      '<script type="TEXT/JAVASCRIPT; charset=utf-8">querySelector(".mime")</script>',
      '<script type="application/javascript">querySelector(".application")</script>',
    ].join('')

    expect(classify(source)).toEqual([true, true, true, true, true])
  })

  it('does not treat JSON, import maps, speculation rules, or unknown script types as JavaScript', () => {
    const source = [
      '<script type="application/json">{"fake":"querySelector(\\".json\\")"}</script>',
      '<script type="importmap">{"imports":{}}</script>',
      '<script type="speculationrules">{"prefetch":[]}</script>',
      '<script type="text/x-custom">querySelector(".custom")</script>',
    ].join('')

    expect(classify(source)).toEqual([false, false, false, false])
  })

  it('falls back to no semantic guess for duplicate or entity-encoded type evidence', () => {
    expect(
      classify('<script type="text/javascript" type="module">querySelector(".dup")</script>'),
    ).toEqual([false])
    expect(
      classify('<script type="text&#47;javascript">querySelector(".encoded")</script>'),
    ).toEqual([false])
  })
})
