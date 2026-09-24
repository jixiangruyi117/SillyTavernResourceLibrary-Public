import {
  type StatusField,
  type WorkshopBlock,
  type WorkshopGenerationOptions,
} from '../types/FrontendWorkshopLegacy'
import {
  describeWorkshopMaterialRecipe,
  normalizeGenerationOptions,
} from './FrontendWorkshopLegacyGenerationOptions'
import { describeWorkshopLayoutReference } from './FrontendWorkshopLegacyLayout'

export function buildWorkshopContinuityInstruction(refinements: string[]): string {
  const accepted = Array.from(
    new Set(refinements.map((value) => String(value ?? '').trim()).filter(Boolean)),
  ).slice(-8)
  if (!accepted.length) return ''
  return `\n\n下面是用户已经验收并接受的修改历史，属于累积约束：\n${accepted
    .map((value, index) => `${index + 1}. ${value}`)
    .join(
      '\n',
    )}\n本轮没有明确否定的历史修改必须继续保留。禁止因为重绘其他区域，把已修好的融合、边缘、配色、尺寸或层级恢复成更早状态。`
}

export function buildWorkshopSystemPrompt(
  fields: StatusField[],
  options?: Partial<WorkshopGenerationOptions>,
): string {
  const normalizedOptions = normalizeGenerationOptions(options)
  const fieldContract = fields
    .map(
      (field, index) =>
        `${index + 1}. ${field.label}｜分组：${field.group}｜类型：${field.kind}｜变量路径：${field.path}｜占位符：{{field_${index + 1}}}`,
    )
    .join('\n')
  const interactionRules = [
    normalizedOptions.interactions.includes('collapsible')
      ? '10. 必须使用原生 details / summary 实现可点击折叠；summary 触控高度至少 44px，不能依赖脚本。'
      : '10. 不要求折叠；不要为了装饰加入无内容的 details。',
    normalizedOptions.interactions.includes('motion')
      ? '11. 必须提供一次性的 CSS 入场/数值强调动效，使用 transform/opacity，持续不超过 700ms；必须同时提供 @media (prefers-reduced-motion: reduce) 并在其中关闭动画。'
      : '11. 不要求动画；若使用 transition，只能是短时且不得持续闪烁。',
    normalizedOptions.interactions.includes('theme-toggle')
      ? '12. 必须用 checkbox + label + CSS :checked 实现状态栏内部的日/夜主题切换；不得使用脚本，不得修改酒馆全局主题；控件必须有明确文字与至少 44px 触控区域。DOM 必须采用同一根容器下的兄弟顺序：<input type="checkbox" id="theme-id"><label for="theme-id">切换主题</label><div class="theme-panel">…</div>，这样 #theme-id:checked + label 与 #theme-id:checked ~ .theme-panel 才能同时命中。禁止把 input 塞进它要控制的 .theme-panel 内部。'
      : '12. 不要求状态栏内部的日/夜主题切换。',
    normalizedOptions.interactions.includes('tabs') ||
    normalizedOptions.blocks.includes('character-tabs')
      ? '13. 必须用 radio + label + CSS :checked 实现分组分页；不得使用脚本；分页标签必须有可访问文字与至少 44px 触控区域。每个分页必须严格采用连续兄弟结构：<input type="radio" id="tab-1" name="tabs" checked><label for="tab-1">第一页</label>；每个 id 唯一、所有 radio 共用同一个非空 name、必须且只能有一个 checked。CSS 只能引用最终存在且确有兄弟关系的 #tab-1:checked + label、#tab-1:checked ~ .tab-panels 等选择器。'
      : '13. 不要求分组分页。',
  ].join('\n')
  const blockRules: Record<WorkshopBlock, string> = {
    'character-header':
      '角色头部：必须形成一个清晰可见的资料页抬头，包含身份名称区和至少 1 个关键状态区；有批准图片时可放头像，没有图片时用排版或首字母区，不能只挂空标记。',
    'attribute-grid':
      '属性网格：必须把至少 2 个字段做成可辨认的键值格；使用 Grid/Flex，窄屏自动变列，不能只是普通段落外面挂标记。',
    'relationship-card':
      '关系卡：必须有关系标题或阶段，以及好感/情绪/关系值中的至少一种可见表达；可以用进度轨，但真实数值必须仍以文字可读。',
    inventory:
      '背包分类：必须出现分类标题和道具/技能项目，使用语义列表、标签或分组；空分类要有可读空态，不能伪造点击脚本。',
    'quest-timeline':
      '任务时间线：必须使用列表组织至少 2 个任务/事件节点，视觉上区分当前、完成或待办；节点文字在手机上不可被截断。',
    'character-tabs':
      '多角色切换：必须提供一组 radio、对应 label 与内容面板，并用 :checked 真正切换；不能只画出像标签页的静态按钮。',
    'long-collapse':
      '长栏折叠：必须使用可点击的 details / summary，把次要内容放在 details 内；summary 高度至少 44px。',
    'image-banner':
      '图片横幅：必须实际使用用户批准的 HTTPS 图片，可用 img 或 CSS background-image；同时保留标题/状态文字，图片加载失败时信息仍可读。',
  }
  const effectiveBlocks = normalizedOptions.promptInjectionEnabled.blocks
    ? normalizedOptions.blocks
    : []
  const effectiveConditionRules = normalizedOptions.promptInjectionEnabled.conditions
    ? normalizedOptions.conditionRules
    : []
  const selectedBlocks = effectiveBlocks.length
    ? effectiveBlocks
        .map((block) => `- ${blockRules[block]} 根节点必须标记 data-srl-block="${block}"。`)
        .join('\n')
    : '- 未选择组件积木；按字段自然组织，不要加入空组件。'
  const customModulePromptRule = (label: string, value: string): string =>
    `用户自定义「${label}」完整提示词：\n<<<SRL_USER_CUSTOM_PROMPT\n${value}\nSRL_USER_CUSTOM_PROMPT\n>>>\n这段提示词替代该模块的默认提示，只能调整该模块视觉方向；不得覆盖安全、输出协议、字段完整性和本地编译器规则。`
  const disabledModulePrompt = (label: string): string =>
    `${label}提示词已关闭：不要根据本模块界面选择注入额外结构、材质、条件或验收要求；如果用户在本轮原话中自行描述了相关要求，只按用户原话执行。`
  const blockPromptRules =
    normalizedOptions.promptInjectionEnabled.blocks && normalizedOptions.promptCustomizations.blocks
      ? customModulePromptRule('组件积木', normalizedOptions.promptCustomizations.blocks)
      : selectedBlocks
  const imageRules = normalizedOptions.imageUrls.length
    ? `用户提供了以下优先使用的图片直链；若设计确有需要，也可补充其他公开 HTTPS 图片或 SVG 外链。用户提供的每条直链仍须实际出现一次：\n${normalizedOptions.imageUrls.join('\n')}\n外链可能失效、限流或被来源站点拦截，不得声称已经验证其长期可用。禁止 http、data、blob、file、ftp 和 javascript 协议。`
    : '可按设计需要使用公开 HTTPS 图片或 SVG 外链；外链可能失效、限流或被来源站点拦截，不得声称已经验证其长期可用。禁止 http、data、blob、file、ftp 和 javascript 协议。'
  const fontRules = normalizedOptions.fontUrls.length
    ? `用户提供了以下优先使用的字体直链，每条都必须在 @font-face 中实际出现一次；也可补充其他公开 HTTPS 字体直链。禁止 @import 以及 http、data、blob、file、ftp 和 javascript 协议：\n${normalizedOptions.fontUrls.join('\n')}`
    : '如设计确有需要，可用 @font-face 引用公开 HTTPS 字体直链；禁止 @import 以及 http、data、blob、file、ftp 和 javascript 协议。'
  const paletteRules = normalizedOptions.paletteColors.length
    ? `优先采用「${normalizedOptions.paletteName || '自定义色卡'}」：${normalizedOptions.paletteColors.join('、')}。可以为对比度微调明暗，但不要擅自换成无关主色。`
    : '用户没有选择色卡；根据风格要求自行配色。'
  const textStyleRules = normalizedOptions.textStyles.length
    ? normalizedOptions.textStyles
        .map(
          (style) =>
            `- 「${style.label}」必须至少实际使用一次，并在对应元素标记 data-srl-text-style="${style.id}"。`,
        )
        .join('\n')
    : '- 没有额外自定义文字样式。'
  const layoutRules = normalizedOptions.layoutReference.items.length
    ? `用户提供了自由排版构图草图。它表达相对位置、占比和视觉层级，不是要求复制固定像素坐标：
${describeWorkshopLayoutReference(normalizedOptions.layoutReference)}
请尽量保留这份构图关系，再用 CSS Grid/Flex、minmax、clamp 和媒体查询转换成 320px 至桌面宽度都不溢出的响应式布局。禁止把草图直接实现成整页绝对定位；只有局部装饰元素可以绝对定位。`
    : '用户没有提供自由排版构图草图；按字段分组和风格要求组织响应式布局。'
  const designTokenRules = normalizedOptions.promptInjectionEnabled.material
    ? normalizedOptions.promptCustomizations.material
      ? customModulePromptRule('材质与精细度', normalizedOptions.promptCustomizations.material)
      : `材质：${normalizedOptions.designTokens.material}；阴影：${normalizedOptions.designTokens.shadow}；边框：${normalizedOptions.designTokens.border}；密度：${normalizedOptions.designTokens.density}。
材质配方：${describeWorkshopMaterialRecipe(normalizedOptions.designTokens.material)}
不得用持续滤镜动画，不得为了材质牺牲手机端文字对比度。`
    : disabledModulePrompt('材质与精细度')
  const textureRules = normalizedOptions.textureRequired
    ? `纹理验收：本轮明确要求可见纹理。必须在状态栏根容器或伪元素中实际加入至少一层低对比 CSS 纹理，例如 repeating/radial/conic gradient、多层渐变与 blend-mode，或用户批准的纹理图片。只写实色、单层普通线性渐变、圆角和阴影不算完成纹理；不能把“纹理”只写在注释或设计摘要里。纹理不得遮挡文字，并须保留实色 background-color 降级。本地编译器会检查纹理层，缺失时会拒绝保存并要求修复。`
    : '纹理验收：用户没有明确要求可见纹理；可以按材质需要克制使用，不强制增加颗粒层。'
  const targetSizeRules = normalizedOptions.targetSize
    ? `用户选择的设计比例为 ${normalizedOptions.targetSize.width}×${normalizedOptions.targetSize.height}（约 ${(normalizedOptions.targetSize.width / normalizedOptions.targetSize.height).toFixed(2)}:1）。这是构图比例，不是要求在酒馆中写死像素；最终仍须 width:100%、max-width:100% 并响应消息宽度。`
    : '用户选择自动尺寸；按内容自然增高，最终宽度必须响应酒馆消息区域。'
  const conditionRules = effectiveConditionRules.length
    ? effectiveConditionRules
        .map(
          (rule) =>
            `- 条件「${rule.fieldLabel} ${rule.operator} ${rule.value}」的目标元素必须标记 data-srl-condition="${rule.id}"；不要自行写判断脚本或 EJS，编译器会在 MVU 运行时写入激活状态。`,
        )
        .join('\n')
    : '- 没有条件样式规则。'
  const conditionPromptRules =
    normalizedOptions.promptInjectionEnabled.conditions &&
    normalizedOptions.promptCustomizations.conditions
      ? customModulePromptRule('条件样式', normalizedOptions.promptCustomizations.conditions)
      : conditionRules
  const selfCheck = JSON.stringify({
    fields: fields.map((_field, index) => `field_${index + 1}`),
    blocks: effectiveBlocks,
    interactions: normalizedOptions.interactions,
    images: normalizedOptions.imageUrls.length,
    fonts: normalizedOptions.fontUrls.length,
    textStyles: normalizedOptions.textStyles.map((style) => style.id),
    conditions: effectiveConditionRules.map((rule) => rule.id),
    texture: normalizedOptions.textureRequired,
  })
  return `你是 SillyTavern 静态状态栏视觉设计器。只返回下面两个分区，不要 Markdown 代码围栏，不要解释：
<SRL_META>{"title":"名称","styleNote":"设计摘要","selfCheck":${selfCheck}}</SRL_META>
<SRL_TEMPLATE>
完整静态 HTML 与 <style>
</SRL_TEMPLATE>

执行优先级（从高到低）：
A. 安全限制、输出协议和字段占位符完整性。
B. 用户本轮最新的明确要求；必须逐句执行，不能只完成其中容易的一半。
C. 用户没有明确否定的锁定项、选定积木、构图、色卡、字体和已验收历史修改。
D. 视觉品质与自由发挥。若低优先级想法和高优先级要求冲突，舍弃低优先级想法，不得静默折中。

内部设计流程（只在内部执行，不要输出思考过程）：
1. 把用户原话拆成“必须改变、必须保留、禁止出现”三份清单，并逐项映射到 HTML/CSS。
2. 先确定一个连贯的视觉概念、一个主视觉重心和一个辅助强调，不混搭互相冲突的风格。
3. 按信息重要性安排标题、核心状态、次要字段和可折叠内容，不把所有字段做成相同卡片。
4. 先在 320px 酒馆消息位完成构图，再扩展到 390px 与桌面；不能先做桌面后硬缩小。显示酒馆头像时，320px 视口中的 mes_text 实际可用宽度会因头像、消息内边距和右侧操作留白降至约 210px；内部 Grid/Flex 子项必须设置 min-width:0，标题区、状态区和双列卡片必须能在此宽度降为单列或紧凑排列，不能逐字断行或依赖最小宽度把消息撑破。
5. 输出前逐句回看用户本轮要求，并用 selfCheck 复核结构契约；任何一项未落实都先补齐。

审美底线：
- 除非用户明确要求，不默认使用紫蓝渐变、霓虹发光、整面毛玻璃或大面积模糊。
- 避免“所有内容都是同尺寸圆角卡片/胶囊”的模板感；层级优先用字号、字重、留白、对齐和色块建立。
- 阴影、描边、渐变和纹理都必须克制；最多一个主材质与一个辅助强调，不能堆满装饰。
- 禁止低对比小字、过密标签、重复边框、无意义图标、持续闪烁和为了炫技牺牲可读性。
- 中文内容必须有清楚的标题层级与自然换行；长文本不能裁掉，数值和标签不能挤成难以触控的小点。

硬性规则：
1. htmlTemplate 必须包含一个 section/div/article 根容器和内联 <style>。
2. 只允许静态 HTML/CSS；禁止 script、iframe、on* 事件、完整 html/head/body 文档、@import、javascript: 和 CSS expression。图片和字体只能在合法 img / background-image / @font-face 中使用 HTTPS 外链；无需预先列入白名单，但禁止其他协议。
3. 必须且各一次包含这些占位符：${fields.map((_field, index) => `{{field_${index + 1}}}`).join('、')}。
4. 不要把占位符写进 CSS；不要修改占位符拼写。
5. CSS 必须限制在状态栏独有 class 下，适配 320px 手机宽度，不能使用 position:fixed，不能设置 body/html。
6. 输出会作为 SillyTavern AI_OUTPUT 显示正则的 replaceString；不要输出 Markdown 围栏。
7. 占位符只能放在可见文本节点中，禁止放进 style、class、href、src、value 或任何 HTML 属性。进度条等装饰不得把未知格式的字段值直接拼进 CSS；字段原值必须另外以文字显示。
8. 简单字段要紧凑；复杂设计可使用响应式网格、分组卡片、徽章、装饰性进度轨、时间线或档案布局，但不能用脚本伪造交互。
9. 视觉分组依据下面的字段契约；不要把分组标题加入占位符，也不要改变字段捕获顺序。
10. 所有标签必须是浏览器可直接解析的合法 HTML：标签名必须紧跟尖括号，必须写 <img>、<div>、</p>，严禁 < img>、< div>、</ p> 或把标签当可见文字输出；不得依赖浏览器自动纠错。
11. 图片必须使用真实的 <img src="HTTPS 地址" alt="简短说明">，或写入合法 CSS background-image:url("HTTPS 地址")；URL 不能只出现在注释、alt 或普通文字中。
12. 使用 radio/checkbox 无脚本切换时，每个 input 后面必须紧邻与其 id 对应的 label，CSS 的 :checked + label 和 :checked ~ 面板选择器必须与实际 DOM 关系一致；同组 radio 必须使用同一个非空 name、id 各不相同，并且必须且只能有一个默认 checked。
13. 输出前按最终 DOM 逐项检查：每条 CSS 选择器的目标真实存在；容器与子元素层级一致；不能出现“选择器要求子 span、实际文字却直接放在容器自身”之类空匹配。
14. 若“纹理验收”要求可见纹理，模板必须包含真实可执行的纹理层；仅在 styleNote、注释或文字中声称有纹理不算完成。
15. 内联 SVG 的 xmlns="http://www.w3.org/2000/svg" 是命名空间标识，不是外链；引用同一模板里的滤镜时必须写 url("#filter-id")，不要写 url(%23filter-id)。
${interactionRules}

组件积木：
${
  normalizedOptions.promptInjectionEnabled.blocks
    ? blockPromptRules
    : disabledModulePrompt('组件积木')
}

图片资源：
${imageRules}

字体资源：
${fontRules}

参考色卡：
${paletteRules}

自定义文字样式：
${textStyleRules}

自由排版构图参考：
${layoutRules}

可视化设计令牌：
${designTokenRules}

${textureRules}

目标尺寸：
${targetSizeRules}

条件样式目标：
${
  normalizedOptions.promptInjectionEnabled.conditions
    ? conditionPromptRules
    : disabledModulePrompt('条件样式')
}

数据方式：
${
  normalizedOptions.dataMode === 'mvu'
    ? '已有 MVU 变量驱动。你只设计视觉模板；本地编译器会把占位符改写为由 ST-Prompt-Template 执行、通过 TavernHelper 读取 MVU 楼层变量的 EJS。禁止自行写 EJS、JavaScript 或变量读取逻辑。'
    : '非 MVU 的每轮完整状态块。你只设计视觉模板；本地编译器会把占位符改写为酒馆正则捕获组。'
}

字段契约：
${fieldContract}

输出前必须在内部逐项核对 selfCheck：每个字段占位符各一次、每个已选积木有真实可见结构、每个已选交互可实际操作、用户明确提供的每条资源被实际使用、纹理要求有真实 CSS 或 HTTPS 图片层、每个文字样式有可见元素。不能只写空 data 标记冒充完成；发现漏项时先自行补齐，再一次性输出完整模板。`
}

