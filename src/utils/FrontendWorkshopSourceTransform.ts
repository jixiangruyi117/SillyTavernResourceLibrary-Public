import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type {
  FrontendWorkshopSourceAnalysisSnapshot,
  FrontendWorkshopSourceMapEntity,
  FrontendWorkshopStaticSourceProvenance,
} from './FrontendWorkshopSourceAnalysis'
import type {
  FrontendWorkshopExactSourceMapEntity,
  FrontendWorkshopResolvedSourceSelection,
} from './FrontendWorkshopSourceSelection'

export type FrontendWorkshopSourceTransformField = 'x' | 'y' | 'width' | 'height' | 'rotation'

export interface FrontendWorkshopSourceTransformTarget {
  field: FrontendWorkshopSourceTransformField
  cssProperty: 'left' | 'top' | 'width' | 'height' | 'transform'
  target: FrontendWorkshopExactSourceMapEntity
  value: number
  unit: 'px' | 'deg'
}

export interface FrontendWorkshopSourceTransformTargets {
  offset?: {
    target: FrontendWorkshopExactSourceMapEntity
    kind: 'tag' | 'style' | 'value'
    x: number
    y: number
    scaleX: number
    scaleY: number
  }
  inlineStyleTarget?: FrontendWorkshopExactSourceMapEntity
  styles?: Record<string, { target: FrontendWorkshopExactSourceMapEntity; value: string }>
  fields: Partial<
    Record<FrontendWorkshopSourceTransformField, FrontendWorkshopSourceTransformTarget>
  >
}

type CurrentStaticEntity = FrontendWorkshopSourceMapEntity & {
  confidence: 'exact'
  provenance: FrontendWorkshopStaticSourceProvenance
}

const FIELD_BY_PROPERTY = {
  left: 'x',
  top: 'y',
  width: 'width',
  height: 'height',
} as const satisfies Record<string, FrontendWorkshopSourceTransformField>

function isCurrentStaticEntity(
  source: FrontendWorkshopSourceDocument,
  entity: FrontendWorkshopSourceMapEntity | undefined,
): entity is CurrentStaticEntity {
  return Boolean(
    entity &&
    entity.confidence === 'exact' &&
    entity.provenance.kind === 'static-source' &&
    entity.provenance.anchor.projectId === source.projectId &&
    entity.provenance.anchor.sourceRevision === source.revision,
  )
}

function containsRange(
  owner: { start: number; end: number },
  candidate: { start: number; end: number },
): boolean {
  return candidate.start >= owner.start && candidate.end <= owner.end
}

function sameRange(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start === right.start && left.end === right.end
}

function findContained(
  entities: readonly CurrentStaticEntity[],
  semanticKind: string,
  owner: CurrentStaticEntity,
): CurrentStaticEntity[] {
  const range = owner.provenance.anchor.range
  return entities.filter(
    (entity) =>
      entity.semanticKind === semanticKind && containsRange(range, entity.provenance.anchor.range),
  )
}

function parseSimplePx(value: string): number | undefined {
  const match = value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/iu)
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseSimpleRotate(value: string): number | undefined {
  const match = value.match(/^rotate\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))deg\s*\)$/iu)
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function exactEntity(entity: CurrentStaticEntity): FrontendWorkshopExactSourceMapEntity {
  return entity as FrontendWorkshopExactSourceMapEntity
}

/**
 * S4-C conservative transform target resolver.
 *
 * Existing fields require exact literal inline declarations. Independent movement can add a
 * translate declaration when current Runtime evidence confirms a compatible layout. Stylesheet
 * rules, inferred selections, duplicate properties and compound transforms remain non-writable
 * here. This is an edit precision rule, never a Runtime capability rule.
 */
