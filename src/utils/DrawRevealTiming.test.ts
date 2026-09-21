import { describe, expect, it } from 'vitest'

import {
  drawRevealDelay,
  SINGLE_DRAW_REVEAL_DELAY,
  TEN_DRAW_INITIAL_DELAY,
  TEN_DRAW_STEP_INTERVAL,
} from './DrawRevealTiming'

describe('DrawRevealTiming', () => {
  it('keeps the single draw timing independent', () => {
    expect(drawRevealDelay(1, 0)).toBe(SINGLE_DRAW_REVEAL_DELAY)
  })

  it('gives every ten-draw card a stable viewing interval', () => {
    expect(drawRevealDelay(10, 0)).toBe(TEN_DRAW_INITIAL_DELAY)
    expect(drawRevealDelay(10, 1) - drawRevealDelay(10, 0)).toBe(TEN_DRAW_STEP_INTERVAL)
    expect(drawRevealDelay(10, 9)).toBe(TEN_DRAW_INITIAL_DELAY + TEN_DRAW_STEP_INTERVAL * 9)
  })
})
