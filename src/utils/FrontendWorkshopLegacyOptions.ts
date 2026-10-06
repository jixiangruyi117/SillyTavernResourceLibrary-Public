import type {
  LockedAspect,
  ReferenceScope,
  TypographyPreset,
  WorkshopReviewCategory,
} from '../types/FrontendWorkshopLegacyApp'
// LEGACY-REQUIRED: presentation choices for the retained status editor only.
import type {
  DesignPanel,
  TargetSizePreset,
  WorkshopPalette,
  WorkshopStep,
} from '../types/FrontendWorkshopLegacyApp'
import type {
  StatusField,
  WorkshopBlock,
  WorkshopConditionOperator,
  WorkshopDataMode,
  WorkshopInteraction,
} from './FrontendWorkshop'

export const CLASSIC_PALETTES: WorkshopPalette[] = [
  {
    id: 'ink-paper',
    name: '墨玉纸页',
    colors: ['#173C30', '#DCE8DF', '#F7F2E7', '#B97952', '#292A27'],
    source: 'classic',
  },
  {
    id: 'mist-blue',
    name: '雾蓝银灰',
    colors: ['#28435B', '#6F8FA8', '#D7E1E8', '#F4F6F6', '#C48C70'],
    source: 'classic',
  },
  {
    id: 'wine-cream',
    name: '酒红奶油',
    colors: ['#692D3C', '#A45A63', '#E6C9C2', '#FFF6E9', '#3D3032'],
    source: 'classic',
  },
  {
    id: 'night-neon',
    name: '夜航霓光',
    colors: ['#111827', '#25304A', '#3CD7C7', '#E0B6FF', '#F5F7FF'],
    source: 'classic',
  },
  {
    id: 'tea-rose',
    name: '山茶柔粉',
    colors: ['#7B4D50', '#BE8580', '#E8C6BC', '#FAF1E7', '#50645B'],
    source: 'classic',
  },
  {
    id: 'black-gold',
    name: '黑金档案',
    colors: ['#171716', '#3B3933', '#B89B5E', '#E8D9AE', '#F7F2E5'],
    source: 'classic',
  },
]

export const workshopSteps: Array<{ id: WorkshopStep; label: string }> = [
  { id: 'design', label: '设计' },
  { id: 'proof', label: '预览' },
  { id: 'delivery', label: '交付' },
]

export const designPanels: Array<{ id: DesignPanel; label: string; eyebrow: string }> = [
  { id: 'content', label: '内容', eyebrow: '01' },
  { id: 'appearance', label: '外观', eyebrow: '02' },
  { id: 'generate', label: '生成', eyebrow: '03' },
]

export const targetSizePresets: Array<{
  id: TargetSizePreset
  label: string
  note: string
  width?: number
  height?: number
}> = [
  { id: 'auto', label: '自动高度', note: '按字段数量自然增高，推荐新手' },
  { id: 'banner', label: '手机横条', note: '2:1 · 标题、头像和少量状态', width: 320, height: 160 },
  { id: 'card', label: '手机卡片', note: '4:3 · 常规人物状态', width: 320, height: 240 },
  { id: 'wide-card', label: '宽手机卡', note: '3:2 · 适合图片与双列', width: 390, height: 260 },
  { id: 'long-panel', label: '手机长面板', note: '2:3 · 字段或任务较多', width: 320, height: 480 },
  { id: 'desktop-wide', label: '桌面宽栏', note: '2:1 · 宽屏聊天栏', width: 720, height: 360 },
  { id: 'custom', label: '自定义', note: '输入宽高，只采用比例' },
]

export const workshopPresets = [
  {
    label: '简洁人物卡',
    source: '姓名：林言\n性别：女\n状态：正在探索\n地点：城南',
    style: '清晰克制的东方档案风，墨绿与米白，手机端单列紧凑，重点突出姓名与状态',
    dataMode: 'reply',
    interactions: [],
    blocks: ['character-header', 'attribute-grid'],
  },
  {
    label: 'RPG 多分组',
    source:
      '[角色]\n姓名：林言\n等级[数字]：18\n生命[百分比]：82%\n[环境]\n地点：城南\n天气：小雨\n[任务]\n目标[长文本]：寻找失落的信物\n标签[列表]：探索、夜晚、主线',
    style:
      '复杂 RPG 信息面板，分组清楚，有徽章与装饰性进度轨，深色羊皮纸与青绿色微光，320px 仍易读',
    dataMode: 'reply',
    interactions: ['collapsible', 'motion'],
    blocks: ['character-header', 'attribute-grid', 'inventory', 'quest-timeline'],
  },
  {
    label: '关系与情绪',
    source:
      '[关系]\n姓名：沈栖\n好感度[百分比]：67%\n关系阶段：熟悉\n[即时状态]\n情绪[标签]：警惕、克制\n想法[长文本]：对方已经注意到你的到来',
    style: '细腻的情绪档案，低饱和酒红和雾灰，关系数值醒目，长文本舒展但不占满屏幕',
    dataMode: 'reply',
    interactions: ['collapsible'],
    blocks: ['relationship-card', 'long-collapse'],
  },
  {
    label: 'MVU 多角色',
    source:
      '[角色.林言]\n好感度[数字]：32\n状态：正在探索\n[角色.沈栖]\n好感度[数字]：18\n状态：保持警惕\n[世界]\n时间：18:36\n地点：巷子口',
    style: '多角色群像档案，角色分区可折叠，数值变化醒目，深墨绿色与暖灰，手机端优先',
    dataMode: 'mvu',
    interactions: ['collapsible', 'motion'],
    blocks: ['character-tabs', 'relationship-card'],
  },
] satisfies Array<{
  label: string
  source: string
  style: string
  dataMode: WorkshopDataMode
  interactions: WorkshopInteraction[]
  blocks: WorkshopBlock[]
}>

