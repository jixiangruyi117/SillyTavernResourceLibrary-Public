/** @vitest-environment node */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build, type Plugin } from 'vite'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {
  officialAppContentHash,
  officialAppPackagesPlugin,
  reuseReleasedOfficialAppPackage,
} from './OfficialAppPackages'

const files = {
  'manifest.json': strToU8('{"shellVersion":"srl-test"}'),
  'assets/app.js': strToU8('export const value=1'),
}
const released = zipSync(files, { mtime: new Date('2020-01-01T00:00:00Z') })
const metadata = {
  url: '/official-apps/srl-test/app.srlapp',
  sha256: createHash('sha256').update(released).digest('hex'),
  downloadBytes: released.length,
}

describe('released official APP rebuilds', () => {
  it('tracks only APP-owned files in a deterministic integrity fingerprint', () => {
    const files = [
      { path: '/assets/shared.js', size: 4, sha256: 'a'.repeat(64), bundled: true },
      { path: '/assets/app.js', size: 3, sha256: 'b'.repeat(64) },
    ]
    const version = officialAppContentHash(files)
    expect(officialAppContentHash([...files].reverse())).toBe(version)
    expect(officialAppContentHash([{ ...files[0]!, sha256: 'c'.repeat(64) }, files[1]!])).toBe(
      version,
    )
    expect(officialAppContentHash([files[0]!, { ...files[1]!, sha256: 'd'.repeat(64) }])).not.toBe(
      version,
    )
  })
  it('reuses the exact released ZIP when only a rebuild timestamp would differ', () => {
    const rebuilt = zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') })
    expect(rebuilt).not.toEqual(released)
    expect(reuseReleasedOfficialAppPackage(released, files, metadata)).toBe(released)
  })
  it('refuses changed code under the same released build ID', () => {
    expect(() =>
      reuseReleasedOfficialAppPackage(
        released,
        { ...files, 'assets/app.js': strToU8('export const value=2') },
        metadata,
      ),
    ).toThrow('new buildId')
  })
  it('refuses changes to the file graph or manifest', () => {
    expect(() =>
      reuseReleasedOfficialAppPackage(
        released,
        { ...files, 'assets/new.js': strToU8('new') },
        metadata,
      ),
    ).toThrow('new buildId')
    expect(() =>
      reuseReleasedOfficialAppPackage(
        released,
        { ...files, 'manifest.json': strToU8('{}') },
        metadata,
      ),
    ).toThrow('new buildId')
  })
  it('does not reuse a corrupt archive or an incorrect catalog digest', () => {
    expect(() => reuseReleasedOfficialAppPackage(released.subarray(1), files, metadata)).toThrow(
      'verification',
    )
    expect(() =>
      reuseReleasedOfficialAppPackage(released, files, { ...metadata, sha256: '0'.repeat(64) }),
    ).toThrow('verification')
  })
})

describe('official APP renderer build identity', () => {
  async function sample(
    version: string,
    extraHostApis: boolean,
    changedVue = false,
    productDependency = false,
  ) {
    const fixture: Plugin = {
      name: 'official-app-consumer-fixture',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'fixture:host') return '\0' + id
        if (id === 'fixture:gate') return resolve('src/components/OfficialAppGate.vue')
        if (id === 'fixture:product') return '\0' + id
      },
      load(id) {
        if (productDependency && id === '\0virtual:srl-official-app-runtime')
          return "export * from 'vue'; export {productValue} from 'fixture:product';"
        if (id === '\0fixture:product') return 'export const productValue=42;'
        if (id === '\0fixture:host')
          return `import {createApp,h${extraHostApis ? ',useTemplateRef,onActivated,watchPostEffect' : ''}} from 'vue';
            import {gate} from 'fixture:gate';
            import {entries,runtimeEntry} from 'virtual:srl-official-app-entries';
            globalThis.fixture={createApp,h,gate,entries,runtimeEntry,version:${JSON.stringify(version)}${extraHostApis ? ',useTemplateRef,onActivated,watchPostEffect' : ''}};`
        if (id.replaceAll('\\', '/').endsWith('/components/OfficialAppGate.vue'))
          return "import {h} from 'vue'; export const gate=()=>h('main');"
        if (id.replaceAll('\\', '/').includes('/src/components/') && id.endsWith('.vue'))
          return `import {defineComponent,h,renderSlot} from 'vue';
            export default defineComponent({render(){return h('article',[renderSlot(this.$slots,'default')])}});`
      },
      transform(code, id) {
        if (changedVue && id.replaceAll('\\', '/').includes('/@vue/runtime-core/'))
          return code.replace(/const version = "[^"]+"/u, 'const version = "changed-vue-fixture"')
      },
    }
    const result = await build({
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      plugins: [fixture, officialAppPackagesPlugin(version)],
      build: { write: false, rolldownOptions: { input: 'fixture:host' } },
    })
    if (!('output' in result)) throw new Error('Expected one fixture build')
    const assets = result.output.filter((file) => file.type === 'asset')
    const catalogAsset = assets.find(
      (file) => file.fileName === `official-apps/${version}/catalog.json`,
    )
    if (!catalogAsset) throw new Error('Fixture APP catalog missing')
    const catalog = JSON.parse(String(catalogAsset.source)) as {
      apps: Record<string, { runtimeEntry: string; hostFiles: unknown[]; url: string }>
    }
    const app = catalog.apps.draw!
    const archive = assets.find((file) => '/' + file.fileName === app.url)
    if (!archive) throw new Error('Fixture APP archive missing')
    const bytes = typeof archive.source === 'string' ? strToU8(archive.source) : archive.source
    return { app, packageFiles: unzipSync(bytes), output: result.output }
  }

  it('keeps installed APP renderer bytes stable across shell releases and new Vue consumers', async () => {
    const before = await sample('shell-before', false)
    const after = await sample('shell-after', true)
    expect(after.app.runtimeEntry).toBe(before.app.runtimeEntry)
    expect(after.app.hostFiles).toEqual(before.app.hostFiles)
    for (const file of after.app.hostFiles as Array<{ path: string }>) {
      const path = file.path.slice(1)
      expect(after.packageFiles[path]).toEqual(before.packageFiles[path])
      expect(after.output.find((chunk) => chunk.fileName === path)?.type).toBe('chunk')
    }
  }, 20000)

  it('changes renderer identity when the actual Vue implementation changes', async () => {
    const before = await sample('shell-before', false)
    const after = await sample('shell-after', false, true)
    expect(after.app.runtimeEntry).not.toBe(before.app.runtimeEntry)
    expect(after.app.hostFiles).not.toEqual(before.app.hostFiles)
  }, 20000)

  it('refuses product dependencies in the shared renderer graph', async () => {
    await expect(sample('contaminated-shell', false, false, true)).rejects.toThrow(
      'must not include product modules',
    )
  }, 20000)
})
