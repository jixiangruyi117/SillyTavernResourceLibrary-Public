/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import { summarizeRegexEffect } from './RegexEffectPreview'
import { buildRegexPreviewDocument } from './RegexStaticPreview'

describe('RegexStaticPreview', () => {
  it('正则替换效果与聊天消息共用 SillyTavern 媒体策略', () => {
    const source = '<div class="card"><img src="https://example.com/card.png"></div>'
    const effect = summarizeRegexEffect('x', source)
    const blocked = buildRegexPreviewDocument(effect, 'test', source)
    const allowed = buildRegexPreviewDocument(effect, 'test', source, {
      allowRemoteResources: true,
      allowScripts: false,
    })

    expect(blocked).toContain('img-src data: blob:')
    expect(blocked).not.toContain('img-src data: blob: https: http:')
    expect(allowed).toContain('img-src data: blob: https: http:')
  })

  it('普通消息替换中的 script 始终由 SillyTavern 消息净化删除', () => {
    const source = '<div>保留正文</div><script>document.body.dataset.ready = "yes"</script>'
    const effect = summarizeRegexEffect('x', source)
    const document = buildRegexPreviewDocument(effect, 'test', source, {
      allowRemoteResources: true,
      allowScripts: true,
    })

    expect(document).toContain('保留正文')
    expect(document).not.toContain('document.body.dataset.ready')
  })

  it('不再为脚本替换伪造酒馆助手对象或诊断覆盖层', () => {
    const source = '<script>SillyTavern.getContext(); getChatMessages()</script>'
    const effect = summarizeRegexEffect('x', source)
    const document = buildRegexPreviewDocument(effect, 'test', source, {
      allowRemoteResources: true,
      allowScripts: true,
    })

    expect(document).not.toContain('SillyTavern.getContext()')
    expect(document).not.toContain('window.TavernHelper=helper')
    expect(document).not.toContain('脚本没有生成可见预览')
  })
})
