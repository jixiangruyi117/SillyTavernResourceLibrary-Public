import {
  type WorkshopInteraction,
  type WorkshopMaterial,
  type WorkshopBlock,
  type WorkshopConditionOperator,
  type WorkshopGenerationOptions,
  type NormalizedWorkshopGenerationOptions,
} from '../types/FrontendWorkshopLegacy'
import { clampLayoutValue, normalizeWorkshopLayoutReference } from './FrontendWorkshopLegacyLayout'
import {
  normalizeWorkshopImageUrls,
  normalizeWorkshopFontUrls,
  normalizeWorkshopPaletteColors,
} from './FrontendWorkshopLegacyResources'

export const WORKSHOP_MATERIAL_RECIPES: Record<WorkshopMaterial, string> = {
  auto: '根据用户风格与色卡选择一种克制的材质，不要同时堆叠多种强材质。',
  solid: '使用清晰的实色分区、稳定对比度和极少透明层；不依赖滤镜，是低性能设备的基准降级。',
  glass:
    '磨砂玻璃配方：先提供可独立阅读的半透明或实色底，再叠加内高光、1px 细描边和轻量 backdrop-filter；必须用 @supports 为不支持模糊的环境保留不透明兜底，不能只靠背景模糊维持对比度。',
  acrylic:
    '亚克力配方：使用透光边缘、两层以内的半透明色块、窄幅内高光和轻微折射感；主体文字承载层保持足够实，不使用覆盖整卡的高强度模糊。',
  paper:
    '高级纸张配方：使用多层低对比渐变、极轻的 CSS 噪点错觉、边缘暗化与局部压印阴影；纹理不能降低小字清晰度，也不能依赖外链纹理图。',
  enamel:
    '珐琅配方：使用高饱和但受控的釉面色、内外双描边、局部弧形高光与硬质边缘；阴影短而克制，避免整面塑料反光。',
  metal: '金属配方：使用冷暖相邻边、定向线性高光、细内描边和克制阴影；保持静态，不用持续扫光。',
  'embossed-metal':
    '金属压印配方：在金属底上组合一明一暗的内阴影、窄幅定向高光、细外轮廓和局部浮雕文字；必须保持文字对比，不用大面积镜面渐变。',
  holographic:
    '全息霓光配方：使用静态圆锥渐变与局部伪元素反光，主体仍有稳定实色底；移动端反光层不得覆盖超过卡片约 30%，动画只允许短时 transform/opacity，并提供 prefers-reduced-motion 静态降级。',
}

export function describeWorkshopMaterialRecipe(material: WorkshopMaterial): string {
  return WORKSHOP_MATERIAL_RECIPES[material]
}

export function requiresWorkshopTexture(...requirements: string[]): boolean {
  return /(?:纹理|肌理|颗粒|噪点|压纹|浮雕纹|纸张质感|grain|noise|texture)/i.test(
    requirements.join('\n'),
  )
}

