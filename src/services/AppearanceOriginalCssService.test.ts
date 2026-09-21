/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import type { AppearanceScope } from '../core/AppearanceScopes'
import type { InstalledOfficialApp, OfficialAppId } from '../types/OfficialApp'
import { readOriginalCss, type OriginalCssReader } from './AppearanceOriginalCssService'

const shell = '/assets/shell-a1.css'
const drawCss = '/assets/draw-b1.css'
const stitchCss = '/assets/stitch-c1.css'
const drawScope: AppearanceScope = {
  value: 'draw',
  title: '抽了么',
  selector: '.draw-stage',
  hint: '',
  appId: 'draw',
}
function installed(id: OfficialAppId, path: string): InstalledOfficialApp {
  return {
    schemaVersion: 1,
    id,
    shellVersion: 'test-build',
    entry: `/assets/${id}.js`,
    installedAt: 1,
    styles: [shell, path],
    files: [
      { path: shell, bundled: true, size: 10, sha256: 'a'.repeat(64) },
      { path, bundled: false, size: 10, sha256: 'b'.repeat(64) },
    ],
  }
}
function reader(html: string, files: Record<string, string>): OriginalCssReader {
  const doc = document.implementation.createHTMLDocument('official CSS')
  doc.head.innerHTML = html
  return {
    document: doc,
    origin: 'https://srl.test',
    shellVersion: 'test-build',
    apps: [installed('draw', drawCss), installed('stitch', stitchCss)],
    readAsset: vi.fn(async (url: string) => {
      const css = files[new URL(url).pathname]
      if (css === undefined) throw new Error('CSS 文件读取失败')
      return css
    }),
  }
}

