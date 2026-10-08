import { describe, expect, it } from 'vitest'
import { readWorldBookEntries } from './WorldBookEntries'

describe('world book presentation', () => {
  it('uses the precise extension position of an exported character book without mutating it', () => {
    const entries = [
      {
        id: 0,
        comment: '深度条目',
        position: 'after_char',
        insertion_order: 220,
        enabled: true,
        keys: ['城市'],
        secondary_keys: ['夜晚'],
        selective: true,
        extensions: { position: 4, depth: 0, role: 2, probability: 1, selectiveLogic: 3 },
      },
    ]
    const original = JSON.stringify(entries)
    expect(readWorldBookEntries(entries, 'character')[0]).toMatchObject({
      id: '0',
      placement: '指定深度 0 · 助手消息',
      order: '220',
      probability: '1%',
      primaryKeys: ['城市'],
      secondaryKeys: ['夜晚'],
      conditions: [{ label: '辅助词条件', value: '全部匹配' }],
    })
    expect(JSON.stringify(entries)).toBe(original)
    expect(readWorldBookEntries(entries)[0]!.placement).toBe('指定深度 0 · 助手消息')
  })
  it('keeps native root fields authoritative and separates disabled from activation strategy', () => {
    const result = readWorldBookEntries({
      '0': {
        uid: 0,
        constant: true,
        disable: true,
        position: 0,
        probability: 0,
        extensions: { position: 4 },
      },
      '3': {
        vectorized: true,
        position: 7,
        outletName: '天气',
        useProbability: false,
        probability: 1,
      },
      '7': { position: 6, key: ['绿灯'] },
    })
    expect(result[0]).toMatchObject({
      id: '0',
      mode: 'constant',
      enabled: false,
      position: '角色设定前',
      probability: '0%',
    })
    expect(result[1]).toMatchObject({
      id: '3',
      mode: 'vector',
      placement: '出口 · 天气',
      probability: '不使用概率',
    })
    expect(result[2]).toMatchObject({ mode: 'keyword', position: '示例对话后' })
  })
  it('keeps zero, defaults, unknown values and duplicate IDs distinguishable', () => {
    const [a, b, c] = readWorldBookEntries([
      { uid: 0, position: 4 },
      { uid: 0, position: 4, depth: 0, role: 55, order: 0 },
      { uid: 99, position: 88, content: '<script>unsafe()</script>\n  preserved' },
      null,
    ])
    expect(a!.placement).toBe('指定深度 4（默认） · 系统消息（默认）')
    expect(b!.placement).toBe('指定深度 0 · 未知角色（55）')
    expect(b!.order).toBe('0')
    expect(a!.key).not.toBe(b!.key)
    expect(c!.position).toBe('未知位置（88）')
    expect(c!.content).toBe('<script>unsafe()</script>\n  preserved')
  })
})
