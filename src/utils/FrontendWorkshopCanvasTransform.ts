import type { FrontendWorkshopNodePlacement } from '../types/FrontendWorkshopProject'

export type FrontendWorkshopCanvasTransformMode =
  'move' | 'resize' | 'resize-x' | 'resize-y' | 'scale' | 'rotate'

export type FrontendWorkshopCanvasTransformHandle = 'nw' | 'ne' | 'se' | 'sw'

export interface FrontendWorkshopCanvasTransformConstraints {
  minWidth?: number
  minHeight?: number
  minScale?: number
  maxScale?: number
  clampPositionToOrigin?: boolean
  clampRightToCanvas?: boolean
  roundOutput?: boolean
}

export interface FrontendWorkshopCanvasPlacementTransformInput {
  mode: Exclude<FrontendWorkshopCanvasTransformMode, 'rotate'>
  placement: FrontendWorkshopNodePlacement
  deltaX: number
  deltaY: number
  canvasWidth: number
  handle?: FrontendWorkshopCanvasTransformHandle
  constraints?: FrontendWorkshopCanvasTransformConstraints
}

export interface FrontendWorkshopCanvasRotationTransformInput {
  startRotation: number
  startAngle: number
  currentAngle: number
  roundOutput?: boolean
}

const DEFAULT_MIN_WIDTH = 96
const DEFAULT_MIN_HEIGHT = 64
const DEFAULT_MIN_SCALE = 0.35
const DEFAULT_MAX_SCALE = 3
const ROTATION_SNAP_DEGREES = [0, 90, 180, -90, -180] as const
const ROTATION_SNAP_THRESHOLD = 4

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function finiteMinimum(value: number | undefined, fallback: number): number {
  const resolved = finite(Number(value), fallback)
  return Math.max(0, resolved)
}

function normalizeOutput(value: number, roundOutput: boolean): number {
  const finiteValue = finite(value, 0)
  return roundOutput ? Math.round(finiteValue) : finiteValue
}

function placementConstraints(input: FrontendWorkshopCanvasPlacementTransformInput) {
  const constraints = input.constraints
  const minScale = finiteMinimum(constraints?.minScale, DEFAULT_MIN_SCALE)
  const requestedMaxScale = finiteMinimum(constraints?.maxScale, DEFAULT_MAX_SCALE)
  return {
    minWidth: finiteMinimum(constraints?.minWidth, DEFAULT_MIN_WIDTH),
    minHeight: finiteMinimum(constraints?.minHeight, DEFAULT_MIN_HEIGHT),
    minScale,
    maxScale: Math.max(minScale, requestedMaxScale),
    clampPositionToOrigin: constraints?.clampPositionToOrigin ?? true,
    clampRightToCanvas: constraints?.clampRightToCanvas ?? true,
    roundOutput: constraints?.roundOutput ?? true,
  }
}

/**
 * Shared Canvas transform math.
 *
 * The default constraint policy deliberately preserves the legacy structured Workbench behavior.
 * Source-backed callers may provide a looser policy because arbitrary Author Source is not bounded
 * by the old structured Canvas minimums/origin. Persistence, provenance and undo remain caller-owned.
 */
export function computeFrontendWorkshopCanvasPlacementTransform(
  input: FrontendWorkshopCanvasPlacementTransformInput,
): FrontendWorkshopNodePlacement {
  const placement = input.placement
  const constraints = placementConstraints(input)
  const canvasWidth = Math.max(1, finite(input.canvasWidth, 1))
  const deltaX = finite(input.deltaX, 0)
  const deltaY = finite(input.deltaY, 0)
  const next = { ...placement }
  const normalize = (value: number) => normalizeOutput(value, constraints.roundOutput)
  const minimumX = constraints.clampPositionToOrigin ? 0 : Number.NEGATIVE_INFINITY
  const minimumY = constraints.clampPositionToOrigin ? 0 : Number.NEGATIVE_INFINITY
  const maxWidth = constraints.clampRightToCanvas
    ? canvasWidth - placement.x
    : Number.POSITIVE_INFINITY

  if (input.mode === 'move') {
    const requestedX = placement.x + deltaX
    const requestedY = placement.y + deltaY
    const maximumX = constraints.clampRightToCanvas
      ? canvasWidth - placement.width
      : Number.POSITIVE_INFINITY
    next.x = normalize(Math.min(maximumX, Math.max(minimumX, requestedX)))
    next.y = normalize(Math.max(minimumY, requestedY))
    return next
  }

  if (input.mode === 'resize') {
    next.width = normalize(
      Math.min(maxWidth, Math.max(constraints.minWidth, placement.width + deltaX)),
    )
    next.height = normalize(Math.max(constraints.minHeight, placement.height + deltaY))
    return next
  }

  if (input.mode === 'resize-x') {
    next.width = normalize(
      Math.min(maxWidth, Math.max(constraints.minWidth, placement.width + deltaX)),
    )
    return next
  }

  if (input.mode === 'resize-y') {
    next.height = normalize(Math.max(constraints.minHeight, placement.height + deltaY))
    return next
  }

  const horizontalDirection = input.handle === 'nw' || input.handle === 'sw' ? -1 : 1
  const verticalDirection = input.handle === 'nw' || input.handle === 'ne' ? -1 : 1
  const factor = Math.max(
    constraints.minScale,
    Math.min(
      constraints.maxScale,
      1 +
        (horizontalDirection * deltaX) / Math.max(1, placement.width) / 2 +
        (verticalDirection * deltaY) / Math.max(1, placement.height) / 2,
    ),
  )
  next.width = normalize(
    Math.min(maxWidth, Math.max(constraints.minWidth, placement.width * factor)),
  )
  next.height = normalize(Math.max(constraints.minHeight, placement.height * factor))
  if (input.handle === 'nw' || input.handle === 'sw') {
    const requestedX = placement.x + placement.width - next.width
    next.x = normalize(Math.max(minimumX, requestedX))
    if (constraints.clampRightToCanvas) {
      next.width = Math.min(canvasWidth - next.x, next.width)
    }
  }
  if (input.handle === 'nw' || input.handle === 'ne') {
    next.y = normalize(Math.max(minimumY, placement.y + placement.height - next.height))
  }
  return next
}

export function computeFrontendWorkshopCanvasRotationTransform(
  input: FrontendWorkshopCanvasRotationTransformInput,
): number {
  const currentAngle = finite(input.currentAngle, input.startAngle)
  let degrees = finite(input.startRotation, 0) + ((currentAngle - input.startAngle) * 180) / Math.PI
  for (const snap of ROTATION_SNAP_DEGREES) {
    if (Math.abs(degrees - snap) < ROTATION_SNAP_THRESHOLD) {
      degrees = snap
      break
    }
  }
  const clamped = Math.min(180, Math.max(-180, degrees))
  return input.roundOutput === false ? clamped : Math.round(clamped)
}
