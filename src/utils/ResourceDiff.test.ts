import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { diffLines, diffResources } from './ResourceDiff'

function resource(overrides: Partial<Resource>): Resource {
  return {
    id: 'r1',
    type: RESOURCE_TYPE.OTHER,
    name: '资源',
    fileName: 'file.json',
    mimeType: 'application/json',
    contentHash: 'hash-a',
    metadata: {},
    originalBlob: new Blob(['{}'], { type: 'application/json' }),
    ...overrides,
  } as Resource
}

function characterCard(hash: string, data: Record<string, unknown>): Resource {
  return resource({
    type: RESOURCE_TYPE.CHARACTER_CARD,
    contentHash: hash,
    fileName: 'card.png',
    mimeType: 'image/png',
    metadata: { card: { spec: 'chara_card_v2', data } },
    originalBlob: new Blob(['png'], { type: 'image/png' }),
  })
}

describe('diffLines', () => {
  it('相同文本全部标记为 same', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ])
  })

  it('按 LCS 标出新增与删除行', () => {
    const ops = diffLines('第一行\n第二行\n第三行', '第一行\n改过的第二行\n第三行')
    expect(ops).toEqual([
      { type: 'same', text: '第一行' },
      { type: 'removed', text: '第二行' },
      { type: 'added', text: '改过的第二行' },
      { type: 'same', text: '第三行' },
    ])
  })

  it('空旧文本时整体为新增', () => {
    expect(diffLines('', 'x')).toEqual([{ type: 'added', text: 'x' }])
  })
})

describe('diffResources', () => {
  it('内容指纹一致时直接判定 identical', async () => {
    const result = await diffResources(
      resource({ contentHash: 'same' }),
      resource({ contentHash: 'same' }),
    )
    expect(result.kind).toBe('identical')
    expect(result.summary).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('角色卡按字段对比：描述修改与备用开场白新增分别列出', async () => {
    const before = characterCard('h1', {
      name: '夜航船',
      description: '旧描述',
      first_mes: '你好。',
      alternate_greetings: ['备一'],
    })
    const after = characterCard('h2', {
      name: '夜航船',
      description: '新描述',
      first_mes: '你好。',
      alternate_greetings: ['备一', '备二'],
    })
    const result = await diffResources(before, after)
    expect(result.kind).toBe('character')
    const labels = result.fields.map((field) => `${field.label}:${field.status}`)
    expect(labels).toContain('描述:changed')
    expect(labels).toContain('备用开场白 2:added')
    expect(labels).not.toContain('名称:changed')
    expect(result.summary.changed).toBe(1)
    expect(result.summary.added).toBe(1)
  })

  it('角色卡内嵌世界书按条目对比', async () => {
    const before = characterCard('h1', {
      name: 'A',
      character_book: {
        entries: [
          { uid: 1, comment: '设定甲', content: '旧内容' },
          { uid: 2, comment: '设定乙', content: '保持' },
        ],
      },
    })
    const after = characterCard('h2', {
      name: 'A',
      character_book: {
        entries: [
          { uid: 1, comment: '设定甲', content: '新内容' },
          { uid: 3, comment: '设定丙', content: '新增' },
        ],
      },
    })
    const result = await diffResources(before, after)
    const statuses = Object.fromEntries(result.entries.map((entry) => [entry.label, entry.status]))
    expect(statuses['设定甲']).toBe('changed')
    expect(statuses['设定丙']).toBe('added')
    expect(statuses['设定乙']).toBe('removed')
  })

  it('世界书 JSON 按 uid 匹配条目', async () => {
    const makeBook = (hash: string, entries: unknown) =>
      resource({
        type: RESOURCE_TYPE.WORLD_BOOK,
        contentHash: hash,
        originalBlob: new Blob([JSON.stringify({ entries })], { type: 'application/json' }),
      })
    const result = await diffResources(
      makeBook('h1', { '0': { uid: 0, comment: '城市', content: '旧' } }),
      makeBook('h2', { '0': { uid: 0, comment: '城市', content: '新' } }),
    )
    expect(result.kind).toBe('worldBook')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].status).toBe('changed')
    expect(result.entries[0].lines?.some((op) => op.type === 'added')).toBe(true)
  })

  it('普通 JSON 资源回退为格式化文本行 diff', async () => {
    const result = await diffResources(
      resource({ contentHash: 'h1', originalBlob: new Blob(['{"a":1}']) }),
      resource({ contentHash: 'h2', originalBlob: new Blob(['{"a":2}']) }),
    )
    expect(result.kind).toBe('text')
    expect(result.lines.some((op) => op.type === 'removed' && op.text.includes('1'))).toBe(true)
    expect(result.lines.some((op) => op.type === 'added' && op.text.includes('2'))).toBe(true)
  })

  it('无法按文本读取的二进制资源标记为 binary', async () => {
    const binary = (hash: string) =>
      resource({
        contentHash: hash,
        fileName: 'image.webp',
        mimeType: 'image/webp',
        originalBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
      })
    const result = await diffResources(binary('h1'), binary('h2'))
    expect(result.kind).toBe('binary')
  })
})
