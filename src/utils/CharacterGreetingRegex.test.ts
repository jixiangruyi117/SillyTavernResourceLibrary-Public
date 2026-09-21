import { describe, expect, it } from 'vitest'

import {
  applyCharacterGreetingRegex,
  extractCharacterGreetingRegexRules,
  getCharacterGreetingRegexPreviewTimeoutMs,
  hasMvuUpdateInstruction,
} from './CharacterGreetingRegex'

describe('CharacterGreetingRegex', () => {
  it('按酒馆首条消息生成阶段再到 Markdown 显示阶段执行 AI 输出正则', () => {
    const rules = extractCharacterGreetingRegexRules([
      {
        id: 'display',
        scriptName: '状态栏',
        findRegex: '/<status>([\\s\\S]*?)<\\/status>/g',
        replaceString: '<section class="status">$1</section>',
        placement: [2],
        markdownOnly: true,
      },
      {
        id: 'not-markdown',
        scriptName: '首条消息阶段',
        findRegex: '/secret/g',
        replaceString: 'public',
        placement: [2],
      },
      {
        id: 'prompt-only',
        scriptName: '提示词阶段',
        findRegex: '/public/g',
        replaceString: 'prompt',
        placement: [2],
        promptOnly: true,
      },
      {
        id: 'user-only',
        scriptName: '用户输入',
        findRegex: '/secret/g',
        replaceString: '',
        placement: [1],
        markdownOnly: true,
      },
      {
        id: 'disabled',
        scriptName: '停用规则',
        findRegex: '/hello/g',
        replaceString: 'hidden',
        placement: [2],
        markdownOnly: true,
        disabled: true,
      },
    ])

    expect(rules.map((rule) => rule.name)).toEqual(['状态栏', '首条消息阶段'])
    expect(
      applyCharacterGreetingRegex(['hello secret <status>心情很好</status>'], rules),
    ).toMatchObject({
      contents: ['hello public <section class="status">心情很好</section>'],
      matchedRuleNames: ['首条消息阶段', '状态栏'],
      errors: [],
      preservedBodyIndexes: [],
    })
  })

  it('兼容 source/destination 结构的显示正则', () => {
    const rules = extractCharacterGreetingRegexRules([
      {
        script_name: '兼容规则',
        find_regex: '/START([\\s\\S]*?)END/',
        replace_string: '<main>{{match}}</main>',
        source: { ai_output: true },
        destination: { display: true },
      },
    ])

    expect(applyCharacterGreetingRegex(['START正文END'], rules).contents).toEqual([
      '<main>START正文END</main>',
    ])
  })

  it('按酒馆 substituteRegex 规则替换查找式中的宏', () => {
    const rules = extractCharacterGreetingRegexRules([
      {
        scriptName: '角色名',
        findRegex: '/{{char}}/g',
        replaceString: '已替换',
        substituteRegex: 1,
        placement: [2],
        markdownOnly: true,
      },
    ])

    expect(applyCharacterGreetingRegex(['角色登场'], rules).contents).toEqual(['已替换登场'])
  })

  it('跳过 prompt-only 规则并报告非法表达式', () => {
    const rules = extractCharacterGreetingRegexRules([
      {
        scriptName: '仅提示词',
        findRegex: '/a/g',
        replaceString: 'b',
        promptOnly: true,
        placement: [2],
      },
      {
        scriptName: '损坏表达式',
        findRegex: '/([/g',
        replaceString: '',
        placement: [2],
        markdownOnly: true,
      },
    ])

    expect(rules.map((rule) => rule.name)).toEqual(['损坏表达式'])
    expect(applyCharacterGreetingRegex(['原文'], rules)).toMatchObject({
      contents: ['原文'],
      matchedRuleNames: [],
      errors: ['损坏表达式 的查找表达式无效'],
      preservedBodyIndexes: [],
    })
  })

  it('同时勾选 markdownOnly 和 promptOnly 时仍按酒馆在 Markdown 显示阶段运行', () => {
    const rules = extractCharacterGreetingRegexRules([
      {
        scriptName: '显示清理',
        findRegex: '/<(UpdateVariable|Analysis|JSONPatch)>[\\s\\S]*?<\\/\\1>/gm',
        replaceString: '',
        promptOnly: true,
        markdownOnly: true,
        placement: [2],
      },
    ])

    expect(rules.map((rule) => rule.name)).toEqual(['显示清理'])
    expect(
      applyCharacterGreetingRegex(
        ['正文<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>结尾'],
        rules,
      ).contents,
    ).toEqual(['正文结尾'])
  })

  it('按开场消息 depth=0 应用深度限制', () => {
    const rules = extractCharacterGreetingRegexRules([
      {
        scriptName: '首层',
        findRegex: '/正文/g',
        replaceString: '首层正文',
        placement: [2],
        markdownOnly: true,
        minDepth: 0,
        maxDepth: 0,
      },
      {
        scriptName: '深层',
        findRegex: '/正文/g',
        replaceString: '深层正文',
        placement: [2],
        markdownOnly: true,
        minDepth: 1,
      },
    ])

    expect(rules.map((rule) => rule.name)).toEqual(['首层'])
    expect(applyCharacterGreetingRegex(['正文'], rules).contents).toEqual(['首层正文'])
  })

  it('按酒馆 trimStrings 清理捕获组', () => {
    const rules = extractCharacterGreetingRegexRules([
      {
        scriptName: '裁剪',
        findRegex: '/<a>([\\s\\S]*?)<\\/a>/g',
        replaceString: '[$1]',
        trimStrings: ['REMOVE'],
        placement: [2],
        markdownOnly: true,
      },
    ])

    expect(applyCharacterGreetingRegex(['<a>保留REMOVE正文</a>'], rules).contents).toEqual([
      '[保留正文]',
    ])
  })

  it('不自行删除 MVU 控制块或改写占位符', () => {
    const source =
      '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>\n<StatusPlaceHolderImpl/>'

    expect(hasMvuUpdateInstruction(source)).toBe(true)
    expect(applyCharacterGreetingRegex([source], []).contents).toEqual([source])
  })

  it('不把被作者正则替换掉的正文擅自拼回', () => {
    const source = '这是一整段开场白正文。'
    const rules = extractCharacterGreetingRegexRules([
      {
        scriptName: '整页面板',
        findRegex: '/[\\s\\S]*/',
        replaceString: '<section class="panel">角色状态</section>',
        placement: [2],
        markdownOnly: true,
      },
    ])

    const result = applyCharacterGreetingRegex([source], rules)
    expect(result.contents).toEqual(['<section class="panel">角色状态</section>'])
    expect(result.preservedBodyIndexes).toEqual([])
  })
})

