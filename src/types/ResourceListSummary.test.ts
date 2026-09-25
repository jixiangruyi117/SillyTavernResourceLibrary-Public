import { describe, expect, it } from 'vitest'

import {
  getResourceDescription,
  RESOURCE_TYPE,
  toResourceListSummary,
  type Resource,
} from './Resource'

describe('ResourceListSummary', () => {
  it('displays legacy chat hints without changing stored descriptions or custom notes', () => {
    const legacy = { type: RESOURCE_TYPE.CHAT, description: '45 楼 · 请在读了么中绑定角色卡' }
    expect(getResourceDescription(legacy)).toBe('45 楼 · 在读了么中阅读')
    expect(legacy.description).toBe('45 楼 · 请在读了么中绑定角色卡')
    for (const description of ['', '我的聊天备注', `${legacy.description}（我的备注）`]) {
      expect(getResourceDescription({ ...legacy, description })).toBe(description)
    }
    expect(getResourceDescription({ ...legacy, type: RESOURCE_TYPE.OTHER })).toBe(
      legacy.description,
    )
  })

  it('keeps list fields but drops full card and arbitrary nested metadata', () => {
    const resource: Resource = {
      id: 'card',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '角色',
      description: '简介',
      fileName: 'card.json',
      mimeType: 'application/json',
      fileSize: 10,
      contentHash: 'a'.repeat(64),
      favorite: false,
      categoryId: null,
      tags: ['标签'],
      metadata: {
        creator: '作者',
        cardContentHash: 'semantic-hash',
        card: { data: { description: 'x'.repeat(100_000) } },
        nested: { full: 'payload' },
        stitchedFrom: ['one', 'two'],
      },
      originalBlob: new Blob(['0123456789']),
      createdAt: 1,
      updatedAt: 1,
    }

    const summary = toResourceListSummary(resource)

    expect(summary.metadata).toMatchObject({
      creator: '作者',
      cardContentHash: 'semantic-hash',
      stitchedFrom: [],
    })
    expect(summary.metadata.card).toBeUndefined()
    expect(summary.metadata.nested).toBeUndefined()
    expect('originalBlob' in summary).toBe(false)
  })
})
