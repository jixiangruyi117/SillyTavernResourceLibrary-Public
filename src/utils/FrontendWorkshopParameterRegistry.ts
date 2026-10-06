import type {
  FrontendWorkshopNodeKind,
  FrontendWorkshopNodeStyle,
  FrontendWorkshopSpacingValue,
} from '../types/FrontendWorkshopProject'

export type FrontendWorkshopParameterKey =
  | 'fontSize'
  | 'fontWeight'
  | 'letterSpacing'
  | 'lineHeight'
  | 'align'
  | 'textColor'
  | 'opacity'
  | 'cornerRadius'
  | 'rotation'
  | 'borderWidth'
  | 'borderColor'
  | 'borderStyle'
  | 'shadowColor'
  | 'shadowOffsetX'
  | 'shadowOffsetY'
  | 'shadowBlur'
  | 'shadowSpread'
  | 'padding'
  | 'margin'

export interface FrontendWorkshopParameterDefinition {
  key: FrontendWorkshopParameterKey
  label: string
  componentKinds: FrontendWorkshopNodeKind[] | 'all'
  valueType: 'number' | 'color' | 'choice' | 'spacing'
  unit?: 'px' | '%' | 'deg' | 'ratio'
  minimum?: number
  maximum?: number
  step?: number
  defaultValue: unknown
  inputs: Array<'slider' | 'stepper' | 'number' | 'color' | 'choice'>
  compileRule: string
  compatibility: 'native-static'
  realtime: true
  choices?: readonly string[]
}

const ALL: FrontendWorkshopNodeKind[] | 'all' = 'all'
const TEXT: FrontendWorkshopNodeKind[] = ['text']
const STATIC = { compatibility: 'native-static' as const, realtime: true as const }

export const FRONTEND_WORKSHOP_PARAMETER_REGISTRY: Record<
  FrontendWorkshopParameterKey,
  FrontendWorkshopParameterDefinition
