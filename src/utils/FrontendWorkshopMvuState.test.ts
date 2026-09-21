import { describe, expect, it, vi } from 'vitest'

import {
  FRONTEND_WORKSHOP_MVU_MAX_ARRAY_ENTRIES,
  FRONTEND_WORKSHOP_MVU_MAX_DEPTH,
  FRONTEND_WORKSHOP_MVU_MAX_OBJECT_ENTRIES,
  FRONTEND_WORKSHOP_MVU_WAIT_TIMEOUT_MS,
  listFrontendWorkshopMvuStateEntries,
  normalizeFrontendWorkshopMvuPath,
  readCurrentFrontendWorkshopMvuState,
  readFrontendWorkshopMvuPath,
  searchFrontendWorkshopMvuStateEntries,
} from './FrontendWorkshopMvuState'

describe('FrontendWorkshopMvuState', () => {
  const statData = {
    角色: {
      好感度: 67,
      心情: '开心',
      装备: { 上衣: '白衬衫', 饰品: '项链' },
    },
  }

  it('按需生成嵌套 stat_data 树并保存相对路径', () => {
    const root = listFrontendWorkshopMvuStateEntries(statData)
    const character = root[0]!

    expect(character).toMatchObject({ name: '角色', path: '角色', expandable: true })
    expect(listFrontendWorkshopMvuStateEntries(statData.角色, character.path)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '好感度', path: '角色.好感度', value: '67' }),
      ]),
    )
    expect(readFrontendWorkshopMvuPath(statData, '角色.好感度')).toBe(67)
  })

  it('搜索字段并限制深层对象与大数组的展示规模', () => {
    const circular: Record<string, unknown> = { 目标字段: '命中' }
    circular.self = circular
    let deep: Record<string, unknown> = { 叶子: '过深' }
    for (let index = 0; index < FRONTEND_WORKSHOP_MVU_MAX_DEPTH + 3; index += 1)
      deep = { [`层${index}`]: deep }
    const large = {
      ...Object.fromEntries(
        Array.from({ length: FRONTEND_WORKSHOP_MVU_MAX_OBJECT_ENTRIES + 5 }, (_, index) => [
          `字段${index}`,
          index,
        ]),
      ),
      array: Array.from(
        { length: FRONTEND_WORKSHOP_MVU_MAX_ARRAY_ENTRIES + 5 },
        (_, index) => index,
      ),
      circular,
      deep,
    }

    expect(searchFrontendWorkshopMvuStateEntries(statData, '好感')).toEqual([
      expect.objectContaining({ path: '角色.好感度' }),
    ])
    expect(listFrontendWorkshopMvuStateEntries(large)).toHaveLength(
      FRONTEND_WORKSHOP_MVU_MAX_OBJECT_ENTRIES,
    )
    expect(listFrontendWorkshopMvuStateEntries(large.array)).toHaveLength(
      FRONTEND_WORKSHOP_MVU_MAX_ARRAY_ENTRIES,
    )
    expect(searchFrontendWorkshopMvuStateEntries(large, '目标字段')).toHaveLength(0)
    expect(normalizeFrontendWorkshopMvuPath('角色.好感度')).toBe('角色.好感度')
    expect(normalizeFrontendWorkshopMvuPath('角色..好感度')).toBeUndefined()
    expect(normalizeFrontendWorkshopMvuPath('.角色')).toBeUndefined()
    expect(normalizeFrontendWorkshopMvuPath('角色.')).toBeUndefined()
    expect(normalizeFrontendWorkshopMvuPath('stat_data.角色')).toBeUndefined()
    expect(normalizeFrontendWorkshopMvuPath('__proto__.x')).toBeUndefined()
  })

  it('以受控宿主 mock 初始化读取当前消息的顶层 stat_data，并兼容旧嵌套形状后安全降级', async () => {
    const rootGetMvuData = vi.fn(async () => ({ stat_data: statData }))
    await expect(
      readCurrentFrontendWorkshopMvuState({
        waitGlobalInitialized: vi.fn(async () => undefined),
        getCurrentMessageId: () => 7,
        Mvu: { getMvuData: rootGetMvuData },
      }),
    ).resolves.toEqual({ available: true, statData })
    expect(rootGetMvuData).toHaveBeenCalledWith({ type: 'message', message_id: 7 })

    const getMvuData = vi.fn(async () => ({ variables: { stat_data: statData } }))
    const snapshot = await readCurrentFrontendWorkshopMvuState({
      waitGlobalInitialized: vi.fn(async () => undefined),
      getCurrentMessageId: () => 7,
      Mvu: { getMvuData },
    })

    expect(getMvuData).toHaveBeenCalledWith({ type: 'message', message_id: 7 })
    expect(snapshot).toEqual({ available: true, statData })
    await expect(readCurrentFrontendWorkshopMvuState({})).resolves.toEqual({ available: false })
    await expect(
      readCurrentFrontendWorkshopMvuState({
        waitGlobalInitialized: async () => {
          throw new Error('unavailable')
        },
      }),
    ).resolves.toEqual({ available: false })
  })

  it('MVU 从未初始化时在有界等待后降级，不让读取 Promise 永久 pending', async () => {
    vi.useFakeTimers()
    try {
      const pending = readCurrentFrontendWorkshopMvuState({
        waitGlobalInitialized: () => new Promise(() => undefined),
      })

      await vi.advanceTimersByTimeAsync(FRONTEND_WORKSHOP_MVU_WAIT_TIMEOUT_MS)
      await expect(pending).resolves.toEqual({ available: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('MVU 在等待窗口内晚初始化时仍读取当前楼层数据', async () => {
    vi.useFakeTimers()
    try {
      const host = {
        waitGlobalInitialized: () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, FRONTEND_WORKSHOP_MVU_WAIT_TIMEOUT_MS - 100)
          }),
        getCurrentMessageId: () => 9,
        Mvu: { getMvuData: vi.fn(async () => ({ stat_data: statData })) },
      }
      const pending = readCurrentFrontendWorkshopMvuState(host)

      await vi.advanceTimersByTimeAsync(FRONTEND_WORKSHOP_MVU_WAIT_TIMEOUT_MS - 100)
      await expect(pending).resolves.toEqual({ available: true, statData })
      expect(host.Mvu.getMvuData).toHaveBeenCalledWith({ type: 'message', message_id: 9 })
    } finally {
      vi.useRealTimers()
    }
  })
})