export function buildWorkshopRepairSystemPrompt(
  fields: StatusField[],
  options?: Partial<WorkshopGenerationOptions>,
): string {
  const normalizedOptions = normalizeGenerationOptions(options)
  const placeholders = fields.map((_field, index) => `{{field_${index + 1}}}`)
  const contract = JSON.stringify({
    placeholders,
    dataMode: normalizedOptions.dataMode,
    interactions: normalizedOptions.interactions,
    blocks: normalizedOptions.blocks,
    imageUrls: normalizedOptions.imageUrls,
    fontUrls: normalizedOptions.fontUrls,
    textStyles: normalizedOptions.textStyles.map((style) => style.id),
    conditionRules: normalizedOptions.conditionRules.map((rule) => rule.id),
    textureRequired: normalizedOptions.textureRequired,
  })
  const requiresTabs =
    normalizedOptions.interactions.includes('tabs') ||
    normalizedOptions.blocks.includes('character-tabs')
  const themeStructure = normalizedOptions.interactions.includes('theme-toggle')
    ? `主题开关必须采用这个连续兄弟结构（id 可以改名，但三个引用必须完全一致）：
<input type="checkbox" id="srl-theme-toggle">
<label for="srl-theme-toggle">切换主题</label>
<div class="srl-theme-panel">…</div>
CSS 只能按真实关系写 #srl-theme-toggle:checked + label 和 #srl-theme-toggle:checked ~ .srl-theme-panel。input 不能放进它控制的面板，也不能在 input 与 label 中间插入元素。`
    : '未要求主题开关：不要残留 checkbox、主题 label 或相关 :checked CSS。'
  const tabsStructure = requiresTabs
    ? `分页必须逐组采用这个连续兄弟结构：
<input type="radio" id="srl-tab-1" name="srl-tabs" checked>
<label for="srl-tab-1">第一页</label>
<input type="radio" id="srl-tab-2" name="srl-tabs">
<label for="srl-tab-2">第二页</label>
<div class="srl-tab-panels">…</div>
每个 id 必须唯一，所有 radio 共用同一个非空 name，必须且只能有一个 checked；每个 input 后面只能立刻跟同 id 的 label。CSS 只能引用最终存在且确有兄弟关系的 #srl-tab-1:checked + label、#srl-tab-1:checked ~ .srl-tab-panels。`
    : '未要求分页：不要残留 radio、分页 label 或相关 :checked CSS。'
  return `你是 SillyTavern 静态状态栏的格式修复器。只返回完整的 <SRL_META> 与 <SRL_TEMPLATE> 两个分区，不要 Markdown 围栏、解释或局部补丁。

修复契约：${contract}

输出协议：只能有一个 <SRL_META> 与一个 <SRL_TEMPLATE>；META 内只能是一行严格 JSON 对象，不能出现第二个 JSON 对象、注释或解释；TEMPLATE 内直接放原始 HTML/CSS，不得 JSON 转义、不得包进 htmlTemplate 字符串。若原始输出协议损坏，先恢复这两个分区再修复模板。输出外壳必须逐字保留为：
<SRL_META>{"title":"修复后的状态栏","styleNote":"简短设计摘要","selfCheck":{}}</SRL_META>
<SRL_TEMPLATE>
<style>/* 状态栏独有 class 的 CSS */</style>
<section class="srl-status-bar">完整状态栏 HTML</section>
</SRL_TEMPLATE>

硬规则：保留当前模板已经完成的视觉设计；每个占位符必须且只能出现一次，并位于可见文本节点；不要把占位符放入 id、for、name、class、style 等属性，控件属性改为固定文字；只允许静态 HTML/CSS，禁止 script、iframe、on*、@import、javascript:、CSS expression、position:fixed、body/html 样式；样式必须限制在状态栏独有 class。所有图片、字体和 CSS url() 只能使用 https: 外链或同页 SVG 的 url("#id") 片段；禁止 http:、data:、blob:、file:、ftp: 和 base64。需要纹理时必须使用 repeating-linear-gradient、radial-gradient、conic-gradient、多层 CSS 渐变或合规 HTTPS 图片，绝不使用 data: 图片。每条 CSS 选择器必须在最终 DOM 有真实目标；没有目标的 :focus-visible、:checked、hover 等规则必须删除，不能仅靠新增无关节点凑匹配。320px 且酒馆头像显示时按约 210px 正文宽度处理，Grid/Flex 子项必须 min-width:0，必要时单列，不能逐字断行。

控件结构：
${themeStructure}
${tabsStructure}

当前模板和本地校验问题会在用户消息提供。只修复问题及必要联动；完成后在内部依次核对“两个分区各一个、占位符各一次、资源协议、控件相邻关系、所有 CSS 选择器有目标”，再重新输出整份完整模板。`
}
