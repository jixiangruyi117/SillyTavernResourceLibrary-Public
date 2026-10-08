import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbArchiveStorage } from '../storage/IndexedDbArchiveStorage'
import { IndexedDbRestoreStagingStore } from '../storage/IndexedDbRestoreStagingStore'
import { IndexedDbResourceStorage } from '../storage/IndexedDbResourceStorage'
import { PngResourceParser } from '../parser/PngResourceParser'
import { JsonResourceParser } from '../parser/JsonResourceParser'
import { RESOURCE_TYPE, type Resource, type Category } from '../types/Resource'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'
import { ExportService, resourceDownloadFileHint } from './ExportService'
import { RestoreService } from './RestoreService'
import { hashBlob } from './HashService'
import { setModifiedResourceSyncTags } from './BrowserDevicePreferences'

afterEach(() => {
  vi.unstubAllGlobals()
})

it.each([false, true])(
  'uses the system tag choice %s for native downloads and transfers without author notes',
  async (enabled) => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    const { resource, cover } = await fixture()
    const card = structuredClone(resource.metadata.card) as { data: Record<string, unknown> }
    card.data.tags = ['原标签']
    card.data.creator = '原作者'
    card.data.creator_notes = '原作者说明'
    const originalBlob = new Blob([JSON.stringify(card)], { type: 'application/json' })
    const current = {
      ...resource,
      tags: ['新标签'],
      metadata: { ...resource.metadata, card },
      originalBlob,
    }
    setModifiedResourceSyncTags(enabled)
    const service = new ExportService()
    const source = { get: vi.fn(async () => cover) }
    for (const file of [
      await service.createResourceDownloadFile(current, [cover]),
      await service.createTavernTransferFile(current, 'modified', source),
    ]) {
      const parsed = await new PngResourceParser().parse(file)
      expect(parsed.metadata.card).toMatchObject({
        data: {
          tags: enabled ? ['新标签'] : ['原标签'],
          creator: '原作者',
          creator_notes: '原作者说明',
        },
      })
      expect(JSON.stringify(parsed.metadata.card)).not.toContain('备注作者')
    }
    const original = await service.createTavernTransferFile(current, 'original', source)
    expect(await original.text()).toBe(await originalBlob.text())
    expect(card.data.tags).toEqual(['原标签'])
    if (enabled) {
      const empty = await service.createTavernTransferFile(
        { ...current, tags: [] },
        'modified',
        source,
      )
      expect((await new PngResourceParser().parse(empty)).metadata.card).toMatchObject({
        data: { tags: [] },
      })
    }
  },
)

it('renames native containers while retaining collection members and target identities', async () => {
  const { resource } = await fixture()
  const service = new ExportService()
  const source = { get: vi.fn() }
  for (const [type, metadata, value] of [
    [
      RESOURCE_TYPE.REGEX,
      { detectedVariant: 'regexCollection' },
      {
        sourceName: '目标角色',
        scoped: [{ scriptName: '成员正则', findRegex: 'x', replaceString: 'y' }],
      },
    ],
    [
      RESOURCE_TYPE.USER_PERSONA,
      {},
      { personas: { 'one.png': '人设一', 'two.png': '人设二' }, persona_descriptions: {} },
    ],
    [
      RESOURCE_TYPE.SCRIPT,
      { detectedVariant: 'tavernHelperScriptFolder' },
      {
        type: 'folder',
        name: '原组名',
        scripts: [{ type: 'script', name: '成员脚本', content: 'return 1' }],
      },
    ],
    [
      RESOURCE_TYPE.REGEX,
      { detectedVariant: 'tavernHelperRegex' },
      { script_name: '原正则', find_regex: 'x', replace_string: 'y' },
    ],
    [
      RESOURCE_TYPE.REGEX,
      { detectedVariant: 'regexPreset' },
      {
        id: 'preset-id',
        name: '原方案',
        global: ['a'],
        scoped: [],
        preset: [],
        sourceName: '目标预设',
      },
    ],
  ] as const) {
    const current = {
      ...resource,
      type,
      name: '新名称',
      metadata,
      originalBlob: new Blob([JSON.stringify(value)]),
    }
    const file = await service.createTavernTransferFile(current, 'modified', source)
    const expected =
      type === RESOURCE_TYPE.SCRIPT || metadata.detectedVariant === 'regexPreset'
        ? { ...value, name: '新名称' }
        : metadata.detectedVariant === 'tavernHelperRegex'
          ? { ...value, script_name: '新名称' }
          : value
    expect(JSON.parse(await file.text())).toEqual(expected)
    expect(JSON.parse(await current.originalBlob.text())).toEqual(value)
  }
})

