import { describe, expect, it } from 'vitest'

import {
  hotspotPointFromClient,
  hotspotRectFromPoints,
  isUsableHotspotRect,
} from './FrontendWorkshopHotspotDrawing'

describe('FrontendWorkshopHotspotDrawing', () => {
  const bounds = { left: 100, top: 50, width: 200, height: 400 }

  it('把指针位置换算成父元素内的相对百分比并限制边界', () => {
    expect(hotspotPointFromClient(150, 150, bounds)).toEqual({ x: 25, y: 25 })
    expect(hotspotPointFromClient(20, 600, bounds)).toEqual({ x: 0, y: 100 })
  })

  it('支持从任意方向拖动并拒绝误触产生的微小热区', () => {
    const rect = hotspotRectFromPoints({ x: 80, y: 70 }, { x: 20, y: 30 })
    expect(rect).toEqual({ x: 20, y: 30, width: 60, height: 40 })
    expect(isUsableHotspotRect(rect)).toBe(true)
    expect(isUsableHotspotRect({ x: 10, y: 10, width: 3, height: 12 })).toBe(false)
  })
})
