import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const assetsDirectory = resolve(dist, 'assets')
const assetNames = await readdir(assetsDirectory)
const entries = await Promise.all(
  assetNames.map(async (name) => ({
    name,
    bytes: (await stat(resolve(assetsDirectory, name))).size,
  })),
)
const failures = []
const limits = {
  js: 500 * 1024,
  mainJs: 800 * 1024,
  lazyVueCompilerJs: 900 * 1024,
  css: 400 * 1024,
  defaultPrecache: 1.5 * 1024 * 1024,
  fullOfflineCore: 12 * 1024 * 1024,
  optionalBrowserCompiler: 16 * 1024 * 1024,
}

for (const entry of entries) {
  const extension = extname(entry.name)
  const limit =
    extension === '.js'
      ? entry.name.startsWith('index-')
        ? limits.mainJs
        : entry.name.startsWith('compiler-sfc.esm-browser-')
          ? limits.lazyVueCompilerJs
          : limits.js
      : extension === '.css'
        ? limits.css
        : undefined
  if (limit && entry.bytes > limit)
    failures.push(`${entry.name} 为 ${entry.bytes} bytes，超过 ${limit}`)
}
const serviceWorker = await readFile(resolve(dist, 'sw.js'), 'utf8')
const precacheUrls = [...serviceWorker.matchAll(/url:"([^"]+)"/gu)].map((match) => match[1])
let precacheBytes = 0
for (const url of new Set(precacheUrls)) {
  const file = resolve(dist, url)
  try {
    precacheBytes += (await stat(file)).size
  } catch {
    failures.push(`默认 precache 引用了不存在的文件：${url}`)
  }
}
if (precacheBytes > limits.defaultPrecache) {
  failures.push(`默认 precache 为 ${precacheBytes} bytes，超过 ${limits.defaultPrecache}`)
}
const offlineManifest = JSON.parse(await readFile(resolve(dist, 'offline-assets.json'), 'utf8'))
const optionalCompilerAsset = (url) =>
  /^\/assets\/(?:FrontendWorkshopBrowserSourceCompilerService-|browser-[^/]+\.js$|compiler-sfc\.esm-browser-|esbuild-[^/]+\.wasm$)/u.test(
    url,
  )
const optionalBrowserCompilerBytes = offlineManifest.assets
  .filter((asset) => optionalCompilerAsset(asset.url))
  .reduce((total, asset) => total + asset.size, 0)
const fullOfflineCoreBytes = offlineManifest.totalBytes - optionalBrowserCompilerBytes
if (fullOfflineCoreBytes > limits.fullOfflineCore) {
  failures.push(`完整离线核心为 ${fullOfflineCoreBytes} bytes，超过 ${limits.fullOfflineCore}`)
}
if (optionalBrowserCompilerBytes > limits.optionalBrowserCompiler) {
  failures.push(
    `按需 Browser Compiler 为 ${optionalBrowserCompilerBytes} bytes，超过 ${limits.optionalBrowserCompiler}`,
  )
}

if (failures.length) throw new Error(`Bundle budget 失败：\n- ${failures.join('\n- ')}`)
process.stdout.write(
  `Bundle budget 通过：默认 precache ${(precacheBytes / 1024 / 1024).toFixed(2)} MiB，完整离线核心 ${(fullOfflineCoreBytes / 1024 / 1024).toFixed(2)} MiB，按需 Browser Compiler ${(optionalBrowserCompilerBytes / 1024 / 1024).toFixed(2)} MiB\n`,
)
