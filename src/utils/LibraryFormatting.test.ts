import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE, type ResourceReference } from '../types/Resource'
import {
  formatBackupDate,
  formatBytes,
  summarizeFileNames,
  summarizeResourceTypes,
} from './LibraryFormatting'

function reference(type: ResourceReference['type']): ResourceReference {
  return { id: `id-${type}`, type } as ResourceReference
}

describe('formatBytes', () => {
  it('零字节显示为 0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('按 KB / MB / GB 逐级换算', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
  })
})

describe('formatBackupDate', () => {
  it('没有时间戳时提示尚未备份', () => {
    expect(formatBackupDate()).toBe('尚未完整备份')
    expect(formatBackupDate(0)).toBe('尚未完整备份')
  })

  it('有时间戳时输出本地化时间', () => {
    expect(formatBackupDate(Date.UTC(2026, 6, 26))).toContain('2026')
  })
})

describe('summarizeResourceTypes', () => {
  it('按类型统计并使用中文标签', () => {
    const summary = summarizeResourceTypes([
      reference(RESOURCE_TYPE.CHARACTER_CARD),
      reference(RESOURCE_TYPE.CHARACTER_CARD),
      reference(RESOURCE_TYPE.WORLD_BOOK),
    ])
    expect(summary).toContain('2')
    expect(summary).toContain('1')
    expect(summary).toContain('、')
  })

  it('空列表返回空字符串', () => {
    expect(summarizeResourceTypes([])).toBe('')
  })
})

describe('summarizeFileNames', () => {
  it('不超过上限时全部展示', () => {
    expect(summarizeFileNames(['a.png', 'b.json'])).toBe('a.png、b.json')
  })

  it('超出上限时补充剩余数量', () => {
    expect(summarizeFileNames(['a', 'b', 'c', 'd', 'e'])).toBe('a、b、c，另有 2 项')
  })

  it('支持自定义上限', () => {
    expect(summarizeFileNames(['a', 'b', 'c'], 1)).toBe('a，另有 2 项')
  })
})
