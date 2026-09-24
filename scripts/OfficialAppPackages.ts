import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { unzipSync, zipSync } from 'fflate'

type ReleasedPackage = { url: string; sha256: string; downloadBytes: number }

/** Preserve published ZIP bytes; only an identical final file graph may reuse a build ID. */
export function reuseReleasedOfficialAppPackage(
  bytes: Uint8Array,
  expected: Record<string, Uint8Array>,
  release: ReleasedPackage,
): Uint8Array {
  if (
    bytes.length !== release.downloadBytes ||
    createHash('sha256').update(bytes).digest('hex') !== release.sha256
  )
    throw new Error('Released official APP archive failed size/SHA-256 verification')
  const actual = unzipSync(bytes)
  if (
    Object.keys(actual).length !== Object.keys(expected).length ||
    Object.entries(expected).some(
      ([name, value]) => !actual[name] || !Buffer.from(actual[name]).equals(Buffer.from(value)),
    )
  )
    throw new Error('Released official APP content changed; use a new buildId before publishing')
  return bytes
}

const entries = {
  draw: 'DrawApp.vue',
  stitch: 'PresetStitcherApp.vue',
  frontendWorkshop: 'FrontendWorkshopSourceAiShell.vue',
  imageGeneration: 'ImageGenerationApp.vue',
  imageAlbum: 'GeneratedImageAlbumApp.vue',
  userPersona: 'UserPersonaApp.vue',
  resourceBundle: 'ResourceBundleApp.vue',
  tavernBridge: 'TavernBridgeCenter.vue',
}
const virtualId = 'virtual:srl-official-app-entries'

