import { describe, expect, it } from 'vitest'
import { TavernDirectoryService } from './TavernDirectoryService'
import { directoryParts, type TavernDirectoryStorage } from '../storage/TavernDirectoryStorage'
import { hashBlob } from './HashService'
import { replacePngCharacterChunk } from '../utils/CharacterCardCustomization'
import { PngResourceParser } from '../parser/PngResourceParser'

function fixture() {
  const files = new Map<string, File>()
  const json = (value: unknown, name = 'resource.json') =>
    new File([JSON.stringify(value)], name, { type: 'application/json' })
  files.set(
    'settings.json',
    json(
      { extension_settings: { regex: [], unrelated: { keep: 42 } }, other: 'preserved' },
      'settings.json',
    ),
  )
  const storage: TavernDirectoryStorage = {
    name: 'default-user',
    async list(path) {
      if (!path)
        return [
          { name: 'characters', directory: true },
          { name: 'settings.json', directory: false },
        ]
      return [...files.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map((key) => ({ name: key.split('/').at(-1)!, directory: false }))
    },
    async read(path) {
      return files.get(path) ?? null
    },
    async write(path, blob, expectedHash) {
      const current = files.get(path)
      if ((current ? await hashBlob(current) : null) !== expectedHash) throw new Error('changed')
      files.set(path, new File([blob], path.split('/').at(-1)!, { type: blob.type }))
    },
  }
  return { files, storage, json, service: new TavernDirectoryService(storage) }
}

describe('offline Tavern directory', () => {
  it('preserves character metadata and existing scoped scripts when writing a disabled script and a renamed copy', async () => {
    const { files, service, json } = fixture()
    const pixels = new Blob(
      [
        Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          ),
          (char) => char.charCodeAt(0),
        ),
      ],
      { type: 'image/png' },
    )
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Alice',
        description: 'preserve',
        extensions: {
          custom: 42,
          TavernHelper_scripts: [
            { id: 'old', type: 'script', name: 'old', content: 'existing', enabled: true },
          ],
        },
      },
    }
    const original = new File(
      [await replacePngCharacterChunk(pixels, 'chara', card)],
      'Alice.png',
      { type: 'image/png' },
    )
    files.set('characters/Alice.png', original)
    await service.listResources()
    await service.sendFiles(
      [
        {
          file: json({ content: 'new', name: 'new' }),
          kind: 'scriptCharacter',
          displayName: 'new',
          targetName: 'Alice',
        },
      ],
      'skip',
    )
    const parsed = await new PngResourceParser().parse(files.get('characters/Alice.png')!)
    expect(parsed.metadata.card).toMatchObject({
      data: {
        description: 'preserve',
        extensions: {
          custom: 42,
          tavern_helper: {
            scripts: [
              { id: 'old', enabled: true },
              { name: 'new', enabled: false },
            ],
          },
        },
      },
    })
    const latest = files.get('characters/Alice.png')!
    await service.sendFiles([{ file: original, kind: 'character', displayName: 'Alice' }], 'copy')
    expect(
      (await new PngResourceParser().parse(files.get('characters/Alice (SRL 2).png')!)).name,
    ).toBe('Alice (SRL 2)')
    expect(await files.get('characters/Alice.png')!.text()).toBe(await latest.text())
  })
  it('reuses an identical conflict copy when retrying and keeps legacy script settings', async () => {
    const { files, service, json } = fixture()
    files.set('themes/theme.json', json({ name: 'theme', original: true }))
    const payload = {
      file: json({ name: 'theme', changed: true }),
      kind: 'theme' as const,
      displayName: 'theme',
    }
    await service.sendFiles([payload], 'copy')
    expect((await service.sendFiles([payload], 'copy'))[0]?.status).toBe('skipped')
    expect([...files.keys()].filter((path) => path.startsWith('themes/'))).toHaveLength(2)
    files.set(
      'settings.json',
      json({
        extension_settings: {
          TavernHelper: {
            script: {
              option: 'keep',
              scripts: [{ type: 'script', id: 'old', name: 'old', content: 'x' }],
            },
          },
        },
      }),
    )
    await service.sendFiles(
      [
        {
          file: json([{ name: 'new', content: 'alert(1)', enabled: true }]),
          kind: 'scriptGlobal',
          displayName: 'new',
        },
      ],
      'skip',
    )
    const settings = JSON.parse(await files.get('settings.json')!.text())
    expect(settings.extension_settings.TavernHelper).toBeUndefined()
    expect(settings.extension_settings.tavern_helper.script.option).toBe('keep')
    expect(settings.extension_settings.tavern_helper.script.scripts).toHaveLength(2)
    expect(settings.extension_settings.tavern_helper.script.scripts[1]).toMatchObject({
      type: 'script',
      enabled: false,
    })
  })
  it('backs up overwritten files and verifies the actual stored content', async () => {
    const { files, service, json } = fixture()
    const old = json({ entries: { old: {} } }, 'world.json')
    files.set('worlds/world.json', old)
    const next = json({ entries: { next: {} } }, 'world.json')
    const result = await service.sendFiles(
      [{ file: next, kind: 'worldBook', displayName: 'world' }],
      'overwrite',
    )
    expect(result[0]?.status).toBe('overwritten')
    expect(await files.get('worlds/world.json')!.text()).toBe(await next.text())
    const backup = [...files.keys()].find((key) => key.startsWith('.srl-backups/'))!
    expect(await files.get(backup)!.text()).toBe(await old.text())
  })
  it('merges a global regex without changing unrelated settings and skips duplicates', async () => {
    const { files, service, json } = fixture()
    const input = {
      file: json({ global: [{ scriptName: 'trim', findRegex: 'x', replaceString: '' }] }),
      kind: 'regexGlobal' as const,
      displayName: 'trim',
    }
    await service.sendFiles([input], 'skip')
    await service.sendFiles([input], 'skip')
    const settings = JSON.parse(await files.get('settings.json')!.text())
    expect(settings.other).toBe('preserved')
    expect(settings.extension_settings.unrelated).toEqual({ keep: 42 })
    expect(settings.extension_settings.regex).toHaveLength(1)
    const item = (await service.listResources()).find((entry) => entry.kind === 'regexGlobal')!
    expect(
      JSON.parse(await (await service.pullResources([item]))[0]!.text()).global[0].scriptName,
    ).toBe('trim')
  })
  it('does not guess an unknown preset API family or overwrite an unrecognized directory', async () => {
    const { service, json, storage } = fixture()
    await expect(
      service.sendFiles(
        [{ file: json({ temperature: 1 }), kind: 'preset', displayName: 'preset' }],
        'overwrite',
      ),
    ).rejects.toThrow('API 类型')
    storage.list = async () => []
    await expect(service.validate()).rejects.toThrow('用户目录')
  })
  it('rejects traversal and leaves a changed target untouched after creating its backup', async () => {
    expect(() => directoryParts('../settings.json')).toThrow()
    expect(() => directoryParts('characters/../../secret')).toThrow()
    const { files, storage, service, json } = fixture()
    files.set('worlds/world.json', json({ entries: {} }, 'world.json'))
    const originalWrite = storage.write.bind(storage)
    storage.write = async (path, blob, expected) => {
      await originalWrite(path, blob, expected)
      if (path.startsWith('.srl-backups/'))
        files.set('worlds/world.json', json({ entries: { user: true } }, 'world.json'))
    }
    await expect(
      service.sendFiles(
        [{ file: json({ entries: { new: true } }), kind: 'worldBook', displayName: 'world' }],
        'overwrite',
      ),
    ).rejects.toThrow('changed')
    expect(JSON.parse(await files.get('worlds/world.json')!.text()).entries.user).toBe(true)
  })
})
