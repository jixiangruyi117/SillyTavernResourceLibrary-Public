declare const caches: {
  open(name: string): Promise<{
    match(request: Request): Promise<Response | undefined>
    put(request: Request, response: Response): Promise<void>
    keys(): Promise<Request[]>
    delete(request: Request): Promise<boolean>
  }>
}
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import vue from '@vitejs/plugin-vue'
import { build } from 'esbuild'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import buildInfo from './build-info.json' with { type: 'json' }

const previewVendorGlobalsSourceId = 'virtual:srl-preview-vendor-globals-source'
const resolvedPreviewVendorGlobalsSourceId = `\0${previewVendorGlobalsSourceId}`
const appearanceStarterCssSourceId = 'virtual:srl-appearance-starter-css-source'
const resolvedAppearanceStarterCssSourceId = `\0${appearanceStarterCssSourceId}`

interface AppearanceStarterCssSource {
  file: string
  selectorHint?: RegExp
}

const appearanceStarterCssSources: Record<string, AppearanceStarterCssSource[]> = {
  library: [
    { file: 'AppShell.css', selectorHint: /\.(library|resource)-/u },
    { file: 'ResourceList.css', selectorHint: /\.resource-/u },
    { file: 'LayoutAndResponsive.css', selectorHint: /\.resource-/u },
  ],
  details: [{ file: 'ResourceDetails.css', selectorHint: /\.resource-detail/u }],
  features: [{ file: 'FeatureDesktop.css', selectorHint: /\.feature-/u }],
  draw: [{ file: 'FeatureDesktop.css', selectorHint: /\.(draw|gallery-reveal)/u }],
  cabinet: [
    {
      file: 'FolderLibrary.css',
      selectorHint: /\.(folder-library|visual-folder|cabinet-resource)/u,
    },
  ],
  appearance: [{ file: 'AppearanceStudio.css', selectorHint: /\.(appearance|layout-settings)-/u }],
  cloud: [{ file: 'CloudBackup.css', selectorHint: /\.cloud-/u }],
  bridge: [{ file: 'TavernBridgeCenter.css', selectorHint: /\.tavern-bridge/u }],
  stitch: [{ file: 'PresetStitcherApp.css', selectorHint: /\.stitch/u }],
  frontend: [
    { file: 'FrontendWorkshopWorkbench.css', selectorHint: /\.(fw-|frontend-workbench)/u },
    { file: 'FrontendWorkshopSourceSession.css', selectorHint: /\.frontend-workshop-source/u },
  ],
  persona: [{ file: 'UserPersonaApp.css', selectorHint: /\.persona-app/u }],
  'app:imageGeneration': [
    { file: 'ImageGenerationApp.css', selectorHint: /\.image-generation-app/u },
  ],
  'app:imageAlbum': [{ file: 'GeneratedImageAlbumApp.css', selectorHint: /\.generated-album/u }],
  'app:resourceBundle': [{ file: 'ResourceBundleApp.css', selectorHint: /\.resource-bundle-app/u }],
  'app:extensions': [{ file: 'ExternalAppManager.css', selectorHint: /\.external-app-manager/u }],
  settings: [
    { file: 'AppearanceStudio.css', selectorHint: /\.(appearance|settings|layout-settings)-/u },
    { file: 'LayoutAndResponsive.css', selectorHint: /\.layout-settings/u },
  ],
}

function extractAppearanceStarterRules(css: string, selectorHint?: RegExp, limit = 8): string[] {
  const rules: string[] = []
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '')
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const header = match[1]?.trim() ?? ''
    if (header.startsWith('@') || header.includes('@') || header.includes(':root')) continue
    if (!/\.[a-zA-Z_][\w-]*/u.test(header)) continue
    if (selectorHint && !selectorHint.test(header)) continue
    rules.push(`${header} {\n${match[2]?.trim() ?? ''}\n}`)
    if (rules.length >= limit) break
  }
  return rules
}

function appearanceStarterCssSourcePlugin(): Plugin {
  return {
    name: 'srl-appearance-starter-css-source',
    resolveId(id) {
      return id === appearanceStarterCssSourceId ? resolvedAppearanceStarterCssSourceId : undefined
    },
    load(id) {
      if (id !== resolvedAppearanceStarterCssSourceId) return undefined
      const root = join(process.cwd(), 'src', 'styles')
      return `export default ${JSON.stringify(
        Object.fromEntries(
          Object.entries(appearanceStarterCssSources).map(([scope, sources]) => [
            scope,
            sources
              .flatMap(({ file, selectorHint }) =>
                extractAppearanceStarterRules(readFileSync(join(root, file), 'utf8'), selectorHint),
              )
              .slice(0, 8)
              .join('\n\n'),
          ]),
        ),
      )}`
    },
  }
}

