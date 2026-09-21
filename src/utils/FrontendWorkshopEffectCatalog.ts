import { workshopEffectExtras } from './FrontendWorkshopEffectExtras'

export interface WorkshopEffect {
  id: string
  name: string
  en: string
  category: string
  desc: string
  use: string
  prompt: string
  control: 'step' | 'range' | 'play' | 'scroll'
  reference: string
}

export const workshopEffectCategories = {
  space: '空间与伪3D',
  reveal: '入场与转场',
  detail: '文字与交互',
  light: '光影与材质',
  scroll: '滚动叙事',
} as const

export const workshopEffects: WorkshopEffect[] = [
  {
    id: 'carousel',
    name: '3D 旋转木马',
    en: '3D carousel',
    desc: '一组内容带着透视感轮换，中间最突出，两侧缩小并向后倾斜。',
    use: '适合：角色选择、封面展示、开场白入口',
    prompt:
      '把开场白选项做成带透视的 3D 旋转木马：当前选项居中放大，两侧缩小后退并轻微倾斜，切换时平滑移位。保留清楚的标题与上一项、下一项按钮；手机可以点按切换，不依赖鼠标悬停。',
    category: 'space',
    control: 'step',
    reference: 'transforms',
  },
  {
    id: 'stack',
    name: '卡片堆叠',
    en: 'Card stack',
    desc: '下一张卡片从后面露出，切换时整叠卡片交替前后位置。',
    use: '适合：人物档案、回忆片段、剧情线索',
    prompt:
      '把人物档案做成一叠错位叠放的卡片，后方露出两张卡片的边缘；切换时当前卡片退到后面，下一张来到前景。层次要清楚，旋转幅度克制，文字保持可读，手机提供明确的切换按钮。',
    category: 'space',
    control: 'step',
    reference: 'transforms',
  },
  {
    id: 'flip',
    name: '立体翻页',
    en: 'Page flip',
    desc: '页面绕书脊旋转，翻过去后露出下一页，有正面和背面。',
    use: '适合：人物手册、书信、故事章节',
    prompt:
      '将人物介绍做成一本双页画册。点击翻页时，纸张以书脊为轴进行 3D 翻转，带正反面与轻微阴影。翻页期间避免文字穿透；手机窄屏可以改成单页翻阅，保留上一页与下一页。',
    category: 'space',
    control: 'step',
    reference: 'transforms',
  },
  {
    id: 'accordion',
    name: '手风琴画廊',
    en: 'Accordion gallery',
    desc: '几张画面并排，当前选中项展开，其余收成窄条。',
    use: '适合：多角色、不同场景、章节入口',
    prompt:
      '把几个场景做成横向手风琴画廊。选中某个场景时它平滑展开，其余收窄，但仍能看见标题。电脑可悬停预览，也能点击选定；手机用点击展开，不让文字挤成难读的竖条。',
    category: 'space',
    control: 'step',
    reference: 'transforms',
  },
  {
    id: 'parallax',
    name: '分层视差',
    en: 'Layered parallax',
    desc: '背景慢、前景快，主体反向轻移，产生空间深度。它与真实 3D 建模不同。',
    use: '适合：角色登场、封面、氛围背景',
    prompt:
      '给角色主视觉加入克制的分层视差：背景、人物、前景装饰分开移动，背景位移最小，人物轻微反向偏移。电脑跟随鼠标；手机用轻微滚动视差或静态构图，不强制申请陀螺仪权限。文字与按钮不要随背景乱晃。',
    category: 'space',
    control: 'range',
    reference: 'transforms',
  },
  {
    id: 'tilt',
    name: '立体倾斜',
    en: '3D tilt',
    desc: '卡片绕横轴、纵轴轻微旋转，前景文字可以有一点浮起感。',
    use: '适合：角色卡、徽章、能力展示',
    prompt:
      '让角色卡根据指针位置轻微 3D 倾斜，标题有一点前后层次，离开时平滑回正。最大倾斜保持克制，不影响点击和文字阅读；手机点击时轻微响应即可，不依赖悬停。',
    category: 'space',
    control: 'range',
    reference: 'transforms',
  },
  {
    id: 'reveal',
    name: '依次入场',
    en: 'Stagger reveal',
    desc: '标题先到、副标题跟上，形成有节奏的登场感。',
    use: '适合：角色首屏、资料逐项展示',
    prompt:
      '让标题、副标题和身份标签依次淡入并轻微上移，每项错开约 100ms；整体尽快完成，正文不要长时间不可见。',
    category: 'reveal',
    control: 'play',
    reference: 'performance',
  },
  {
    id: 'mask',
    name: '遮罩揭示',
    en: 'Mask reveal',
    desc: '文字本身保持位置，由一道裁切边界逐渐揭开。',
    use: '适合：大标题、章节切换',
    prompt:
      '让大标题通过横向遮罩揭示出现，像从遮挡后被逐渐擦出；文字本身尽量不移动，动效约 700ms，结束后清晰稳定。',
    category: 'reveal',
    control: 'play',
    reference: 'clipping',
  },
  {
    id: 'decode',
    name: '字符解码',
    en: 'Text scramble',
    desc: '短暂随机字符后稳定为最终内容，只用于简短标签。',
    use: '适合：身份编号、状态、科幻档案',
    prompt:
      '状态标签先出现短暂随机字符，再逐字稳定为真实内容，约 600ms 结束。只用于短标签，不对整段正文持续乱码，最终内容必须可读。',
    category: 'detail',
    control: 'play',
    reference: 'performance',
  },
  {
    id: 'count',
    name: '数字滚动',
    en: 'Count up',
    desc: '数字从起点平滑变化到目标值，读数最后保持稳定。',
    use: '适合：能力值、档案编号、进度',
    prompt:
      '能力值在首次出现时从 0 平滑增长到实际数值，约 800ms 完成，使用等宽数字避免抖动。最终值保持稳定，不循环重播，不改变真实数据。',
    category: 'detail',
    control: 'play',
    reference: 'performance',
  },
  {
    id: 'line',
    name: '线条与字距',
    en: 'Line draw + tracking',
    desc: '细线绘制与标题字距变化配合，适合克制的电影感。',
    use: '适合：姓名定格、章节标题、信息分隔',
    prompt:
      '标题出现时字距从略宽缓慢收回，同时下方细线从左向右绘制。总时长约 800ms，线条纤细，不使用强烈闪光或大面积发光。',
    category: 'detail',
    control: 'play',
    reference: 'performance',
  },
]

