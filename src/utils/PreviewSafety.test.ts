import { describe, expect, it } from 'vitest'

import {
  extractPreviewCss,
  prepareStaticMarkupPreview,
  sanitizeCssForPreview,
  stripCodeFence,
} from './PreviewSafety'

describe('PreviewSafety', () => {
  it('removes Markdown and style wrappers from CSS beautification files', () => {
    const source = '```css\n<style>#chat .mes { color: #fff; }</style>\n```'

    expect(stripCodeFence(source)).toContain('<style>')
    expect(extractPreviewCss(source)).toBe('#chat .mes { color: #fff; }')
  })

  it('removes standalone fence markers inside mixed rich openings', () => {
    const source =
      '<section class="status">status</section>\n```\nFOG opening text\n```\n<p>tail</p>\ninline ``` stays'
    const cleaned = stripCodeFence(source)

    expect(cleaned).toContain('<section class="status">status</section>')
    expect(cleaned).toContain('FOG opening text')
    expect(cleaned).toContain('<p>tail</p>')
    expect(cleaned).toContain('inline ``` stays')
    expect(cleaned).not.toMatch(/^\s*```(?:html|css|xml|svg)?\s*$/im)
  })

  it('blocks external and dangerous CSS features', () => {
    const css = sanitizeCssForPreview(
      '@import url("https://example.com/a.css"); .card { background:url(x); behavior:url(x) }',
    )

    expect(css).not.toContain('https://')
    expect(css).not.toContain('background:url')
    expect(css).toContain('已阻止')
  })

  it('can temporarily keep remote styles, images and fonts without restoring dangerous CSS', () => {
    const css = extractPreviewCss(
      '@import url("https://example.com/theme.css"); .card { background:url("https://example.com/bg.webp"); behavior:url(x) }',
      { allowExternalResources: true },
    )

    expect(css).toContain('https://example.com/theme.css')
    expect(css).toContain('https://example.com/bg.webp')
    expect(css).not.toContain('behavior:url')
  })

  it('keeps static HTML and CSS while removing executable content', () => {
    const preview = prepareStaticMarkupPreview(`
      \`\`\`html
      <html><head><style>.card { color: red }</style></head>
      <body><div class="card" onclick="steal()">状态卡</div><script>steal()</script></body></html>
      \`\`\`
    `)

    expect(preview.hasStaticContent).toBe(true)
    expect(preview.blockedScripts).toBe(true)
    expect(preview.css).toContain('.card')
    expect(preview.markup).toContain('状态卡')
    expect(preview.markup).not.toContain('onclick')
    expect(preview.markup).not.toContain('<script')
  })

  it('keeps remote images but still removes event scripts when globally allowed', () => {
    const preview = prepareStaticMarkupPreview(
      '<img src="https://example.com/a.png" onerror="steal()"><script>steal()</script>',
      { allowExternalResources: true },
    )

    expect(preview.markup).toContain('https://example.com/a.png')
    expect(preview.markup).not.toContain('onerror')
    expect(preview.markup).not.toContain('<script')
  })

  it('does not claim a script-only replacement has a safe static preview', () => {
    const preview = prepareStaticMarkupPreview('<body><script>loadRemotePage()</script></body>')

    expect(preview.hasStaticContent).toBe(false)
    expect(preview.blockedScripts).toBe(true)
  })
})
