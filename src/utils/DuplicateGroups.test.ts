import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import { findContainerVariantGroups, findDuplicateGroups } from './DuplicateGroups'

function summary(id: string, contentHash: string, updatedAt: number): ResourceSummary {
  return {
    id,
    contentHash,
    updatedAt,
    name: id,
    tags: [],
    metadata: {},
  } as unknown as ResourceSummary
}

describe('findDuplicateGroups', () => {
  it('只返回出现两次以上的内容指纹', () => {
    const groups = findDuplicateGroups([
      summary('a', 'h1', 1),
      summary('b', 'h1', 2),
      summary('c', 'h2', 3),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].contentHash).toBe('h1')
  })

  it('组内按更新时间倒序，最新副本排在首位', () => {
    const groups = findDuplicateGroups([
      summary('old', 'h1', 100),
      summary('newest', 'h1', 300),
      summary('mid', 'h1', 200),
    ])
    expect(groups[0].resources.map((item) => item.id)).toEqual(['newest', 'mid', 'old'])
  })

  it('组间按重复数量降序排列', () => {
    const groups = findDuplicateGroups([
      summary('a', 'pair', 1),
      summary('b', 'pair', 2),
      summary('c', 'triple', 1),
      summary('d', 'triple', 2),
      summary('e', 'triple', 3),
    ])
    expect(groups.map((group) => group.contentHash)).toEqual(['triple', 'pair'])
  })

  it('缺少内容指纹的资源不参与查重', () => {
    expect(findDuplicateGroups([summary('a', '', 1), summary('b', '', 2)])).toEqual([])
  })

  it('没有重复时返回空数组', () => {
    expect(findDuplicateGroups([summary('a', 'h1', 1), summary('b', 'h2', 2)])).toEqual([])
  })
})

describe('findContainerVariantGroups', () => {
  function card(
    id: string,
    contentHash: string,
    cardHash: string | undefined,
    fileName: string,
    updatedAt = 1,
  ) {
    return {
      id,
      type: RESOURCE_TYPE.CHARACTER_CARD,
      contentHash,
      fileName,
      mimeType: fileName.endsWith('.png') ? 'image/png' : 'application/json',
      metadata: cardHash ? { cardContentHash: cardHash } : {},
      updatedAt,
      name: id,
      tags: [],
    } as unknown as ResourceSummary
  }

  it('同卡指纹但不同文件指纹的 PNG/JSON 归为一组，PNG 排在保留位', () => {
    const groups = findContainerVariantGroups([
      card('json', 'file-b', 'card-1', 'a.json', 9),
      card('png', 'file-a', 'card-1', 'a.png', 1),
      card('other', 'file-c', 'card-2', 'b.png'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].resources.map((item) => item.id)).toEqual(['png', 'json'])
  })

  it('文件指纹完全相同的组不重复出现在封装组里', () => {
    const groups = findContainerVariantGroups([
      card('a', 'same-file', 'card-1', 'a.png'),
      card('b', 'same-file', 'card-1', 'b.png'),
    ])
    expect(groups).toEqual([])
  })

  it('缺少卡指纹或非角色卡的资源不参与', () => {
    const groups = findContainerVariantGroups([
      card('a', 'f1', undefined, 'a.png'),
      card('b', 'f2', undefined, 'b.json'),
    ])
    expect(groups).toEqual([])
  })
})
