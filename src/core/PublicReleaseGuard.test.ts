import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function runtimeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return runtimeFiles(file)
    if (!/\.(?:ts|vue|js)$/u.test(entry.name) || /\.(?:test|spec)\./u.test(entry.name)) return []
    return [file]
  })
}

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('public release boundary', () => {
  it('contains no removed author-service or formal bridge endpoints in runtime/config code', () => {
    const source = [
      ...runtimeFiles(join(process.cwd(), 'src')),
      join(process.cwd(), 'vite.config.ts'),
      join(process.cwd(), 'package.json'),
    ]
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    const forbidden = [
      ['/api', 'auth'].join('/'),
      ['/api', 'admin'].join('/'),
      ['/api', 'feedback'].join('/'),
      ['/api', 'image-hosting'].join('/'),
      ['/api', 'app-update'].join('/'),
      ['Auth', 'Service'].join(''),
      ['Auth', 'Portal'].join(''),
      ['Admin', 'Console'].join(''),
      ['Feedback', 'Service'].join(''),
      ['is', 'LocalOnlyBuild'].join(''),
      ['api', 'bridge', 'join'].join('/'),
      ['Component', 'Share', 'Service'].join(''),
      ['FrontendWorkshop', 'Legacy'].join(''),
      ['LegacyWorkshop', 'DraftStorage'].join(''),
    ]
    for (const needle of forbidden) expect(source).not.toContain(needle)
  })

  it('starts directly without an auth session or access-policy gate', () => {
    const root = read('src/RootApp.vue')
    const main = read('src/Main.ts')
    for (const needle of ['AuthSession', 'accessPolicy', 'userSession', '/api/']) {
      expect(root).not.toContain(needle)
      expect(main).not.toContain(needle)
    }
  })

  it('keeps rich previews script-capable without same-origin privilege', () => {
    const richPreview = read('src/components/RichContentPreview.vue')
    const sourceRuntime = read('src/utils/FrontendWorkshopSourceRuntime.ts')
    expect(richPreview).toContain('sandbox="allow-scripts"')
    expect(richPreview).not.toContain('allow-same-origin')
    expect(sourceRuntime).toContain('allow-scripts')
    expect(sourceRuntime).not.toContain('allow-same-origin')
  })

  it('routes frontend workshop through the current source/workbench shell', () => {
    const entry = read('src/components/FrontendWorkshopApp.vue')
    expect(entry).toContain('FrontendWorkshopSourceAiShell')
    expect(entry).not.toContain('UseFrontendWorkshopApp')
    expect(entry).not.toContain('StatusPlaceHolder')
    expect(entry).not.toContain('状态栏校样')
  })
})
