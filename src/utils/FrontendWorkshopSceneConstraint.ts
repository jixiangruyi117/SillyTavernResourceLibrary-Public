import type {
  FrontendWorkshopLayoutViewport,
  FrontendWorkshopSceneConstraint,
  FrontendWorkshopSceneConstraintWideOverride,
} from '../types/FrontendWorkshopProject'

export const SCENE_CONSTRAINT_MAX_SIZE = 4096

export const DEFAULT_SCENE_CONSTRAINT: Omit<FrontendWorkshopSceneConstraint, 'wide'> = {
  anchor: 'auto',
  offsetX: 0,
  offsetY: 0,
  widthMode: 'fill',
  heightMode: 'hug',
}

export type FrontendWorkshopEffectiveSceneConstraint = Omit<FrontendWorkshopSceneConstraint, 'wide'>

export const SCENE_CONSTRAINT_WIDE_FIELDS = [
  'anchor',
  'offsetX',
  'offsetY',
  'widthMode',
  'widthValue',
  'heightMode',
  'heightValue',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'aspectRatio',
] as const satisfies ReadonlyArray<keyof FrontendWorkshopSceneConstraintWideOverride>

export function effectiveSceneConstraint(
  constraint: FrontendWorkshopSceneConstraint | undefined,
  viewport: FrontendWorkshopLayoutViewport,
): FrontendWorkshopEffectiveSceneConstraint | undefined {
  if (!constraint) return undefined
  const { wide, ...phone } = constraint
  return viewport === 'wide' ? { ...phone, ...wide } : phone
}

export function hasSceneConstraintWideOverride(
  constraint: FrontendWorkshopSceneConstraint | undefined,
): boolean {
  return Boolean(constraint?.wide && Object.keys(constraint.wide).length)
}
