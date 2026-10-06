import { describe, expect, it } from 'vitest'

import type { FrontendWorkshopNodePlacement } from '../types/FrontendWorkshopProject'
import { computeFrontendWorkshopCanvasPlacementTransform } from './FrontendWorkshopCanvasTransform'

const sourceConstraints = {
  minWidth: 1,
  minHeight: 1,
  minScale: 0.05,
  maxScale: 20,
  clampPositionToOrigin: false,
  clampRightToCanvas: false,
  roundOutput: false,
} as const

const placement: FrontendWorkshopNodePlacement = {
  x: -12.5,
  y: 20.25,
  width: 40.5,
  height: 30.25,
  zIndex: 0,
}

describe('FrontendWorkshopCanvasTransform Source policy', () => {
  it('does not impose legacy origin, minimum-size or integer rounding rules on Source movement', () => {
    const moved = computeFrontendWorkshopCanvasPlacementTransform({
      mode: 'move',
      placement,
      deltaX: -2.25,
      deltaY: -30.5,
      canvasWidth: 390,
      constraints: sourceConstraints,
    })

    expect(moved).toEqual({
      ...placement,
      x: -14.75,
      y: -10.25,
    })
  })

  it('keeps small Source elements resizable without the legacy 96x64 floor', () => {
    const resized = computeFrontendWorkshopCanvasPlacementTransform({
      mode: 'resize',
      placement,
      deltaX: -35,
      deltaY: -25,
      canvasWidth: 390,
      constraints: sourceConstraints,
    })

    expect(resized.width).toBe(5.5)
    expect(resized.height).toBe(5.25)
  })

  it('still reuses shared proportional scale math under the Source constraint policy', () => {
    const scaled = computeFrontendWorkshopCanvasPlacementTransform({
      mode: 'scale',
      placement,
      deltaX: 20,
      deltaY: 15,
      canvasWidth: 390,
      handle: 'se',
      constraints: sourceConstraints,
    })

    expect(scaled.width).toBeGreaterThan(placement.width)
    expect(scaled.height).toBeGreaterThan(placement.height)
    expect(scaled.x).toBe(placement.x)
    expect(scaled.y).toBe(placement.y)
  })
})
