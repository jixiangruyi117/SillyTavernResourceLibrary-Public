import type { FrontendWorkshopInspectorItem } from './FrontendWorkshopInspectorRegistry'

const CONTENT_ATTRIBUTES = [
  ['src', '图片 URL'],
  ['href', '链接 URL'],
  ['alt', '替代文字'],
  ['title', '悬停提示'],
  ['placeholder', '输入提示'],
  ['value', '表单内容'],
] as const
const CSS_FIELDS = [
  ['font-family', '字体', 'appearance'],
  ['font-size', '字号', 'appearance'],
  ['font-weight', '字重', 'appearance'],
  ['line-height', '行高', 'appearance'],
  ['letter-spacing', '字距', 'appearance'],
  ['color', '文字颜色', 'appearance'],
  ['background-color', '背景颜色', 'appearance'],
  ['opacity', '透明度', 'appearance'],
  ['border', '边框', 'appearance'],
  ['border-radius', '圆角', 'appearance'],
  ['box-shadow', '阴影', 'appearance'],
  ['object-fit', '图片适应', 'appearance'],
  ['object-position', '图片裁切位置', 'appearance'],
  ['width', '宽度', 'layout'],
  ['height', '高度', 'layout'],
  ['min-width', '最小宽度', 'layout'],
  ['max-width', '最大宽度', 'layout'],
  ['min-height', '最小高度', 'layout'],
  ['max-height', '最大高度', 'layout'],
  ['margin', '外间距', 'layout'],
  ['padding', '内间距', 'layout'],
  ['gap', '间距', 'layout'],
  ['display', '排布方式', 'layout'],
  ['flex-direction', '排列方向', 'layout'],
  ['flex-wrap', '换行', 'layout'],
  ['align-items', '交叉方向对齐', 'layout'],
  ['justify-content', '排列方向对齐', 'layout'],
  ['grid-template-columns', '网格列', 'layout'],
  ['position', '定位方式', 'layout'],
] as const
export const SOURCE_INSPECTOR_ITEMS = [
  {
    key: 'source.text',
    tab: 'content',
    level: 'quick',
    group: 'common',
    label: '文字内容',
    control: 'textarea',
    appliesTo: 'all',
  },
  ...CONTENT_ATTRIBUTES.map(([attribute, label]) => ({
    key: `attribute.${attribute}`,
    tab: 'content' as const,
    level: 'quick' as const,
    group: 'common' as const,
    label,
    control: 'text' as const,
    appliesTo: 'all' as const,
  })),
  ...CSS_FIELDS.map(([property, label, tab]) => ({
    key: `css.${property}`,
    tab,
    level: 'quick' as const,
    group: 'common' as const,
    label,
    control: 'text' as const,
    appliesTo: 'all' as const,
  })),
  ...(['positionX', 'positionY', 'width', 'height', 'rotation'] as const).map((key) => ({
    key: `source.${key}`,
    tab: 'layout' as const,
    level: 'quick' as const,
    group: (key === 'positionX' || key === 'positionY'
      ? 'position'
      : 'transform') as FrontendWorkshopInspectorItem['group'],
    label:
      key === 'positionX'
        ? 'X (px)'
        : key === 'positionY'
          ? 'Y (px)'
          : key === 'width'
            ? '宽度 (px)'
            : key === 'height'
              ? '高度 (px)'
              : '旋转 (deg)',
    control: 'number' as const,
    numberCommit: 'change' as const,
    appliesTo: 'all' as const,
  })),
] as const satisfies readonly FrontendWorkshopInspectorItem[]

export const SOURCE_INSPECTOR_ADVANCED_KEYS = new Set([
  'attribute.alt',
  'attribute.title',
  'css.font-family',
  'css.font-weight',
  'css.line-height',
  'css.letter-spacing',
  'css.min-width',
  'css.max-width',
  'css.min-height',
  'css.max-height',
  'css.grid-template-columns',
  'css.position',
  'source.positionX',
  'source.positionY',
  'source.rotation',
])
export const SOURCE_INSPECTOR_CHOICES: Record<string, readonly (readonly [string, string])[]> = {
  'css.font-weight': [
    ['400', '常规'],
    ['500', '中等'],
    ['600', '半粗'],
    ['700', '加粗'],
  ],
  'css.object-fit': [
    ['contain', '完整显示'],
    ['cover', '裁切填满'],
    ['fill', '拉伸填满'],
    ['none', '原始大小'],
    ['scale-down', '仅缩小'],
  ],
  'css.flex-direction': [
    ['row', '横向'],
    ['column', '纵向'],
    ['row-reverse', '横向反排'],
    ['column-reverse', '纵向反排'],
  ],
  'css.flex-wrap': [
    ['nowrap', '不换行'],
    ['wrap', '自动换行'],
    ['wrap-reverse', '反向换行'],
  ],
  'css.align-items': [
    ['stretch', '拉伸'],
    ['flex-start', '起点'],
    ['center', '居中'],
    ['flex-end', '终点'],
    ['baseline', '文字基线'],
  ],
  'css.justify-content': [
    ['flex-start', '起点'],
    ['center', '居中'],
    ['flex-end', '终点'],
    ['space-between', '两端对齐'],
    ['space-around', '两侧留间距'],
    ['space-evenly', '等距'],
  ],
  'css.display': [
    ['block', '独占一行'],
    ['inline-block', '行内块'],
    ['flex', '弹性排列'],
    ['grid', '网格排列'],
    ['none', '隐藏'],
  ],
  'css.position': [
    ['static', '随页面排列'],
    ['relative', '相对原位置'],
    ['absolute', '相对容器'],
    ['fixed', '固定在视口'],
    ['sticky', '滚动吸附'],
  ],
}
