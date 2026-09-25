import { describe, expect, it } from 'vitest'
import { ChatResourceParser, readChatMessages, jsonChatRecords } from './ChatResourceParser'
import { JsonResourceParser } from './JsonResourceParser'

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of values) result.push(value)
  return result
}

const header = { user_name: 'unused', character_name: 'unused', chat_metadata: { integrity: 'id' } }
const first = {
  name: '角色',
  mes: '你好 {{user}}',
  is_user: false,
  extra: { variables: { score: 1 } },
}
const second = {
  name: '许安',
  mes: '下雨了',
  is_user: true,
  swipes: ['下雨了', '天晴了'],
  swipe_id: 0,
}
const jsonl = (rows: unknown[]) =>
  new File(['\uFEFF' + rows.map((x) => JSON.stringify(x)).join('\r\n')], '雨夜.jsonl')
describe('ChatResourceParser', () => {
  it('recognizes JSONL without persisting bodies or inferring the character from names', async () => {
    const file = jsonl([header, first, second])
    const result = await new ChatResourceParser().parse(file)
    expect(result).toMatchObject({
      type: 'chat',
      name: '雨夜',
      metadata: { messageCount: 2, visibleMessageCount: 2, chatUserNames: ['许安'] },
    })
    expect(result.metadata).not.toHaveProperty('messages')
    expect(result.metadata).not.toHaveProperty('characterId')
    expect(await collect(readChatMessages(file))).toEqual([first, second])
  })
  it('reports malformed lines and rejects empty/header-only chats', async () => {
    const parser = new ChatResourceParser()
    await expect(
      parser.parse(new File([JSON.stringify(header) + '\n{broken'], 'x.jsonl')),
    ).rejects.toThrow('第 2 行')
    await expect(parser.parse(jsonl([header]))).rejects.toThrow('没有消息')
    await expect(
      parser.parse(jsonl([first, { name: '坏消息', mes: 7, is_user: false }])),
    ).rejects.toThrow('第 2 行')
  })
  it('preserves the empty system flag used by saved chats without accepting arbitrary flags', async () => {
    const message = { ...first, is_system: '', variables: { score: 2 } }
    const file = jsonl([header, message])
    expect(await collect(readChatMessages(file))).toEqual([message])
    expect((await new ChatResourceParser().parse(file)).metadata).toMatchObject({
      messageCount: 1,
      visibleMessageCount: 1,
    })
    expect(jsonChatRecords([header, message])).toEqual([message])
    for (const flag of ['false', 'true', 1, {}, []]) {
      expect(jsonChatRecords([{ ...first, is_system: flag }])).toBeUndefined()
    }
  })
  it('handles split UTF-8 characters, headerless chats and keeps all original message fields', async () => {
    const large = { ...first, mes: '中'.repeat(100_000) }
    expect(await collect(readChatMessages(jsonl([large, second])))).toEqual([large, second])
  })
  it('recognizes strict JSON chat arrays without stealing unrelated resource formats', async () => {
    const parsed = await new JsonResourceParser().parse(
      new File([JSON.stringify([header, first])], 'chat.json'),
    )
    expect(parsed.type).toBe('chat')
    expect(jsonChatRecords([{ role: 'user', content: 'hello' }])).toBeUndefined()
    expect(jsonChatRecords({ first_mes: 'hello', name: 'card' })).toBeUndefined()
    expect(jsonChatRecords([{ name: 'rule', findRegex: 'a', replaceString: 'b' }])).toBeUndefined()
  })
})
