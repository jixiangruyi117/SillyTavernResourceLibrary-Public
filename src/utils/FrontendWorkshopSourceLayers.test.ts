// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  createFrontendWorkshopLayerPatch,
  readFrontendWorkshopSourceLayers,
} from './FrontendWorkshopSourceLayers'
import { prepareFrontendWorkshopSourcePatch } from './FrontendWorkshopSourcePatch'
const source = (html: string) => createFrontendWorkshopSourceDocument('layers', html, 1)
describe('source-backed layers', () => {
  it('groups multiple roots, nested groups and table elements without changing source', () => {
    const doc = source(
      '<section data-fw-layer="person" data-fw-layer-name="人物"><h1>标题</h1><div data-fw-layer="face">头像</div></section><p data-fw-layer="person">说明</p><table><tr data-fw-layer="row"><td>数据</td></tr></table><footer>其他</footer>',
    )
    const result = readFrontendWorkshopSourceLayers(doc)
    expect(result.groups.map((group) => group.id)).toEqual(['person', 'face', 'row'])
    expect(result.groups[0]!.roots).toHaveLength(2)
    expect(result.groups[0]!.elements.some((item) => item.selection.tagName === 'h1')).toBe(true)
    expect(result.groups[0]!.elements.some((item) => item.selection.tagName === 'div')).toBe(false)
    expect(result.groups[2]!.elements.some((item) => item.selection.tagName === 'td')).toBe(true)
    expect(result.ungrouped.some((item) => item.selection.tagName === 'footer')).toBe(true)
  })
  it('renames unquoted attributes safely and preserves unrelated bytes', () => {
    const doc = source(
      '<style>.a { color:red }</style><img data-fw-layer=photo data-fw-layer-name=旧 src="https://a.test/x.png">',
    )
    const group = readFrontendWorkshopSourceLayers(doc).groups[0]!
    const result = prepareFrontendWorkshopSourcePatch(
      doc,
      createFrontendWorkshopLayerPatch(doc, group.roots, {
        kind: 'group',
        id: 'photo',
        name: '人物 " 头像',
      }),
    ).authorSource
    expect(result).toContain('<style>.a { color:red }</style>')
    expect(result).toContain('data-fw-layer-name="人物 &quot; 头像"')
    expect(
      new DOMParser()
        .parseFromString(result, 'text/html')
        .querySelector('img')
        ?.getAttribute('src'),
    ).toBe('https://a.test/x.png')
  })
  it('creates a group without wrappers and deletes nested roots once; stale and inferred selections fail', () => {
    const doc = source(
      '<section><h1>名字</h1><img src="a" /></section><script>const shared=1</script>',
    )
    const roots = readFrontendWorkshopSourceLayers(doc).elements.map((item) => item.selection)
    const marked = prepareFrontendWorkshopSourcePatch(
      doc,
      createFrontendWorkshopLayerPatch(doc, [roots[2]!], {
        kind: 'group',
        id: 'portrait',
        name: '立绘',
      }),
    ).authorSource
    expect(marked).toContain('<img src="a"  data-fw-layer="portrait" data-fw-layer-name="立绘" />')
    const removed = prepareFrontendWorkshopSourcePatch(
      doc,
      createFrontendWorkshopLayerPatch(doc, roots, { kind: 'delete' }),
    ).authorSource
    expect(removed).toBe('<script>const shared=1</script>')
    expect(() =>
      createFrontendWorkshopLayerPatch({ ...doc, revision: 2 }, roots, { kind: 'delete' }),
    ).toThrow('已变化')
    expect(() =>
      createFrontendWorkshopLayerPatch(doc, [{ ...roots[0]!, mappingConfidence: 'inferred' }], {
        kind: 'delete',
      }),
    ).toThrow()
  })
})