it('uses one bridge choice, applies all saved edits and cover, and preserves the host filename', async () => {
  const { resource, cover } = await fixture()
  const source = { get: vi.fn(async () => cover) }
  const service = new ExportService()
  const original = await service.createTavernTransferFile(resource, 'original', source)
  expect(original.name).toBe('card.json')
  expect(await original.text()).toBe(await resource.originalBlob.text())
  expect(source.get).not.toHaveBeenCalled()
  const modified = await service.createTavernTransferFile(resource, 'modified', source)
  expect(modified.name).toBe('card.png')
  expect(source.get).toHaveBeenCalledExactlyOnceWith('cover')
  const parsed = await new PngResourceParser().parse(modified)
  expect(parsed.metadata.card).toMatchObject({
    data: {
      name: resource.name,
      first_mes: '新开场白',
      character_book: { entries: [{ content: '新世界书' }] },
      extensions: {
        regex_scripts: [{ replaceString: 'c', disabled: true }],
        tavern_helper: { scripts: [{ value: { content: 'return 2' } }] },
      },
    },
  })
  const alias = await service.createTavernTransferFile(
    resource,
    'modified',
    source,
    'host-avatar.png',
  )
  expect(alias.name).toBe('host-avatar.png')
  await expect(
    service.createTavernTransferFile(resource, 'modified', { get: vi.fn(async () => undefined) }),
  ).rejects.toThrow('自定义封面已不存在')
})

it('transfers a PNG with only a saved rename while preserving its original and host identity', async () => {
  const { resource } = await fixture()
  const service = new ExportService()
  const metadata = { ...resource.metadata }
  delete metadata.characterContentEdits
  delete metadata.characterOverrides
  delete metadata.resourceCoverId
  const first = await service.createResourceDownloadFile({ ...resource, name: '原角色', metadata })
  const parsed = await new PngResourceParser().parse(first)
  const renamed = {
    ...resource,
    name: '新角色',
    fileName: 'host-avatar.png',
    mimeType: 'image/png',
    originalBlob: first,
    metadata: parsed.metadata,
  }
  const source = { get: vi.fn(async () => undefined) }
  const original = await service.createTavernTransferFile(renamed, 'original', source)
  expect(await original.arrayBuffer()).toEqual(await first.arrayBuffer())
  const modified = await service.createTavernTransferFile(renamed, 'modified', source)
  expect(modified.name).toBe('host-avatar.png')
  expect((await new PngResourceParser().parse(modified)).metadata.card).toMatchObject({
    data: { name: '新角色' },
  })
  expect(renamed.metadata.card).toMatchObject({ data: { name: '原角色' } })
  expect(await renamed.originalBlob.arrayBuffer()).toEqual(await first.arrayBuffer())
  expect(source.get).not.toHaveBeenCalled()
})