describe('original appearance CSS', () => {
  it('keeps all rules and conditions without user CSS', async () => {
    const css = [
      ...Array.from({ length: 20 }, (_, index) => `.rule-${index} { color: red; }`),
      '@media (max-width: 48rem) { @supports (display: grid) { .small { display: grid; } } }',
      '@container page (min-width: 20rem) { .inside { color: blue; } }',
      '@layer theme { :root { --brand: green; } }',
      '@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }',
      `/* ${'x'.repeat(250_000)} */`,
      '.last-rule { color: green; }',
    ].join('\n')
    const source = reader(
      `<link rel="stylesheet" href="${shell}">
       <style id="srl-custom-ui-style">.user-only { color: pink; }</style>
       <style data-custom-css>.also-user { color: pink; }</style>
       <style>.extension-only { color: pink; }</style>
       <link rel="stylesheet" href="https://other.test/theme.css">`,
      { [shell]: css },
    )
    localStorage.setItem('css-test-user-preset', 'unchanged')
    const original = (await readOriginalCss(undefined, undefined, source)).parts.join('')
    expect(original).toContain(css)
    expect(original).toContain('.rule-19')
    expect(original).not.toMatch(/user-only|also-user|extension-only/u)
    expect(source.readAsset).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('css-test-user-preset')).toBe('unchanged')
    localStorage.removeItem('css-test-user-preset')
  })

  it('reads an unopened APP with shared styles, not other APPs', async () => {
    const source = reader(
      `<link rel="stylesheet" href="${shell}"><link rel="stylesheet" href="${stitchCss}">`,
      { [shell]: ':root { --base: 1; }', [drawCss]: '.draw-new { display: grid; }' },
    )
    const css = (await readOriginalCss(drawScope, undefined, source)).parts.join('')
    expect(css).toContain('--base: 1')
    expect(css).toContain('.draw-new')
    expect(source.readAsset).toHaveBeenCalledTimes(2)
    expect(source.readAsset).not.toHaveBeenCalledWith(expect.stringContaining('stitch'), undefined)
  })

  it('reads the updated installation manifest without stale CSS', async () => {
    const source = reader(`<link rel="stylesheet" href="${shell}">`, {
      [shell]: ':root { --base: 1; }',
      [drawCss]: '.old-version {}',
      '/assets/draw-b2.css': '.new-version {}',
    })
    expect((await readOriginalCss(drawScope, undefined, source)).parts.join('')).toContain(
      '.old-version',
    )
    source.apps[0] = installed('draw', '/assets/draw-b2.css')
    const css = (await readOriginalCss(drawScope, undefined, source)).parts.join('')
    expect(css).toContain('.new-version')
    expect(css).not.toContain('.old-version')
  })

  it('preserves media conditions and deduplicates loaded APP styles', async () => {
    const source = reader(
      `<link rel="stylesheet" href="${shell}" media="(max-width: 48rem)">
       <link rel="stylesheet" href="${drawCss}">`,
      { [shell]: '.small { color: red; }', [drawCss]: '.draw-only {}' },
    )
    const css = (await readOriginalCss(drawScope, undefined, source)).parts.join('')
    expect(css).toContain('@media (max-width: 48rem) {\n.small { color: red; }\n}')
    expect(css.match(/\.draw-only/gu)).toHaveLength(1)
    expect(source.readAsset).toHaveBeenCalledTimes(2)
  })

  it('includes lazy host styles without opening the host page', async () => {
    const source = reader('', {})
    const css = '@media (max-width: 48rem) { .external-app-manager { display: grid; } }'
    source.readExtraCss = vi.fn(async () => css)
    const scope: AppearanceScope = {
      value: 'app:extensions',
      title: '扩展',
      selector: '.external-app-manager',
      hint: '',
      appId: 'extensions',
    }
    const original = (await readOriginalCss(scope, undefined, source)).parts.join('')
    expect(original).toContain(css)
    expect(source.readExtraCss).toHaveBeenCalledTimes(1)
    expect(source.readAsset).not.toHaveBeenCalled()
  })

  it('reads official Vite style text without using CSSOM rule sampling', async () => {
    const source = reader(
      '<style data-vite-dev-id="/src/Styles.css">@media (max-width: 48rem) { .new-rule {} }</style>',
      {},
    )
    const css = (await readOriginalCss(undefined, undefined, source)).parts.join('')
    expect(css).toContain('@media (max-width: 48rem) { .new-rule {} }')
    expect(source.readAsset).not.toHaveBeenCalled()
  })

  it('rejects empty and missing sources without requiring an installed APP', async () => {
    await expect(readOriginalCss(undefined, undefined, reader('', {}))).rejects.toThrow('空文件')
    await expect(
      readOriginalCss(drawScope, undefined, reader(`<link rel="stylesheet" href="${shell}">`, {})),
    ).rejects.toThrow('读取失败')
    const source = reader('', {})
    source.apps = []
    source.document.head.innerHTML = `<link rel="stylesheet" href="${shell}">`
    source.readAsset = vi.fn(async () => ':root { --bundled: 1; }')
    const bundled = await readOriginalCss(drawScope, undefined, source)
    expect(bundled.parts.join('')).toContain('--bundled: 1')
  })

  it('rejects an APP from a different shell version', async () => {
    const source = reader('', {})
    source.apps[0]!.shellVersion = 'older-build'
    await expect(readOriginalCss(drawScope, undefined, source)).rejects.toThrow('不同版本')
    expect(source.readAsset).not.toHaveBeenCalled()
  })

  it('rejects undeclared or off-origin CSS assets without fetching them', async () => {
    const source = reader('', {})
    source.apps[0]!.styles = ['/assets/not-listed.css']
    await expect(readOriginalCss(drawScope, undefined, source)).rejects.toThrow('清单不完整')
    source.apps[0] = installed('draw', 'https://other.test/assets/theme.css')
    await expect(readOriginalCss(drawScope, undefined, source)).rejects.toThrow('来源无效')
    expect(source.readAsset).not.toHaveBeenCalled()
  })

  it('cancels an in-flight read without returning a partial file', async () => {
    const controller = new AbortController()
    const source = reader(`<link rel="stylesheet" href="${shell}">`, {})
    source.readAsset = async () => {
      controller.abort()
      return '.partial {}'
    }
    await expect(readOriginalCss(undefined, controller.signal, source)).rejects.toThrow('已取消')
  })
})