export function normalizeGenerationOptions(
  options?: Partial<WorkshopGenerationOptions>,
): NormalizedWorkshopGenerationOptions {
  const blocks = (options?.blocks ?? []).filter(
    (block): block is WorkshopBlock =>
      block === 'character-header' ||
      block === 'attribute-grid' ||
      block === 'relationship-card' ||
      block === 'inventory' ||
      block === 'quest-timeline' ||
      block === 'character-tabs' ||
      block === 'long-collapse' ||
      block === 'image-banner',
  )
  const normalizePromptCustomization = (value: unknown): string =>
    String(value ?? '')
      .trim()
      .slice(0, 4000)
  return {
    dataMode: options?.dataMode === 'mvu' ? 'mvu' : 'reply',
    interactions: Array.from(
      new Set(
        (options?.interactions ?? []).filter(
          (interaction): interaction is WorkshopInteraction =>
            interaction === 'collapsible' ||
            interaction === 'motion' ||
            interaction === 'theme-toggle' ||
            interaction === 'tabs',
        ),
      ),
    ),
    blocks: Array.from(new Set(blocks)),
    imageUrls: normalizeWorkshopImageUrls(options?.imageUrls ?? []),
    fontUrls: normalizeWorkshopFontUrls(options?.fontUrls ?? []),
    textStyles: Array.from(
      new Map(
        (options?.textStyles ?? [])
          .map((style) => ({
            id: String(style.id ?? '')
              .trim()
              .replace(/[^a-z0-9_-]/gi, '')
              .slice(0, 32),
            label: String(style.label ?? '')
              .trim()
              .slice(0, 20),
          }))
          .filter((style) => style.id && style.label)
          .map((style) => [style.id, style]),
      ).values(),
    ).slice(0, 6),
    paletteName: String(options?.paletteName ?? '')
      .trim()
      .slice(0, 40),
    paletteColors: normalizeWorkshopPaletteColors(options?.paletteColors ?? []),
    layoutReference: normalizeWorkshopLayoutReference(options?.layoutReference),
    designTokens: {
      material:
        options?.designTokens?.material === 'solid' ||
        options?.designTokens?.material === 'glass' ||
        options?.designTokens?.material === 'acrylic' ||
        options?.designTokens?.material === 'paper' ||
        options?.designTokens?.material === 'enamel' ||
        options?.designTokens?.material === 'metal' ||
        options?.designTokens?.material === 'embossed-metal' ||
        options?.designTokens?.material === 'holographic'
          ? options.designTokens.material
          : 'auto',
      shadow:
        options?.designTokens?.shadow === 'none' ||
        options?.designTokens?.shadow === 'layered' ||
        options?.designTokens?.shadow === 'dramatic'
          ? options.designTokens.shadow
          : 'soft',
      border:
        options?.designTokens?.border === 'none' ||
        options?.designTokens?.border === 'double' ||
        options?.designTokens?.border === 'glow'
          ? options.designTokens.border
          : 'hairline',
      density:
        options?.designTokens?.density === 'compact' || options?.designTokens?.density === 'airy'
          ? options.designTokens.density
          : 'balanced',
    },
    targetSize:
      options?.targetSize &&
      Number.isFinite(options.targetSize.width) &&
      Number.isFinite(options.targetSize.height)
        ? {
            width: clampLayoutValue(options.targetSize.width, 160, 1_200),
            height: clampLayoutValue(options.targetSize.height, 100, 1_800),
          }
        : undefined,
    conditionRules: (options?.conditionRules ?? [])
      .map((rule) => ({
        id: String(rule.id ?? '')
          .trim()
          .replace(/[^a-z0-9_-]/gi, '')
          .slice(0, 32),
        fieldPath: String(rule.fieldPath ?? '')
          .trim()
          .slice(0, 160),
        fieldLabel: String(rule.fieldLabel ?? '')
          .trim()
          .slice(0, 80),
        operator: (
          ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains'] as WorkshopConditionOperator[]
        ).includes(rule.operator)
          ? rule.operator
          : 'eq',
        value: String(rule.value ?? '')
          .trim()
          .slice(0, 80),
        color: normalizeCssColor(rule.color),
        background: normalizeCssColor(rule.background),
      }))
      .filter((rule) => rule.id && rule.fieldPath && rule.value)
      .slice(0, 8),
    promptCustomizations: {
      material: normalizePromptCustomization(options?.promptCustomizations?.material),
      conditions: normalizePromptCustomization(options?.promptCustomizations?.conditions),
      blocks: normalizePromptCustomization(options?.promptCustomizations?.blocks),
    },
    promptInjectionEnabled: {
      material: options?.promptInjectionEnabled?.material !== false,
      conditions: options?.promptInjectionEnabled?.conditions !== false,
      blocks: options?.promptInjectionEnabled?.blocks !== false,
    },
    textureRequired: options?.textureRequired === true,
  }
}

export function normalizeCssColor(value: string): string {
  const normalized = String(value ?? '').trim()
  return /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(normalized)
    ? normalized
    : ''
}