it('keeps scoped regex transport wrappers intact and converts modified JSON chat to host JSONL', async () => {
  const { resource } = await fixture()
  const source = { get: vi.fn(async () => undefined) }
  const wrapper = {
    global: [{ scriptName: 'global' }],
    scoped: [{ scriptName: 'scoped' }],
    preset: [{ scriptName: 'preset' }],
    sourceName: 'scope',
  }
  const regex = {
    ...resource,
    type: RESOURCE_TYPE.REGEX,
    fileName: 'regex.json',
    originalBlob: new Blob([JSON.stringify(wrapper)]),
  }
  const service = new ExportService()
  expect(await (await service.createTavernTransferFile(regex, 'modified', source)).text()).toBe(
    JSON.stringify(wrapper),
  )
  const chat = {
    ...resource,
    type: RESOURCE_TYPE.CHAT,
    fileName: 'chat.json',
    metadata: { format: 'json' },
    originalBlob: new Blob([
      JSON.stringify([
        { user_name: '用户', custom: true },
        { name: '角色', is_user: false, mes: '当前消息', extra: 1 },
      ]),
    ]),
  }
  const file = await service.createTavernTransferFile(chat, 'modified', source)
  expect(file.name).toBe('整理后的名称.jsonl')
  expect(
    (await file.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual([
    { user_name: '用户', custom: true },
    { name: '角色', is_user: false, mes: '当前消息', extra: 1 },
  ])
  expect(source.get).not.toHaveBeenCalled()
})
async function fixture() {
  const book = { uid: 7, content: '原世界书', enabled: true }
  const regex = {
    id: 'regex-1',
    scriptName: '正则',
    findRegex: 'a',
    replaceString: 'b',
    disabled: false,
  }
  const script = { id: 'script-1', name: '脚本', content: 'return 1', enabled: true }
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '原角色',
      first_mes: '原开场白',
      character_book: { entries: [book] },
      extensions: {
        regex_scripts: [regex],
        tavern_helper: { scripts: [{ type: 'script', value: script }] },
      },
    },
  }
  const edits: CharacterCardContentEdit[] = [
    { id: 'g', section: 'greeting', targetKey: 'primary', before: '原开场白', after: '新开场白' },
    {
      id: 'w',
      section: 'worldBook',
      targetKey: '7',
      before: book,
      after: { ...book, content: '新世界书' },
    },
    {
      id: 'r',
      section: 'regex',
      targetKey: 'regex-1',
      before: regex,
      after: { ...regex, replaceString: 'c' },
    },
    {
      id: 's',
      section: 'helperScript',
      targetKey: 'script-1',
      before: script,
      after: { ...script, content: 'return 2' },
    },
  ].map((edit) => ({
    ...edit,
    section: edit.section as CharacterCardContentEdit['section'],
    operation: 'update',
    label: edit.id,
    migrateToVersions: false,
    updatedAt: 2,
  }))
  const blob = new Blob([JSON.stringify(card)], { type: 'application/json' })
  const resource: Resource = {
    id: 'card',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '整理后的名称',
    description: '资源备注',
    fileName: 'card.json',
    mimeType: blob.type,
    fileSize: blob.size,
    contentHash: await hashBlob(blob),
    originalBlob: blob,
    favorite: true,
    categoryId: 'folder',
    categoryIds: ['folder'],
    relatedResourceIds: ['external-card'],
    tags: ['自定义标签'],
    sourceLinks: [
      {
        id: 'link',
        type: 'other',
        url: 'https://example.com/resource',
        label: '来源',
        createdAt: 1,
      },
    ],
    metadata: {
      card,
      characterContentEdits: edits,
      characterOverrides: { regexEnabled: { 'id:regex-1': false } },
      authorNote: '备注作者',
      resourceCoverId: 'cover',
    },
    createdAt: 1,
    updatedAt: 2,
  }
  const pixels = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
    (value) => value.charCodeAt(0),
  )
  const imageBlob = new Blob([pixels], { type: 'image/png' })
  const cover: Resource = {
    ...resource,
    id: 'cover',
    type: RESOURCE_TYPE.OTHER,
    name: '新封面',
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    fileName: 'cover.png',
    mimeType: imageBlob.type,
    originalBlob: imageBlob,
    fileSize: imageBlob.size,
    contentHash: await hashBlob(imageBlob),
    metadata: {
      assetKind: 'resource-gallery-image',
      galleryOwnerId: 'card',
      galleryStorage: 'local',
      galleryVisible: false,
    },
  }
  const categories: Category[] = [
    { id: 'folder', name: '自定义文件夹', color: '#123456', createdAt: 1, updatedAt: 1 },
  ]
  return { resource, cover, categories }
}