function previewVendorGlobalsSourcePlugin(): Plugin {
  return {
    name: 'srl-preview-vendor-globals-source',
    resolveId(id) {
      return id === previewVendorGlobalsSourceId ? resolvedPreviewVendorGlobalsSourceId : undefined
    },
    async load(id) {
      if (id !== resolvedPreviewVendorGlobalsSourceId) return undefined
      const result = await build({
        entryPoints: [join(process.cwd(), 'src', 'utils', 'PreviewVendorGlobals.ts')],
        bundle: true,
        format: 'iife',
        legalComments: 'inline',
        minify: true,
        platform: 'browser',
        target: 'es2022',
        write: false,
      })
      const source = result.outputFiles[0]?.text
      if (!source) throw new Error('Preview vendor globals bundle is empty')
      return `export default ${JSON.stringify(source)}`
    },
  }
}

function listPublicOfflineAssets(
  root: string,
  directory = root,
): Array<{ url: string; size: number }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) return listPublicOfflineAssets(root, absolutePath)
    const publicPath = relative(root, absolutePath).split(sep).join('/')
    if (
      publicPath.startsWith('downloads/') ||
      publicPath === '_headers' ||
      publicPath === 'sw-share-target.js'
    ) {
      return []
    }
    return [{ url: `/${publicPath}`, size: statSync(absolutePath).size }]
  })
}

function offlineAssetManifestPlugin(): Plugin {
  const publicAssets = [
    { url: '/index.html', size: statSync(join(process.cwd(), 'index.html')).size },
    ...listPublicOfflineAssets(join(process.cwd(), 'public')),
  ]
  return {
    name: 'srl-offline-asset-manifest',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const outputAssets = Object.values(bundle)
          .filter((entry) => !entry.fileName.endsWith('.map'))
          .map((entry) => ({
            url: `/${entry.fileName}`,
            size:
              entry.type === 'chunk'
                ? Buffer.byteLength(entry.code)
                : typeof entry.source === 'string'
                  ? Buffer.byteLength(entry.source)
                  : entry.source.byteLength,
          }))
        const assets = [
          ...new Map(
            [...outputAssets, ...publicAssets].map((asset) => [asset.url, asset]),
          ).values(),
        ].sort((left, right) => left.url.localeCompare(right.url))
        this.emitFile({
          type: 'asset',
          fileName: 'offline-assets.json',
          source: JSON.stringify({
            version: buildInfo.buildId,
            totalBytes: assets.reduce((total, asset) => total + asset.size, 0),
            assets,
          }),
        })
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    appearanceStarterCssSourcePlugin(),
    previewVendorGlobalsSourcePlugin(),
    offlineAssetManifestPlugin(),
    VitePWA({
      // 更新不静默生效：新版本就绪后由页面提示用户刷新，避免运行中的会话被换掉分包。
      registerType: 'prompt',
      injectRegister: null,
      // 沿用 public/manifest.webmanifest，不再生成第二份清单。
      manifest: false,
      workbox: {
        clientsClaim: true,
        // Web Share Target 的 POST 接收器；系统分享的文件由它暂存后交回应用。
        importScripts: ['sw-share-target.js'],
        // 默认只安装应用壳与资源库核心入口；Feature 分包和教程图按需进入运行时缓存。
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'icons/*.{svg,png,ico}',
          'assets/index-*.{js,css}',
          'assets/App-*.{js,css}',
          'assets/AppContainer-*.js',
          'assets/vue.runtime*.js',
          'assets/vue-router*.js',
        ],
        globIgnores: ['**/downloads/**', '**/offline-assets.json'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/force-refresh\.html$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin &&
              (url.pathname.startsWith('/assets/') ||
                request.destination === 'script' ||
                request.destination === 'style'),
            handler: async ({ request }) => {
              const runtime = await caches.open('srl-feature-assets')
              const cached = await runtime.match(request)
              if (cached) return cached
              const response = await fetch(request)
              if (response.ok) {
                await runtime.put(request, response.clone())
                const keys = await runtime.keys()
                for (const key of keys.slice(0, Math.max(0, keys.length - 180)))
                  await runtime.delete(key)
              }
              return response
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'srl-runtime-images',
              expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'srl-runtime-fonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // Keep production CSS compatible with older Android WebViews used by packaged APKs.
    // This prevents minification from emitting modern media-query range syntax that those runtimes may ignore.
    cssTarget: 'chrome61',
  },
})
