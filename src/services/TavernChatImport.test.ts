import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbResourceStorage } from '../storage/IndexedDbResourceStorage'
import { ResourceParserRegistry } from '../parser/ResourceParser'
import { PngResourceParser } from '../parser/PngResourceParser'
import { JsonResourceParser } from '../parser/JsonResourceParser'
import { ChatResourceParser } from '../parser/ChatResourceParser'
import { ResourceService } from './ResourceService'
import { ChatReaderService } from './ChatReaderService'
import { createChatArchive, readChatArchive } from './TavernChatArchiveCodec.mjs'
import { resolveChatCharacter, chatCharacterThumbnail } from './ChatReaderCharacter'
import { ExternalAppSdkService } from './ExternalAppSdkService'
import { prepareChatReturn } from './TavernChatReturn'
import { hashBlob } from './HashService'
import { RESOURCE_TYPE, includeChatCompanionIds, toResourceListSummary } from '../types/Resource'
import * as nativeFiles from '../core/NativeFileSource'
import * as thumbnails from '../utils/createImageThumbnail'

vi.mock('../utils/createImageThumbnail', () => ({
  createImageThumbnail: async () => new Blob(['thumbnail'], { type: 'image/webp' }),
}))
const databases: AppDatabase[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) await db.delete()
})
function setup() {
  const db = new AppDatabase(`chat-transfer-${crypto.randomUUID()}`)
  databases.push(db)
  const storage = new IndexedDbResourceStorage(db)
  const resources = new ResourceService(
    storage,
    new ResourceParserRegistry([
      new PngResourceParser(),
      new ChatResourceParser(),
      new JsonResourceParser(),
    ]),
  )
  return { resources, storage, database: db }
}
function png(marker: string, scripts: unknown[] = []) {
  const data = new TextEncoder().encode(
    'chara\0' +
      btoa(
        String.fromCharCode(
          ...new TextEncoder().encode(
            JSON.stringify({
              name: 'Same name',
              description: marker,
              first_mes: 'Hello',
              ...(scripts.length ? { extensions: { tavern_helper: { scripts } } } : {}),
            }),
          ),
        ),
      ),
  )
  const chunk = new Uint8Array(data.length + 12)
  new DataView(chunk.buffer).setUint32(0, data.length)
  chunk.set(new TextEncoder().encode('tEXt'), 4)
  chunk.set(data, 8)
  return new File(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk,
      new Uint8Array([0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0]),
    ],
    `${marker}.png`,
    { type: 'image/png' },
  )
}
const raw =
  '\ufeff{"user_name":"旅人","character_name":"同名角色"}\r\n{"name":"角色","is_user":false,"mes":"{{user}} <status>原文</status>"}\r\n'
