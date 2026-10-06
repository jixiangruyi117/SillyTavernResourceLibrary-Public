import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import console from 'node:console'
import { TextDecoder } from 'node:util'
import { fileURLToPath, URL } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(root, 'extensions/duleme')
const output = resolve(process.argv[2] || resolve(root, '.codex-tmp/chat-reader-package'))
const files = ['manifest.json', 'index.html', 'reader.css', 'app.js', 'icon.svg']
const entries = {}
for (const name of files) entries[name] = new Uint8Array(await readFile(resolve(source, name)))
const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']))
entries['README.txt'] = strToU8(await readFile(resolve(source, 'README.md'), 'utf8'))
await mkdir(output, { recursive: true })
const archive = zipSync(entries, { level: 6 })
// The ZIP alias uses the same manifest and bytes for file pickers that reject custom suffixes.
for (const extension of ['srlapp', 'zip']) {
  const target = resolve(output, `${manifest.id}-${manifest.version}.${extension}`)
  await writeFile(target, archive)
  console.log(target)
}
