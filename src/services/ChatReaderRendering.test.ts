/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { buildCompatibilityFrontendDocument } from '../utils/RichContentPreview'
import {
  archivedChatSnapshot,
  chatRegexRules,
  chatRegexProfileRules,
  chatRenderInput,
  formatChatResult,
  selectChatReply,
  chatReaderCss,
  chatReaderFonts,
  transformChatInputs,
  readChatRegexSource,
  type ChatRenderInput,
} from './ChatReaderRendering'
import { applyCharacterGreetingRegex } from '../utils/CharacterGreetingRegex'

describe('chat history display semantics', () => {
  it.each([
    '```html\r\n<div>STATUS_CODE</div>\r\n```\r\n尾声',
    '    STATUS_CODE = { value: 1 };\n\n尾声',
    '&lt;div class="status"&gt;STATUS_CODE&lt;/div&gt;\n\n尾声',
    '<code>STATUS_CODE</code>\n\n尾声',
  ])('pure reading removes code envelopes and keeps following prose: %s', (source) => {
    const result = formatChatResult('开头\n\n' + source, false, false, undefined, true)
    expect(result.html).not.toContain('STATUS_CODE')
    expect(result.html).toContain('开头')
    expect(result.html).toContain('尾声')
  })
  it('loads only the chosen group from a saved regex collection', async () => {
    const rule = {
      findRegex: 'x',
      replaceString: '<div>x</div>',
      markdownOnly: true,
      disabled: true,
      placement: [2],
    }
    const resource = {
      type: 'regex',
      originalBlob: {
        size: 10,
        text: async () => JSON.stringify({ global: [], scoped: [rule], preset: [] }),
      },
    } as never
    expect(await readChatRegexSource(resource, 'character')).toEqual([rule])
    await expect(readChatRegexSource(resource, 'preset')).rejects.toThrow('没有显示正则')
  })
  it('reports rule limits instead of silently rendering unprocessed source', () => {
    const rules = Array.from({ length: 129 }, () => ({
      findRegex: 'x',
      replaceString: '',
      markdownOnly: true,
      placement: [2],
    }))
    const input = chatRenderInput(
      { index: 1, depth: 0, message: { name: '角色', mes: 'x', is_user: false } },
      {},
      { extraRules: rules },
    )
    expect(input.rules).toHaveLength(128)
    expect(input.diagnostics?.join()).toContain('后续规则未执行')
  })
  it('projects only prose in clean reading without constructing frontend panels or media', () => {
    const source = [
      '雨声停了。\n\n**窗边的人**抬起头。',
      '```html\n<html><style>invalid {{{</style><body>隐藏的状态栏<script>throw Error()</script></body></html>\n```',
      '<div><div>嵌套状态</div>末行状态</div>',
      '<p>仍有<em>轻声交谈</em>的正文。</p>',
      '![](data:image/png;base64,aA==)',
      '<audio src="https://example.com/sound.mp3"></audio>',
    ].join('\n\n')
    const result = formatChatResult(source, true, false, undefined, true)
    expect(result.html).toContain('窗边的人')
    expect(result.html).toContain('轻声交谈')
    expect(result.html).not.toMatch(/状态|invalid|script|audio|img|iframe|style|src=/i)
    expect(result.frontends).toEqual([])
    expect(result.formatted.frontendBlocks).toEqual([])
    expect(result.frontendCount).toBe(0)
  })
  it('returns empty prose for an HTML-only floor, without exposing code as a fallback', () => {
    expect(
      formatChatResult('```html\n<body>只有状态栏</body>\n```', false, false, undefined, true).html,
    ).toBe('')
  })
  it('renders an alternate reply with its own saved data without changing the archived selection', () => {
    const entry = {
      index: 3,
      depth: 1,
      message: {
        name: '角色',
        is_user: false,
        mes: '当前正文',
        swipe_id: 0,
        swipes: ['当前正文', '另一条正文'],
        extra: { display_text: '当前显示' },
        variables: [{ value: 1 }, { value: 9 }],
      },
    }
    const selected = selectChatReply(entry, 1)
    expect(chatRenderInput(selected, {}, {}).source).toBe('另一条正文')
    expect(archivedChatSnapshot(selected, 8)).toMatchObject({
      message_id: 3,
      swipe_id: 1,
      data: { value: 9 },
    })
    expect(entry.message.mes).toBe('当前正文')
    expect(entry.message.swipe_id).toBe(0)
    expect(() => selectChatReply(entry, 2)).toThrow('不存在')
    expect(selectChatReply(entry, 0)).toBe(entry)
  })
  it('extracts chat CSS and theme variables while dropping unrelated panels and imports', () => {
    const css = chatReaderCss(
      ':root{--bubble:red;color:black}body .sheld #chat .mes_text{color:var(--bubble)}#top-bar{display:none}@media(min-width:1px){.mes{padding:2px}.settings{display:none}}@import url(https://example.com/all.css);',
    )
    expect(css).toContain('--bubble: red')
    expect(css).toContain('#chat .mes_text')
    expect(css).toContain('.mes')
    expect(css).not.toMatch(/sheld|top-bar|settings|@import|color: black/)
  })
  it('maps saved theme colors to chat variables and ignores invalid colors', () => {
    const css = chatReaderCss('', {
      main_text_color: '#123456',
      quote_text_color: 'red',
      chat_tint_color: 'url(https://example.com/background)',
    })
    expect(css).toContain('--SmartThemeBodyColor:rgb(18, 52, 86)')
    expect(css).toContain('--SmartThemeQuoteColor:red')
    expect(css).not.toContain('example.com')
    expect(css).toContain('#chat q')
  })
  it('retains message decorations and root backgrounds without importing toolbar selectors', () => {
    const css = chatReaderCss(
      '<style>body{background-image:url(https://example.com/paper.png);position:fixed}.mes_block::before{content:"";background:url(https://example.com/ribbon.png)}.mesAvatarWrapper .avatar img{border-radius:4px}q{color:pink}#top-bar{display:none}</style>',
    )
    expect(css).toContain('.mes_block::before')
    expect(css).toContain('paper.png')
    expect(css).toContain('ribbon.png')
    expect(css).toContain('.mesAvatarWrapper .avatar img')
    expect(css).toContain('#chat .mes_text q')
    expect(css).not.toMatch(/top-bar|position: fixed/)
    const shell = chatReaderCss(
      '#bg1{background-image:url(https://example.com/back.png);position:fixed}',
    )
    expect(shell).toContain('back.png')
    expect(shell).not.toMatch(/position/)
  })
  it('loads only font faces from imported stylesheets and respects remote opt-out', async () => {
    const loader = await import('../utils/PreviewResourcePreloader')
    const read = vi
      .spyOn(loader, 'readPreviewStylesheet')
      .mockResolvedValue(
        '@font-face{font-family:Archive;src:url(https://example.com/a.woff2)}body{display:none}',
      )
    const source = '@import url("https://example.com/fonts.css");'
    expect((await chatReaderFonts(source, false)).css).toBe('')
    expect(read).not.toHaveBeenCalled()
    const result = await chatReaderFonts(source, true)
    expect(result.css).toContain('@font-face')
    expect(result.css).not.toContain('display')
    expect(read).toHaveBeenCalledOnce()
    read.mockRestore()
  })
  it('shares profile switches only for identical rule content in the same scope', async () => {
    const rule = {
      id: 'same-id',
      scriptName: '同名规则',
      findRegex: 'A',
      replaceString: 'B',
      markdownOnly: true,
      placement: [2],
    }
    const [first] = await chatRegexProfileRules({}, { extraRules: [rule] })
    const saved = { [first!.signature]: false }
    const [same] = await chatRegexProfileRules({}, { extraRules: [{ ...rule }] }, saved)
    expect(same!.enabled).toBe(false)
    const [changed] = await chatRegexProfileRules(
      {},
      { extraRules: [{ ...rule, replaceString: 'C' }] },
      saved,
    )
    expect(changed!.enabled).toBe(true)
    const [otherScope] = await chatRegexProfileRules({}, { presetRules: [rule] }, saved)
    expect(otherScope!.enabled).toBe(true)
    expect(rule).not.toHaveProperty('disabled')
  })
  it('runs archived global display rules before scoped rules and ignores disabled ones', () => {
    const rule = { findRegex: 'A', replaceString: 'B', markdownOnly: true, placement: [2] }
    const input = chatRenderInput(
      { index: 2, depth: 0, message: { name: '角色', mes: 'A', is_user: false } },
      { extensions: { regex_scripts: [{ ...rule, findRegex: 'B', replaceString: 'C' }] } },
      { extraRules: [{ ...rule, disabled: true, replaceString: 'wrong' }, rule] },
    )
    expect(applyCharacterGreetingRegex([input.source], input.rules).contents).toEqual(['C'])
  })
  it('preserves scope consent and disabled rules, with per-chat overrides in ST ordering', () => {
    const rule = {
      id: 'r',
      scriptName: '状态',
      findRegex: 'A',
      replaceString: 'B',
      markdownOnly: true,
      placement: [2],
    }
    const card = {
      extensions: {
        regex_scripts: [{ ...rule, findRegex: 'C', replaceString: 'D', disabled: true }],
      },
    }
    const options = {
      extraRules: [rule],
      presetRules: [{ ...rule, findRegex: 'B', replaceString: 'C' }],
      regexContext: { presetEnabled: false },
    }
    expect(chatRegexRules(card, options).map((r) => [r.scope, r.enabled])).toEqual([
      ['global', true],
      ['preset', false],
      ['character', false],
    ])
    const entry = { index: 1, depth: 0, message: { name: '角色', mes: 'A', is_user: false } }
    const enabled = chatRenderInput(entry, card, {
      ...options,
      ruleOverrides: { 'preset:r': true, 'character:r': true },
    })
    expect(applyCharacterGreetingRegex([enabled.source], enabled.rules).contents).toEqual(['D'])
    expect(chatRegexRules(card, options).at(-1)?.enabled).toBe(false)
  })
  it('uses the archived selected swipe variables and real floor number, without replaying updates', () => {
    const snapshot = archivedChatSnapshot(
      {
        index: 7,
        depth: 2,
        message: {
          name: '角色',
          mes: '正文',
          is_user: false,
          swipe_id: 1,
          variables: { 0: { stat_data: { n: 0 } }, 1: { stat_data: { n: 12 } } },
        },
      },
      10,
    )
    expect(snapshot).toMatchObject({
      message_id: 7,
      last_message_id: 9,
      swipe_id: 1,
      data: { stat_data: { n: 12 } },
    })
  })

  it('renders prompt-hidden messages like ST while leaving actual system notices alone', () => {
    const card = {
      extensions: {
        regex_scripts: [
          {
            id: 'panel',
            scriptName: '面板',
            findRegex: 'STATUS',
            replaceString: '<div>面板</div>',
            markdownOnly: true,
            placement: [1, 2],
            minDepth: 2,
            maxDepth: 0,
          },
        ],
      },
    }
    for (const is_user of [false, true]) {
      const entry = {
        index: 2,
        depth: -1,
        message: { name: is_user ? '用户' : '角色', mes: 'STATUS', is_user, is_system: true },
      }
      expect(chatRenderInput(entry, card, {}).rules).toHaveLength(1)
      expect(
        chatRenderInput(
          { ...entry, message: { ...entry.message, name: 'SillyTavern System' } },
          card,
          {},
        ).rules,
      ).toHaveLength(0)
    }
  })

  it('only applies display rules, respects placement/depth and does not reapply saved mutations', () => {
    const rules = [
      { findRegex: 'A', replaceString: 'AA', placement: [2] },
      {
        findRegex: 'A',
        replaceString: 'B',
        placement: [2],
        markdownOnly: true,
        minDepth: 1,
        maxDepth: null,
      },
      { findRegex: 'B', replaceString: 'C', placement: [1], markdownOnly: true },
    ]
    const input = chatRenderInput(
      { index: 3, depth: 2, message: { name: '角色', mes: 'A', is_user: false } },
      { data: { extensions: { regex_scripts: rules } } },
      {},
    )
    expect(applyCharacterGreetingRegex([input.source], input.rules).contents).toEqual(['B'])
    expect(
      chatRenderInput(
        { index: 3, depth: 0, message: { name: '角色', mes: 'A', is_user: false } },
        { extensions: { regex_scripts: rules } },
        {},
      ).rules,
    ).toHaveLength(0)
  })
  it('uses display_text and only resolves known identity macros in the opening', () => {
    const m = { name: '林晚', mes: '{{user}} {{time}}', is_user: false }
    expect(
      chatRenderInput({ index: 0, depth: 2, message: m }, {}, { userName: '许安' }).source,
    ).toBe('许安 {{time}}')
    expect(
      chatRenderInput({ index: 2, depth: 0, message: m }, {}, { userName: '许安' }).source,
    ).toBe(m.mes)
    expect(
      chatRenderInput(
        { index: 2, depth: 0, message: { ...m, extra: { display_text: '已显示' } } },
        {},
        {},
      ).source,
    ).toBe('已显示')
  })
  it('isolates full status panels and requires script opt-in', () => {
    const source = '<body><button onclick="this.textContent=1">状态</button></body>'
    const render = (allowScripts: boolean) =>
      buildCompatibilityFrontendDocument(
        source,
        { allowScripts, allowRemoteResources: false },
        undefined,
        '',
        true,
      ).document
    const child = render(true)
    expect(child).toContain('const host=window.__SRL_RENDER_COMPAT_HOST__')
    expect(child).not.toContain('window.parent.__SRL_RENDER_COMPAT_HOST__')
    expect(child).not.toContain('window.parent._')
    expect(child).toContain('"messageContextAvailable":false')
    expect(child).toContain('onclick="this.textContent=1"')
    expect(render(false)).not.toContain('onclick="this.textContent=1"')
    const libraries = buildCompatibilityFrontendDocument(
      source,
      { allowScripts: true, allowRemoteResources: false },
      { jquery: 'jquery-marker', jqueryUi: 'ui-marker' },
      '',
      true,
    ).document
    expect(libraries.split('jquery-marker')).toHaveLength(2)
    expect(libraries.indexOf('jquery-marker')).toBeLessThan(libraries.indexOf('ui-marker'))
  })
  it('preserves static frontend panels in place, keeps ordinary code and strips active markup', () => {
    const result = formatChatResult(
      '正文\n```html\n<body>状态<script>alert(1)</script></body>\n```\n```js\nconst a = 1\n```',
      true,
    )
    expect(result.html).toContain('data-chat-frontend="0"')
    expect(result.frontends[0]).toContain('状态')
    expect(result.frontends[0]).not.toContain('alert(1)')
    expect(result.html).toContain('const a = 1')
    expect(result.html).not.toContain('alert(1)')
    expect(
      formatChatResult('<img src="https://example.com/image.png" onerror="alert(1)">', true).html,
    ).not.toContain('onerror')
  })
  it('keeps panel styles isolated and respects disabled remote media without hiding static text', () => {
    const source =
      '```html\n<html><head><style>body { color: red; background: url(https://example.com/a); } @media(min-width:1px){ .card{font-size:14px} }</style></head><body class="original"><div class="card">时间：20:05</div><img src="https://example.com/image.png"><button onclick="alert(1)">展开</button><iframe src="https://example.com"></iframe></body></html>\n```'
    const offline = formatChatResult(source, false).frontends[0]!
    expect(offline).toContain('时间：20:05')
    expect(offline).toContain('.reader-panel-body')
    expect(offline).toContain('color: red')
    expect(offline).toContain('font-size: 14px')
    expect(offline).not.toMatch(/example\.com|onclick|<iframe|<script/)
    expect(formatChatResult(source, true).frontends[0]).toContain('https://example.com/image.png')
  })
})

