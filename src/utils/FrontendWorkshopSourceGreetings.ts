import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourcePatch } from './FrontendWorkshopSourcePatch'
import { readFrontendWorkshopCharacterData } from './FrontendWorkshopSourceDelivery'
import { segmentFrontendWorkshopAuthorSource } from './FrontendWorkshopSourceHtmlSegmentation'

/** Edit the existing inert character payload, without reformatting surrounding author code. */
export function createFrontendWorkshopGreetingPatch(
  source: FrontendWorkshopSourceDocument,
  index: number,
  text: string,
): FrontendWorkshopSourcePatch {
  const character = readFrontendWorkshopCharacterData(source.authorSource)
  const greetings = character?.alternate_greetings as string[] | undefined
  if (!greetings || !Number.isInteger(index) || index < 1 || index > greetings.length)
    throw new Error('这条备用开场白已不存在，请重新选择。')
  if (!text.trim()) throw new Error('请填写开场白正文。')
  const activePayload = new DOMParser()
    .parseFromString(source.authorSource, 'text/html')
    .querySelector('script[type="application/json"][data-tavern-character]')?.textContent
  const segments = segmentFrontendWorkshopAuthorSource(source.authorSource).segments
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    if (segment.semanticKind !== 'html.start-tag') continue
    const tag = source.authorSource.slice(segment.range.start, segment.range.end)
    if (!/^<script\b/i.test(tag)) continue
    const node = new DOMParser()
      .parseFromString(tag + '</script>', 'text/html')
      .querySelector('script[type="application/json"][data-tavern-character]')
    if (!node) continue
    const content = segments.find(
      (candidate) =>
        candidate.range.start === segment.range.end &&
        candidate.semanticKind === 'html.script-content',
    )
    if (content?.semanticKind !== 'html.script-content') break
    const json = source.authorSource.slice(content.range.start, content.range.end)
    if (json !== activePayload) continue
    if (
      segments.filter(
        (candidate) =>
          candidate.semanticKind === 'html.script-content' &&
          source.authorSource.slice(candidate.range.start, candidate.range.end) === activePayload,
      ).length !== 1
    )
      throw new Error('角色卡资料存在重复位置，请在源码中编辑以避免改错。')
    // JSON was validated by the shared delivery reader. Track depth to exclude nested keys.
    const tokens = [...json.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]:,]|[^\s{}[\]:,]+/g)]
    let depth = 0
    let target: { start: number; end: number } | undefined
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t]!
      if (
        depth === 1 &&
        token[0].startsWith('"') &&
        JSON.parse(token[0]) === 'alternate_greetings' &&
        tokens[t + 1]?.[0] === ':' &&
        tokens[t + 2]?.[0] === '['
      ) {
        const value = tokens[t + 3 + (index - 1) * 2]
        if (value?.[0].startsWith('"'))
          target = {
            start: content.range.start + value.index!,
            end: content.range.start + value.index! + value[0].length,
          }
      }
      if (token[0] === '{' || token[0] === '[') depth++
      if (token[0] === '}' || token[0] === ']') depth--
    }
    if (!target) break
    return {
      projectId: source.projectId,
      sourceRevision: source.revision,
      edits: [
        {
          target: {
            confidence: 'exact',
            provenance: {
              kind: 'static-source',
              anchor: {
                projectId: source.projectId,
                sourceRevision: source.revision,
                offsetUnit: 'utf16-code-unit',
                range: target,
              },
            },
          },
          expectedText: source.authorSource.slice(target.start, target.end),
          replacement: JSON.stringify(text).replaceAll('<', '\\u003c'),
        },
      ],
    }
  }
  throw new Error('无法定位角色卡中的开场白，请在源码中编辑。')
}
