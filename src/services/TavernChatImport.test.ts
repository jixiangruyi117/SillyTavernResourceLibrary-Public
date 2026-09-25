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
import { RESOURCE_TYPE } from '../types/Resource'

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
  return { resources, storage }
}
function png(marker: string) {
  const data = new TextEncoder().encode(
    'chara\0' +
      btoa(JSON.stringify({ name: 'Same name', description: marker, first_mes: 'Hello' })),
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
  })
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
