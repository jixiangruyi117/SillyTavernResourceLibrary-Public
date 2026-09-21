import { prepareStaticMarkupPreview, type StaticMarkupPreview } from './PreviewSafety'

export type RegexEffectKind = 'delete' | 'html' | 'dynamic' | 'capture' | 'text'

export interface RegexEffectSummary {
  kind: RegexEffectKind
  before: string
  after: string
  explanation: string
  staticPreview: StaticMarkupPreview
}

function stripRegexDelimiters(value: string): string {
  const source = value.trim()
  const match = source.match(/^\/([\s\S]*)\/[dgimsuvy]*$/)
  return match?.[1] ?? source
}

function readableTagExample(source: string): string | undefined {
  const normalized = source.replace(/\\\//g, '/')
  const match = normalized.match(/<([\p{L}][\p{L}\p{N}_:-]*)[^>]*>([\s\S]*?)<\/\1>/iu)
  if (!match) return undefined

  const labels = Array.from(
    match[2].matchAll(/([\p{L}\p{N}_-]{1,16})\s*\\?\[[^\]]*[:：][^\]]*\]/gu),
    (item) => item[1],
  ).filter(
    (label, index, values): label is string => Boolean(label) && values.indexOf(label) === index,
  )
  const summary = labels.length
    ? `${labels
        .slice(0, 6)
        .map((label) => `${label}：…`)
        .join('；')}${labels.length > 6 ? '；等' : ''}`
    : '内容'
  return `<${match[1]}>${summary}</${match[1]}>`
}

export function humanizeRegexMatch(value: string): string {
  const source = stripRegexDelimiters(value)
  const tagExample = readableTagExample(source)
  if (tagExample) return tagExample
  const protectedSource = source.replace(/\\\[/g, '\uE000').replace(/\\\]/g, '\uE001')

  const readable = protectedSource
    .replace(/\(\[\\s\\S\][+*?]\??\)/g, '…')
    .replace(/\(\.\*[+?]?\??\)/g, '…')
    .replace(/\(\?:([^()]*)\)/g, '$1')
    .replace(/\(\?<[^>]+>([^()]*)\)/g, '…')
    .replace(/\((?!\?)[^()]{1,160}\)/g, '…')
    .replace(/\[\\s\\S\][+*?]\??/g, '…')
    .replace(/\.\*[+?]?\??/g, '…')
    .replace(/\[\^?[^\]]+\][+*?]?/g, '…')
    .replace(/\\s(?:\{\d+(?:,\d*)?\}|[+*?])?/g, ' ')
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\([[\]{}()<>./\\])/g, '$1')
    .replace(/\uE000/g, '[')
    .replace(/\uE001/g, ']')
    .replace(/[+*?]\??/g, '')
    .replace(/\{\d+(?:,\d*)?\}/g, '')
    .replace(/[\^$]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(?:…\s*){2,}/g, '…')
    .trim()

  if (!readable) return /\\s/.test(source) ? '连续空白字符' : '匹配内容'
  return readable.length > 120 ? `${readable.slice(0, 117)}…` : readable
}

function readableReplacement(value: string): string {
  if (!value) return '空'
  if (!value.trim()) {
    if (value.includes('\n')) return '换行'
    return value.length === 1 ? '一个空格' : `${value.length} 个空格`
  }
  const replaced = value
    .replace(/\$\d+|\$<[^>]+>|\{\{match\}\}/gi, '示例内容')
    .replace(/```(?:html|css|xml|svg)?|```/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!replaced) return 'HTML / CSS 效果'
  return replaced.length > 120 ? `${replaced.slice(0, 117)}…` : replaced
}

export function summarizeRegexEffect(find: string, replace: string): RegexEffectSummary {
  const staticPreview = prepareStaticMarkupPreview(replace)
  const isDelete = replace.length === 0
  const hasCaptureReferences = /\$\d+|\$<[^>]+>|\{\{match\}\}/i.test(replace)
  const kind: RegexEffectKind = isDelete
    ? 'delete'
    : staticPreview.hasStaticContent
      ? 'html'
      : staticPreview.blockedScripts
        ? 'dynamic'
        : hasCaptureReferences
          ? 'capture'
          : 'text'
  const explanation = {
    delete: '匹配到的整段内容会被移除，不会显示在聊天或提示词中。',
    html: '匹配文本会被转换成 HTML / CSS 视觉组件；安全预览会移除脚本和联网内容，原文件仍完整保留。',
    dynamic:
      '替换内容依赖 JavaScript 或远程页面，资源库不会执行；原文件仍完整保留，可查看代码与风险说明。',
    capture: '替换结果会保留捕获到的部分内容，并按新的顺序或格式重新组合。',
    text: replace.trim() ? '匹配内容会被替换为固定文本。' : '匹配内容会被替换为空白。',
  }[kind]

  return {
    kind,
    before: humanizeRegexMatch(find),
    after:
      kind === 'html'
        ? 'HTML / CSS 组件'
        : kind === 'dynamic'
          ? '动态脚本页面（不执行）'
          : readableReplacement(replace),
    explanation,
    staticPreview,
  }
}
