/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import viewportContract from '../../fixtures/render-compatibility-viewport-contract.json'
import {
  findRenderCompatibilityFrontendBlocks,
  mapRenderCompatibilityViewportMinimums,
} from './RenderCompatibilityFrontend'

describe('Render Compatibility formatted DOM frontend detection', () => {
  it('detects only actual formatted pre DOM content', () => {
    const result = findRenderCompatibilityFrontendBlocks(
      '<p>正文里出现 &lt;body&gt; 不算。</p><pre><code>&lt;html&gt;&lt;body&gt;ok&lt;/body&gt;&lt;/html&gt;</code></pre>',
    )

    expect(result.blocks).toEqual(['<html><body>ok</body></html>'])
    expect(result.html).toContain('data-srl-render-frontend="true"')
    expect(result.html).toContain('class="TH-render"')
  })

  it('does not infer frontend from a language label or generic markup', () => {
    const result = findRenderCompatibilityFrontendBlocks(
      '<pre><code class="language-html">&lt;div&gt;example&lt;/div&gt;</code></pre><section><body-copy>text</body-copy></section>',
    )

    expect(result.blocks).toEqual([])
    expect(result.html).not.toContain('data-srl-render-frontend')
  })

  it.each(viewportContract.cases)('$name', ({ input, expected }) => {
    expect(mapRenderCompatibilityViewportMinimums(input)).toBe(expected)
  })
})
