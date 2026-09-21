import { segmentFrontendWorkshopAuthorSource } from './FrontendWorkshopSourceHtmlSegmentation'
import { createFrontendWorkshopSourceEntityId } from './FrontendWorkshopSourceRelations'

interface SourceDomAnchor {
  entityId: string
  tagName: string
}

/** Disposable editor projection. Never persist this HTML or use it for final delivery. */
export function projectFrontendWorkshopSourceDomAnchors(source: string, attribute: string) {
  const segmentation = segmentFrontendWorkshopAuthorSource(source)
  const anchors: SourceDomAnchor[] = []
  const edits: Array<{ at: number; value: string }> = []
  let templateDepth = 0
  for (const segment of segmentation.segments) {
    if (!['html.start-tag', 'html.end-tag'].includes(segment.semanticKind)) continue
    const opening = source.slice(segment.range.start, segment.range.end)
    const tagName = /^<\/?([\w:-]+)/u.exec(opening)?.[1]?.toLowerCase()
    if (tagName === 'template') {
      templateDepth += segment.semanticKind === 'html.start-tag' ? 1 : -1
      templateDepth = Math.max(0, templateDepth)
      continue
    }
    if (
      segment.semanticKind !== 'html.start-tag' ||
      templateDepth ||
      !tagName ||
      ['html', 'head', 'body', 'script', 'style', 'title', 'meta', 'link', 'base'].includes(
        tagName,
      ) ||
      segmentation.unknownSlices.some(
        ({ range }) => range.start < segment.range.end && range.end > segment.range.start,
      )
    )
      continue
    const token = anchors.length
    anchors.push({
      entityId: createFrontendWorkshopSourceEntityId('html.start-tag', segment.range),
      tagName,
    })
    // Insert immediately after the tag name: unquoted trailing values and SVG /> stay intact.
    edits.push({ at: segment.range.start + 1 + tagName.length, value: ` ${attribute}="${token}"` })
  }
  let html = source
  for (const edit of edits.reverse())
    html = html.slice(0, edit.at) + edit.value + html.slice(edit.at)
  return { html, attribute, anchors }
}

/** Parser insertion records establish object identity, not a later DOM resemblance search.
 * Only direct added nodes are registered: traversing their *current* descendants could bind
 * a script-created clone after the original was removed. Tokens are single-use per runtime.
 */
export function installFrontendWorkshopSourceDomAnchors(
  win: Window & typeof globalThis,
  attribute: string,
  anchors: readonly SourceDomAnchor[],
) {
  const owners = new Set<number>()
  const identities = new WeakMap<Node, string>()
  const register = (records: MutationRecord[]) => {
    for (const record of records)
      for (const node of record.addedNodes) {
        if (!(node instanceof win.Element)) continue
        const raw = node.getAttribute(attribute)
        if (raw === null) continue
        node.removeAttribute(attribute)
        if (!/^(0|[1-9]\d*)$/u.test(raw)) continue
        const token = Number(raw)
        const anchor = anchors[token]
        if (!anchor || owners.has(token) || node.localName.toLowerCase() !== anchor.tagName)
          continue
        owners.add(token)
        identities.set(node, anchor.entityId)
      }
  }
  const observer = new win.MutationObserver(register)
  observer.observe(win.document, { childList: true, subtree: true })
  return {
    get(node: Node) {
      register(observer.takeRecords())
      return identities.get(node)
    },
    dispose() {
      observer.disconnect()
    },
  }
}