export const dataModeOptions: Array<{
  value: WorkshopDataMode
  eyebrow: string
  title: string
  description: string
  meta: string
}> = [
  {
    value: 'reply',
    eyebrow: 'NO MVU',
    title: '每轮完整输出',
    description: 'AI 每次回复都填写完整状态块，正则直接变成界面。',
    meta: '上手最快 · 只需酒馆内置正则',
  },
  {
    value: 'mvu',
    eyebrow: 'MVU VIEW',
    title: '读取已有 MVU',
    description: '状态栏从当前消息楼层的 stat_data / display_data 读取。',
    meta: '跨回合 · 需要酒馆助手与现有 MVU',
  },
]

export const interactionOptions: Array<{
  value: WorkshopInteraction
  title: string
  description: string
}> = [
  {
    value: 'collapsible',
    title: '折叠分组',
    description: '使用原生 details / summary，不依赖脚本。',
  },
  {
    value: 'motion',
    title: '短时动效',
    description: '只用 transform / opacity，并适配减少动态效果。',
  },
  {
    value: 'theme-toggle',
    title: '局部日夜切换',
    description: 'checkbox + CSS 切换，不改酒馆全局主题。',
  },
  {
    value: 'tabs',
    title: '分组分页',
    description: 'radio + CSS 标签页，适合多角色和多面板。',
  },
]

export const designTokenOptions = {
  material: [
    ['auto', '自动', '按风格要求决定'],
    ['solid', '实色', '清晰稳定、性能最好'],
    ['glass', '磨砂玻璃', '半透明、内高光、细边与模糊降级'],
    ['acrylic', '亚克力', '透光边缘、叠层色彩与窄幅高光'],
    ['paper', '高级纸张', '渐变纹理、边缘暗化与压印'],
    ['enamel', '珐琅', '釉面色、双描边与弧形高光'],
    ['metal', '金属', '克制定向高光与冷暖边'],
    ['embossed-metal', '金属压印', '浮雕明暗、细轮廓与定向高光'],
    ['holographic', '全息霓光', '圆锥渐变与局部反光'],
  ],
  shadow: [
    ['none', '无阴影', '扁平清楚'],
    ['soft', '柔和', '轻微悬浮'],
    ['layered', '分层', '前后层次明显'],
    ['dramatic', '强烈', '重点卡片更突出'],
  ],
  border: [
    ['none', '无边框', '靠色块分区'],
    ['hairline', '细线', '精致克制'],
    ['double', '双线', '档案与古典质感'],
    ['glow', '微光', '赛博或夜间界面'],
  ],
  density: [
    ['compact', '紧凑', '手机一次看更多'],
    ['balanced', '均衡', '默认阅读密度'],
    ['airy', '宽松', '留白更明显'],
  ],
} as const

export const designTokenKeys = ['material', 'shadow', 'border', 'density'] as const

export type DesignTokenKey = (typeof designTokenKeys)[number]

export const conditionOperatorOptions: Array<{
  value: WorkshopConditionOperator
  label: string
}> = [
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含文字' },
]