function archive(marker = 'a', text = raw) {
  return createChatArchive(png(marker), new File([text], '雨夜.jsonl'), `${marker}.png`)
}
describe('chat transfer to the canonical resource library', () => {
  it('resolves complete bound-card metadata without reading card or unrelated originals', async () => {
    const { resources, storage } = setup()
    await resources.importFiles([png('bound'), png('second')])
    const [card, second] = await resources.list()
    if (!card || !second) throw new Error('card fixture missing')
    await resources.importFiles([archive()])
    const chat = (await resources.list()).find((resource) => resource.type === RESOURCE_TYPE.CHAT)!
    const unrelated = { ...card, id: 'unrelated', type: RESOURCE_TYPE.OTHER }
    await storage.save(unrelated)
    const fullRead = vi.spyOn(resources, 'get').mockRejectedValue(new Error('original not needed'))
    const summaryRead = vi.spyOn(resources, 'getSummary')
    const linked = { ...chat, relatedResourceIds: [card.id, unrelated.id, 'missing'] }
    expect(await resolveChatCharacter(linked, resources)).toEqual({
      id: card.id,
      name: card.name,
      contentHash: card.contentHash,
      fileName: card.fileName,
      card: card.metadata.card,
    })
    expect(summaryRead.mock.calls.map(([id]) => id)).toEqual([card.id, unrelated.id, 'missing'])
    expect(fullRead).not.toHaveBeenCalled()
    await expect(
      resolveChatCharacter({ ...chat, relatedResourceIds: [card.id, second.id] }, resources),
    ).rejects.toThrow('明确绑定一张角色卡')
    // A missing/non-card link still uses the portable companion in the chat metadata.
    expect(
      (await resolveChatCharacter({ ...chat, relatedResourceIds: ['missing'] }, resources)).id,
    ).toMatch(/^chat-character:/)
    expect(fullRead).not.toHaveBeenCalled()
  })

  it('reuses batch summaries/card thumbnails among 1000 resources, but keeps newly imported duplicates visible', async () => {
    const { resources, database } = setup()
    await resources.importFiles([png('filler')])
    const template = (await resources.list())[0]!
    const storedFixture = await database.resources.get(template.id)
    if (!storedFixture) throw new Error('stored fixture missing')
    const fillers = Array.from({ length: 1000 }, (_, index) => ({
      ...template,
      id: 'filler-' + index,
      contentHash: index.toString(16).padStart(64, '0'),
    }))
    const summariesFixture = fillers.map(toResourceListSummary)
    // Seed existing records in one transaction; this regression measures chat
    // batch reads, rather than externalizing the same fixture thumbnail 1000 times.
    await database.transaction(
      'rw',
      [database.resources, database.resourceSummaries, database.resourceListSummaries],
      async () => {
        await database.resources.bulkPut(
          fillers.map(({ id, contentHash }) => ({ ...storedFixture, id, contentHash })),
        )
        await database.resourceSummaries.bulkPut(summariesFixture)
        await database.resourceListSummaries.bulkPut(summariesFixture)
      },
    )
    expect(await database.resourceListSummaries.count()).toBe(1001)
    const summaries = vi.spyOn(resources, 'listResourceListSummaries')
    const thumbnail = vi.spyOn(thumbnails, 'createImageThumbnail')
    const metadata = vi.spyOn(resources, 'updateMetadata')
    const results = await resources.importFiles([
      archive(),
      archive('a', raw.replace('原文', '新原文')),
      archive(),
    ])
    expect(results.map((result) => result.status)).toEqual(['imported', 'imported', 'duplicate'])
    expect(summaries).toHaveBeenCalledTimes(1)
    expect(thumbnail).toHaveBeenCalledTimes(1)
    expect(metadata).toHaveBeenCalledTimes(3)
    await resources.importFiles([archive()])
    expect(summaries).toHaveBeenCalledTimes(2)
    expect(thumbnail).toHaveBeenCalledTimes(2)
    const first = results[0]!
    if (first.status !== 'imported') throw new Error('chat import failed')
    const stored = await resources.get(first.resource.id)
    expect(new Uint8Array(await stored!.originalBlob.arrayBuffer())).toEqual(
      new TextEncoder().encode(raw),
    )
  }, 10000)

  it('imports a native shared chat package through the service entrypoint', async () => {
    const { resources } = setup()
    const bytes = archive()
    const placeholder = new File([], bytes.name)
    const read = vi.spyOn(nativeFiles, 'materializeNativeFile').mockResolvedValue(bytes)
    try {
      const [result] = await resources.importFiles([placeholder])
      expect(result?.status).toBe('imported')
      if (result?.status !== 'imported') throw new Error('chat import failed')
      expect(result.resource.type).toBe(RESOURCE_TYPE.CHAT)
      expect(result.resource.fileSize).toBeGreaterThan(0)
    } finally {
      read.mockRestore()
    }
  })
  it('uses the existing hash index among 500 cards and skips full metadata/version preparation for chat packages', async () => {
    const { resources, storage } = setup()
    await resources.importFiles([png('a')])
    const original = (await resources.list())[0]!
    await storage.saveMany(
      Array.from({ length: 500 }, (_, index) => ({
        ...original,
        id: `filler-${index}`,
        contentHash: String(index).padStart(64, '0'),
        metadata: { card: { description: 'x'.repeat(20000) } },
      })),
    )
    const summaryRead = vi.spyOn(storage, 'listSummaries')
    const versionRead = vi.spyOn(storage, 'listVersionSummaries')
    const hashRead = vi.spyOn(storage, 'findByHash')
    expect((await resources.findByContentHash(original.contentHash))?.id).toBe(original.id)
    expect(hashRead).toHaveBeenCalledWith(original.contentHash)
    await resources.importFiles([archive()])
    expect(summaryRead).not.toHaveBeenCalled()
    expect(versionRead).not.toHaveBeenCalled()
  }, 20_000)
  it('stores only a chat by default, keeping reading rules and a portable thumbnail without full card lore', async () => {
    const { resources } = setup()
    await resources.importFiles([archive(), archive()])
    const rows = await resources.list()
    expect(rows).toHaveLength(1)
    const chat = rows[0]!
    expect(chat.type).toBe(RESOURCE_TYPE.CHAT)
    expect(chat.relatedResourceIds).toEqual([])
    const role = await resolveChatCharacter(chat, resources)
    expect(role.id).toBe(`chat-character:${await hashBlob(png('a'))}`)
    expect(role.card).not.toHaveProperty('description')
    expect(await chatCharacterThumbnail(chat.metadata)?.text()).toBe('thumbnail')
    const apps = { get: async () => ({ enabled: true }), hasPermission: async () => true }
    const sdk = new ExternalAppSdkService(apps as never, resources)
    expect((await sdk.list('reader', { types: ['chat'] })).items[0]?.chatCharacter?.id).toBe(
      role.id,
    )
    expect(await (await sdk.thumbnail('reader', chat.id))?.text()).toBe('thumbnail')
    expect(await prepareChatReturn(chat, resources, undefined, false)).toMatchObject({
      avatar: 'a.png',
    })
  })
  it('reuses the explicitly saved companion card for three chats in the same batch', async () => {
    const { resources } = setup()
    const card = png('same-role')
    const hash = await hashBlob(card)
    const files = [1, 2, 3].map((index) =>
      createChatArchive(
        card,
        new File(
          [
            raw +
              '\n' +
              JSON.stringify({ name: 'Same name', is_user: false, mes: `message ${index}` }),
          ],
          `chat-${index}.jsonl`,
        ),
        'same-role.png',
      ),
    )
    const results = await resources.importFiles(files, {
      chatCharacterBindings: { [hash]: null },
      saveChatCharacterHashes: [hash],
    })
    expect(results.map((result) => result.status)).toEqual(['imported', 'imported', 'imported'])
    const rows = await resources.list()
    const cards = rows.filter((resource) => resource.type === RESOURCE_TYPE.CHARACTER_CARD)
    const chats = rows.filter((resource) => resource.type === RESOURCE_TYPE.CHAT)
    expect(cards).toHaveLength(1)
    expect(chats).toHaveLength(3)
    const roles = await Promise.all(chats.map((chat) => resolveChatCharacter(chat, resources)))
    expect(new Set(roles.map((role) => role.id))).toEqual(new Set([cards[0]!.id]))
    expect(await hashBlob(cards[0]!.originalBlob)).toBe(hash)
  })
  it('only reuses a verified user-selected card and rejects a stale selection before writing', async () => {
    const { resources } = setup()
    await resources.importFiles([png('a')])
    const card = (await resources.list())[0]!
    const hash = await hashBlob(png('a'))
    expect(
      (
        await resources.importFiles([archive()], { chatCharacterBindings: { [hash]: 'missing' } })
      )[0]?.status,
    ).toBe('failed')
    expect(await resources.list()).toHaveLength(1)
    await resources.importFiles([archive()], { chatCharacterBindings: { [hash]: card.id } })
    const chat = (await resources.list()).find((r) => r.type === RESOURCE_TYPE.CHAT)!
    expect(chat.relatedResourceIds).toEqual([card.id])
    expect(await resources.list()).toHaveLength(2)
  })
  it('can decline an existing card and keeps different same-named companions separate', async () => {
    const { resources } = setup()
    await resources.importFiles([png('a')])
    await resources.importFiles([archive('a'), archive('b'), archive('b')])
    const rows = await resources.list()
    expect(rows).toHaveLength(3)
    const chats = rows.filter((r) => r.type === RESOURCE_TYPE.CHAT)
    expect(chats.every((r) => !r.relatedResourceIds?.length)).toBe(true)
    const roles = await Promise.all(chats.map((c) => resolveChatCharacter(c, resources)))
    expect(new Set(roles.map((r) => r.id)).size).toBe(2)
  })
  it('carries global display rules without changing originals and upgrades existing imports on redelivery', async () => {
    const { resources } = setup()
    await resources.importFiles([archive()], { saveChatCharacter: true })
    const rules = [
      {
        scriptName: '状态栏',
        findRegex: '<status>(.*?)</status>',
        replaceString: '<b>$1</b>',
        markdownOnly: true,
        placement: [2],
      },
    ]
    const file = createChatArchive(png('a'), new File([raw], '雨夜.jsonl'), 'a.png', rules)
    expect((await readChatArchive(file)).displayRules).toEqual(rules)
    await resources.importFiles([file, file], { saveChatCharacter: true })
    const rows = await resources.list()
    expect(rows).toHaveLength(3)
    const chat = rows.find((r) => r.type === RESOURCE_TYPE.CHAT)!
    const regex = rows.find((r) => r.id === chat.metadata.chatDisplayRegexId)!
    expect(regex.type).toBe(RESOURCE_TYPE.REGEX)
    expect(JSON.parse(await regex.originalBlob.text()).global).toEqual(rules)
    expect(new Uint8Array(await chat.originalBlob.arrayBuffer())).toEqual(
      new TextEncoder().encode(raw),
    )
    expect(() =>
      createChatArchive(png('a'), new File([raw], '雨夜.jsonl'), 'a.png', [
        { ...rules[0], replaceString: 'x'.repeat(3 * 1024 * 1024) },
      ]),
    ).toThrow('大小限制')
  })

  it('persists the exact originals, binds the actual card, reads it through Duleme, and deduplicates repeated delivery', async () => {
    const { resources } = setup()
    const [result] = await resources.importFiles([archive()], { saveChatCharacter: true })
    expect(result?.status).toBe('imported')
    let rows = await resources.list()
    const chat = rows.find((r) => r.type === RESOURCE_TYPE.CHAT)!
    const card = rows.find((r) => r.type === RESOURCE_TYPE.CHARACTER_CARD)!
    expect(chat.relatedResourceIds).toEqual([card.id])
    expect(new Uint8Array(await chat.originalBlob.arrayBuffer())).toEqual(
      new TextEncoder().encode(raw),
    )
    expect(new Uint8Array(await card.originalBlob.arrayBuffer())).toEqual(
      new Uint8Array(await png('a').arrayBuffer()),
    )
    expect(
      (await new ChatReaderService(resources).read(chat.id)).messages[0]?.message.mes,
    ).toContain('{{user}}')
    expect((await resources.importFiles([archive()], { saveChatCharacter: true }))[0]?.status).toBe(
      'duplicate',
    )
    rows = await resources.list()
    expect(rows).toHaveLength(2)
  })
  it('never rebinds an existing chat when identical text arrives with a different same-named character', async () => {
    const { resources } = setup()
    await resources.importFiles([archive('a'), archive('b'), archive('b')], {
      saveChatCharacter: true,
    })
    const rows = await resources.list()
    expect(rows).toHaveLength(4)
    const chats = rows.filter((r) => r.type === RESOURCE_TYPE.CHAT)
    expect(new Set(chats.flatMap((r) => r.relatedResourceIds)).size).toBe(2)
    expect(chats[0]?.contentHash).toBe(chats[1]?.contentHash)
  })
  it('validates both parts before saving; broken framing and invalid JSONL create no resources', async () => {
    const { resources } = setup()
    const broken = new File([archive().slice(0, -1)], 'broken.srlchat')
    for (const file of [broken, archive('a', '{bad json}')])
      expect((await resources.importFiles([file]))[0]?.status).toBe('failed')
    expect(await resources.list()).toHaveLength(0)
  })
  it('reports a failed relationship write and safely reuses saved originals on retry', async () => {
    const { resources } = setup()
    const bind = vi
      .spyOn(resources, 'updateDetails')
      .mockRejectedValueOnce(new Error('模拟存储失败'))
    expect(
      (await resources.importFiles([archive()], { saveChatCharacter: true }))[0],
    ).toMatchObject({
      status: 'failed',
      message: '模拟存储失败',
    })
    bind.mockRestore()
    expect((await resources.importFiles([archive()], { saveChatCharacter: true }))[0]?.status).toBe(
      'duplicate',
    )
    const rows = await resources.list()
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.type === RESOURCE_TYPE.CHAT)?.relatedResourceIds).toHaveLength(1)
  })
  it('decodes with bounded slices and rejects oversized or unsafe metadata', async () => {
    const file = archive()
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('whole-file read'))
    expect((await readChatArchive(file)).avatar).toBe('a.png')
    expect(() => createChatArchive(png('a'), new File([raw], '../chat.jsonl'), 'a.png')).toThrow(
      '无效',
    )
    const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    new DataView(prefix.buffer).setUint32(8, 1000000)
    await expect(
      readChatArchive(new File([prefix, file.slice(12)], 'bad.srlchat')),
    ).rejects.toThrow('包头')
  })
  it('accepts chats over 64 MiB and cards over 16 MiB within the shared file limit', async () => {
    const card = new File([new Uint8Array(17 * 1024 * 1024)], 'a.png')
    const chat = new File([new Uint8Array(65 * 1024 * 1024)], 'large.jsonl')
    const file = createChatArchive(card, chat, 'a.png')
    const decoded = await readChatArchive(file)
    expect(decoded.card.size).toBe(card.size)
    expect(decoded.chat.size).toBe(chat.size)
    expect(file.size).toBeGreaterThan(card.size + chat.size)
  })
})

