import type { FrontendWorkshopNodePlacement } from '../types/FrontendWorkshopProject'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  computeFrontendWorkshopCanvasPlacementTransform,
  computeFrontendWorkshopCanvasRotationTransform,
  type FrontendWorkshopCanvasTransformHandle,
} from './FrontendWorkshopCanvasTransform'
import type { FrontendWorkshopSourcePatch } from './FrontendWorkshopSourcePatch'
import { encodeFrontendWorkshopSourceAttributeValue } from './FrontendWorkshopSourceSelection'
import {
  formatFrontendWorkshopSourceTransformValue,
  type FrontendWorkshopSourceTransformField,
  type FrontendWorkshopSourceTransformTarget,
  type FrontendWorkshopSourceTransformTargets,
} from './FrontendWorkshopSourceTransform'

export type FrontendWorkshopSourceCanvasGestureMode = 'move' | 'resize' | 'scale' | 'rotate'

export interface FrontendWorkshopSourceCanvasGesture {
  mode: FrontendWorkshopSourceCanvasGestureMode
  deltaX?: number
  deltaY?: number
  handle?: FrontendWorkshopCanvasTransformHandle
  startAngle?: number
  currentAngle?: number
}

export interface FrontendWorkshopSourceCanvasGestureCapabilities {
  move: boolean
  resize: boolean
  scale: boolean
  rotate: boolean
}

type FrontendWorkshopSourcePlacementTransformField = Exclude<
  FrontendWorkshopSourceTransformField,
  'rotation'
>

const SOURCE_TRANSFORM_CONSTRAINTS = {
  minWidth: 1,
  minHeight: 1,
  minScale: 0.05,
  maxScale: 20,
  clampPositionToOrigin: false,
  clampRightToCanvas: false,
  roundOutput: false,
} as const

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0
}

function normalizeGestureValue(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Source Canvas gesture 产生了非法数值')
  const normalized = Math.round(value * 1000) / 1000
  return Object.is(normalized, -0) ? 0 : normalized
}

function sourcePlacement(
  targets: FrontendWorkshopSourceTransformTargets,
): FrontendWorkshopNodePlacement {
  return {
    x: targets.fields.x?.value ?? 0,
    y: targets.fields.y?.value ?? 0,
    width: targets.fields.width?.value ?? 1,
    height: targets.fields.height?.value ?? 1,
    zIndex: 0,
  }
}

function rangeText(
  source: FrontendWorkshopSourceDocument,
  target: FrontendWorkshopSourceTransformTarget,
): string {
  const range = target.target.provenance.anchor.range
  return source.authorSource.slice(range.start, range.end)
}

export class FrontendWorkshopSourceCanvasGestureUnavailableError extends Error {
  readonly field?: FrontendWorkshopSourceTransformField

  constructor(message: string, field?: FrontendWorkshopSourceTransformField) {
    super(message)
    this.name = 'FrontendWorkshopSourceCanvasGestureUnavailableError'
    this.field = field
  }
}

export function getFrontendWorkshopSourceCanvasGestureCapabilities(
  targets: FrontendWorkshopSourceTransformTargets,
): FrontendWorkshopSourceCanvasGestureCapabilities {
  return {
    move: Boolean(targets.offset || (targets.fields.x && targets.fields.y)),
    resize: Boolean(targets.fields.width && targets.fields.height),
    scale: Boolean(targets.fields.width && targets.fields.height),
    rotate: Boolean(targets.fields.rotation),
  }
}

function requireTarget(
  targets: FrontendWorkshopSourceTransformTargets,
  field: FrontendWorkshopSourceTransformField,
): FrontendWorkshopSourceTransformTarget {
  const target = targets.fields[field]
  if (!target) {
    throw new FrontendWorkshopSourceCanvasGestureUnavailableError(
      `Source Canvas gesture 缺少可精确写回的 ${field} target`,
      field,
    )
  }
  return target
}

function changedFieldsForScale(
  handle: FrontendWorkshopCanvasTransformHandle,
): readonly FrontendWorkshopSourcePlacementTransformField[] {
  if (handle === 'nw') return ['x', 'y', 'width', 'height']
  if (handle === 'ne') return ['y', 'width', 'height']
  if (handle === 'sw') return ['x', 'width', 'height']
  return ['width', 'height']
}