> = {
  fontSize: {
    key: 'fontSize',
    label: '字号',
    componentKinds: TEXT,
    valueType: 'number',
    unit: 'px',
    minimum: 8,
    maximum: 128,
    step: 1,
    defaultValue: 16,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'font-size: <value>px',
    ...STATIC,
  },
  fontWeight: {
    key: 'fontWeight',
    label: '字重',
    componentKinds: TEXT,
    valueType: 'number',
    minimum: 100,
    maximum: 900,
    step: 100,
    defaultValue: 400,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'font-weight: <value>',
    ...STATIC,
  },
  letterSpacing: {
    key: 'letterSpacing',
    label: '字距',
    componentKinds: TEXT,
    valueType: 'number',
    unit: 'px',
    minimum: -10,
    maximum: 30,
    step: 0.5,
    defaultValue: 0,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'letter-spacing: <value>px',
    ...STATIC,
  },
  lineHeight: {
    key: 'lineHeight',
    label: '行高',
    componentKinds: TEXT,
    valueType: 'number',
    unit: 'ratio',
    minimum: 0.8,
    maximum: 3,
    step: 0.1,
    defaultValue: 1.6,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'line-height: <value>',
    ...STATIC,
  },
  align: {
    key: 'align',
    label: '对齐',
    componentKinds: ALL,
    valueType: 'choice',
    defaultValue: 'start',
    choices: ['start', 'center', 'end'],
    inputs: ['choice'],
    compileRule: 'text-align/justify-items',
    ...STATIC,
  },
  textColor: {
    key: 'textColor',
    label: '颜色',
    componentKinds: ALL,
    valueType: 'color',
    defaultValue: '#1f2925',
    inputs: ['color'],
    compileRule: 'color: <value>',
    ...STATIC,
  },
  opacity: {
    key: 'opacity',
    label: '透明度',
    componentKinds: ALL,
    valueType: 'number',
    unit: '%',
    minimum: 0,
    maximum: 100,
    step: 1,
    defaultValue: 100,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'opacity: <value>/100',
    ...STATIC,
  },
  cornerRadius: {
    key: 'cornerRadius',
    label: '圆角',
    componentKinds: ALL,
    valueType: 'number',
    unit: 'px',
    minimum: 0,
    maximum: 999,
    step: 1,
    defaultValue: 0,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'border-radius: <value>px',
    ...STATIC,
  },
  rotation: {
    key: 'rotation',
    label: '旋转',
    componentKinds: ALL,
    valueType: 'number',
    unit: 'deg',
    minimum: -180,
    maximum: 180,
    step: 1,
    defaultValue: 0,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'transform: rotate(<value>deg)',
    ...STATIC,
  },
  borderWidth: {
    key: 'borderWidth',
    label: '边框宽度',
    componentKinds: ALL,
    valueType: 'number',
    unit: 'px',
    minimum: 0,
    maximum: 20,
    step: 1,
    defaultValue: 0,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'border-width: <value>px',
    ...STATIC,
  },
  borderColor: {
    key: 'borderColor',
    label: '边框颜色',
    componentKinds: ALL,
    valueType: 'color',
    defaultValue: '#23302a',
    inputs: ['color'],
    compileRule: 'border-color: <value>',
    ...STATIC,
  },
  borderStyle: {
    key: 'borderStyle',
    label: '边框样式',
    componentKinds: ALL,
    valueType: 'choice',
    defaultValue: 'solid',
    choices: ['solid', 'dashed', 'dotted', 'double'],
    inputs: ['choice'],
    compileRule: 'border-style: <value>',
    ...STATIC,
  },
  shadowColor: {
    key: 'shadowColor',
    label: '阴影颜色',
    componentKinds: ALL,
    valueType: 'color',
    defaultValue: '#202a25',
    inputs: ['color'],
    compileRule: 'box-shadow color',
    ...STATIC,
  },
  shadowOffsetX: {
    key: 'shadowOffsetX',
    label: '阴影横移',
    componentKinds: ALL,
    valueType: 'number',
    unit: 'px',
    minimum: -64,
    maximum: 64,
    step: 1,
    defaultValue: 0,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'box-shadow offset-x',
    ...STATIC,
  },
  shadowOffsetY: {
    key: 'shadowOffsetY',
    label: '阴影纵移',
    componentKinds: ALL,
    valueType: 'number',
    unit: 'px',
    minimum: -64,
    maximum: 64,
    step: 1,
    defaultValue: 8,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'box-shadow offset-y',
    ...STATIC,
  },
  shadowBlur: {
    key: 'shadowBlur',
    label: '阴影模糊',
    componentKinds: ALL,
    valueType: 'number',
    unit: 'px',
    minimum: 0,
    maximum: 128,
    step: 1,
    defaultValue: 24,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'box-shadow blur-radius',
    ...STATIC,
  },
  shadowSpread: {
    key: 'shadowSpread',
    label: '阴影扩散',
    componentKinds: ALL,
    valueType: 'number',
    unit: 'px',
    minimum: -48,
    maximum: 64,
    step: 1,
    defaultValue: 0,
    inputs: ['slider', 'stepper', 'number'],
    compileRule: 'box-shadow spread-radius',
    ...STATIC,
  },
  padding: {
    key: 'padding',
    label: '内间距',
    componentKinds: ALL,
    valueType: 'spacing',
    unit: 'px',
    minimum: 0,
    maximum: 160,
    step: 1,
    defaultValue: { top: 16, right: 16, bottom: 16, left: 16 },
    inputs: ['stepper', 'number'],
    compileRule: 'padding: top right bottom left',
    ...STATIC,
  },
  margin: {
    key: 'margin',
    label: '外间距',
    componentKinds: ALL,
    valueType: 'spacing',
    unit: 'px',
    minimum: -160,
    maximum: 160,
    step: 1,
    defaultValue: { top: 0, right: 0, bottom: 0, left: 0 },
    inputs: ['stepper', 'number'],
    compileRule: 'margin: top right bottom left',
    ...STATIC,
  },
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function color(value: unknown, fallback: string): string {
  const source = String(value ?? '')
    .trim()
    .toLowerCase()
  return /^#[0-9a-f]{6}$/u.test(source) ? source : fallback
}

function spacing(
  value: unknown,
  definition: FrontendWorkshopParameterDefinition,
): FrontendWorkshopSpacingValue {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const fallback = definition.defaultValue as FrontendWorkshopSpacingValue
  const minimum = definition.minimum ?? 0
  const maximum = definition.maximum ?? 160
  return {
    top: clamp(source.top, minimum, maximum, fallback.top),
    right: clamp(source.right, minimum, maximum, fallback.right),
    bottom: clamp(source.bottom, minimum, maximum, fallback.bottom),
    left: clamp(source.left, minimum, maximum, fallback.left),
  }
}

export function normalizeFrontendWorkshopParameterValue(
  key: FrontendWorkshopParameterKey,
  value: unknown,
): unknown {
  const definition = FRONTEND_WORKSHOP_PARAMETER_REGISTRY[key]
  if (definition.valueType === 'number')
    return clamp(
      value,
      definition.minimum ?? 0,
      definition.maximum ?? 100,
      Number(definition.defaultValue),
    )
  if (definition.valueType === 'color') return color(value, String(definition.defaultValue))
  if (definition.valueType === 'choice')
    return definition.choices?.includes(String(value)) ? String(value) : definition.defaultValue
  return spacing(value, definition)
}

export function frontendWorkshopParameterValue(
  style: FrontendWorkshopNodeStyle,
  key: FrontendWorkshopParameterKey,
): unknown {
  return normalizeFrontendWorkshopParameterValue(
    key,
    style[key as keyof FrontendWorkshopNodeStyle] ??
      FRONTEND_WORKSHOP_PARAMETER_REGISTRY[key].defaultValue,
  )
}
