import { describe, expect, it } from 'vitest'
import { compareChatVariables } from './ChatVariableReview'

describe('saved chat variable comparison', () => {
  it('compares raw MVU state without schema/display noise or numeric coercion', () => {
    const before = {
      stat_data: { 地点: '家', 好感: 2, 任务: false, 旧值: null, 数字文本: '2' },
      schema: { a: 1 },
      display_data: { x: '旧描述' },
    }
    const after = {
      stat_data: { 地点: '基地', 好感: 5, 任务: true, 新值: 0, 数字文本: 2 },
      schema: { b: 2 },
      display_data: { x: '新描述' },
    }
    const result = compareChatVariables(before, after)
    expect(result.changes.find((x) => x.path === '好感')).toMatchObject({
      before: '2',
      after: '5',
      delta: 3,
    })
    expect(result.changes.find((x) => x.path === '数字文本')).not.toHaveProperty('delta')
    expect(result.changes.find((x) => x.path === '旧值')).toMatchObject({
      type: 'removed',
      before: 'null',
    })
    expect(result.changes.find((x) => x.path === '新值')).toMatchObject({
      type: 'added',
      after: '0',
    })
    expect(result.changes.some((x) => /schema|display_data/.test(x.path))).toBe(false)
    expect(before.stat_data.好感).toBe(2)
  })
  it('ignores object ordering, handles arrays and distinguishes empty from absent', () => {
    expect(compareChatVariables({ a: 1, b: 2 }, { b: 2, a: 1 }).changes).toEqual([])
    expect(compareChatVariables({ a: [] }, { a: [false] }).changes[0]).toMatchObject({
      path: 'a › 0',
      type: 'added',
      after: 'false',
    })
    expect(compareChatVariables({ a: {} }, {}).changes[0]?.type).toBe('removed')
    expect(compareChatVariables({ stat_data: {} }, {}).incompatible).toBe(true)
    expect(
      compareChatVariables({}, JSON.parse('{"__proto__":{"value":1}}')).changes[0],
    ).toMatchObject({ path: '__proto__', type: 'added', before: '未保存此项' })
  })
  it('bounds rows and previews instead of claiming oversized states are identical', () => {
    const before = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [String(i), 0]))
    const after = Object.fromEntries(
      Array.from({ length: 250 }, (_, i) => [String(i), 'x'.repeat(1000)]),
    )
    const result = compareChatVariables(before, after)
    expect(result.changes).toHaveLength(200)
    expect(result.truncated).toBe(true)
    expect(result.changes[0]!.after.length).toBeLessThan(520)
  })
})