it('packages all four content edit types, regex toggles, custom pixels and organization, then restores through the existing format', async () => {
  const { resource, cover, categories } = await fixture()
  const sourceBytes = await resource.originalBlob.text()
  const archive = await new ExportService().createResourceDownloadArchive(
    resource,
    [cover],
    categories,
  )
  expect(archive.fileName).toBe('整理后的名称-修改版.zip')
  const descriptor = archive.manifest.resources.find((entry) => entry.id === resource.id)!
  expect(descriptor).toMatchObject({
    name: resource.name,
    description: resource.description,
    tags: resource.tags,
    favorite: true,
    categoryIds: ['folder'],
    relatedResourceIds: ['external-card'],
    sourceLinks: resource.sourceLinks,
    metadata: { authorNote: '备注作者', resourceCoverId: 'cover' },
  })
  expect(archive.manifest.categories).toEqual(categories)
  expect(archive.manifest.resources.map((entry) => entry.id)).toEqual(['card', 'cover'])
  const files = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()))
  const png = new File([files[descriptor.archivePath]!], descriptor.fileName, { type: 'image/png' })
  const parsed = await new PngResourceParser().parse(png)
  const data = (parsed.metadata.card as { data: Record<string, unknown> }).data
  expect(data.first_mes).toBe('新开场白')
  expect(data.character_book).toMatchObject({ entries: [{ uid: 7, content: '新世界书' }] })
  expect(data.extensions).toMatchObject({
    regex_scripts: [{ replaceString: 'c', disabled: true }],
    tavern_helper: { scripts: [{ value: { content: 'return 2' } }] },
  })
  expect(files[archive.manifest.resources[1]!.archivePath]).toEqual(
    new Uint8Array(await cover.originalBlob.arrayBuffer()),
  )
  expect(await resource.originalBlob.text()).toBe(sourceBytes)
  expect(resource.metadata.characterContentEdits).toHaveLength(4)
  const db = new AppDatabase(`download-roundtrip-${crypto.randomUUID()}`)
  try {
    const restore = new RestoreService(
      new IndexedDbArchiveStorage(db),
      new IndexedDbRestoreStagingStore(db),
    )
    const prepared = await restore.prepare(new File([archive.blob], archive.fileName), [], [])
    await restore.restore(prepared)
    const storage = new IndexedDbResourceStorage(db)
    const recovered = (await storage.listSummaries()).find((entry) => entry.name === resource.name)!
    expect(recovered).toMatchObject({
      tags: resource.tags,
      favorite: true,
      description: resource.description,
      metadata: { authorNote: '备注作者' },
    })
    expect(
      (await db.categories.toArray()).map((folder) => ('name' in folder ? folder.name : undefined)),
    ).toEqual(['自定义文件夹'])
    const restored = await storage.get(recovered.id)
    expect(restored!.mimeType).toBe('image/png')
    expect(await storage.get(String(restored!.metadata.resourceCoverId))).toBeDefined()
  } finally {
    db.close()
    await db.delete()
  }
})

it('stops a modified download when its custom cover cannot be read', async () => {
  const { resource, cover } = await fixture()
  const service = new ExportService()
  await expect(service.createResourceDownloadArchive(resource, [], [])).rejects.toThrow(
    '封面已不存在',
  )
  cover.metadata = {
    ...cover.metadata,
    galleryStorage: 'url',
    galleryUrl: 'https://example.com/cover.png',
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))
  await expect(service.createResourceDownloadArchive(resource, [cover], [])).rejects.toThrow(
    '封面下载失败',
  )
  expect(resource.fileName).toBe('card.json')
})

it('exports a single host PNG with every saved card edit and custom artwork, without a ZIP', async () => {
  const { resource, cover } = await fixture()
  const original = await resource.originalBlob.text()
  const file = await new ExportService().createResourceDownloadFile(resource, [cover])
  expect(file.name).toBe('整理后的名称-修改版.png')
  expect(file.type).toBe('image/png')
  const parsed = await new PngResourceParser().parse(file)
  expect(parsed.metadata.card).toMatchObject({
    data: {
      name: resource.name,
      first_mes: '新开场白',
      character_book: { entries: [{ content: '新世界书' }] },
      extensions: {
        regex_scripts: [{ replaceString: 'c', disabled: true }],
        tavern_helper: { scripts: [{ value: { content: 'return 2' } }] },
      },
    },
  })
  expect(await resource.originalBlob.text()).toBe(original)
})

