import { describe, expect, it } from 'vitest'

import {
  canonicalizeCardJson,
  computeCardFingerprints,
  readStoredFingerprints,
} from './CharacterCardFingerprint'

const card = {
  spec: 'chara_card_v2',
  data: {
    name: '夜航船',
    description: '一段描述',
    personality: '冷静',
    first_mes: '你好。',
    alternate_greetings: ['备一'],
    creator: '某人',
  },
}

describe('canonicalizeCardJson', () => {
  it('键顺序不同的对象产生相同的规范化文本', () => {
    expect(canonicalizeCardJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalizeCardJson({ a: { c: 3, d: 2 }, b: 1 }),
    )
  })

  it('数组顺序保留，undefined 字段剔除', () => {
    expect(canonicalizeCardJson({ list: [2, 1], skip: undefined })).toBe('{"list":[2,1]}')
    expect(canonicalizeCardJson({ list: [1, 2] })).not.toBe(canonicalizeCardJson({ list: [2, 1] }))
  })
})

describe('computeCardFingerprints', () => {
  it('PNG 与 JSON 封装同一份卡数据时完整指纹一致', async () => {
    const fromPng = await computeCardFingerprints({ format: 'png', card })
    const reordered = {
      data: { ...card.data, creator: '某人' },
      spec: 'chara_card_v2',
    }
    const fromJson = await computeCardFingerprints({ card: reordered })
    expect(fromPng?.full).toBe(fromJson?.full)
    expect(fromPng?.core).toBe(fromJson?.core)
  })

  it('导出工具附加易变字段时核心指纹仍一致', async () => {
    const base = await computeCardFingerprints({ card })
    const withExtras = await computeCardFingerprints({
      card: {
        ...card,
        data: { ...card.data, create_date: '2026-07-26', chub: { id: 42 } },
      },
    })
    expect(withExtras?.full).not.toBe(base?.full)
    expect(withExtras?.core).toBe(base?.core)
  })

  it('修改或增加开场白只改变完整指纹，核心设定指纹保持一致', async () => {
    const base = await computeCardFingerprints({ card })
    const edited = await computeCardFingerprints({
      card: {
        ...card,
        data: {
          ...card.data,
          first_mes: '改过的开场白。',
          alternate_greetings: ['备一', '新增开场白'],
        },
      },
    })
    expect(edited?.full).not.toBe(base?.full)
    expect(edited?.core).toBe(base?.core)
  })

  it('设定不同的同名卡核心指纹不同', async () => {
    const base = await computeCardFingerprints({ card })
    const edited = await computeCardFingerprints({
      card: { ...card, data: { ...card.data, description: '不同的人设' } },
    })
    expect(edited?.core).not.toBe(base?.core)
  })

  it('缺少设定内容的同名卡仍保留开场白证据', async () => {
    const base = await computeCardFingerprints({
      card: { name: '空白卡', description: ' ', first_mes: '你好' },
    })
    const edited = await computeCardFingerprints({
      card: { name: '空白卡', description: ' ', first_mes: '另一个角色' },
    })
    expect(edited?.core).not.toBe(base?.core)
  })

  it('v1 卡（无 data 包裹）与 v2 同字段核心指纹一致', async () => {
    const v1 = await computeCardFingerprints({ card: { ...card.data } })
    const v2 = await computeCardFingerprints({ card })
    expect(v1?.full).toBe(v2?.full)
    expect(v1?.core).toBe(v2?.core)
  })

  it('世界书条目 uid/id 和顺序变化不改变卡内容指纹', async () => {
    const base = await computeCardFingerprints({
      card: {
        data: {
          ...card.data,
          character_book: {
            entries: [
              { uid: 1, comment: '甲', content: '设定甲' },
              { uid: 2, comment: '乙', content: '设定乙' },
            ],
          },
        },
      },
    })
    const reordered = await computeCardFingerprints({
      card: {
        data: {
          ...card.data,
          character_book: {
            entries: [
              { id: 20, comment: '乙', content: '设定乙' },
              { id: 10, comment: '甲', content: '设定甲' },
            ],
          },
        },
      },
    })

    expect(reordered?.full).toBe(base?.full)
    expect(reordered?.core).toBe(base?.core)
  })

  it('没有条目和空角色书等价于没有角色书', async () => {
    const withoutBook = await computeCardFingerprints({ card })
    const withEmptyBook = await computeCardFingerprints({
      card: { ...card, data: { ...card.data, character_book: { entries: [] } } },
    })

    expect(withEmptyBook?.full).toBe(withoutBook?.full)
  })

  it('无卡数据的资源返回 undefined', async () => {
    expect(await computeCardFingerprints({})).toBeUndefined()
    expect(await computeCardFingerprints({ card: 'oops' })).toBeUndefined()
  })
})

describe('readStoredFingerprints', () => {
  it('读取已写入 metadata 的指纹字段', () => {
    expect(readStoredFingerprints({ cardContentHash: 'f', cardCoreHash: 'c' })).toEqual({
      full: 'f',
      core: 'c',
    })
    expect(readStoredFingerprints({})).toEqual({ full: undefined, core: undefined })
  })
})
