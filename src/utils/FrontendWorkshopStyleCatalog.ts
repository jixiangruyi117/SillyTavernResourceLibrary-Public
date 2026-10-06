export interface WorkshopStyle {
  id: string
  name: string
  en: string
  hint: string
  desc: string
  use: string
  palette: string[]
  prompt: string
}

export const workshopStyles: WorkshopStyle[] = [
  {
    id: 'glass',
    name: '毛玻璃',
    en: 'Glassmorphism',
    hint: '透明层、柔和背景、细描边',
    desc: '这是材质风格，不是固定色系。示例用冷色，也可以换成暖色或深色。',
    use: '例子：悬浮人物档案、梦境封面、轻盈信息面板',
    palette: ['#b9dada', '#d3cfec', '#203f53'],
    prompt:
      '使用毛玻璃材质：柔和渐变背景上放半透明面板、细描边和轻阴影。背景可以轻度虚化，但正文区域保持足够对比，不对整屏持续高强度模糊。',
  },
  {
    id: 'console',
    name: '复古掌机',
    en: 'Handheld console',
    hint: '塑料机身、像素屏、实体感',
    desc: '重点是屏幕边框、按键语言和像素节奏，颜色可以是灰绿，也可以是其他机身配色。',
    use: '例子：角色选择界面、剧情存档、状态菜单',
    palette: ['#d4d6c8', '#a7b889', '#273f28'],
    prompt:
      '使用原创复古掌机风格：塑料机身边框、像素感状态屏、实体按键与存档菜单。参考灰绿色屏幕配色，不使用现成品牌标志；中文正文清晰，不要为了像素感变得难读。',
  },
  {
    id: 'editorial',
    name: '杂志排版',
    en: 'Editorial',
    hint: '大标题、留白、细线',
    desc: '依靠字体大小与疏密对比形成高级感，图片和正文有明确的阅读顺序。',
    use: '例子：人物专访、作品封面、章节目录',
    palette: ['#eee8db', '#25251e', '#95614d'],
    prompt:
      '使用杂志式编辑排版：大号角色姓名、非对称留白、细线分区和清晰的正文层级。参考米白、墨黑与少量棕红点缀，避免一排排相同的信息卡片。',
  },
  {
    id: 'archive',
    name: '纸质档案',
    en: 'Paper archive',
    hint: '纸张、编号、批注',
    desc: '用纸张叠放和小幅错位制造档案感，装饰不能盖住正文。',
    use: '例子：调查笔记、人物履历、线索卡片',
    palette: ['#d9d2c0', '#f2edde', '#8e594e'],
    prompt:
      '使用纸质档案风格：浅色纸张、编号、细小批注与少量印章，内容略微错位叠放，保留清楚的阅读区。参考旧纸色和低饱和红色点缀，不堆满污渍与纹理。',
  },
  {
    id: 'cinema',
    name: '冷峻电影',
    en: 'Cinematic',
    hint: '暗部留白、局部高光',
    desc: '以人物和大标题作为焦点，局部光影负责层次，而不是满屏霓虹。',
    use: '例子：角色 PV、悬疑档案、最终海报',
    palette: ['#111c27', '#344c60', '#86b3cc'],
    prompt:
      '使用冷峻电影风：深蓝黑背景、大面积暗部留白、局部冷色高光、细线与大号标题。人物始终是视觉核心，避免满屏霓虹和大量粒子，正文要有清楚对比。',
  },
  {
    id: 'ink',
    name: '东方留白',
    en: 'Ink-inspired',
    hint: '疏密、纸感、少量朱色',
    desc: '重点是构图的虚实与呼吸感，并不等于给所有文字使用书法字体。',
    use: '例子：人物小传、山水章节、书信开场',
    palette: ['#eeeae1', '#292f2a', '#925547'],
    prompt:
      '使用东方留白风格：纸白与墨色为主，少量朱色点缀，疏密有序的构图，人物姓名可用有书卷感的字体，正文使用清晰字体。装饰克制，不堆砌古风图案。',
  },
]

workshopStyles.push(
  {
    id: 'blueprint',
    name: '工程蓝图',
    en: 'Blueprint',
    hint: '网格、引线、编号',
    desc: '网格和标注营造技术档案感，参数可以更换为人物设定。',
    use: '机甲设定、能力分析、装备手册',
    palette: ['#173d60', '#a2d2ee', '#edf5f7'],
    prompt:
      '使用工程蓝图风格：深蓝底色、细网格、浅色标注线与编号，重点内容清楚留白，装饰参数不要伪装成真实人物数据。',
  },
  {
    id: 'brutal',
    name: '大胆平面',
    en: 'Neo-brutalism',
    hint: '大色块、硬边框、错位影子',
    desc: '强烈对比和直白的排版，适合活泼而有个性的角色。',
    use: '角色名片、活动开场、个性选项',
    palette: ['#ffe59a', '#dd583f', '#25251e'],
    prompt:
      '使用大胆平面风格：大色块、粗而明确的边框、少量错位硬阴影与醒目标题；选两三种主色，正文不要过度装饰，避免满屏不同强调色。',
  },
  {
    id: 'pastel',
    name: '柔和梦境',
    en: 'Pastel dream',
    hint: '低饱和、圆润、柔和渐变',
    desc: '温柔的色彩与轻盈的形状，留足正文与装饰的距离。',
    use: '治愈角色、幻想场景、日记开场',
    palette: ['#f5e2e6', '#dedcf1', '#555173'],
    prompt:
      '使用柔和梦境风格：低饱和粉紫或自选柔和色系、圆润形状、浅渐变与少量漂浮装饰；正文用深色保证对比，不铺满星星粒子。',
  },
  {
    id: 'terminal',
    name: '终端档案',
    en: 'Terminal',
    hint: '等宽字、命令行、状态提示',
    desc: '以终端信息组织方式呈现人物，不要求用户真的输入命令。',
    use: '人工智能角色、机密日志、科幻状态栏',
    palette: ['#12231e', '#8cd6b2', '#cfe9db'],
    prompt:
      '使用终端档案风格：深色背景、清晰等宽标签、少量绿色状态文字和命令行式分段。中文正文保留可读字体，不持续闪烁光标、不用整页乱码。',
  },
)

export function buildWorkshopInspirationPrompt(
  style: WorkshopStyle | undefined,
  effects: { name: string; prompt: string }[],
): string {
  return [
    '请根据我的当前作品和接下来补充的需求，使用以下视觉方向。修改已有作品时保留原内容和功能，只调整我指定的范围；没有作品时先确认角色内容与布局。',
    style ? '视觉风格：' + style.name + '。' + style.prompt : '视觉风格：保留当前作品风格。',
    ...effects.map((effect) => '动效：' + effect.name + '。' + effect.prompt),
    '配色只是参考，可以按角色气质调整。兼顾手机点按与电脑操作；支持系统减少动态效果设置，动效结束后正文和按钮清楚可用。请先说明这些效果适合放在哪些位置，不要把每个元素都做成相同动效。',
  ].join('\n\n')
}
