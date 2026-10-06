/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPreviewFontStylesheet } from './PreviewFontStylesheet'

afterEach(() => {
  vi.unstubAllGlobals()
  document.head.replaceChildren()
})

describe('isolated preview fonts', () => {
  it('stores a repeated font once while preserving every face and its original bytes', async () => {
    const font = btoa('same-font-bytes')
    const data = `data:font/woff2;base64,${font}`
    const css = `@font-face{font-family:A;src:url(${data})}@font-face{font-family:B;src:url(${data})}`
    const blobs: Blob[] = []
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob)
        return 'blob:isolated-font'
      },
    })
    const result = buildPreviewFontStylesheet(css)
    expect(result.split(font)).toHaveLength(2)
    const script = new DOMParser().parseFromString(result, 'text/html').scripts[0]!.textContent!
    new Function(script)()
    expect(blobs).toHaveLength(1)
    expect(blobs[0]!.size).toBe('same-font-bytes'.length)
    expect(document.head.querySelector('style')!.textContent).toBe(
      css.replaceAll(data, 'blob:isolated-font'),
    )
  })

  it('does not introduce a script for a stylesheet without embedded fonts', () => {
    expect(buildPreviewFontStylesheet('.fa{color:red}')).toBe('<style>.fa{color:red}</style>')
    expect(buildPreviewFontStylesheet(undefined)).toBe('')
  })

  it('keeps closing script tags inside the CSS string', () => {
    const result = buildPreviewFontStylesheet(
      '/* </script><script>bad() */a{src:url(data:font/woff2;base64,QQ==)}',
    )
    expect(result.match(/<script>/gu)).toHaveLength(1)
    expect(result.match(/<\/script>/gu)).toHaveLength(1)
  })
})
