/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  parseTavernHelperFrontendEnvelope,
  serializeTavernHelperFrontendEnvelope,
  TavernHelperFrontendEnvelopeSerializationError,
} from './FrontendWorkshopTavernFrontendEnvelope'

describe('FrontendWorkshop TavernHelper frontend envelope adapter', () => {
  it('does not reinterpret raw HTML as a TavernHelper message iframe envelope', () => {
    expect(parseTavernHelperFrontendEnvelope('<body><main>raw source</main></body>')).toMatchObject(
      { kind: 'none', blocks: [] },
    )
  })

  it('reuses ST Markdown + TH formatted-PRE detection for CRLF, fence length and language case', () => {
    const message =
      '````HTML\r\n<body><main>匿名界面</main><script>const ticks = "```"; window.value = ticks</script></body>\r\n````'
    const parsed = parseTavernHelperFrontendEnvelope(message)

    expect(parsed.kind).toBe('single')
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]?.source).toContain('<main>匿名界面</main>')
    expect(parsed.blocks[0]?.source).toContain('const ticks = "```"')
    expect(parsed.blocks[0]?.officialBodyEnvelope).toBe(true)
  })

  it('supports tilde fences because the real host consumes rendered PRE rather than raw backticks', () => {
    const parsed = parseTavernHelperFrontendEnvelope(
      '~~~~html\n<body><main>tilde frontend</main></body>\n~~~~',
    )

    expect(parsed.kind).toBe('single')
    expect(parsed.blocks[0]?.source).toContain('tilde frontend')
  })

  it('supports indented Markdown code because TavernHelper scans every rendered PRE', () => {
    const parsed = parseTavernHelperFrontendEnvelope(
      '    <body>\n      <main>indented frontend</main>\n    </body>',
    )

    expect(parsed.kind).toBe('single')
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]?.source).toContain('<main>indented frontend</main>')
  })

  it('does not use the language label as the frontend execution switch', () => {
    expect(
      parseTavernHelperFrontendEnvelope('```css\n<body><main>still frontend</main></body>\n```'),
    ).toMatchObject({ kind: 'single' })
    expect(
      parseTavernHelperFrontendEnvelope('```html\n<div>displayed source only</div>\n```'),
    ).toMatchObject({ kind: 'none', blocks: [] })
  })

  it('preserves mixed prose and requires the caller to choose the frontend payload', () => {
    const parsed = parseTavernHelperFrontendEnvelope(
      '开场正文。\n\n```html\n<body><main>界面</main></body>\n```\n\n后续正文。',
    )

    expect(parsed.kind).toBe('mixed')
    expect(parsed.hasNonFrontendContent).toBe(true)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]?.source).toContain('<main>界面</main>')
  })

  it('keeps multiple TH frontend blocks distinct instead of concatenating them', () => {
    const parsed = parseTavernHelperFrontendEnvelope(
      '```\n<body><main>A</main></body>\n```\n\n```html\n<html><body><main>B</main></body></html>\n```',
    )

    expect(parsed.kind).toBe('multiple')
    expect(parsed.blocks).toHaveLength(2)
    expect(parsed.blocks[0]?.source).toContain('<main>A</main>')
    expect(parsed.blocks[1]?.source).toContain('<main>B</main>')
  })

  it('does not claim a non-html code block is a frontend', () => {
    expect(parseTavernHelperFrontendEnvelope('```json\n{"value":1}\n```')).toMatchObject({
      kind: 'none',
      blocks: [],
    })
  })

  it('marks only a leading fence-shaped host-marker input as a malformed transport envelope', () => {
    const parsed = parseTavernHelperFrontendEnvelope('```html <body><main>broken</main></body>')
    expect(parsed.kind).toBe('malformed')
    expect(parsed.blocks).toEqual([])

    expect(
      parseTavernHelperFrontendEnvelope(
        '<body><script>\nconst sample = `\n```html <body>text</body>\n`;\n</script></body>',
      ),
    ).not.toMatchObject({ kind: 'malformed' })
  })

  it('serializes a pure fragment with a transport-only closed body without trimming creative source', () => {
    const source = '  <main>保留空格</main>\n<script>window.x = "雪"</script>  '
    const serialized = serializeTavernHelperFrontendEnvelope(source)

    expect(serialized.wrappedBody).toBe(true)
    expect(serialized.payload).toBe(`<body>${source}</body>`)
    expect(serialized.envelope).toContain(`<body>${source}</body>`)
  })

  it('does not rewrite an author-owned complete body envelope', () => {
    const source =
      '<body data-mode="author">\n<style>main{display:grid}</style>\n<main>正文</main>\n</body>'
    const serialized = serializeTavernHelperFrontendEnvelope(source)

    expect(serialized.wrappedBody).toBe(false)
    expect(serialized.payload).toBe(source)
  })

  it('fails closed for document-like html/head source without a body instead of changing DOM semantics', () => {
    expect(() =>
      serializeTavernHelperFrontendEnvelope(
        '<html><head><style>main{display:grid}</style></head></html>',
      ),
    ).toThrow(TavernHelperFrontendEnvelopeSerializationError)
  })

  it('fails closed when author HTML casing would not match the current TH case-sensitive marker predicate', () => {
    expect(() =>
      serializeTavernHelperFrontendEnvelope('<BODY><main>uppercase body only</main></BODY>'),
    ).toThrow(TavernHelperFrontendEnvelopeSerializationError)
  })

  it('uses a longer Markdown fence when author source itself contains backtick runs', () => {
    const source = '<body><script>const sample = "`````"</script></body>'
    const serialized = serializeTavernHelperFrontendEnvelope(source)

    expect(serialized.fence.length).toBe(6)
    expect(serialized.envelope.startsWith('``````html\n')).toBe(true)
  })

  it('round-trips the exact TH-executed payload for HTML, CSS, JS, Unicode and multiline source', () => {
    const originalEnvelope =
      '```html\n<body>\n<style>.card::before{content:"雪"}</style>\n<div class="card">你好</div>\n<script>window.message = `多行\\n文本`</script>\n</body>\n```'
    const firstParse = parseTavernHelperFrontendEnvelope(originalEnvelope)

    expect(firstParse.kind).toBe('single')
    const authorSource = firstParse.blocks[0]?.source ?? ''
    expect(authorSource).toContain('.card::before{content:"雪"}')
    expect(authorSource).toContain('window.message = `多行\\n文本`')

    const serialized = serializeTavernHelperFrontendEnvelope(authorSource)
    expect(serialized.payload).toBe(authorSource)
    const secondParse = parseTavernHelperFrontendEnvelope(serialized.envelope)
    expect(secondParse.kind).toBe('single')
    expect(secondParse.blocks[0]?.source).toBe(authorSource)
  })

  it('fails closed on an unpaired body instead of silently repairing author markup', () => {
    expect(() => serializeTavernHelperFrontendEnvelope('<body><main>broken</main>')).toThrow(
      TavernHelperFrontendEnvelopeSerializationError,
    )
  })
})
