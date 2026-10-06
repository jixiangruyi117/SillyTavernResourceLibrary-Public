import { describe, expect, it } from 'vitest'

import { humanizeRegexMatch, summarizeRegexEffect } from './RegexEffectPreview'

describe('RegexEffectPreview', () => {
  it('turns a thinking block pattern into a readable example', () => {
    expect(humanizeRegexMatch('<thinking>[\\s\\S]*?<\\/thinking>')).toBe(
      '<thinking>内容</thinking>',
    )
    expect(summarizeRegexEffect('<thinking>[\\s\\S]*?<\\/thinking>', '')).toMatchObject({
      kind: 'delete',
      after: '空',
    })
  })

  it('shows capture-based markers as representative content', () => {
    expect(humanizeRegexMatch('MiPhone_start([\\s\\S]+?)MiPhone_end')).toBe(
      'MiPhone_start…MiPhone_end',
    )
    expect(humanizeRegexMatch('\\[忽视此条变化：([^\\]]+)\\]')).toBe('[忽视此条变化：…]')
  })

  it('summarizes field-heavy status blocks without repeating placeholder text', () => {
    const value =
      '<角色状态>[\\s\\n]*衣着[:: ][\\s\\n]*(.*?)[\\s\\n]*心情[:: ][\\s\\n]*(.*?)[\\s\\n]*好感度[:: ][\\s\\n]*(.*?)[\\s\\n]*动作[:: ][\\s\\n]*(.*?)<\\/角色状态>'

    expect(humanizeRegexMatch(value)).toBe(
      '<角色状态>衣着：…；心情：…；好感度：…；动作：…</角色状态>',
    )
    expect(humanizeRegexMatch(value)).not.toContain('示例内容示例内容')
  })

  it('classifies static HTML replacements separately from plain text', () => {
    const summary = summarizeRegexEffect(
      '【这是一个简介】',
      `
      \`\`\`html
      <style>.card { color: red }</style><div class="card">简介卡片</div>
      \`\`\`
    `,
    )

    expect(summary.kind).toBe('html')
    expect(summary.after).toBe('HTML / CSS 组件')
    expect(summary.staticPreview.hasStaticContent).toBe(true)
  })

  it('describes whitespace normalization without pretending it is deletion', () => {
    expect(summarizeRegexEffect('\\s{2,}', ' ')).toMatchObject({
      kind: 'text',
      before: '连续空白字符',
      after: '一个空格',
    })
  })

  it('marks script-only replacements as dynamic instead of rendering them', () => {
    expect(
      summarizeRegexEffect('START([\\s\\S]+?)END', '<script>loadRemotePage()</script>'),
    ).toMatchObject({
      kind: 'dynamic',
      after: '动态脚本页面（不执行）',
    })
  })
})
