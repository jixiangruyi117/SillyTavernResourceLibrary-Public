export const SINGLE_DRAW_REVEAL_DELAY = 1750
export const TEN_DRAW_INITIAL_DELAY = 700
export const TEN_DRAW_STEP_INTERVAL = 1200

export function drawRevealDelay(count: number, index: number): number {
  if (count <= 1) return SINGLE_DRAW_REVEAL_DELAY
  return TEN_DRAW_INITIAL_DELAY + Math.max(0, index) * TEN_DRAW_STEP_INTERVAL
}
