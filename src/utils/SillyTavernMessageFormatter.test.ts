/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import regressionCard from '../../fixtures/render-parity-regression-character.json'
import upstreamOracle from '../../fixtures/render-parity-st-1.18.0.expected.json'
import {
  formatSillyTavernCoreMessage,
  formatSillyTavernMessage,
  scopeSillyTavernMessageStyles,
} from './SillyTavernMessageFormatter'

describe('SillyTavernMessageFormatter', () => {
  it('与本地 SillyTavern 1.18.0 对同一张回归卡的核心 HTML 逐字一致', () => {
    const sources = [
      regressionCard.data.first_mes,
      ...regressionCard.data.alternate_greetings.slice(0, 2),
    ]

    sources.forEach((source, index) => {
      expect(formatSillyTavernCoreMessage(source).html).toBe(upstreamOracle.messages[index]?.html)
    })
    expect(formatSillyTavernCoreMessage(upstreamOracle.messages[3]?.regexed ?? '').html).toBe(
      upstreamOracle.messages[3]?.html,
    )
  })

  it('使用酒馆 Showdown 选项格式化正文和 Markdown', () => {
    const result = formatSillyTavernMessage(
      '第一段正文。\n\n第二段有 **强调**，并保留 mid_word_name。',
    )

    expect(result.usedMarkdown).toBe(true)
    expect(result.html).toContain('<p>第一段正文。</p>')
    expect(result.html).toContain('<p>第二段有 <strong>强调</strong>')
    expect(result.html).toContain('mid_word_name')
  })

  it('按浏览器与酒馆净化规则保留非法自定义标签中的正文', () => {
    const result = formatSillyTavernMessage(
      '九月依旧闷热。\n\n{{user}}站在柜前。\n\n<QQSpace>状态内容</QQSpace>',
    )

    expect(result.html).toContain('<p>九月依旧闷热。</p>')
    expect(result.html).toContain('<p>{{user}}站在柜前。</p>')
    expect(result.html).toContain('<p>状态内容</p>')
    expect(result.html).not.toContain('QQSpace')
  })

  it('裸 CSS 仍是正文，不会被识别成 style', () => {
    const result = formatSillyTavernCoreMessage(
      '城堡的外墙塌了大半，剩下的部分长满暗绿色的苔藓。\n\n.status-card { color: red; padding: 12px; }\n\n这是一段正文，不是 CSS。',
    )

    expect(result.html).toBe(
      '<p>城堡的外墙塌了大半，剩下的部分长满暗绿色的苔藓。</p>\n' +
        '<p>.status-card { color: red; padding: 12px; }</p>\n' +
        '<p>这是一段正文，不是 CSS。</p>',
    )
  })

  it('像酒馆一样同时限定 CSS 作用域并改写作者 class', () => {
    const result = scopeSillyTavernMessageStyles(
      '<style>.card{color:red}.mes_text{font-size:99px}.mes_text p{margin:1px}@media(max-width:600px){p{margin:0}}</style>',
    )

    expect(result).toContain('.mes_text .custom-card')
    expect(result).toContain('.mes_text .custom-mes_text')
    expect(result).toContain('.mes_text .custom-mes_text p')
    expect(result).toContain('.mes_text p')
    expect(result).not.toContain('<style>.card')
  })

  it('同时改写 HTML class 与对应 CSS selector', () => {
    const result = formatSillyTavernMessage(
      '<style>.welcome{color:teal}</style><div class="welcome">你好</div>',
    )

    expect(result.html).toContain('.mes_text .custom-welcome')
    expect(result.html).toContain('class="custom-welcome"')
  })

  it('原始消息脚本会在酒馆消息净化阶段被移除', () => {
    const result = formatSillyTavernMessage(
      '<div id="result">正文</div><script>document.querySelector("#result").remove()</script>',
    )

    expect(result.blockedScripts).toBe(true)
    expect(result.html).toContain('正文')
    expect(result.html).not.toContain('document.querySelector')
    expect(result.html).not.toContain('<script')
  })

  it('html 语言的普通片段代码块仍是代码', () => {
    const result = formatSillyTavernMessage(
      '正文仍然保留。\n\n```html\n<section class="status">状态栏</section>\n```',
    )

    expect(result.frontendBlockCount).toBe(0)
    expect(result.html).toContain('<pre>')
    expect(result.html).toContain('&lt;section')
    expect(result.html).not.toContain('data-srl-frontend-block')
  })

  it('只把酒馆助手 isFrontend 命中的已渲染代码块交给 iframe', () => {
    const result = formatSillyTavernMessage(
      '正文仍然保留。\n\n```html\n<html><body><section class="status">状态栏</section></body></html>\n```',
    )

    expect(result.frontendBlockCount).toBe(1)
    expect(result.html).toContain('<p>正文仍然保留。</p>')
    expect(result.html).toContain('<div class="TH-render" data-srl-render-frontend="true"><pre>')
    expect(result.frontendBlocks[0]).toContain('<section class="status">状态栏</section>')
    expect(result.html).not.toContain('```')
  })

  it('reads frontend blocks from the rendered pre DOM like TavernHelper', () => {
    const result = formatSillyTavernMessage(
      '```html\n<!doctype html>\n<html><body><div>A &amp; B</div></body></html>\n```',
    )

    expect(result.frontendBlockCount).toBe(1)
    expect(result.frontendBlocks[0]).toContain('<html><body><div>A & B</div></body></html>')
    expect(result.html).toContain('<div class="TH-render" data-srl-render-frontend="true"><pre>')
    expect(result.html).toContain('</pre></div>')
    expect(result.html).not.toContain('data-srl-frontend-block')
  })

  it('不依据代码围栏标签擅自判断 CSS', () => {
    const result = formatSillyTavernMessage(
      '```css\n<body><main class="opening-prose">这仍是正文。</main></body>\n```',
    )

    expect(result.frontendBlockCount).toBe(1)
    expect(result.frontendBlocks[0]).toContain('<body>')
    expect(result.frontendBlocks[0]).toContain('这仍是正文。')
    expect(result.frontendBlocks[0]).not.toContain('<style>')
  })

  it('无语言围栏只有零散标签时保持为代码', () => {
    const result = formatSillyTavernMessage('```\n<div class="tips">这是示例代码</div>\n```')

    expect(result.frontendBlockCount).toBe(0)
    expect(result.html).toContain('<pre>')
  })

  it('无语言围栏包含 body 特征时按助手前端块处理', () => {
    const result = formatSillyTavernMessage(
      '正文。\n\n```\n<body><section>状态栏</section></body>\n```',
    )

    expect(result.frontendBlockCount).toBe(1)
    expect(result.frontendBlocks[0]).toContain('<section>状态栏</section>')
  })

  it('非前端代码围栏保持可读', () => {
    const result = formatSillyTavernMessage('```json\n{"name":"谢赢"}\n```')

    expect(result.frontendBlockCount).toBe(0)
    expect(result.html).toContain('{"name":"谢赢"}')
    expect(result.html).toContain('<pre>')
  })

  it('裸完整 HTML 文档仍走酒馆消息格式化，不冒充助手代码围栏', () => {
    const source =
      '<!doctype html><html><head><style>body{margin:0}</style></head><body><main id="app">正文</main><script>render()</script></body></html>'
    const result = formatSillyTavernMessage(source)

    expect(result.usedMarkdown).toBe(true)
    expect(result.frontendBlockCount).toBe(0)
    expect(result.standaloneFrontendDocument).toBe(false)
    expect(result.html).toContain('正文')
    expect(result.html).toContain('.mes_text body')
    expect(result.html).not.toContain('render()')
  })

  it('裸完整文档后的正文仍留在同一酒馆消息层', () => {
    const source = `<!doctype html>
<html><head><style>body{overflow:hidden}</style></head>
<body><audio autoplay loop><source src="https://example.com/bgm.mp3"></audio></body></html>

2019年9月11日 周三 18:36

夕阳的余晖染红了狭窄的巷口。`
    const result = formatSillyTavernMessage(source)

    expect(result.frontendBlockCount).toBe(0)
    expect(result.html).not.toContain('data-srl-frontend-block')
    expect(result.html).toContain('<p>2019年9月11日 周三 18:36</p>')
    expect(result.html).toContain('<p>夕阳的余晖染红了狭窄的巷口。</p>')
  })

  it('消息净化阶段移除 HTML 注释元数据', () => {
    const result = formatSillyTavernMessage('<!-- theme: 暧昧期 -->\n<!-- title: KTV团建 -->\n正文')

    expect(result.html).not.toContain('KTV团建')
    expect(result.html).not.toContain('<!--')
    expect(result.html).toContain('<p>正文</p>')
  })
})
