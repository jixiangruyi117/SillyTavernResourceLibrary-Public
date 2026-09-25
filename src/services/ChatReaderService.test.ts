import { describe, expect, it, vi } from 'vitest'
import { ChatReaderService } from './ChatReaderService'
import type { ResourceService } from './ResourceService'
import { ChatResourceParser } from '../parser/ChatResourceParser'

async function fixture() {
  const rows = [
    { name: '角色', mes: '第一楼', is_user: false },
    { name: 'system', mes: '隐藏', is_user: false, is_system: true },
    { name: '用户', mes: '第三楼', is_user: true },
    { name: '角色', mes: '末楼', is_user: false },
  ]
  const originalBlob = new File([rows.map((x) => JSON.stringify(x)).join('\n')], 'test.jsonl')
  const parsed = await new ChatResourceParser().parse(originalBlob)
  const chat = {
    ...parsed,
    id: 'chat',
    originalBlob,
    contentHash: 'original',
    relatedResourceIds: ['old', 'regex'],
    tags: [],
    categoryId: null,
  }
  const resources = {
    get: vi.fn(async (id: string) =>
      id === 'chat' ? chat : { id, type: id === 'bad' ? 'regex' : 'characterCard' },
    ),
    listResourceListSummaries: vi.fn(async () => [
      { id: 'old', type: 'characterCard' },
      { id: 'new', type: 'characterCard' },
    ]),
    updateDetails: vi.fn(),
  }
  return {
    service: new ChatReaderService(resources as unknown as ResourceService),
    resources,
    chat,
  }
}
describe('ChatReaderService', () => {
  it('隐藏用户时跳过连续用户章，前后导航保留原楼号与正则深度', async () => {
    const { service, chat } = await fixture()
    const users = [true, false, true, true, false, true, false, true]
    chat.originalBlob = new File(
      [
        users
          .map((is_user, index) =>
            JSON.stringify({
              name: is_user ? '用户' : '角色',
              mes: `内容${index}`,
              is_user,
            }),
          )
          .join('\n'),
      ],
      'test.jsonl',
    )
    chat.metadata.messageCount = 8
    chat.metadata.visibleMessageCount = 8
    const first = await service.read('chat', 0, 1, { hideUser: true })
    expect(first).toMatchObject({
      previousOffset: null,
      nextOffset: 4,
      messages: [{ index: 1, depth: 6 }],
    })
    const second = await service.read('chat', first.nextOffset!, 1, { hideUser: true })
    expect(second).toMatchObject({
      previousOffset: 1,
      nextOffset: 6,
      messages: [{ index: 4, depth: 3 }],
    })
    const back = await service.read('chat', second.previousOffset!, 1, {
      hideUser: true,
      backward: true,
    })
    expect(back).toEqual(first)
    const batch = await service.read('chat', 6, 2, { hideUser: true, backward: true })
    expect(batch.messages.map((x) => x.index)).toEqual([4, 6])
    expect(batch).toMatchObject({ previousOffset: 1, nextOffset: null })
    expect(
      (await service.read('chat', 7, 1, { hideUser: true })).messages.map((x) => x.index),
    ).toEqual([6])
    expect((await service.read('chat', 2, 1)).messages[0]?.message.is_user).toBe(true)
  })

  it('全为用户的记录没有空章节导航', async () => {
    const { service, chat } = await fixture()
    chat.originalBlob = new File(
      [JSON.stringify({ name: '用户', mes: '仅用户', is_user: true })],
      'test.jsonl',
    )
    chat.metadata.messageCount = 1
    expect(await service.read('chat', 0, 1, { hideUser: true })).toMatchObject({
      messages: [],
      previousOffset: null,
      nextOffset: null,
    })
  })
  it('reviews the selected saved reply against the nearest earlier snapshot and reports gaps', async () => {
    const { service, chat, resources } = await fixture()
    const rows = [
      {
        name: '角色',
        is_user: false,
        mes: '开场',
        variables: [{ stat_data: { 地点: '家', 好感: 1 } }],
      },
      { name: '用户', is_user: true, mes: '继续' },
      {
        name: '角色',
        is_user: false,
        mes: '当前',
        swipes: ['当前', '备用'],
        swipe_id: 0,
        variables: [
          { stat_data: { 地点: '基地', 好感: 3 } },
          { stat_data: { 地点: '公园', 好感: 9 } },
        ],
      },
      { name: '角色', is_user: false, mes: '空快照', variables: [{}] },
    ]
    chat.originalBlob = new File([rows.map((x) => JSON.stringify(x)).join('\n')], 'variables.jsonl')
    expect(await service.variableReview('chat', 0)).toMatchObject({
      status: 'initial',
      baseline: null,
    })
    expect(await service.variableReview('chat', 1)).toMatchObject({
      status: 'missing',
      changes: [],
    })
    const result = await service.variableReview('chat', 2, { '2': 1 })
    expect(result).toMatchObject({
      status: 'compared',
      floor: 2,
      replyId: 1,
      baseline: { floor: 0, replyId: 0 },
      missingFloors: 1,
    })
    expect(result.changes.find((x) => x.path === '好感')).toMatchObject({ delta: 8 })
    expect(await service.variableReview('chat', 3)).toMatchObject({ status: 'incompatible' })
    rows[2]!.variables = [{ stat_data: { 地点: '基地', 好感: 3 } }]
    chat.originalBlob = new File([rows.map((x) => JSON.stringify(x)).join('\n')], 'variables.jsonl')
    expect(await service.variableReview('chat', 2, { '2': 1 })).toMatchObject({ status: 'missing' })
    expect(resources.updateDetails).not.toHaveBeenCalled()
    await expect(service.variableReview('chat', 4)).rejects.toThrow('不存在')
  })
  it('returns a bounded chapter directory without message variables or raw HTML', async () => {
    const { service, chat } = await fixture()
    chat.originalBlob = new File(
      [
        JSON.stringify({
          name: '角色',
          is_user: false,
          mes: '<status_top>不作为章节标题的日期和数值</status_top>```html\n<script>hidden()</script>\n```\n正文的关键词',
          variables: { secret: 'not in outline' },
        }) +
          '\n' +
          JSON.stringify({ name: '用户', is_user: true, mes: '第二章' }),
      ],
      'outline.jsonl',
    )
    const result = await service.chapters('chat', 0, 1)
    expect(result.items).toEqual([
      { floor: 0, name: '角色', isUser: false, text: '正文的关键词', replies: 1 },
    ])
    expect(result.nextOffset).toBe(1)
    expect(JSON.stringify(result)).not.toContain('secret')
    await expect(service.chapters('chat', 0, 51)).rejects.toThrow('参数')
  })
  it('pages original messages and calculates ST depth ignoring system messages', async () => {
    const { service } = await fixture()
    const page = await service.read('chat', 2, 1)
    expect(page).toMatchObject({
      total: 4,
      nextOffset: 3,
      contentHash: 'original',
      messages: [{ index: 2, depth: 1, message: { mes: '第三楼' } }],
    })
    expect((await service.read('chat', 3)).nextOffset).toBeNull()
    await expect(service.read('chat', 0, 0)).rejects.toThrow('分页')
  })
  it('searches originals once and returns bounded floor excerpts', async () => {
    const { service } = await fixture()
    expect(await service.search('chat', '楼', 2)).toEqual({
      results: [
        { floor: 2, text: '第三楼' },
        { floor: 3, text: '末楼' },
      ],
      nextOffset: null,
    })
    await expect(service.search('chat', '')).rejects.toThrow('参数')
  })
  it('binds one real character using existing resource relationships, preserving non-character links and originals', async () => {
    const { service, resources, chat } = await fixture()
    await service.bind('chat', 'new')
    expect(resources.updateDetails).toHaveBeenCalledWith(
      chat,
      expect.objectContaining({ relatedResourceIds: ['regex', 'new'] }),
    )
    await expect(service.bind('chat', 'bad')).rejects.toThrow('角色卡')
  })
})