/** Uses the same build graph, Vue runtime and host services as the shell. */
export function officialAppPackagesPlugin(shellVersion: string): Plugin {
  let production = false
  let publicRoot = ''
  const refs = new Map<string, string>()
  return {
    name: 'srl-official-app-packages',
    configResolved(config) {
      production = config.command === 'build'
      publicRoot = config.publicDir || ''
    },
    resolveId(id) {
      if (id === virtualId || id.startsWith('virtual:srl-official-app/')) return '\0' + id
    },
    buildStart() {
      if (!production) return
      for (const [id, component] of Object.entries(entries)) {
        refs.set(
          id,
          this.emitFile({
            type: 'chunk',
            preserveSignature: 'strict',
            id: 'virtual:srl-official-app/' + id,
            name: component.replace('.vue', ''),
          }),
        )
      }
    },
    load(id) {
      if (id.startsWith('\0virtual:srl-official-app/')) {
        const appId = id.slice('\0virtual:srl-official-app/'.length)
        const component = entries[appId as keyof typeof entries]
        if (!component) throw new Error('Unknown official APP')
        const root = JSON.stringify(resolve('src/components', component).replaceAll('\\', '/'))
        let prepare = ''
        if (appId === 'imageGeneration')
          prepare =
            'export async function prepare(){const [g,a]=await Promise.all([import("/src/core/ImageGenerationContainer.ts"),import("/src/core/ImageAlbumContainer.ts")]);await Promise.all([g.frontendWorkshopImageGenerationService.initializeCredentials(),a.frontendWorkshopImageHostingService.initializeCredentials()])}'
        if (appId === 'imageAlbum')
          prepare =
            'export async function prepare(){const a=await import("/src/core/ImageAlbumContainer.ts");await a.frontendWorkshopImageHostingService.initializeCredentials()}'
        return 'export {default} from ' + root + ';' + prepare
      }
      if (id !== '\0' + virtualId) return
      if (!production) {
        return `export const entries={${Object.keys(entries)
          .map(
            (key) =>
              `${JSON.stringify(key)}:{load:()=>import(${JSON.stringify('virtual:srl-official-app/' + key)})}`,
          )
          .join(',')}}`
      }
      return `export const entries={${[...refs]
        .map(([key, ref]) => `${JSON.stringify(key)}:{url:import.meta.ROLLUP_FILE_URL_${ref}}`)
        .join(',')}}`
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const releasedCatalogPath = resolve(
          publicRoot,
          `official-apps/${shellVersion}/catalog.json`,
        )
        const released =
          publicRoot && existsSync(releasedCatalogPath)
            ? (JSON.parse(readFileSync(releasedCatalogPath, 'utf8')) as {
                shellVersion: string
                apps: Record<string, ReleasedPackage>
              })
            : undefined
        if (released && released.shellVersion !== shellVersion)
          throw new Error('Released official APP catalog buildId mismatch')
        const appEntries = new Map([...refs].map(([id, ref]) => [id, this.getFileName(ref)]))
        const appRoots = new Set(appEntries.values())
        const closure = (roots: string[], skipApps: boolean): Set<string> => {
          const seen = new Set<string>()
          const visit = (name: string) => {
            if (seen.has(name) || (appRoots.has(name) && (skipApps || !roots.includes(name))))
              return
            const file = bundle[name]
            if (!file) return
            seen.add(name)
            if (file.type !== 'chunk') return
            const meta = file as typeof file & {
              viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> }
            }
            for (const dep of [
              ...file.imports,
              ...file.dynamicImports,
              ...(meta.viteMetadata?.importedCss ?? []),
              ...(meta.viteMetadata?.importedAssets ?? []),
            ])
              visit(dep)
          }
          roots.forEach(visit)
          return seen
        }
        const shellRoots = Object.values(bundle)
          .filter((file) => file.type === 'chunk' && file.isEntry && !appRoots.has(file.fileName))
          .map((file) => file.fileName)
        const core = closure(shellRoots, true)
        const optional = new Set<string>()
        const catalog: Record<string, unknown> = {}
        for (const [id, entry] of appEntries) {
          const gate = Object.values(bundle).find(
            (file) =>
              file.type === 'chunk' &&
              Object.keys(file.modules).some((name) =>
                name.replaceAll('\\', '/').endsWith('/components/OfficialAppGate.vue'),
              ),
          )?.fileName
          if (!gate) throw new Error('Official APP loading gate missing')
          const graph = closure([entry, gate], false)
          const archive: Record<string, Uint8Array> = {}
          const files = [...graph].sort().map((name) => {
            if (!core.has(name)) optional.add(name)
            const file = bundle[name]!
            const bytes = Buffer.from(file.type === 'chunk' ? file.code : file.source)
            archive[name] = bytes
            return {
              path: '/' + name,
              bundled: core.has(name),
              size: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            }
          })
          if (!files.some((file) => file.path === '/' + entry))
            throw new Error(`Official APP ${id} is still eagerly reachable from the shell`)
          if (files.length >= 100)
            throw new Error(`Official APP ${id} exceeds package file limit: ${files.length}`)
          archive['manifest.json'] = Buffer.from(
            JSON.stringify({
              schemaVersion: 1,
              shellVersion,
              id,
              entry: '/' + entry,
              styles: [...graph].filter((name) => name.endsWith('.css')).map((name) => '/' + name),
              files,
            }),
          )
          const previous = released?.apps[id]
          if (
            released &&
            (!previous ||
              !new RegExp(`^/official-apps/${shellVersion}/${id}-[a-f0-9]{16}\\.srlapp$`, 'u').test(
                previous.url,
              ))
          )
            throw new Error(`Released official APP ${id} has an invalid archive path`)
          const content = previous
            ? reuseReleasedOfficialAppPackage(
                readFileSync(resolve(publicRoot, previous.url.slice(1))),
                archive,
                previous,
              )
            : zipSync(archive, { level: 6 })
          const packageHash = createHash('sha256').update(content).digest('hex')
          const url = `official-apps/${shellVersion}/${id}-${packageHash.slice(0, 16)}.srlapp`
          this.emitFile({ type: 'asset', fileName: url, source: content })
          catalog[id] = {
            url: '/' + url,
            sha256: packageHash,
            downloadBytes: Buffer.byteLength(content),
            installedBytes: files.reduce((total, file) => total + file.size, 0),
            entry: '/' + entry,
          }
        }
        this.emitFile({
          type: 'asset',
          fileName: `official-apps/${shellVersion}/catalog.json`,
          source: JSON.stringify({ schemaVersion: 1, shellVersion, apps: catalog }),
        })
        // Capacitor packaging excludes these files and package downloads. The Web host retains them.
        this.emitFile({
          type: 'asset',
          fileName: 'official-app-assets.json',
          source: JSON.stringify({ shellVersion, files: [...optional].sort() }),
        })
      },
    },
  }
}