export function resolveFrontendWorkshopSourceTransformTargets(
  source: FrontendWorkshopSourceDocument,
  analysis: FrontendWorkshopSourceAnalysisSnapshot,
  selection: FrontendWorkshopResolvedSourceSelection,
): FrontendWorkshopSourceTransformTargets {
  const empty: FrontendWorkshopSourceTransformTargets = { fields: {} }
  if (
    selection.projectId !== source.projectId ||
    selection.sourceRevision !== source.revision ||
    selection.mappingConfidence !== 'exact' ||
    selection.provenanceKind !== 'static-source'
  ) {
    return empty
  }
  if (!selection.sourceEntityId) return empty

  const entities = analysis.sourceMap.entities.filter((entity): entity is CurrentStaticEntity =>
    isCurrentStaticEntity(source, entity),
  )
  const startTag = entities.find(
    (entity) => entity.id === selection.sourceEntityId && entity.semanticKind === 'html.start-tag',
  )
  if (!startTag) return empty

  const attributes = findContained(entities, 'html.attribute', startTag)
  let styleAttributeCount = 0
  let styleValue: CurrentStaticEntity | undefined
  for (const attribute of attributes) {
    const names = findContained(entities, 'html.attribute-name', attribute)
    if (names.length !== 1) continue
    const nameRange = names[0]!.provenance.anchor.range
    if (source.authorSource.slice(nameRange.start, nameRange.end).toLowerCase() !== 'style')
      continue
    styleAttributeCount += 1
    if (styleAttributeCount > 1) return empty
    const values = findContained(entities, 'html.attribute-value', attribute)
    if (values.length !== 1) return empty
    styleValue = values[0]
  }
  const offset = resolveOffset(source, selection, startTag, styleValue, entities)
  if (offset) empty.offset = offset
  if (styleAttributeCount !== 1 || !styleValue) return empty

  const styleRange = styleValue.provenance.anchor.range
  const inlineStyles = entities.filter(
    (entity) =>
      entity.semanticKind === 'css.inline-style' &&
      sameRange(entity.provenance.anchor.range, styleRange),
  )
  if (inlineStyles.length !== 1) return empty
  const inlineStyle = inlineStyles[0]!
  const declarations = findContained(entities, 'css.declaration', inlineStyle)
  const byProperty = new Map<string, Array<{ value: CurrentStaticEntity; raw: string }>>()

  for (const declaration of declarations) {
    const properties = findContained(entities, 'css.property', declaration)
    const values = findContained(entities, 'css.value', declaration)
    if (properties.length !== 1 || values.length !== 1) continue
    const propertyRange = properties[0]!.provenance.anchor.range
    const property = source.authorSource
      .slice(propertyRange.start, propertyRange.end)
      .trim()
      .toLowerCase()
    const value = values[0]!
    const valueRange = value.provenance.anchor.range
    const raw = source.authorSource.slice(valueRange.start, valueRange.end)
    const list = byProperty.get(property) ?? []
    list.push({ value, raw })
    byProperty.set(property, list)
  }

  const fields: FrontendWorkshopSourceTransformTargets['fields'] = {}
  const styles: NonNullable<FrontendWorkshopSourceTransformTargets['styles']> = {}
  for (const [property, matches] of byProperty) {
    if (matches.length !== 1 || /!important|var\(|calc\(/iu.test(matches[0]!.raw)) continue
    // Only the same property can override this value. Unrelated reduced-motion rules must not
    // disable every field on the page.
    if (
      analysis.sourceMap.entities.some(
        (entity) =>
          isCurrentStaticEntity(source, entity) &&
          entity.semanticKind === 'css.declaration' &&
          !containsRange(styleRange, entity.provenance.anchor.range) &&
          source.authorSource
            .slice(entity.provenance.anchor.range.start, entity.provenance.anchor.range.end)
            .trim()
            .toLowerCase()
            .startsWith(property + ':') &&
          /!important/iu.test(
            source.authorSource.slice(
              entity.provenance.anchor.range.start,
              entity.provenance.anchor.range.end,
            ),
          ),
      )
    )
      continue
    styles[property] = { target: exactEntity(matches[0]!.value), value: matches[0]!.raw }
  }
  const position = byProperty.get('position')
  const positioned =
    position?.length === 1 && /^(absolute|relative|fixed|sticky)$/iu.test(position[0]!.raw.trim())
  const blockLike =
    /^(div|section|article|main|aside|header|footer|p|h[1-6]|ul|ol|li|img|video|canvas|input|button|textarea|select|hr)$/iu.test(
      selection.tagName,
    ) ||
    /^(block|inline-block|flex|inline-flex|grid|inline-grid)$/iu.test(
      styles.display?.value.trim() ?? '',
    ) ||
    /^(absolute|fixed)$/iu.test(styles.position?.value.trim() ?? '')
  if (!blockLike) {
    delete styles.width
    delete styles.height
  }
  for (const [property, field] of Object.entries(FIELD_BY_PROPERTY)) {
    if ((field === 'x' || field === 'y') && !positioned) continue
    if (!styles[property]) continue
    const matches = byProperty.get(property)
    if (matches?.length !== 1) continue
    const parsed = parseSimplePx(matches[0]!.raw)
    if (parsed === undefined) continue
    fields[field] = {
      field,
      cssProperty: property as 'left' | 'top' | 'width' | 'height',
      target: exactEntity(matches[0]!.value),
      value: parsed,
      unit: 'px',
    }
  }

  const transforms = byProperty.get('transform')
  if (transforms?.length === 1 && styles.transform) {
    const parsed = parseSimpleRotate(transforms[0]!.raw)
    if (parsed !== undefined) {
      fields.rotation = {
        field: 'rotation',
        cssProperty: 'transform',
        target: exactEntity(transforms[0]!.value),
        value: parsed,
        unit: 'deg',
      }
    }
  }

  return {
    ...(offset ? { offset } : {}),
    inlineStyleTarget: exactEntity(styleValue),
    styles,
    fields,
  }
}

function resolveOffset(
  source: FrontendWorkshopSourceDocument,
  selection: FrontendWorkshopResolvedSourceSelection,
  startTag: CurrentStaticEntity,
  style: CurrentStaticEntity | undefined,
  entities: CurrentStaticEntity[],
): FrontendWorkshopSourceTransformTargets['offset'] {
  const layout = selection.layout
  if (!layout?.movable || selection.selectionOrigin === 'source') return undefined
  let target = startTag
  let kind: 'tag' | 'style' | 'value' = style ? 'style' : 'tag'
  let x = 0
  let y = 0
  if (style) {
    target = style
    const declarations = findContained(entities, 'css.declaration', style).filter((entity) => {
      const range = entity.provenance.anchor.range
      return /^translate\s*:/iu.test(source.authorSource.slice(range.start, range.end))
    })
    if (declarations.length > 1) return undefined
    if (declarations.length === 1) {
      const values = findContained(entities, 'css.value', declarations[0]!)
      if (values.length !== 1) return undefined
      target = values[0]!
      const range = target.provenance.anchor.range
      const raw = source.authorSource.slice(range.start, range.end).trim()
      const match = /^([+-]?[\d.]+)px\s+([+-]?[\d.]+)px$/u.exec(raw)
      if (!match || !Number.isFinite(Number(match[1])) || !Number.isFinite(Number(match[2])))
        return undefined
      x = Number(match[1])
      y = Number(match[2])
      kind = 'value'
    }
  }
  if (kind !== 'value' && layout.translate !== 'none') return undefined
  return { target: exactEntity(target), kind, x, y, scaleX: layout.scaleX, scaleY: layout.scaleY }
}

export function formatFrontendWorkshopSourceTransformValue(
  target: FrontendWorkshopSourceTransformTarget,
  value: number,
): string {
  if (!Number.isFinite(value)) throw new Error('Source transform value 必须是有限数字')
  const normalized = Object.is(value, -0) ? 0 : value
  return target.field === 'rotation' ? `rotate(${normalized}deg)` : `${normalized}px`
}