it('makes JSON cards without a cover into valid PNG and keeps existing PNG pixels', async () => {
  const { resource } = await fixture()
  delete resource.metadata.resourceCoverId
  const service = new ExportService()
  const first = await service.createResourceDownloadFile(resource)
  const parsed = await new PngResourceParser().parse(first)
  expect(parsed.type).toBe(RESOURCE_TYPE.CHARACTER_CARD)
  const saved = {
    ...resource,
    fileName: first.name,
    mimeType: first.type,
    originalBlob: first,
    metadata: parsed.metadata,
  }
  const second = await service.createResourceDownloadFile(saved)
  expect(new Uint8Array(await second.arrayBuffer())).toEqual(
    new Uint8Array(await first.arrayBuffer()),
  )
})

it.each([
  [
    RESOURCE_TYPE.WORLD_BOOK,
    { entries: { '0': { uid: 0, key: ['test'], content: '保存后的世界书' } } },
  ],
  [RESOURCE_TYPE.PRESET, { name: '保存后的预设', temperature: 0.7, prompts: [], prompt_order: [] }],
  [
    RESOURCE_TYPE.REGEX,
    { scriptName: '保存后的正则', findRegex: 'a', replaceString: 'b', disabled: true },
  ],
  [
    RESOURCE_TYPE.QUICK_REPLY,
    { version: 2, name: '保存后的回复', qrList: [{ label: '回复', message: 'hi' }] },
  ],
  [
    RESOURCE_TYPE.BEAUTIFICATION,
    { name: '保存后的主题', main_text_color: '#eee', custom_css: 'body{color:red}' },
  ],
  [
    RESOURCE_TYPE.SCRIPT,
    {
      type: 'script',
      id: 'script',
      name: '保存后的脚本',
      content: 'return 2',
      button: { buttons: [] },
    },
  ],
  [
    RESOURCE_TYPE.USER_PERSONA,
    {
      personas: { 'avatar.png': '保存后的人设' },
      persona_descriptions: {
        'avatar.png': { description: '当前描述', position: 0, depth: 2, role: 0 },
      },
      default_persona: 'avatar.png',
    },
  ],
] as const)(
  'exports saved %s in its host JSON format and preserves unknown fields',
  async (type, content) => {
    const value = { ...content, unknown_future_field: { keep: true } }
    const file = new File([JSON.stringify(value)], 'native.json', { type: 'application/json' })
    const parsed = await new JsonResourceParser().parse(file)
    expect(parsed.type).toBe(type)
    const { resource } = await fixture()
    const current = {
      ...resource,
      ...parsed,
      originalBlob: file,
      fileName: file.name,
      mimeType: file.type,
      name: '新资源名称',
    }
    expect(resourceDownloadFileHint(current)).toBeTruthy()
    const output = await new ExportService().createResourceDownloadFile(current)
    expect(output.name).toMatch(/-修改版\.json$/u)
    const renamed =
      type === RESOURCE_TYPE.REGEX
        ? { ...value, scriptName: current.name }
        : type === RESOURCE_TYPE.USER_PERSONA
          ? { ...value, personas: { 'avatar.png': current.name } }
          : { ...value, name: current.name }
    expect(JSON.parse(await output.text())).toEqual(renamed)
    const service = new ExportService()
    const source = { get: vi.fn() }
    const transfer = await service.createTavernTransferFile(current, 'modified', source)
    expect(transfer.name).toBe('新资源名称.json')
    expect(JSON.parse(await transfer.text())).toEqual(renamed)
    const original = await service.createTavernTransferFile(current, 'original', source)
    expect(original.name).toBe(file.name)
    expect(await original.text()).toBe(await file.text())
    expect(await current.originalBlob.text()).toBe(await file.text())
  },
)