describe('parseRegex 与酒馆 regexFromString 对齐', () => {
  it('裸斜杠字面量能命中多行文本', () => {
    const result = applyCharacterGreetingRegex(
      ['前文\n<a>第一行\n第二行</a>\n后文'],
      [{ id: '1', name: '裸斜杠', find: '/<a>([\\s\\S]*?)</a>/gi', replace: '[$1]' }],
    )
    expect(result.contents[0]).toContain('[第一行\n第二行]')
    expect(result.contents[0]).not.toContain('<a>')
    expect(result.errors).toEqual([])
  })

  it('支持转义斜杠', () => {
    const result = applyCharacterGreetingRegex(
      ['a/b 和 a/c'],
      [{ id: '1', name: '转义斜杠', find: '/a\\/b/g', replace: 'X' }],
    )
    expect(result.contents[0]).toBe('X 和 a/c')
  })

  it('非法表达式保留原文并报告错误', () => {
    const result = applyCharacterGreetingRegex(
      ['正文'],
      [{ id: '1', name: '坏正则', find: '([未闭合', replace: 'X' }],
    )
    expect(result.contents[0]).toBe('正文')
    expect(result.errors).toContain('坏正则 的查找表达式无效')
  })

  it('非法 flags 时按酒馆规则回退为整串裸正则', () => {
    const result = applyCharacterGreetingRegex(
      ['路径 /1/2/3 出现'],
      [{ id: '1', name: '路径', find: '/1/2/3', replace: 'P' }],
    )
    expect(result.contents[0]).toBe('路径 /P/3 出现')
    expect(result.errors).toEqual([])
  })

  it('在查找式与替换式中使用当前角色名展开酒馆宏', () => {
    const result = applyCharacterGreetingRegex(
      ['林默走进酒馆'],
      [
        {
          id: '1',
          name: '角色名宏',
          find: '/{{char}}/',
          replace: '<strong>{{char}}</strong>',
          substituteRegex: 1,
        },
      ],
      { charName: '林默' },
    )

    expect(result.contents[0]).toBe('<strong>林默</strong>走进酒馆')
  })
})

describe('角色开场白正则 Worker 时限', () => {
  it('为较大的开场白和规则集留出结构化传输余量，并保持上限', () => {
    expect(getCharacterGreetingRegexPreviewTimeoutMs(['short'], [])).toBe(3_000)
    expect(
      getCharacterGreetingRegexPreviewTimeoutMs(
        ['x'.repeat(300 * 1024)],
        Array.from({ length: 20 }, (_, index) => ({
          id: String(index),
          name: `rule-${index}`,
          find: 'x',
          replace: 'y'.repeat(2 * 1024),
        })),
      ),
    ).toBeGreaterThan(3_000)
    expect(
      getCharacterGreetingRegexPreviewTimeoutMs(
        ['x'.repeat(2 * 1024 * 1024)],
        Array.from({ length: 128 }, (_, index) => ({
          id: String(index),
          name: `rule-${index}`,
          find: 'x'.repeat(8 * 1024),
          replace: 'y'.repeat(8 * 1024),
        })),
      ),
    ).toBe(8_000)
  })
})