/**
 * Convert one direct-manipulation gesture into one current-revision atomic Source Patch.
 *
 * This function never persists Source. Movement may add an independent translate declaration
 * after Runtime validation; other changed fields require an existing exact inline Source target.
 */
export function createFrontendWorkshopSourceCanvasGesturePatch(
  source: FrontendWorkshopSourceDocument,
  targets: FrontendWorkshopSourceTransformTargets,
  gesture: FrontendWorkshopSourceCanvasGesture,
): FrontendWorkshopSourcePatch | undefined {
  if (gesture.mode === 'move' && targets.offset) {
    const offset = targets.offset
    const dx = finite(gesture.deltaX) / offset.scaleX
    const dy = finite(gesture.deltaY) / offset.scaleY
    if (!dx && !dy) return undefined
    const value = `${normalizeGestureValue(offset.x + dx)}px ${normalizeGestureValue(offset.y + dy)}px`
    const range = offset.target.provenance.anchor.range
    const expectedText = source.authorSource.slice(range.start, range.end)
    const replacement =
      offset.kind === 'tag'
        ? expectedText.replace(/(\s*\/?>)$/u, ` style="translate:${value}"$1`)
        : offset.kind === 'style'
          ? expectedText +
            encodeFrontendWorkshopSourceAttributeValue(source, offset.target, `;translate:${value}`)
          : value
    return {
      projectId: source.projectId,
      sourceRevision: source.revision,
      edits: [{ target: offset.target, expectedText, replacement }],
    }
  }
  const placement = sourcePlacement(targets)
  const nextValues = new Map<FrontendWorkshopSourceTransformField, number>()

  if (gesture.mode === 'move') {
    requireTarget(targets, 'x')
    requireTarget(targets, 'y')
    const next = computeFrontendWorkshopCanvasPlacementTransform({
      mode: 'move',
      placement,
      deltaX: finite(gesture.deltaX),
      deltaY: finite(gesture.deltaY),
      canvasWidth: 1,
      constraints: SOURCE_TRANSFORM_CONSTRAINTS,
    })
    nextValues.set('x', normalizeGestureValue(next.x))
    nextValues.set('y', normalizeGestureValue(next.y))
  } else if (gesture.mode === 'resize') {
    requireTarget(targets, 'width')
    requireTarget(targets, 'height')
    const next = computeFrontendWorkshopCanvasPlacementTransform({
      mode: 'resize',
      placement,
      deltaX: finite(gesture.deltaX),
      deltaY: finite(gesture.deltaY),
      canvasWidth: 1,
      constraints: SOURCE_TRANSFORM_CONSTRAINTS,
    })
    nextValues.set('width', normalizeGestureValue(next.width))
    nextValues.set('height', normalizeGestureValue(next.height))
  } else if (gesture.mode === 'scale') {
    const handle = gesture.handle ?? 'se'
    for (const field of changedFieldsForScale(handle)) requireTarget(targets, field)
    const next = computeFrontendWorkshopCanvasPlacementTransform({
      mode: 'scale',
      placement,
      deltaX: finite(gesture.deltaX),
      deltaY: finite(gesture.deltaY),
      canvasWidth: 1,
      handle,
      constraints: SOURCE_TRANSFORM_CONSTRAINTS,
    })
    for (const field of changedFieldsForScale(handle)) {
      nextValues.set(field, normalizeGestureValue(next[field]))
    }
  } else {
    const rotation = requireTarget(targets, 'rotation')
    const startAngle = finite(gesture.startAngle)
    const currentAngle = Number.isFinite(gesture.currentAngle)
      ? Number(gesture.currentAngle)
      : startAngle
    nextValues.set(
      'rotation',
      computeFrontendWorkshopCanvasRotationTransform({
        startRotation: rotation.value,
        startAngle,
        currentAngle,
      }),
    )
  }

  const edits: FrontendWorkshopSourcePatch['edits'][number][] = []
  for (const [field, nextValue] of nextValues) {
    const target = requireTarget(targets, field)
    if (Object.is(nextValue, target.value) || nextValue === target.value) continue
    edits.push({
      target: target.target,
      expectedText: rangeText(source, target),
      replacement: formatFrontendWorkshopSourceTransformValue(target, nextValue),
    })
  }
  if (edits.length === 0) return undefined
  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    edits,
  }
}