it('exports every scope in regex bundles as the array accepted by the host importer', async () => {
  const value = {
    sourceName: '角色正则',
    global: [{ scriptName: '全局规则', findRegex: 'x', replaceString: 'y', disabled: false }],
    scoped: [{ scriptName: '规则', findRegex: 'a', replaceString: 'b', disabled: true }],
  }
  const blob = new File([JSON.stringify(value)], 'regex.json')
  const parsed = await new JsonResourceParser().parse(blob)
  const { resource } = await fixture()
  const output = await new ExportService().createResourceDownloadFile({
    ...resource,
    ...parsed,
    originalBlob: blob,
    fileName: blob.name,
  })
  expect(JSON.parse(await output.text())).toEqual([...value.global, ...value.scoped])
})

it('converts chat arrays to JSONL with a header and retains swipes, metadata and unknown fields', async () => {
  const header = {
    user_name: '用户',
    character_name: '角色',
    chat_metadata: { state: '保存值' },
    future: true,
  }
  const messages = [
    { name: '角色', mes: '保存后的聊天', is_user: false, swipes: ['甲', '乙'], future: 42 },
  ]
  const { resource } = await fixture()
  const service = new ExportService()
  const current = {
    ...resource,
    type: RESOURCE_TYPE.CHAT,
    fileName: 'chat.json',
    metadata: { format: 'json' },
    originalBlob: new Blob([JSON.stringify([header, ...messages])]),
  }
  const file = await service.createResourceDownloadFile(current)
  expect(file.name).toMatch(/\.jsonl$/u)
  expect(
    (await file.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual([header, ...messages])
  const jsonl = {
    ...current,
    originalBlob: file,
    fileName: file.name,
    metadata: { format: 'jsonl' },
  }
  expect(await (await service.createResourceDownloadFile(jsonl)).text()).toBe(await file.text())
  current.originalBlob = new Blob([JSON.stringify(messages)])
  expect(
    JSON.parse((await (await service.createResourceDownloadFile(current)).text()).split('\n')[0]!),
  ).toMatchObject({ character_name: '角色', chat_metadata: {} })
})

it.each([
  RESOURCE_TYPE.GREETING,
  RESOURCE_TYPE.EXTRA_STORY,
  RESOURCE_TYPE.POCKET_PHONE,
  RESOURCE_TYPE.SECRET,
  RESOURCE_TYPE.PLUGIN,
  RESOURCE_TYPE.OTHER,
])('does not offer native standalone export for %s', async (type) => {
  const { resource } = await fixture()
  const current = { ...resource, type }
  expect(resourceDownloadFileHint(current)).toBeUndefined()
  await expect(new ExportService().createResourceDownloadFile(current)).rejects.toThrow(
    '没有酒馆原生',
  )
})

it('preserves a wrapped chat header without embedding its message array twice', async () => {
  const { resource } = await fixture()
  const header = { user_name: '用户', character_name: '角色', chat_metadata: { future: 1 } }
  const messages = [{ name: '角色', mes: '当前消息', is_user: false, future: true }]
  const file = await new ExportService().createResourceDownloadFile({
    ...resource,
    type: RESOURCE_TYPE.CHAT,
    fileName: 'chat.json',
    metadata: { format: 'json' },
    originalBlob: new Blob([JSON.stringify({ ...header, chat: messages })]),
  })
  expect(
    (await file.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual([header, ...messages])
})

it('rejects empty JSONL and native files whose content does not match the resource type', async () => {
  const { resource } = await fixture()
  const service = new ExportService()
  await expect(
    service.createResourceDownloadFile({
      ...resource,
      type: RESOURCE_TYPE.CHAT,
      fileName: 'empty.jsonl',
      metadata: { format: 'jsonl' },
      originalBlob: new Blob([JSON.stringify({ character_name: '角色', chat_metadata: {} })]),
    }),
  ).rejects.toThrow('没有消息')
  await expect(
    service.createResourceDownloadFile({
      ...resource,
      type: RESOURCE_TYPE.WORLD_BOOK,
      fileName: 'invalid.json',
      metadata: {},
      originalBlob: new Blob([
        JSON.stringify({ scriptName: '正则', findRegex: 'a', replaceString: 'b' }),
      ]),
    }),
  ).rejects.toThrow('内容与资源类型不一致')
})
