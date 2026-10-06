import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopSourceRuntimeInstance } from '../utils/FrontendWorkshopSourceRuntime'
import {
  classifyFrontendWorkshopBrowserSourceProject,
  createFrontendWorkshopBrowserSourceProjectFromFiles,
  FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_FILE_BYTES,
  FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_FILES,
  FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_TOTAL_BYTES,
  FrontendWorkshopBrowserSourceCompileError,
  FrontendWorkshopBrowserSourceCompilerService,
  type FrontendWorkshopBrowserBuildEngine,
  type FrontendWorkshopBrowserSourceProject,
} from './FrontendWorkshopBrowserSourceCompilerService'
import { diagnoseFrontendWorkshopSourceCompatibility } from './FrontendWorkshopSourceCompatibilityDiagnosticsService'

function report(name: string, source: string) {
  return diagnoseFrontendWorkshopSourceCompatibility(
    createFrontendWorkshopSourceDocument(name, source, 100),
  )
}

const nativeBuildEngine: FrontendWorkshopBrowserBuildEngine = {
  build: build as unknown as FrontendWorkshopBrowserBuildEngine['build'],
}

beforeAll(() => {
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser)
})

function compiler(): FrontendWorkshopBrowserSourceCompilerService {
  return new FrontendWorkshopBrowserSourceCompilerService(nativeBuildEngine)
}

function project(
  entryPath: string,
  files: Record<string, string | Uint8Array>,
): FrontendWorkshopBrowserSourceProject {
  return {
    entryPath,
    files: Object.entries(files).map(([path, contents]) => ({ path, contents })),
  }
}

