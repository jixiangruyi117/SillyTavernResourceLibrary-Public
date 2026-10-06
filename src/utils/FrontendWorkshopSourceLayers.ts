import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  analyzeFrontendWorkshopSource,
  createFrontendWorkshopStaticSourceProvenance,
} from './FrontendWorkshopSourceAnalysis'
import {
  listFrontendWorkshopSourceElements,
  type FrontendWorkshopResolvedSourceSelection,
} from './FrontendWorkshopSourceSelection'
import { extractFrontendWorkshopSourceComponentHtml } from './FrontendWorkshopSourceComponent'
import type {
  FrontendWorkshopSourcePatch,
  FrontendWorkshopSourcePatchEdit,
} from './FrontendWorkshopSourcePatch'

export interface FrontendWorkshopLayerView {
  hidden: string[]
  locked: string[]
  solo?: string
}
export interface FrontendWorkshopSourceLayer {
  id: string
  name: string
  roots: FrontendWorkshopResolvedSourceSelection[]
  ranges: { start: number; end: number }[]
  elements: ReturnType<typeof listFrontendWorkshopSourceElements>
}
const validId = /^[a-zA-Z0-9_-]+$/u
function readOpening(
  source: FrontendWorkshopSourceDocument,
  range: { start: number; end: number },
) {
  const opening = source.authorSource.slice(range.start, range.end).replace(/^<[^\s/>]+/u, '<i')
  return new DOMParser().parseFromString(opening, 'text/html').body.firstElementChild
}
export function readFrontendWorkshopSourceLayers(source: FrontendWorkshopSourceDocument) {
  const elements = listFrontendWorkshopSourceElements(source, analyzeFrontendWorkshopSource(source))
  const groups = new Map<string, FrontendWorkshopSourceLayer>()
  const ranges = new Map<string, { start: number; end: number }[]>()
  for (const element of elements) {
    const range = element.selection.sourceRange!
    const node = readOpening(source, range)
    const id = node?.getAttribute('data-fw-layer')
    if (!id || !validId.test(id)) continue
    const group = groups.get(id) ?? {
      id,
      name: node?.getAttribute('data-fw-layer-name')?.trim() || id,
      roots: [],
      ranges: [],
      elements: [],
    }
    group.roots.push(element.selection)
    groups.set(id, group)
    try {
      ranges.set(id, [
        ...(ranges.get(id) ?? []),
        extractFrontendWorkshopSourceComponentHtml(source, element.selection).range,
      ])
    } catch {
      /* Unknown/malformed code remains visible in the element list. */
    }
  }
  for (const group of groups.values()) group.ranges = ranges.get(group.id) ?? []
  const ungrouped: typeof elements = []
  for (const element of elements) {
    const start = element.selection.sourceRange!.start
    const owners = [...groups.values()].filter((group) =>
      ranges.get(group.id)?.some((range) => start >= range.start && start < range.end),
    )
    const nearest = owners.sort(
      (a, b) =>
        Math.min(
          ...ranges
            .get(a.id)!
            .filter((r) => start >= r.start && start < r.end)
            .map((r) => r.end - r.start),
        ) -
        Math.min(
          ...ranges
            .get(b.id)!
            .filter((r) => start >= r.start && start < r.end)
            .map((r) => r.end - r.start),
        ),
    )[0]
    if (nearest) nearest.elements.push(element)
    else ungrouped.push(element)
  }
  return { groups: [...groups.values()], ungrouped, elements }
}
function edit(
  source: FrontendWorkshopSourceDocument,
  range: { start: number; end: number },
  replacement: string,
): FrontendWorkshopSourcePatchEdit {
  return {
    target: {
      confidence: 'exact',
      provenance: createFrontendWorkshopStaticSourceProvenance(source, range),
    },
    expectedText: source.authorSource.slice(range.start, range.end),
    replacement,
  }
}
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
export function createFrontendWorkshopLayerPatch(
  source: FrontendWorkshopSourceDocument,
  selections: readonly FrontendWorkshopResolvedSourceSelection[],
  action: { kind: 'delete' } | { kind: 'group'; id: string; name: string },
): FrontendWorkshopSourcePatch {
  const current = listFrontendWorkshopSourceElements(source, analyzeFrontendWorkshopSource(source))
  const roots = selections.map((selection) => {
    if (
      selection.projectId !== source.projectId ||
      selection.sourceRevision !== source.revision ||
      selection.mappingConfidence !== 'exact' ||
      selection.provenanceKind !== 'static-source'
    )
      throw new Error('作品已变化，请重新选择图层')
    const found = current.find(
      (item) =>
        item.selection.sourceRange?.start === selection.sourceRange?.start &&
        item.selection.sourceRange?.end === selection.sourceRange?.end,
    )
    if (!found) throw new Error('图层对应的源码位置已变化')
    return found.selection
  })
  if (!roots.length) throw new Error('请先选择可编辑的元素')
  const edits: FrontendWorkshopSourcePatchEdit[] = []
  if (action.kind === 'delete') {
    const ranges = roots.map(
      (root) => extractFrontendWorkshopSourceComponentHtml(source, root).range,
    )
    for (const range of ranges.filter(
      (item, index) =>
        !ranges.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            other.start <= item.start &&
            other.end >= item.end &&
            (other.start < item.start || other.end > item.end || otherIndex < index),
        ),
    ))
      edits.push(edit(source, range, ''))
  } else {
    if (!validId.test(action.id) || !action.name.trim()) throw new Error('请填写图层名称')
    for (const root of roots) {
      const additions: string[] = []
      for (const [key, value] of [
        ['data-fw-layer', action.id],
        ['data-fw-layer-name', action.name],
      ]) {
        const target = root.exactAttributeTargets?.[key!]
        if (target) {
          const range = target.provenance.anchor.range
          const quote = source.authorSource[range.start - 1]
          edits.push(
            edit(
              source,
              range,
              quote === '"' || quote === "'" ? escape(value!) : `"${escape(value!)}"`,
            ),
          )
        } else {
          const node = readOpening(source, root.sourceRange!)
          if (node?.hasAttribute(key!))
            throw new Error('该分组标记需要在源码中修正，未覆盖已有代码')
          additions.push(`${key}="${escape(value!)}"`)
        }
      }
      if (additions.length) {
        const range = root.sourceRange!
        const opening = source.authorSource.slice(range.start, range.end)
        const end =
          range.end - (/\/\s*>$/u.test(opening) ? opening.length - opening.lastIndexOf('/') : 1)
        edits.push(edit(source, { start: end, end }, ' ' + additions.join(' ') + ' '))
      }
    }
  }
  return { projectId: source.projectId, sourceRevision: source.revision, edits }
}