describe('bounded display regex reuse', () => {
  it('reuses equal projections, invalidates source/rules/context and never exposes cached objects', async () => {
    let jobs = 0
    class FakeWorker {
      onmessage?: (event: { data: unknown }) => void
      terminate() {}
      postMessage(inputs: ChatRenderInput[]) {
        jobs++
        queueMicrotask(() =>
          this.onmessage?.({
            data: inputs.map((input) =>
              applyCharacterGreetingRegex([input.source], input.rules, input.context),
            ),
          }),
        )
      }
    }
    vi.stubGlobal('Worker', FakeWorker)
    try {
      const input = chatRenderInput(
        {
          index: 1,
          depth: 0,
          message: { name: 'cache-char', is_user: false, mes: 'cache-source-A' },
        },
        {
          extensions: {
            regex_scripts: [
              { findRegex: 'A', replaceString: 'B', markdownOnly: true, placement: [2] },
            ],
          },
        },
        {},
      )
      const first = await transformChatInputs([input, input])
      expect(jobs).toBe(1)
      expect(first[0]?.contents[0]).toBe('cache-source-B')
      first[0]!.contents[0] = 'mutation'
      expect((await transformChatInputs([input]))[0]?.contents[0]).toBe('cache-source-B')
      expect(jobs).toBe(1)
      await transformChatInputs([{ ...input, source: 'another-A' }])
      await transformChatInputs([{ ...input, context: { userName: 'changed' } }])
      await transformChatInputs([
        { ...input, rules: input.rules.map((rule) => ({ ...rule, replaceString: 'C' })) },
      ])
      expect(jobs).toBe(4)
      const concurrent = { ...input, source: 'concurrent-A' }
      await Promise.all([transformChatInputs([concurrent]), transformChatInputs([concurrent])])
      expect(jobs).toBe(5)
      for (let i = 0; i < 130; i++)
        await transformChatInputs([{ ...input, source: 'evict-' + i + '-A' }])
      const before = jobs
      await transformChatInputs([input])
      expect(jobs).toBe(before + 1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('applies the reader palette only when requested without changing the author source', () => {
    const source =
      '```html\n<html><style>.card{background:white;color:black}</style><body><div class="card">状态<img src="data:image/png;base64,AA"></div></body></html>\n```'
    expect(formatChatResult(source, false, false).frontends[0]).not.toContain(
      '.reader-panel-body{background:transparent!important;color:inherit!important}',
    )
    expect(formatChatResult(source, false, false, 'night').frontends[0]).toContain(
      '.reader-panel-body{background:transparent!important;color:inherit!important}',
    )
    expect(formatChatResult(source, false, false, 'night').frontends[0]).toContain(
      'data:image/png;base64,AA',
    )
    expect(source).toContain('background:white')
  })
})
