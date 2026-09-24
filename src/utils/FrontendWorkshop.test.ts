/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'

import {
  applyTavernRegex,
  buildWorkshopMvuTurns,
  buildWorkshopContinuityInstruction,
  buildWorkshopRepairSystemPrompt,
  buildWorkshopStressCases,
  buildWorkshopSystemPrompt,
  buildWorkshopWorldbook,
  compileWorkshopArtifact,
  createWorkshopLayoutReference,
  describeWorkshopLayoutReference,
  describeWorkshopMaterialRecipe,
  extractJsonObject,
  extractWorkshopPaletteColors,
  extractWorkshopDesign,
  inspectWorkshopSample,
  normalizeWorkshopFontUrls,
  normalizeWorkshopImageUrls,
  parseWorkshopPaletteText,
  parseStatusFields,
  serializeStatusFields,
  renderWorkshopInspectablePreview,
  renderWorkshopPreview,
  requiresWorkshopTexture,
  WorkshopValidationError,
} from './FrontendWorkshop'
import { formatSillyTavernMessage } from './SillyTavernMessageFormatter'

describe('FrontendWorkshop', () => {
  it('compiles fixed fields into a SillyTavern AI_OUTPUT regex and validates captures', () => {
    const artifact = compileWorkshopArtifact('姓名：林言\n性别：男\n状态：平静', {
      title: '人物状态',
      htmlTemplate:
        '<style>.srl-status{display:grid}</style><section class="srl-status"><b>{{field_1}}</b><i>{{field_2}}</i><span>{{field_3}}</span></section>',
    })

    expect(artifact.regex.placement).toEqual([2])
    expect(artifact.regex.markdownOnly).toBe(true)
    expect(artifact.regex.substituteRegex).toBe(0)
    expect(applyTavernRegex(artifact.regex, artifact.sampleOutput)).toContain('<b>林言</b>')
    expect(artifact.prompt).toContain('不要使用 Markdown 代码围栏')
    expect(artifact.prompt).toContain(
      '外层开标签 <StatusPlaceHolder> 与闭标签 </StatusPlaceHolder> 必须完整保留',
    )
    expect(artifact.prompt).toContain('纯文本限制只作用于冒号后的字段值')
  })

  it('rejects templates that omit a field placeholder', () => {
    expect(() =>
      compileWorkshopArtifact('姓名：林言\n状态：平静', {
        htmlTemplate: '<section>{{field_1}}</section>',
      }),
    ).toThrow('漏掉了第 2 个字段')
  })

  it('一次性收集可并行定位的模板校验问题', () => {
    let error: unknown
    try {
      compileWorkshopArtifact(
        '姓名：林言\n状态：平静',
        {
          htmlTemplate:
            '<style>.loose-value{color:red}</style><section><span style="width:{{field_1}}">{{field_1}}</span></section>',
        },
        {
          blocks: ['character-header'],
          interactions: ['collapsible'],
        },
      )
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(WorkshopValidationError)
    expect(error).toHaveProperty('issues')
    const issues = (error as WorkshopValidationError).issues
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('第 1 个字段占位符出现了 2 次'),
        expect.stringContaining('模板漏掉了第 2 个字段占位符'),
        expect.stringContaining('只能放在可见文本节点中'),
        expect.stringContaining('details / summary'),
        expect.stringContaining('组件积木：character-header'),
        expect.stringContaining('状态栏根容器必须设置独有 class'),
      ]),
    )
    expect((error as Error).message).toContain('发现')
  })

  it('repairs invalid CSS backslash escapes and raw newlines in AI JSON strings', () => {
    const parsed = extractJsonObject(`{
      "title":"状态栏",
      "htmlTemplate":"<style>.icon::before{content:'\\q123'}</style>
<section>{{field_1}}</section>"
    }`)

    expect(parsed.htmlTemplate).toContain('\\q123')
    expect(parsed.htmlTemplate).toContain('\n<section>')
  })

  it('从夹带额外内容的旧 JSON 输出中只读取第一个完整对象', () => {
    expect(extractJsonObject('{"title":"状态栏"}\n{"note":"不要输出这一段"}')).toEqual({
      title: '状态栏',
    })
  })

  it('双分区协议缺失且旧 JSON 没有模板时报告协议错误', () => {
    expect(() => extractWorkshopDesign('{"title":"状态栏"}')).toThrow('AI 输出协议不完整')
  })

  it('只在裸 HTML 从完整 style 模板起始时兼容漏掉的双分区外壳', () => {
    const parsed = extractWorkshopDesign(
      '```html\n<style>.card{display:block}</style>\n<section class="card">{{field_1}}</section>\n```',
    )

    expect(parsed).toEqual({
      htmlTemplate:
        '<style>.card{display:block}</style>\n<section class="card">{{field_1}}</section>',
    })
    expect(() =>
      extractWorkshopDesign(
        '这是修复后的代码：\n<style>.card{display:block}</style><section class="card"></section>',
      ),
    ).toThrow('AI 输出协议不完整')
  })

  it('支持分组和字段类型提示，用于生成复杂但仍稳定的静态面板', () => {
    const fields = parseStatusFields(
      '[角色]\n姓名：林言\n好感度[百分比]：72%\n[任务]\n标签[列表]：探索、夜晚',
    )

    expect(fields).toMatchObject([
      { label: '姓名', group: '角色', kind: 'text', path: '角色.姓名' },
      { label: '好感度', group: '角色', kind: 'percent', path: '角色.好感度' },
      { label: '标签', group: '任务', kind: 'tags', path: '任务.标签' },
    ])
  })

  it('可视化字段编辑可往返写回酒馆兼容的分组文本语法', () => {
    const fields = parseStatusFields(
      '[角色]\n姓名：林言\n好感度[百分比]：72%\n[任务]\n标签[列表]：探索、夜晚',
    )
    const serialized = serializeStatusFields(fields)

    expect(serialized).toContain('[角色]\n姓名[文本]：林言')
    expect(serialized).toContain('好感度[百分比]：72%')
    expect(serialized).toContain('[任务]\n标签[标签]：探索、夜晚')
    expect(parseStatusFields(serialized)).toEqual(fields)

    const regrouped = [fields[0]!, { ...fields[1]!, group: '基础信息', path: '好感度' }]
    expect(parseStatusFields(serializeStatusFields(regrouped))).toEqual(regrouped)
  })

  it('读取无须 JSON 转义的模板分区，避免复杂 CSS 触发 Bad escaped character', () => {
    const parsed = extractWorkshopDesign(`<SRL_META>{"title":"复杂面板"}</SRL_META>
<SRL_TEMPLATE>
<style>.panel::before{content:"\\2726"}</style>
<section class="panel">{{field_1}}</section>
</SRL_TEMPLATE>`)

    expect(parsed.title).toBe('复杂面板')
    expect(parsed.htmlTemplate).toContain('\\2726')
  })

  it('为已有 MVU 变量生成楼层读取适配层，并用可编辑 JSON 校样', () => {
    const artifact = compileWorkshopArtifact(
      '[角色.林言]\n好感度[数字]：32\n状态：探索中',
      {
        title: '角色状态',
        htmlTemplate:
          '<style>.mvu-card{display:grid}</style><section class="mvu-card"><b>{{field_1}}</b><span>{{field_2}}</span></section>',
      },
      { dataMode: 'mvu' },
    )

    expect(artifact.regex.findRegex).toContain('StatusPlaceHolder')
    expect(artifact.regex.replaceString).toContain('window.TavernHelper')
    expect(artifact.regex.replaceString).toContain('__srlHelper.getVariables')
    expect(artifact.regex.replaceString).not.toContain('_.get')
    expect(artifact.regex.replaceString).toContain('"角色.林言.好感度"')
    expect(artifact.prompt).toContain('不替代角色卡现有的 [InitVar]')
    expect(artifact.compatibility.dependencies).toEqual([
      'SillyTavern 内置正则',
      '酒馆助手',
      'MVU',
      'ST-Prompt-Template（开启“处理消息内容”）',
    ])
    expect(artifact.compatibility.verificationNote).toContain('未开启“处理消息内容”时 EJS 不会执行')
    expect(
      renderWorkshopPreview(
        artifact,
        JSON.stringify({
          stat_data: { 角色: { 林言: { 好感度: [48, '更新条件'], 状态: '休息中' } } },
        }),
      ),
    ).toContain('<b>48</b><span>休息中</span>')
  })

  it('拒绝危险的 MVU 对象路径，并让运行时代码在酒馆助手缺失时降级为未知值', () => {
    expect(() =>
      compileWorkshopArtifact(
        '[__proto__]\n状态：异常',
        {
          htmlTemplate:
            '<style>.card{display:block}</style><section class="card">{{field_1}}</section>',
        },
        { dataMode: 'mvu' },
      ),
    ).toThrow('变量路径包含保留名称')

    const artifact = compileWorkshopArtifact(
      '状态：正常',
      {
        htmlTemplate:
          '<style>.card{display:block}</style><section class="card">{{field_1}}</section>',
      },
      { dataMode: 'mvu' },
    )
    expect(artifact.regex.replaceString).toContain('let __srlVariables = {}')
    expect(artifact.regex.replaceString).toContain('catch (_error)')
    expect(artifact.regex.replaceString).toContain("return rawValue ?? '未知'")
  })

  it('普通状态块不接受空字段值，但接受明确的未知值', () => {
    const artifact = compileWorkshopArtifact('姓名：林言\n地点：城南', {
      htmlTemplate:
        '<style>.card{display:block}</style><section class="card"><b>{{field_1}}</b><span>{{field_2}}</span></section>',
    })
    const emptyValue = '<StatusPlaceHolder>\n姓名: 林言\n地点: \n</StatusPlaceHolder>'
    const unknownValue = '<StatusPlaceHolder>\n姓名: 林言\n地点: 未知\n</StatusPlaceHolder>'

    expect(applyTavernRegex(artifact.regex, emptyValue)).toBe(emptyValue)
    expect(applyTavernRegex(artifact.regex, unknownValue)).toContain('<span>未知</span>')
    expect(inspectWorkshopSample(artifact, emptyValue)[0]?.message).toContain('状态块未匹配')
  })

  it('普通状态块按酒馆顺序先执行 AI_OUTPUT 正则，再经过 Showdown、净化和 CSS 作用域', () => {
    const artifact = compileWorkshopArtifact('姓名：林言\n状态：平静', {
      htmlTemplate:
        '<style>.status-card{display:grid}.status-card > span{color:#345}</style><section class="status-card"><b>{{field_1}}</b><span>{{field_2}}</span></section>',
    })
    const regexed = applyTavernRegex(artifact.regex, `正文保留。\n\n${artifact.sampleOutput}`)
    const formatted = formatSillyTavernMessage(regexed)

    expect(formatted.html).toContain('<p>正文保留。</p>')
    expect(formatted.html).toContain('class="custom-status-card"')
    expect(formatted.html).toContain('.mes_text .custom-status-card > span')
    expect(formatted.html).toContain('<b>林言</b>')
    expect(formatted.frontendBlockCount).toBe(0)
  })

  it('严格检查用户选择的折叠和短时动效是否真正生成', () => {
    expect(() =>
      compileWorkshopArtifact(
        '状态：平静',
        {
          htmlTemplate:
            '<style>.card{display:block}</style><section class="card">{{field_1}}</section>',
        },
        { interactions: ['collapsible'] },
      ),
    ).toThrow('details / summary')

    expect(() =>
      compileWorkshopArtifact(
        '状态：平静',
        {
          htmlTemplate:
            '<style>@keyframes enter{from{opacity:0}to{opacity:1}}</style><section>{{field_1}}</section>',
        },
        { interactions: ['motion'] },
      ),
    ).toThrow('减少动态效果')

    expect(() =>
      compileWorkshopArtifact(
        '状态：平静',
        {
          htmlTemplate:
            '<style>.card{display:block}</style><section class="card">{{field_1}}</section>',
        },
        { interactions: ['theme-toggle'] },
      ),
    ).toThrow('checkbox')

    expect(() =>
      compileWorkshopArtifact(
        '状态：平静',
        {
          htmlTemplate:
            '<style>.card{display:block}</style><section class="card">{{field_1}}</section>',
        },
        { interactions: ['tabs'] },
      ),
    ).toThrow('radio')
  })

  it('把提示词包装成酒馆原生世界书而不是自定义合并文件', () => {
    const artifact = compileWorkshopArtifact('状态：平静', {
      title: '旅途状态',
      htmlTemplate:
        '<style>.trip{display:block}</style><section class="trip">{{field_1}}</section>',
    })
    const worldbook = buildWorkshopWorldbook(artifact)

    expect(worldbook.entries['0']).toMatchObject({
      uid: 0,
      comment: '旅途状态 · 状态栏输出协议',
      content: artifact.prompt,
      constant: true,
      position: 4,
      depth: 0,
      role: 0,
    })
  })

  it('允许 AI 补充任意 HTTPS 图片并仍校验组件积木确实生成', () => {
    const imageUrl = 'https://cdn.example.com/status/banner.webp'
    const artifact = compileWorkshopArtifact(
      '姓名：林言\n状态：探索中',
      {
        htmlTemplate: `<style>.card{background-image:url("${imageUrl}")}</style><section class="card" data-srl-block="character-header"><img src="${imageUrl}" alt=""><b>{{field_1}}</b><span>{{field_2}}</span></section>`,
      },
      {
        blocks: ['character-header'],
        imageUrls: [imageUrl],
      },
    )

    expect(artifact.imageUrls).toEqual([imageUrl])
    expect(artifact.blocks).toEqual(['character-header'])
    expect(artifact.compatibility.levelLabel).toBe('纯酒馆 + 外部资源')
    expect(
      compileWorkshopArtifact(
        '姓名：林言',
        {
          htmlTemplate:
            '<style>.card{display:block}</style><section class="card" data-srl-block="character-header"><img src="https://cdn.ai.example/generated.svg" alt="AI 生成图标">{{field_1}}</section>',
        },
        { blocks: ['character-header'] },
      ).regex.replaceString,
    ).toContain('https://cdn.ai.example/generated.svg')
    expect(() => normalizeWorkshopImageUrls(['http://example.com/a.png'])).toThrow('HTTPS')
    expect(() =>
      compileWorkshopArtifact('姓名：林言', {
        htmlTemplate:
          '<style>.card{background-image:url("http://example.com/a.svg")}</style><section class="card">{{field_1}}</section>',
      }),
    ).toThrow('只允许 HTTPS')
  })

  it('接受 SVG 外链，并兼容 HTML 属性中的转义查询参数', () => {
    const imageUrl = 'https://cdn.example.com/icons/heart.svg?color=%23fff&width=64'
    const artifact = compileWorkshopArtifact(
      '状态：平静',
      {
        htmlTemplate: `<style>.card{background-image:url("${imageUrl}")}</style><section class="card" data-srl-block="image-banner"><img src="https://cdn.example.com/icons/heart.svg?color=%23fff&amp;width=64" alt="图标">{{field_1}}</section>`,
      },
      { blocks: ['image-banner'], imageUrls: [imageUrl] },
    )

    expect(artifact.imageUrls).toEqual([imageUrl])
    expect(artifact.regex.replaceString).toContain('heart.svg')
  })

  it('把 SVG 命名空间视为标识符，并把编码的页内滤镜引用规范为真实片段', () => {
    const artifact = compileWorkshopArtifact('状态：平静', {
      htmlTemplate:
        '<style>.card{filter:url(%23noiseFilter)}</style><section class="card"><svg xmlns="http://www.w3.org/2000/svg"><filter id="noiseFilter"></filter></svg><span>{{field_1}}</span></section>',
    })

    expect(artifact.regex.replaceString).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(artifact.regex.replaceString).toContain('filter:url("#noiseFilter")')
  })

  it('拒绝把图片标签写成会在酒馆显示源码的 < img>', () => {
    const imageUrl = 'https://cdn.example.com/status/banner.webp'
    expect(() =>
      compileWorkshopArtifact(
        '姓名：林言',
        {
          htmlTemplate: `<style>.card{display:block}</style><section class="card" data-srl-block="image-banner">< img src="${imageUrl}" alt="横幅">{{field_1}}</section>`,
        },
        { blocks: ['image-banner'], imageUrls: [imageUrl] },
      ),
    ).toThrow('畸形 HTML 标签')
  })

  it('旧版本再次校样时会报告畸形模板，避免继续复制导出', () => {
    const artifact = compileWorkshopArtifact('姓名：林言', {
      htmlTemplate:
        '<style>.card{display:block}</style><section class="card">{{field_1}}</section>',
    })
    artifact.htmlTemplate =
      '<style>.card{display:block}</style><section class="card">< img src="https://example.com/a.png">{{field_1}}</section>'

    expect(inspectWorkshopSample(artifact, artifact.sampleOutput)).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('畸形 HTML 标签'),
      }),
    ])
  })

  it('拒绝把字段占位符放进 style 属性形成不可信 CSS 值', () => {
    expect(() =>
      compileWorkshopArtifact('生命：100/100', {
        htmlTemplate:
          '<style>.hp{height:12px}</style><section><span class="hp" style="width:{{field_1}}"></span></section>',
      }),
    ).toThrow('只能放在可见文本节点中')
  })

  it('拒绝 radio 与 label 分离导致 :checked + label 永远无法命中', () => {
    expect(() =>
      compileWorkshopArtifact(
        '状态：平静',
        {
          htmlTemplate:
            '<style>#tab1:checked + .tab-label{font-weight:bold}#tab1:checked ~ #panel1{display:block}</style><section><input type="radio" id="tab1" checked><div><label class="tab-label" for="tab1">状态</label></div><div id="panel1">{{field_1}}</div></section>',
        },
        { interactions: ['tabs'] },
      ),
    ).toThrow('radio 必须各自紧邻')
  })

  it('主题开关结构错位时报告一个根因并收束其连带失效选择器', () => {
    expect(() =>
      compileWorkshopArtifact(
        '状态：平静',
        {
          htmlTemplate:
            '<style>.card #theme:checked + label{color:white}.card #theme:checked ~ .panel{background:black}.card #theme:checked ~ .panel .name{color:white}</style><section class="card"><div class="panel"><input type="checkbox" id="theme"><span></span><label for="theme">主题</label><span class="name">{{field_1}}</span></div></section>',
        },
        { interactions: ['theme-toggle'] },
      ),
    ).toThrow('已省略 3 条由该错误连带失效的 CSS 选择器')
  })

  it('解析 CSS 并拒绝没有实际 DOM 目标的选择器及并列根节点', () => {
    expect(() =>
      compileWorkshopArtifact('状态：平静', {
        htmlTemplate:
          '<style>.card{display:block}.card .tag-container > span{color:red}</style><section class="card"><div class="tag-container">{{field_1}}</div></section>',
      }),
    ).toThrow('CSS 选择器在实际模板中没有目标：.card .tag-container > span')

    expect(() =>
      compileWorkshopArtifact('状态：平静', {
        htmlTemplate:
          '<style>.card{display:block}</style><section class="card">{{field_1}}</section><aside>额外根节点</aside>',
      }),
    ).toThrow('必须只有一个状态栏根容器')
  })

  it('CSS 结构校验允许伪元素、交互状态和运行时条件属性', () => {
    const artifact = compileWorkshopArtifact(
      '状态：平静',
      {
        htmlTemplate:
          '<style>.card:hover::before{content:""}.card [data-srl-condition-active="true"]{color:red}</style><section class="card"><span data-srl-condition="condition-status">{{field_1}}</span></section>',
      },
      {
        dataMode: 'mvu',
        conditionRules: [
          {
            id: 'condition-status',
            fieldPath: '状态',
            fieldLabel: '状态',
            operator: 'eq',
            value: '平静',
            color: '#ff0000',
            background: '',
          },
        ],
      },
    )

    expect(artifact.regex.replaceString).toContain('data-srl-condition-active')
  })

  it('阻止未批准媒体、外部 CSS、固定定位和未按根 class 限定的样式', () => {
    expect(() =>
      compileWorkshopArtifact('状态：平静', {
        htmlTemplate:
          '<style>@import url("https://example.com/theme.css");.card{display:block}</style><section class="card">{{field_1}}</section>',
      }),
    ).toThrow('禁止使用 @import')
    expect(() =>
      compileWorkshopArtifact('状态：平静', {
        htmlTemplate:
          '<style>.card{display:block}</style><section class="card"><img src="data:image/svg+xml,abc">{{field_1}}</section>',
      }),
    ).toThrow('模板资源协议只允许 HTTPS 外链')
    expect(() =>
      compileWorkshopArtifact('状态：平静', {
        htmlTemplate:
          '<style>.card{position:fixed}</style><section class="card">{{field_1}}</section>',
      }),
    ).toThrow('position: fixed')
    expect(() =>
      compileWorkshopArtifact('状态：平静', {
        htmlTemplate:
          '<style>.card{display:block}.value{color:red}</style><section class="card"><span class="value">{{field_1}}</span></section>',
      }),
    ).toThrow('没有限制在状态栏根 class 下')
  })

  it('多标签分页必须共享 name 且只有一个默认 checked', () => {
    const template = (nameAttribute: string, checkedAttribute: string) =>
      `<style>.card #tab-a:checked ~ .panel-a,.card #tab-b:checked ~ .panel-b{display:block}</style><section class="card"><input type="radio" id="tab-a" ${nameAttribute} ${checkedAttribute}><label for="tab-a">甲</label><input type="radio" id="tab-b" ${nameAttribute}><label for="tab-b">乙</label><div class="panel-a">{{field_1}}</div><div class="panel-b">备用</div></section>`

    expect(() =>
      compileWorkshopArtifact(
        '状态：平静',
        { htmlTemplate: template('', 'checked') },
        { interactions: ['tabs'] },
      ),
    ).toThrow('同一个非空 name')
    expect(() =>
      compileWorkshopArtifact(
        '状态：平静',
        { htmlTemplate: template('name="status-tab"', '') },
        { interactions: ['tabs'] },
      ),
    ).toThrow('必须且只能有一个默认 checked')
  })

  it('接受合法图片元素以及紧邻的 radio/label 无脚本结构', () => {
    const imageUrl = 'https://cdn.example.com/status/banner.webp'
    const artifact = compileWorkshopArtifact(
      '状态：平静',
      {
        htmlTemplate: `<style>.card #tab1:checked + .tab-label{font-weight:bold}.card #tab1:checked ~ #panel1{display:block}.card .banner{background-image:url("${imageUrl}")}</style><section class="card"><div class="banner" data-srl-block="image-banner"><img src="${imageUrl}" alt="横幅"></div><input type="radio" id="tab1" checked><label class="tab-label" for="tab1">状态</label><div id="panel1">{{field_1}}</div></section>`,
      },
      { interactions: ['tabs'], blocks: ['image-banner'], imageUrls: [imageUrl] },
    )

    expect(artifact.regex.replaceString).toContain(`<img src="${imageUrl}"`)
  })

  it('为可视点选添加校样专用标记，并报告缺失字段与异常类型', () => {
    const artifact = compileWorkshopArtifact('姓名：林言\n好感度[数字]：82', {
      htmlTemplate:
        '<style>.card{display:block}</style><section class="card"><details><summary>档案</summary><b>{{field_1}}</b><span>{{field_2}}</span></details></section>',
    })
    const inspectable = renderWorkshopInspectablePreview(artifact, artifact.sampleOutput)
    const missing = buildWorkshopStressCases(artifact).find((item) => item.id === 'missing-field')!
    const typeError = buildWorkshopStressCases(artifact).find((item) => item.id === 'type-error')!

    expect(inspectable).not.toContain('data-srl-inspect="panel"')
    expect(inspectable).toContain('data-srl-inspect="summary:1"')
    expect(inspectable).toContain('data-srl-inspect-label="姓名"')
    expect(inspectWorkshopSample(artifact, missing.sample)[0]?.message).toContain('状态块未匹配')
    expect(inspectWorkshopSample(artifact, typeError.sample)[0]?.message).toContain('预期为数值')
  })

  it('把用户图片写进系统提示，并明确允许 AI 补充 HTTPS 外链', () => {
    const prompt = buildWorkshopSystemPrompt(parseStatusFields('姓名：林言'), {
      blocks: ['image-banner'],
      interactions: ['theme-toggle'],
      imageUrls: ['https://cdn.example.com/banner.png'],
    })

    expect(prompt).toContain('data-srl-block="image-banner"')
    expect(prompt).toContain('https://cdn.example.com/banner.png')
    expect(prompt).toContain('可补充其他公开 HTTPS 图片或 SVG 外链')
    expect(prompt).not.toContain('只允许使用以下图片直链')
    expect(prompt).toContain('用户本轮最新的明确要求')
    expect(prompt).toContain('不能只完成其中容易的一半')
    expect(prompt).toContain('不默认使用紫蓝渐变')
    expect(prompt).toContain('先在 320px 酒馆消息位完成构图')
    expect(prompt).toContain('约 210px')
    expect(prompt).toContain('<input type="checkbox" id="theme-id">')
    expect(prompt).toContain('url("#filter-id")')
  })

  it('自动修复使用紧凑协议，同时保留字段和酒馆窄栏约束', () => {
    const prompt = buildWorkshopRepairSystemPrompt(parseStatusFields('姓名：林言\n好感度：82'), {
      interactions: ['theme-toggle', 'tabs'],
      textureRequired: true,
    })

    expect(prompt).toContain('{{field_1}}')
    expect(prompt).toContain('{{field_2}}')
    expect(prompt).toContain('theme-toggle')
    expect(prompt).toContain('textureRequired')
    expect(prompt).toContain('约 210px 正文宽度')
    expect(prompt).toContain('只返回完整的 <SRL_META> 与 <SRL_TEMPLATE>')
    expect(prompt).toContain('<SRL_META>{"title":"修复后的状态栏"')
    expect(prompt).toContain('禁止 http:、data:、blob:、file:、ftp: 和 base64')
    expect(prompt).toContain('<input type="checkbox" id="srl-theme-toggle">')
    expect(prompt).toContain('<input type="radio" id="srl-tab-1" name="srl-tabs" checked>')
    expect(prompt).toContain('每条 CSS 选择器必须在最终 DOM 有真实目标')
  })

  it('多角色积木即使未单独勾选分页交互，也会注入 radio 的真实兄弟结构', () => {
    const prompt = buildWorkshopSystemPrompt(parseStatusFields('姓名：林言'), {
      blocks: ['character-tabs'],
    })

    expect(prompt).toContain('<input type="radio" id="tab-1" name="tabs" checked>')
    expect(prompt).toContain('#tab-1:checked + label')
  })

  it('把用户对材质、条件样式和组件积木的自定义提示写入对应分区', () => {
    const prompt = buildWorkshopSystemPrompt(parseStatusFields('好感度[数字]：82'), {
      dataMode: 'mvu',
      blocks: ['relationship-card'],
      conditionRules: [
        {
          id: 'condition-affinity',
          fieldPath: '好感度',
          fieldLabel: '好感度',
          operator: 'gt',
          value: '80',
          color: '#7A2F25',
          background: '#F8DED7',
        },
      ],
      promptCustomizations: {
        material: '纸面要有细微压纹，不要仿玻璃。',
        conditions: '条件激活后仅强调关系标题。',
        blocks: '关系卡要像双人档案页，不要通用数值卡。',
      },
    })

    expect(prompt).toContain('纸面要有细微压纹，不要仿玻璃。')
    expect(prompt).toContain('条件激活后仅强调关系标题。')
    expect(prompt).toContain('关系卡要像双人档案页，不要通用数值卡。')
    expect(prompt).toContain('替代该模块的默认提示')
    expect(prompt).not.toContain('材质配方：')
    expect(prompt).toContain('不得覆盖安全、输出协议、字段完整性和本地编译器规则')
  })

  it('关闭模块提示词后不注入材质、条件和积木要求，也不触发对应编译验收', () => {
    const prompt = buildWorkshopSystemPrompt(parseStatusFields('好感度[数字]：82'), {
      dataMode: 'mvu',
      blocks: ['relationship-card'],
      conditionRules: [
        {
          id: 'condition-affinity',
          fieldPath: '好感度',
          fieldLabel: '好感度',
          operator: 'gt',
          value: '80',
          color: '#7A2F25',
          background: '#F8DED7',
        },
      ],
      designTokens: { material: 'glass' },
      promptCustomizations: {
        material: '纸面要有细微压纹。',
        conditions: '只强调标题。',
        blocks: '关系卡像双人档案页。',
      },
      promptInjectionEnabled: {
        material: false,
        conditions: false,
        blocks: false,
      },
    })
    const artifact = compileWorkshopArtifact(
      '好感度[数字]：82',
      {
        htmlTemplate:
          '<style>.card{display:block}</style><section class="card">{{field_1}}</section>',
      },
      {
        dataMode: 'mvu',
        blocks: ['relationship-card'],
        conditionRules: [
          {
            id: 'condition-affinity',
            fieldPath: '好感度',
            fieldLabel: '好感度',
            operator: 'gt',
            value: '80',
            color: '#7A2F25',
            background: '#F8DED7',
          },
        ],
        promptInjectionEnabled: {
          material: false,
          conditions: false,
          blocks: false,
        },
      },
    )

    expect(prompt).toContain('材质与精细度提示词已关闭')
    expect(prompt).toContain('条件样式提示词已关闭')
    expect(prompt).toContain('组件积木提示词已关闭')
    expect(prompt).not.toContain('纸面要有细微压纹。')
    expect(prompt).not.toContain('data-srl-block="relationship-card"')
    expect(prompt).not.toContain('data-srl-condition="condition-affinity"')
    expect(artifact.blocks).toEqual([])
    expect(artifact.conditionRules).toEqual([])
    expect(artifact.regex.replaceString).not.toContain('data-srl-condition-active')
  })

  it('把自由排版草图转换为响应式构图要求，而不是固定定位成品', () => {
    const fields = parseStatusFields('姓名：林言\n状态：探索中\n地点：旧城区')
    const layout = createWorkshopLayoutReference(fields, [])
    layout.items[0]!.x = 32
    layout.items[0]!.width = 210
    const prompt = buildWorkshopSystemPrompt(fields, { layoutReference: layout })
    const artifact = compileWorkshopArtifact(
      '姓名：林言\n状态：探索中\n地点：旧城区',
      {
        htmlTemplate:
          '<style>.card{display:grid}</style><section class="card"><b>{{field_1}}</b><i>{{field_2}}</i><span>{{field_3}}</span></section>',
      },
      { layoutReference: layout },
    )

    expect(describeWorkshopLayoutReference(layout)).toContain('字段「姓名」')
    expect(prompt).toContain('不是要求复制固定像素坐标')
    expect(prompt).toContain('禁止把草图直接实现成整页绝对定位')
    expect(artifact.layoutReference?.items).toHaveLength(3)
    expect(artifact.layoutReference?.desktop?.items).toHaveLength(3)
    expect(describeWorkshopLayoutReference(layout)).toContain('宽屏布局意图')
  })

  it('按目标尺寸同比例缩放手机与宽屏画布，并输出完整材质配方', () => {
    const fields = parseStatusFields('姓名：林言\n状态：探索中')
    const targetSize = { width: 400, height: 200 }
    const layout = createWorkshopLayoutReference(fields, [], undefined, targetSize)
    const prompt = buildWorkshopSystemPrompt(fields, {
      targetSize,
      layoutReference: layout,
      designTokens: { material: 'holographic' },
    })

    expect(layout.canvasWidth / layout.canvasHeight).toBeCloseTo(2, 1)
    expect(layout.desktop!.canvasWidth / layout.desktop!.canvasHeight).toBeCloseTo(2, 1)
    expect(prompt).toContain('设计比例为 400×200')
    expect(prompt).toContain('移动端反光层不得覆盖超过卡片约 30%')
    expect(describeWorkshopMaterialRecipe('embossed-metal')).toContain('浮雕')
  })

  it('把用户明确要求的纹理升级为提示词和本地编译双重验收', () => {
    expect(requiresWorkshopTexture('高级纸张质感，要有细微颗粒纹理')).toBe(true)
    expect(requiresWorkshopTexture('清爽实色卡片')).toBe(false)

    const prompt = buildWorkshopSystemPrompt(parseStatusFields('姓名：林言'), {
      textureRequired: true,
      designTokens: { material: 'paper' },
    })
    expect(prompt).toContain('本轮明确要求可见纹理')
    expect(prompt).toContain('本地编译器会检查纹理层')

    expect(() =>
      compileWorkshopArtifact(
        '姓名：林言',
        {
          htmlTemplate:
            '<style>.paper-card{background:#f5efe2}</style><section class="paper-card">{{field_1}}</section>',
        },
        { textureRequired: true },
      ),
    ).toThrow('明确要求了纹理')

    expect(() =>
      compileWorkshopArtifact(
        '姓名：林言',
        {
          htmlTemplate:
            '<style>.paper-card{background-color:#f5efe2;background-image:repeating-linear-gradient(12deg,rgba(80,60,40,.04) 0 1px,transparent 1px 4px),radial-gradient(circle at 20% 30%,rgba(255,255,255,.5),transparent 35%)}</style><section class="paper-card">{{field_1}}</section>',
        },
        { textureRequired: true },
      ),
    ).not.toThrow()
  })

  it('把已经接受的多轮修改写成累积约束，避免后续重绘回退', () => {
    const instruction = buildWorkshopContinuityInstruction([
      '让图片和边缘融合自然',
      '标题字号稍微缩小',
    ])

    expect(instruction).toContain('让图片和边缘融合自然')
    expect(instruction).toContain('标题字号稍微缩小')
    expect(instruction).toContain('本轮没有明确否定')
  })

  it('合并重复的历史要求，避免同一审美建议随版本链反复注入', () => {
    const repeatedRequirement = '【已选审美建议】\n1. 为标题增加留白\n【已选审美建议结束】'
    const instruction = buildWorkshopContinuityInstruction([
      repeatedRequirement,
      '保留卡片的浅色层次',
      repeatedRequirement,
      repeatedRequirement,
    ])

    expect(instruction.match(/为标题增加留白/g)).toHaveLength(1)
    expect(instruction.match(/保留卡片的浅色层次/g)).toHaveLength(1)
  })

  it('把设计令牌和 MVU 条件样式编译为可执行且可校样的规则', () => {
    const artifact = compileWorkshopArtifact(
      '[角色]\n好感度[数字]：82\n状态：亲近',
      {
        htmlTemplate:
          '<style>.card{display:grid}</style><section class="card"><b data-srl-condition="condition-affinity">{{field_1}}</b><span>{{field_2}}</span></section>',
      },
      {
        dataMode: 'mvu',
        designTokens: {
          material: 'glass',
          shadow: 'layered',
          border: 'glow',
          density: 'compact',
        },
        conditionRules: [
          {
            id: 'condition-affinity',
            fieldPath: '角色.好感度',
            fieldLabel: '好感度',
            operator: 'gt',
            value: '80',
            color: '#7A2F25',
            background: '#F8DED7',
          },
        ],
      },
    )

    expect(artifact.regex.replaceString).toContain('__srlCompare')
    expect(artifact.regex.replaceString).toContain('data-srl-condition-active')
    expect(artifact.designTokens).toMatchObject({ material: 'glass', density: 'compact' })
    expect(renderWorkshopPreview(artifact, artifact.sampleOutput)).toContain(
      'data-srl-condition-active="true"',
    )
    const turns = buildWorkshopMvuTurns(artifact)
    expect(turns).toHaveLength(10)
    expect(turns[1]?.sample).not.toBe(turns[0]?.sample)
  })

  it('解析结构化色卡和图片像素，并规范化字体白名单', () => {
    expect(
      parseWorkshopPaletteText(
        '{"colors":["#173c30","#f7f2e7"]}\nrgb(185, 121, 82)\n41 42 39 深色',
      ),
    ).toEqual(['#173C30', '#F7F2E7', '#B97952', '#292A27'])
    expect(
      extractWorkshopPaletteColors(
        new Uint8ClampedArray([
          23, 60, 48, 255, 23, 60, 48, 255, 247, 242, 231, 255, 247, 242, 231, 255,
        ]),
      ),
    ).toEqual(['#173C30', '#F7F2E7'])
    expect(normalizeWorkshopFontUrls(['https://cdn.example.com/font.woff2'])).toEqual([
      'https://cdn.example.com/font.woff2',
    ])
    expect(() => normalizeWorkshopFontUrls(['http://example.com/font.woff2'])).toThrow('HTTPS')
  })

  it('校验自定义字体、参考色和自定义文字样式真正进入模板', () => {
    const fontUrl = 'https://cdn.example.com/archive.woff2'
    const artifact = compileWorkshopArtifact(
      '姓名：林言',
      {
        htmlTemplate: `<style>@font-face{font-family:"Archive";src:url("${fontUrl}")}.card{color:#173C30}.card .small{font-family:"Archive"}</style><section class="card"><small class="small" data-srl-text-style="style_small">{{field_1}}</small></section>`,
      },
      {
        fontUrls: [fontUrl],
        textStyles: [{ id: 'style_small', label: '小字' }],
        paletteName: '墨玉纸页',
        paletteColors: ['#173c30', '#f7f2e7'],
      },
    )

    expect(artifact.fontUrls).toEqual([fontUrl])
    expect(artifact.textStyles).toEqual([{ id: 'style_small', label: '小字' }])
    expect(artifact.palette).toEqual({
      name: '墨玉纸页',
      colors: ['#173C30', '#F7F2E7'],
    })
    expect(artifact.compatibility.dependencies).toContain('联网字体')
  })
})
