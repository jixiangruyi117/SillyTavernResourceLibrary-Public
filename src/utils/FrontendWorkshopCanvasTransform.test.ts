import { describe, expect, it } from 'vitest'

import type { FrontendWorkshopNodePlacement } from '../types/FrontendWorkshopProject'
import {
  computeFrontendWorkshopCanvasPlacementTransform,
  computeFrontendWorkshopCanvasRotationTransform,
} from './FrontendWorkshopCanvasTransform'

const placement: FrontendWorkshopNodePlacement = {
  x: 12,
  y: 20,
  width: 220,
  height: 120,
  zIndex: 3,
}

describe('FrontendWorkshopCanvasTransform', () => {
  it('keeps the legacy move clamp and rounding behavior', () => {
    expect(
      computeFrontendWorkshopCanvasPlacementTransform({
        mode: 'move',
        placement,
        deltaX: 20,
        deltaY: 40,
        canvasWidth: 390,
      }),
    ).toEqual({ x: 32, y: 60, width: 220, height: 120, zIndex: 3 })

    expect(
      computeFrontendWorkshopCanvasPlacementTransform({
        mode: 'move',
        placement,
        deltaX: -100,
        deltaY: -100,
        canvasWidth: 390,
      }),
    ).toEqual({ x: 0, y: 0, width: 220, height: 120, zIndex: 3 })
  })

  it('keeps resize minimums and the right canvas boundary', () => {
    expect(
      computeFrontendWorkshopCanvasPlacementTransform({
        mode: 'resize',
        placement,
        deltaX: 500,
        deltaY: -500,
        canvasWidth: 390,
      }),
    ).toEqual({ x: 12, y: 20, width: 378, height: 64, zIndex: 3 })

    expect(
      computeFrontendWorkshopCanvasPlacementTransform({
        mode: 'resize-x',
        placement,
        deltaX: -500,
        deltaY: 0,
        canvasWidth: 390,
      }).width,
    ).toBe(96)
    expect(
      computeFrontendWorkshopCanvasPlacementTransform({
        mode: 'resize-y',
        placement,
        deltaX: 0,
        deltaY: -500,
        canvasWidth: 390,
      }).height,
    ).toBe(64)
  })

  it('keeps scale factor limits and anchors the opposite edge for west/north handles', () => {
    expect(
      computeFrontendWorkshopCanvasPlacementTransform({
        mode: 'scale',
        placement,
        deltaX: -44,
        deltaY: -24,
        canvasWidth: 390,
        handle: 'nw',
      }),
    ).toEqual({ x: 0, y: 0, width: 264, height: 144, zIndex: 3 })

    const tiny = computeFrontendWorkshopCanvasPlacementTransform({
      mode: 'scale',
      placement,
      deltaX: -5000,
      deltaY: -5000,
      canvasWidth: 390,
      handle: 'se',
    })
    expect(tiny.width).toBe(96)
    expect(tiny.height).toBe(64)
  })

  it('keeps rotation snapping, clamping and integer output', () => {
    expect(
      computeFrontendWorkshopCanvasRotationTransform({
        startRotation: 10,
        startAngle: 0,
        currentAngle: (-8 * Math.PI) / 180,
      }),
    ).toBe(0)
    expect(
      computeFrontendWorkshopCanvasRotationTransform({
        startRotation: 0,
        startAngle: 0,
        currentAngle: Math.PI,
      }),
    ).toBe(180)
    expect(
      computeFrontendWorkshopCanvasRotationTransform({
        startRotation: 170,
        startAngle: 0,
        currentAngle: Math.PI,
      }),
    ).toBe(180)
  })

  it('does not mutate the initial placement', () => {
    const initial = { ...placement }
    computeFrontendWorkshopCanvasPlacementTransform({
      mode: 'move',
      placement: initial,
      deltaX: 10,
      deltaY: 20,
      canvasWidth: 390,
    })
    expect(initial).toEqual(placement)
  })
})
