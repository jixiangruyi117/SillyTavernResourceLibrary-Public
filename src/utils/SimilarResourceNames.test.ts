import { describe, expect, it } from 'vitest'

import type { ResourceSummary } from '../types/Resource'
import { findSimilarResourceNameGroups } from './SimilarResourceNames'

function resource(id: string, name: string): ResourceSummary {
  return { id, name, tags: [], metadata: {} } as unknown as ResourceSummary
}

describe('findSimilarResourceNameGroups', () => {
  it('广泛模式在缺少基础版时归拢版本和番外，不合并只有共同短前缀的资源', () => {
    const items = [
      resource('formal', '资源A（正式版）'),
      resource('extra', '资源A（番外）'),
      resource('v2', '资源A2.0'),
      resource('v3', '资源A v3.1（修订版）'),
      resource('other', '资源B特别故事'),
    ]
    expect(findSimilarResourceNameGroups(items).some((group) => group.resources.length === 4)).toBe(
      false,
    )
    const groups = findSimilarResourceNameGroups(items, 'broad')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.resources.map((item) => item.id).sort()).toEqual([
      'extra',
      'formal',
      'v2',
      'v3',
    ])
  })
  it('把同名和“名称（番外）”归为一组', () => {
    const groups = findSimilarResourceNameGroups([
      resource('base', 'A'),
      resource('extra', 'A（番外）'),
      resource('other', 'B'),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].resources.map((item) => item.id).sort()).toEqual(['base', 'extra'])
  })

  it('把括号内的版本说明视为名称变体', () => {
    const groups = findSimilarResourceNameGroups([
      resource('base', 'Alice'),
      resource('revised', 'Alice（修订）'),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].resources).toHaveLength(2)
  })

  it('忽略全半角、大小写和标点差异，并收集同名资源', () => {
    const groups = findSimilarResourceNameGroups([
      resource('one', 'Alice!'),
      resource('two', 'ＡＬＩＣＥ'),
      resource('three', ' Alice '),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].resources).toHaveLength(3)
  })

  it('识别至少四字符名称中的单字符增删改', () => {
    const groups = findSimilarResourceNameGroups([
      resource('base', 'Alice'),
      resource('typo', 'Alicf'),
      resource('different', 'Bob'),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].resources.map((item) => item.id).sort()).toEqual(['base', 'typo'])
  })

  it('短名称只按同名或明确变体后缀归组，避免宽泛误报', () => {
    expect(findSimilarResourceNameGroups([resource('a', 'A'), resource('b', 'B')])).toEqual([])
  })

  it('没有名称的资源不进入分组', () => {
    expect(
      findSimilarResourceNameGroups([resource('empty-a', ''), resource('empty-b', '  ')]),
    ).toEqual([])
  })

  it('能扫描几千个名称并找出相邻编号变体', () => {
    const resources = Array.from({ length: 3_000 }, (_, index) =>
      resource(`resource-${index}`, `角色卡${String(index).padStart(5, '0')}`),
    )

    expect(findSimilarResourceNameGroups(resources).length).toBeGreaterThan(0)
  })
})