describe('external source compatibility diagnostics', () => {
  it('does not reject unknown browser structures only because Analyzer cannot classify them', () => {
    const result = report(
      'fixture-basic-html',
      '<fixture-unknown-element><template shadowrootmode="open">ready</template></fixture-unknown-element>',
    )
    expect(
      result.findings
        .filter((item) => item.category === 'syntax')
        .every((item) => item.severity !== 'error'),
    ).toBe(true)
  })

  it('reports browser-bundle candidates without routing them to AI', () => {
    const result = report(
      'fixture-vue-frontend',
      `import { createApp } from 'vue'; interface State { value: number }`,
    )
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'module-build', severity: 'info' }),
      ]),
    )
  })

  it('fails closed for backend-bound source instead of claiming frontend conversion', () => {
    const result = report(
      'fixture-external-resource',
      `import { readFile } from 'node:fs/promises'; navigator.serviceWorker.register('/worker.js'); void readFile`,
    )
    expect(result.findings.filter((item) => item.category === 'external-host')).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
    )
  })

  it('compiles a local TypeScript module graph with CSS and static assets into Author Source', async () => {
    const input = project('src/main.ts', {
      'src/main.ts': `
        import { label } from './label'
        import './theme.css'
        import badge from './badge.png'
        interface FixtureState { ready: boolean }
        const state: FixtureState = { ready: true }
        document.body.innerHTML = '<main class="fixture-external-resource">' + label + '<img src="' + badge + '"></main>'
        document.body.dataset.ready = String(state.ready)
      `,
      'src/label.ts': `export const label: string = 'fixture-typescript'`,
      'src/theme.css': `@import './nested.css'; .fixture-external-resource{background-image:url('./badge.png')}`,
      'src/nested.css': `.fixture-external-resource{display:grid}`,
      'src/badge.png': new Uint8Array([137, 80, 78, 71]),
    })

    expect(classifyFrontendWorkshopBrowserSourceProject(input)).toBe('browser-compile')
    const compiled = await compiler().compile(input)
    expect(compiled.authorSource).toContain('<style>')
    expect(compiled.authorSource).toContain('<script>')
    expect(compiled.authorSource).toContain('fixture-typescript')
    expect(compiled.authorSource).toContain('data:image/png;base64,')
    expect(compiled.authorSource).not.toContain('interface FixtureState')
    expect(compiled.authorSource).not.toMatch(/\bimport\s/u)

    const source = createFrontendWorkshopSourceDocument(
      'fixture-external-resource',
      compiled.authorSource,
      100,
      'imported',
    )
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'fixture-compiler-instance',
      runtimeNonce: 'fixture-compiler-nonce',
    })
    expect(runtime.childDocument).toContain(`\n${compiled.authorSource}\n</body>`)
  })

  it('compiles TSX syntax without introducing a package manager', async () => {
    const compiled = await compiler().compile(
      project('main.tsx', {
        'main.tsx': `
          const React = { createElement: (tag: string, props: unknown, text: string) => {
            const node = document.createElement(tag)
            node.textContent = text
            return node
          }}
          document.body.append(<section data-fixture="tsx">fixture-tsx</section>)
        `,
      }),
    )
    expect(compiled.authorSource).toContain('fixture-tsx')
    expect(compiled.authorSource).not.toContain('<section data-fixture="tsx">')

    await expect(
      compiler().compile(
        project('react-entry.tsx', {
          'react-entry.tsx': `import React from 'react'; document.body.append(<main />)`,
        }),
      ),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'unsupported-package' })],
    } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
  })

  it('compiles a Vue SFC with scoped CSS against the existing window.Vue vendor runtime', async () => {
    const compiled = await compiler().compile(
      project('src/App.vue', {
        'src/App.vue': `
          <script setup lang="ts">
          import { ref } from 'vue'
          const label = ref<string>('fixture-vue-frontend')
          </script>
          <template><main class="fixture-vue">{{ label }}</main></template>
          <style scoped>.fixture-vue{display:flex}</style>
        `,
      }),
    )
    expect(compiled.authorSource).toContain('frontend-workshop-browser-source-root')
    expect(compiled.authorSource).toContain('fixture-vue-frontend')
    expect(compiled.authorSource).toContain('data-v-')
    expect(compiled.authorSource).toContain('window.Vue')
    expect(compiled.authorSource).not.toContain('<template>')
  })

  it('compiles HTML module, local stylesheet and asset references into one Author Source result', async () => {
    const compiled = await compiler().compile(
      project('index.html', {
        'index.html': `<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><main><img src="./icon.svg"></main><script type="module" src="./main.ts"></script></body></html>`,
        'style.css': `main{color:rgb(1 2 3)}`,
        'main.ts': `document.querySelector('main')?.setAttribute('data-ready','fixture-html-module')`,
        'icon.svg': `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>`,
      }),
    )
    expect(compiled.authorSource).toContain('<style>')
    expect(compiled.authorSource).toContain('fixture-html-module')
    expect(compiled.authorSource).toContain('data:image/svg+xml;base64,')
    expect(compiled.authorSource).not.toContain('<html')
    expect(compiled.authorSource).not.toContain('type="module"')
  })

  it('inlines selected classic browser scripts and reports missing local HTML resources', async () => {
    const compiled = await compiler().compile(
      project('index.html', {
        'index.html': `<main><img src="./icon.svg"></main><script src="./classic.js"></script>`,
        'classic.js': `document.body.dataset.classic = 'ready'`,
        'icon.svg': `<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
      }),
    )
    expect(compiled.authorSource).toContain(`document.body.dataset.classic = 'ready'`)
    expect(compiled.authorSource).not.toContain('src="./classic.js"')

    await expect(
      compiler().compile(
        project('index.html', {
          'index.html': `<link rel="stylesheet" href="./missing.css"><img src="./missing.png">`,
        }),
      ),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'missing-import', path: 'index.html' })],
    } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
  })

  it('does not execute a selected binary asset through an HTML script tag', async () => {
    await expect(
      compiler().compile(
        project('index.html', {
          'index.html': `<script src="./fixture-image.png"></script>`,
          'fixture-image.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        }),
      ),
    ).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: 'compile-error',
          message: expect.stringContaining('只接受本地 JavaScript 文本'),
        }),
      ],
    } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
  })

  it('diagnoses Host/backend-bound imports before invoking the compiler engine', async () => {
    const engine: FrontendWorkshopBrowserBuildEngine = { build: vi.fn() }
    const service = new FrontendWorkshopBrowserSourceCompilerService(engine)
    const input = project('main.ts', {
      'main.ts': `import { readFile } from 'node:fs/promises'; void readFile`,
    })
    expect(classifyFrontendWorkshopBrowserSourceProject(input)).toBe('host-bound')
    await expect(service.compile(input)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'host-bound', path: 'main.ts' })],
    } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
    expect(engine.build).not.toHaveBeenCalled()
  })

  it('reports unresolved bare browser packages instead of cloning npm or invoking AI', async () => {
    await expect(
      compiler().compile(
        project('main.ts', {
          'main.ts': `import packageValue from 'fixture-package'; console.log(packageValue)`,
        }),
      ),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'unsupported-package' })],
    } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
  })

  it('rejects traversal, duplicate paths and malformed UTF-8 before producing Source', async () => {
    for (const input of [
      project('../main.ts', { '../main.ts': 'document.body.textContent = "no"' }),
      project('main.ts', {
        'main.ts': 'document.body.textContent = "one"',
        './main.ts': 'document.body.textContent = "two"',
      }),
    ]) {
      await expect(compiler().compile(input)).rejects.toMatchObject({
        diagnostics: [expect.objectContaining({ code: 'invalid-project' })],
      } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
    }

    await expect(
      compiler().compile(project('main.ts', { 'main.ts': new Uint8Array([0xc3, 0x28]) })),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'compile-error', path: 'main.ts' })],
    } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
  })

  it('enforces selected File limits before reading bytes', async () => {
    const unread = vi.fn()
    const selected = (name: string, size: number) =>
      ({ name, webkitRelativePath: '', size, arrayBuffer: unread }) as unknown as File

    await expect(
      createFrontendWorkshopBrowserSourceProjectFromFiles([
        selected('oversized.ts', FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_FILE_BYTES + 1),
      ]),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'invalid-project' })],
    } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
    await expect(
      createFrontendWorkshopBrowserSourceProjectFromFiles(
        Array.from({ length: FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_FILES + 1 }, (_, index) =>
          selected(`file-${index}.ts`, 1),
        ),
      ),
    ).rejects.toBeInstanceOf(FrontendWorkshopBrowserSourceCompileError)
    await expect(
      createFrontendWorkshopBrowserSourceProjectFromFiles([
        selected('a.bin', FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_FILE_BYTES),
        selected('b.bin', FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_FILE_BYTES),
        selected('c.bin', FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_FILE_BYTES),
        selected('d.bin', FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_FILE_BYTES),
        selected('e.bin', 1),
      ]),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'invalid-project' })],
    } satisfies Partial<FrontendWorkshopBrowserSourceCompileError>)
    expect(FRONTEND_WORKSHOP_BROWSER_SOURCE_MAX_TOTAL_BYTES).toBe(20 * 1024 * 1024)
    expect(unread).not.toHaveBeenCalled()
  })
})
