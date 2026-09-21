import { describe, expect, it } from 'vitest'

import type { TavernResourceItem } from '../services/TavernBridgeProtocol'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'
import {
  bridgeKindOfResource,
  buildLocalNameIndex,
  buildTavernNameIndex,
  localResourceExistsInTavern,
  normalizeBridgeName,
  tavernItemExistsLocally,
} from './TavernBridgeDiff'

function tavernItem(overrides: Partial<TavernResourceItem>): TavernResourceItem {
  return {
    id: 'character:a.png',
    kind: 'character',
    name: '夜航船',
    fileName: '夜航船.png',
    detail: '',
    ...overrides,
  } as TavernResourceItem
}

function local(overrides: Partial<ResourceSummary>): ResourceSummary {
  return {
    id: 'r1',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '夜航船',
    fileName: '夜航船.png',
    metadata: {},
    tags: [],
    ...overrides,
  } as unknown as ResourceSummary
}

describe('normalizeBridgeName', () => {
  it('去扩展名、大小写与全半角差异', () => {
    expect(normalizeBridgeName('夜航船.PNG')).toBe('夜航船')
    expect(normalizeBridgeName(' Card.json ')).toBe('card')
    expect(normalizeBridgeName('ＡＢＣ')).toBe('abc')
  })
})

describe('bridgeKindOfResource', () => {
  it('按元数据区分三种正则作用域', () => {
    const base = { type: RESOURCE_TYPE.REGEX } as ResourceSummary
    expect(bridgeKindOfResource({ ...base, metadata: {} } as ResourceSummary)).toBe('regexGlobal')
    expect(
      bridgeKindOfResource({
        ...base,
        metadata: { extractedFromCharacterId: 'x' },
      } as unknown as ResourceSummary),
    ).toBe('regexCharacter')
    expect(
      bridgeKindOfResource({ ...base, metadata: { regexScope: 'preset' } } as ResourceSummary),
    ).toBe('regexPreset')
  })

  it('非主题美化与未知类型返回 undefined', () => {
    expect(
      bridgeKindOfResource({
        type: RESOURCE_TYPE.BEAUTIFICATION,
        metadata: {},
      } as ResourceSummary),
    ).toBeUndefined()
    expect(
      bridgeKindOfResource({ type: RESOURCE_TYPE.OTHER, metadata: {} } as ResourceSummary),
    ).toBeUndefined()
  })
})

describe('两端存在性判断', () => {
  it('酒馆条目按名称或文件名主体与库内同类匹配', () => {
    const localIndex = buildLocalNameIndex([local({})])
    expect(tavernItemExistsLocally(tavernItem({}), localIndex)).toBe(true)
    expect(
      tavernItemExistsLocally(tavernItem({ name: '别的卡', fileName: 'other.png' }), localIndex),
    ).toBe(false)
  })

  it('同名不同类不算存在', () => {
    const localIndex = buildLocalNameIndex([local({})])
    expect(
      tavernItemExistsLocally(
        tavernItem({ kind: 'worldBook', fileName: '夜航船.json' }),
        localIndex,
      ),
    ).toBe(false)
  })

  it('库内资源反向匹配酒馆目录', () => {
    const tavernIndex = buildTavernNameIndex([tavernItem({})])
    expect(localResourceExistsInTavern(local({}), tavernIndex)).toBe(true)
    expect(
      localResourceExistsInTavern(
        local({ name: '新卡', fileName: '新卡.png' } as Partial<ResourceSummary>),
        tavernIndex,
      ),
    ).toBe(false)
  })
})