describe('chat reading script carriage', () => {
  const phone = {
    type: 'script',
    id: 'phone',
    name: '手机',
    enabled: true,
    content: 'initializeGlobal("Phone", getVariables({type:"message"}));',
    data: { label: '保存配置' },
  }
  it('extracts legacy card scripts without saving the full card and deduplicates redelivery', async () => {
    const { resources } = setup()
    const file = createChatArchive(png('script', [phone]), new File([raw], '雨夜.jsonl'), 'a.png')
    expect((await readChatArchive(file)).hasReadingScriptSnapshot).toBe(false)
    await resources.importFiles([file, file])
    const rows = await resources.list()
    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.type === RESOURCE_TYPE.CHARACTER_CARD)).toBe(false)
    const chat = rows.find((r) => r.type === RESOURCE_TYPE.CHAT)!
    const source = rows.find((r) => r.id === chat.metadata.chatReadingScriptId)!
    expect(source.type).toBe(RESOURCE_TYPE.SCRIPT)
    expect(JSON.parse(await source.originalBlob.text()).scripts[0]).toMatchObject({
      ...phone,
      enabled: false,
    })
    expect(JSON.stringify(chat.metadata)).not.toContain(phone.content)
    expect(new Uint8Array(await chat.originalBlob.arrayBuffer())).toEqual(
      new TextEncoder().encode(raw),
    )
    const selected = new Set([chat.id])
    includeChatCompanionIds(rows, selected)
    expect([...selected]).toEqual([chat.id, source.id])
  })
  it('an explicit off snapshot skips all companion scripts, clears previous references and retains PNG/JSONL bytes', async () => {
    const { resources } = setup()
    const card = png('off', [phone]),
      chatFile = new File([raw], '雨夜.jsonl')
    await resources.importFiles([createChatArchive(card, chatFile, 'a.png')])
    const chat = (await resources.list()).find((r) => r.type === RESOURCE_TYPE.CHAT)!
    const oldScript = chat.metadata.chatReadingScriptId as string
    const archive = createChatArchive(card, chatFile, 'a.png', [], {
      carryReadingScripts: false,
      readingScripts: [{ sourceName: 'ignored', scripts: phone }],
    })
    const decoded = await readChatArchive(archive)
    expect(decoded.carryReadingScripts).toBe(false)
    expect(decoded.readingScripts).toEqual([])
    expect(await decoded.card.arrayBuffer()).toEqual(await card.arrayBuffer())
    await resources.importFiles([archive])
    expect((await resources.get(chat.id))?.metadata.chatReadingScriptId).toBeNull()
    expect(await resources.get(oldScript)).toBeDefined()
    expect(
      new Uint8Array(await (await resources.get(chat.id))!.originalBlob.arrayBuffer()),
    ).toEqual(new TextEncoder().encode(raw))
  })
  it('stores selected global/preset code separately and preserves old-package reimports', async () => {
    const { resources } = setup()
    const file = createChatArchive(png('a'), new File([raw], '雨夜.jsonl'), 'a.png', [], {
      readingScripts: [{ sourceName: '全局手机', scripts: phone }],
    })
    expect((await readChatArchive(file)).hasReadingScriptSnapshot).toBe(true)
    await resources.importFiles([file, file])
    const chat = (await resources.list()).find((r) => r.type === RESOURCE_TYPE.CHAT)!
    const sourceId = chat.metadata.chatReadingScriptId
    await resources.importFiles([archive()])
    expect((await resources.get(chat.id))?.metadata.chatReadingScriptId).toBe(sourceId)
    await resources.importFiles([
      createChatArchive(png('a'), new File([raw], '雨夜.jsonl'), 'a.png', [], {
        readingScripts: [],
      }),
    ])
    expect((await resources.get(chat.id))?.metadata.chatReadingScriptId).toBeNull()
    // Existing sources may be used by another chat; clearing a reference never deletes them.
    expect(await resources.get(sourceId as string)).toBeDefined()
  })
  it('rejects unrecognizable and excessive sources before storing chat/card resources', async () => {
    const { resources } = setup()
    const files = [
      createChatArchive(png('a'), new File([raw], '雨夜.jsonl'), 'a.png', [], {
        readingScripts: [{ sourceName: '坏来源', scripts: { other: true } }],
      }),
      createChatArchive(
        png(
          'a',
          Array.from({ length: 65 }, (_, i) => ({ ...phone, id: String(i) })),
        ),
        new File([raw], '雨夜.jsonl'),
        'a.png',
      ),
    ]
    for (const file of files)
      expect((await resources.importFiles([file], { saveChatCharacter: true }))[0]?.status).toBe(
        'failed',
      )
    expect(await resources.list()).toHaveLength(0)
    expect(() =>
      createChatArchive(png('a'), new File([raw], '雨夜.jsonl'), 'a.png', [], {
        readingScripts: Array.from({ length: 9 }, () => ({ sourceName: '手机', scripts: phone })),
      }),
    ).toThrow('来源')
    expect(() =>
      createChatArchive(png('a'), new File([raw], '雨夜.jsonl'), 'a.png', [], {
        readingScripts: [
          { sourceName: '手机', scripts: { ...phone, content: 'x'.repeat(2 * 1024 * 1024) } },
        ],
      }),
    ).toThrow('大小限制')
  })
})