export const blockOptions: Array<{
  value: WorkshopBlock
  title: string
  technicalName: string
  description: string
  compatibility: string
  bestFor: string
  structure: string
}> = [
  {
    value: 'character-header',
    title: '人物名片',
    technicalName: '角色头部',
    description: '让姓名、身份和最重要的状态先被看见。',
    compatibility: '纯 HTML/CSS',
    bestFor: '单角色档案、队伍成员首页',
    structure: '增加头像、姓名、身份摘要和重点状态区',
  },
  {
    value: 'attribute-grid',
    title: '并排数值区',
    technicalName: '属性网格',
    description: '把多项数值排成能快速扫读的小格子。',
    compatibility: '纯 HTML/CSS',
    bestFor: '生命、理智、好感度、日期地点',
    structure: '增加至少两格数值，窄屏时自动换列',
  },
  {
    value: 'relationship-card',
    title: '关系与好感',
    technicalName: '关系卡',
    description: '集中突出关系阶段、情绪和好感变化。',
    compatibility: '纯 HTML/CSS',
    bestFor: '恋爱、羁绊、阵营与信任关系',
    structure: '增加关系标题、当前阶段和进度轨',
  },
  {
    value: 'inventory',
    title: '分类背包',
    technicalName: '背包分类',
    description: '把武器、道具和收藏物分组收纳。',
    compatibility: '纯 HTML/CSS',
    bestFor: '背包、技能、收藏物',
    structure: '增加分类标题和成组的道具标签或列表',
  },
  {
    value: 'quest-timeline',
    title: '剧情进度',
    technicalName: '任务时间线',
    description: '按顺序展示目标、阶段和已经发生的事件。',
    compatibility: '纯 HTML/CSS',
    bestFor: '任务、事件、章节进度',
    structure: '增加带连线的节点列表和当前状态',
  },
  {
    value: 'character-tabs',
    title: '队伍成员切换',
    technicalName: '多角色切换',
    description: '在同一块状态栏里切换查看不同角色。',
    compatibility: '联动无脚本分页',
    bestFor: '群像、队伍、多角色数组',
    structure: '增加成员标签和一一对应的角色面板',
  },
  {
    value: 'long-collapse',
    title: '收起次要内容',
    technicalName: '长栏折叠',
    description: '重要信息先看，详细内容需要时再点开。',
    compatibility: '联动原生折叠',
    bestFor: '字段很多、手机优先',
    structure: '增加可点击标题和收起的详细内容',
  },
  {
    value: 'image-banner',
    title: '顶部视觉图',
    technicalName: '图片横幅',
    description: '在顶部加入角色、地点或章节视觉图。',
    compatibility: '需要 HTTPS 图片直链',
    bestFor: '角色立绘、地点图、章节封面',
    structure: '增加批准的图片和加载失败时的文字兜底',
  },
]

export const fieldKindOptions: Array<{ value: StatusField['kind']; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'percent', label: '百分比' },
  { value: 'tags', label: '标签/列表' },
  { value: 'longText', label: '长文本' },
]

export const blockSceneOptions: Array<{
  id: string
  title: string
  description: string
  blocks: WorkshopBlock[]
}> = [
  {
    id: 'profile',
    title: '人物档案',
    description: '姓名身份先出现，下面紧凑排列状态与数值。',
    blocks: ['character-header', 'attribute-grid'],
  },
  {
    id: 'story',
    title: '剧情进度',
    description: '当前目标先看，背景和次要事件需要时再展开。',
    blocks: ['quest-timeline', 'long-collapse'],
  },
  {
    id: 'party',
    title: '队伍状态',
    description: '先切换成员，再查看每位角色的重点状态。',
    blocks: ['character-tabs', 'character-header'],
  },
  {
    id: 'bond-items',
    title: '物品与关系',
    description: '把羁绊变化和背包内容拆成两个清楚区域。',
    blocks: ['inventory', 'relationship-card'],
  },
]

export const reviewCategoryLabels: Record<WorkshopReviewCategory, string> = {
  interaction: '交互',
  motion: '动效',
  layout: '排版',
  color: '配色',
  content: '内容',
  accessibility: '可读性',
  other: '其他',
}

export const REVIEW_REQUIREMENT_START = '【已选审美建议】'

export const REVIEW_REQUIREMENT_END = '【已选审美建议结束】'

export const typographyOptions: Array<{
  value: TypographyPreset
  label: string
  description: string
  stack: string
}> = [
  {
    value: 'auto',
    label: '自动匹配',
    description: '让 AI 按整体风格选择安全回退字体',
    stack: 'var(--font-ui)',
  },
  {
    value: 'song',
    label: '宋体档案',
    description: '典雅、文学感，适合标题和叙事',
    stack: '"Songti SC", "STSong", "Noto Serif CJK SC", serif',
  },
  {
    value: 'hei',
    label: '现代黑体',
    description: '清楚紧凑，适合高密度状态信息',
    stack: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  },
  {
    value: 'kai',
    label: '楷体手记',
    description: '古典、手写感，适合少量强调',
    stack: '"Kaiti SC", "STKaiti", "KaiTi", serif',
  },
  {
    value: 'rounded',
    label: '圆润轻快',
    description: '柔和亲切，适合日常和治愈风',
    stack: '"Yuanti SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    value: 'mono',
    label: '等宽终端',
    description: '机械、数据感，适合科幻和数值面板',
    stack: '"Sarasa Mono SC", "Noto Sans Mono CJK SC", ui-monospace, monospace',
  },
  {
    value: 'custom',
    label: '自定义直链',
    description: '使用你提供的 HTTPS 字体文件',
    stack: '"SRLUserFont", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
]

export const referenceScopeOptions: Array<{ value: ReferenceScope; label: string }> = [
  { value: 'color', label: '配色' },
  { value: 'structure', label: '结构' },
  { value: 'typography', label: '字体' },
  { value: 'material', label: '材质' },
  { value: 'spacing', label: '留白' },
  { value: 'motion', label: '动效' },
]

export const lockedAspectOptions: Array<{ value: LockedAspect; label: string }> = [
  { value: 'layout', label: '锁定布局' },
  { value: 'colors', label: '锁定配色' },
  { value: 'typography', label: '锁定字体' },
  { value: 'field-order', label: '锁定字段顺序' },
]
