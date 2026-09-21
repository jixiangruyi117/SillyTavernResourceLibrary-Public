// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { analyzeFrontendWorkshopSource } from './FrontendWorkshopSourceAnalysis'
import {
  listFrontendWorkshopSourceContent,
  listFrontendWorkshopSourceElements,
} from './FrontendWorkshopSourceSelection'
import { resolveFrontendWorkshopSourceTransformTargets } from './FrontendWorkshopSourceTransform'
import {
  createFrontendWorkshopSourceCanvasGesturePatch,
  getFrontendWorkshopSourceCanvasGestureCapabilities,
} from './FrontendWorkshopSourceCanvasGesture'
import { prepareFrontendWorkshopSourcePatch } from './FrontendWorkshopSourcePatch'

function setup(html: string) {
  const source = createFrontendWorkshopSourceDocument('editing', html, 100)
  const analysis = analyzeFrontendWorkshopSource(source)
  const selection = listFrontendWorkshopSourceElements(source, analysis)[0]!.selection
  return { source, analysis, selection }
}
describe('Source content and visual offsets', () => {
  it('does not let an unrelated reduced-motion important rule disable editable styles', () => {
    const { source, analysis, selection } = setup(
      '<style>@media (prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important}}</style><div style="color:red;position:relative;left:10px;top:20px">hello</div>',
    )
    const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)
    expect(targets.styles?.color?.value).toBe('red')
    expect(targets.fields.x?.value).toBe(10)
    expect(targets.fields.y?.value).toBe(20)
  })
  it('edits mixed title and paragraphs individually without flattening spans, links or scripts', () => {
    const html =
      '<h1>沈砚潮<span>SHEN</span><br>档案<img src="avatar.png"><script>const name="untouched"</script></h1>'
    const { source, analysis, selection } = setup(html)
    const fields = listFrontendWorkshopSourceContent(source, analysis, selection)
    expect(
      fields.map((field) =>
        source.authorSource.slice(
          field.target.provenance.anchor.range.start,
          field.target.provenance.anchor.range.end,
        ),
      ),
    ).toEqual(['沈砚潮', 'SHEN', '档案', 'avatar.png'])
    const changed = prepareFrontendWorkshopSourcePatch(source, {
      projectId: source.projectId,
      sourceRevision: 1,
      edits: [{ target: fields[0]!.target, expectedText: '沈砚潮', replacement: '新名字' }],
    })
    expect(changed.authorSource).toBe(html.replace('沈砚潮', '新名字'))
    expect(
      listFrontendWorkshopSourceContent(source, analysis, { ...selection, sourceRevision: 2 }),
    ).toEqual([])
  })
  it.each(['', ' style="color:red;transform:rotate(3deg)"', ' style=color:red'])(
    'moves ordinary CSS layout with one precise reversible patch (%s)',
    (suffix) => {
      const html = `<div${suffix}>hello</div>`
      const { source, analysis, selection } = setup(html)
      selection.selectionOrigin = undefined
      selection.layout = { movable: true, translate: 'none', scaleX: 0.5, scaleY: 0.5 }
      const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)
      expect(getFrontendWorkshopSourceCanvasGestureCapabilities(targets).move).toBe(true)
      const patch = createFrontendWorkshopSourceCanvasGesturePatch(source, targets, {
        mode: 'move',
        deltaX: 15,
        deltaY: -10,
      })!
      const changed = prepareFrontendWorkshopSourcePatch(source, patch)
      const parsed = new DOMParser().parseFromString(changed.authorSource, 'text/html').body
        .firstElementChild!
      expect(parsed.getAttribute('style')).toContain('translate:30px -20px')
      expect(parsed.textContent).toBe('hello')
      if (suffix.includes('transform'))
        expect(parsed.getAttribute('style')).toContain('transform:rotate(3deg)')
      const restored =
        changed.authorSource.slice(0, changed.changes[0]!.afterRange.start) +
        changed.changes[0]!.beforeText +
        changed.authorSource.slice(changed.changes[0]!.afterRange.end)
      expect(restored).toBe(html)
      expect(() => prepareFrontendWorkshopSourcePatch({ ...source, revision: 2 }, patch)).toThrow(
        'revision',
      )
    },
  )
  it('updates an existing offset rather than appending duplicate styles', () => {
    const { source, analysis, selection } = setup(
      '<div style="translate:20px 30px;transform:scale(1.08)">text</div>',
    )
    selection.selectionOrigin = undefined
    selection.layout = { movable: true, translate: '20px 30px', scaleX: 1, scaleY: 1 }
    const targets = resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection)
    const patch = createFrontendWorkshopSourceCanvasGesturePatch(source, targets, {
      mode: 'move',
      deltaX: 5,
      deltaY: 8,
    })!
    expect(prepareFrontendWorkshopSourcePatch(source, patch).authorSource).toBe(
      '<div style="translate:25px 38px;transform:scale(1.08)">text</div>',
    )
    selection.layout.movable = false
    expect(
      resolveFrontendWorkshopSourceTransformTargets(source, analysis, selection).offset,
    ).toBeUndefined()
  })
})