workshopEffects.push(
  ...workshopEffectExtras.map(
    ([id, category, name, en, desc, use, prompt, control, reference]) => ({
      id,
      category,
      name,
      en,
      desc,
      use,
      prompt,
      control,
      reference,
    }),
  ),
)

export const workshopReferences: Record<string, { label: string; url: string }> = {
  'perspective-grid': {
    label: 'Codrops · 透视网格动效',
    url: 'https://tympanus.net/codrops/2023/08/03/on-scroll-perspective-grid-animations/',
  },
  'layered-zoom': {
    label: 'Codrops · 分层镜头推进',
    url: 'https://tympanus.net/codrops/2025/10/29/building-a-layered-zoom-scroll-effect-with-gsap-scrollsmoother-and-scrolltrigger/',
  },
  'css3d-morph': {
    label: 'Three.js · 空间布局变形',
    url: 'https://threejs.org/examples/css3d_periodictable.html',
  },
  'image-unroll': {
    label: 'Codrops · 图像卷曲展开',
    url: 'https://tympanus.net/codrops/2020/01/22/how-to-unroll-images-with-three-js/',
  },
  transforms: {
    label: 'MDN · CSS 3D 变换',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-style',
  },
  clipping: {
    label: 'MDN · 裁切与揭示',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/clip-path',
  },
  masking: {
    label: 'MDN · CSS 遮罩',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Masking/Introduction',
  },
  blending: {
    label: 'MDN · 混合模式',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mix-blend-mode',
  },
  performance: { label: 'web.dev · 动画与性能', url: 'https://web.dev/articles/animations-guide' },
  'motion-path': {
    label: 'MDN · 运动路径',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/offset-path',
  },
  svg: {
    label: 'MDN · SVG 描边',
    url: 'https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dasharray',
  },
  scrolling: {
    label: 'WebKit · 滚动驱动动画',
    url: 'https://webkit.org/blog/17101/a-guide-to-scroll-driven-animations-with-just-css/',
  },
}
