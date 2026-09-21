import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopSourceAiFocusedPreviewDocument } from './FrontendWorkshopSourceAiFocusedPreview'

describe('FrontendWorkshopSourceAiFocusedPreview', () => {
  it('只派生标记与隐藏逻辑，不改动 authoritative Source', () => {
    const authorSource =
      '<main><section id="target"><button>保留</button></section><aside>隐藏</aside></main>'
    const source = createFrontendWorkshopSourceDocument('project', authorSource, 100)
    const start = authorSource.indexOf('<section')
    const end = authorSource.indexOf('</section>') + '</section>'.length

    const preview = createFrontendWorkshopSourceAiFocusedPreviewDocument(source, [{ start, end }])

    expect(source.authorSource).toBe(authorSource)
    expect(preview.authorSource).toContain('<section id="target" data-srl-ai-preview-focus=')
    expect(preview.authorSource).toContain('data-srl-ai-preview-hidden')
    expect(preview.authorSource).toContain('<aside>隐藏</aside>')
    expect(preview.projectId).toBe('source-ai-focused-preview-project')
    expect(preview.revision).toBe(source.revision)
  })

  it('同一派生 Preview 可同时聚焦多个互不相邻组件', () => {
    const authorSource =
      '<main><section id="one">一</section><aside>隐藏</aside><section id="two">二</section></main>'
    const source = createFrontendWorkshopSourceDocument('project', authorSource, 100)
    const firstStart = authorSource.indexOf('<section id="one"')
    const firstEnd = authorSource.indexOf('</section>') + '</section>'.length
    const secondStart = authorSource.indexOf('<section id="two"')
    const secondEnd = authorSource.lastIndexOf('</section>') + '</section>'.length

    const preview = createFrontendWorkshopSourceAiFocusedPreviewDocument(source, [
      { start: firstStart, end: firstEnd },
      { start: secondStart, end: secondEnd },
    ])

    expect(preview.authorSource.match(/data-srl-ai-preview-focus=/gu)).toHaveLength(2)
    expect(preview.authorSource).toContain('const focuses =')
    expect(source.authorSource).toBe(authorSource)
  })

  it('范围内没有可识别根元素时 fail closed', () => {
    const source = createFrontendWorkshopSourceDocument('project', '<main>hello</main>', 100)
    expect(() =>
      createFrontendWorkshopSourceAiFocusedPreviewDocument(source, [{ start: 6, end: 11 }]),
    ).toThrow('组件预览范围内没有可识别的根元素')
  })

  it('部分交叠的多个组件范围 fail closed', () => {
    const authorSource = '<main><section>一</section><section>二</section></main>'
    const source = createFrontendWorkshopSourceDocument('project', authorSource, 100)
    expect(() =>
      createFrontendWorkshopSourceAiFocusedPreviewDocument(source, [
        { start: 0, end: 30 },
        { start: 20, end: authorSource.length },
      ]),
    ).toThrow('组件预览范围发生交叠')
  })
})
