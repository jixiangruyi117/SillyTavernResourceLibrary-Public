import { readFileSync, readdirSync } from 'node:fs'
import process from 'node:process'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { TextDecoder } from 'node:util'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'

const directory = resolve(process.argv[2] ?? 'dist')
const read = (path) => readFileSync(resolve(directory, path.replace(/^\//u, '')))
const json = (path) => JSON.parse(read(path).toString('utf8'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const inventory = json('official-app-assets.json')
const catalog = json(`official-apps/${inventory.shellVersion}/catalog.json`)
const offline = json('offline-assets.json')
const optional = new Set(inventory.files.map((path) => '/' + path))
assert.equal(Object.keys(catalog.apps).length, 8)
for (const [id, download] of Object.entries(catalog.apps)) {
  const bytes = read(download.url)
  assert.equal(bytes.length, download.downloadBytes, id)
  assert.equal(hash(bytes), download.sha256, id)
  const archive = unzipSync(bytes)
  const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']))
  assert.equal(manifest.id, id)
  assert.equal(manifest.shellVersion, inventory.shellVersion)
  assert.equal(manifest.entry, download.entry)
  assert.ok(manifest.files.length < 100)
  assert.equal(Object.keys(archive).length, manifest.files.length + 1)
  assert.ok(manifest.files.some((file) => file.path === manifest.entry && !file.bundled))
  for (const file of manifest.files) {
    const packed = archive[file.path.slice(1)]
    assert.ok(packed, `${id}: missing ${file.path}`)
    assert.equal(packed.length, file.size)
    assert.equal(hash(packed), file.sha256)
    // Vite finalizes dynamic-import preloads late; archives must contain those final bytes.
    assert.deepEqual(
      Buffer.from(packed),
      read(file.path),
      `${id}: stale packaged code ${file.path}`,
    )
    assert.equal(optional.has(file.path), !file.bundled)
  }
  for (const style of manifest.styles) assert.ok(manifest.files.some((file) => file.path === style))
}
for (const asset of offline.assets) {
  assert.ok(!optional.has(asset.url), `Optional APP precached: ${asset.url}`)
  assert.ok(!asset.url.startsWith('/official-apps/'), `Package precached: ${asset.url}`)
}
// Released APKs request their original build, even after the website is upgraded.
// Check both the immutable archive and Vite's copy into the deployment directory.
const retainedRoot = resolve('public/official-apps')
let retainedPackages = 0
for (const build of readdirSync(retainedRoot, { withFileTypes: true })) {
  assert.ok(build.isDirectory() && /^srl-\d+\.\d+\.\d+-v\d+$/u.test(build.name))
  const catalogPath = `official-apps/${build.name}/catalog.json`
  const sourceCatalog = readFileSync(resolve('public', catalogPath))
  assert.deepEqual(read(catalogPath), sourceCatalog, `Retained catalog changed: ${build.name}`)
  const retained = JSON.parse(sourceCatalog.toString('utf8'))
  assert.equal(retained.shellVersion, build.name)
  assert.equal(retained.schemaVersion, 1)
  for (const [id, download] of Object.entries(retained.apps)) {
    const prefix = `/official-apps/${build.name}/`
    assert.ok(download.url.startsWith(prefix))
    assert.match(download.url.slice(prefix.length), /^[\w-]+-[a-f0-9]{16}\.srlapp$/u)
    const bytes = read(download.url)
    assert.deepEqual(bytes, readFileSync(resolve('public', download.url.slice(1))))
    assert.equal(bytes.length, download.downloadBytes, `${build.name}/${id}`)
    assert.equal(hash(bytes), download.sha256, `${build.name}/${id}`)
    const archive = unzipSync(bytes)
    const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']))
    assert.equal(manifest.shellVersion, build.name)
    assert.equal(manifest.id, id)
    assert.equal(manifest.entry, download.entry)
    assert.equal(Object.keys(archive).length, manifest.files.length + 1)
    for (const file of manifest.files) {
      const packed = archive[file.path.slice(1)]
      assert.ok(packed, `${build.name}/${id}: missing ${file.path}`)
      assert.equal(packed.length, file.size)
      assert.equal(hash(packed), file.sha256)
    }
    retainedPackages++
  }
}
console.log(
  `Official APP packages verified: 8 current + ${retainedPackages} retained packages, ${optional.size} optional assets; final bytes and offline boundaries match.`,
)
