import { parse } from '@adobe/css-tools'
import {
  type StatusField,
  type WorkshopInteraction,
  type WorkshopBlock,
  type WorkshopTextStyleRequirement,
  type WorkshopConditionRule,
  type WorkshopCssNode,
} from '../types/FrontendWorkshopLegacy'
import { escapeRegex, UNSAFE_PATH_SEGMENTS } from './FrontendWorkshopLegacyValues'
import { normalizeApprovedResourceUrl } from './FrontendWorkshopLegacyResources'

export function formatWorkshopValidationIssues(issues: string[]): string {
  const normalizedIssues = Array.from(new Set(issues.map((issue) => issue.trim()).filter(Boolean)))
  if (!normalizedIssues.length) return '生成结果没有通过本地完整校验'
  if (normalizedIssues.length === 1) return normalizedIssues[0]!
  return `发现 ${normalizedIssues.length} 个问题：\n${normalizedIssues
    .map((issue, index) => `${index + 1}. ${issue}`)
    .join('\n')}`
}

export class WorkshopValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    const normalizedIssues = Array.from(
      new Set(issues.map((issue) => issue.trim()).filter(Boolean)),
    )
    super(formatWorkshopValidationIssues(normalizedIssues))
    this.name = 'WorkshopValidationError'
    this.issues = normalizedIssues
  }
}

export const CSS_DYNAMIC_PSEUDO_PATTERN =
  /:(?:active|any-link|autofill|checked|disabled|empty|enabled|focus|focus-visible|focus-within|fullscreen|hover|indeterminate|invalid|link|optional|placeholder-shown|read-only|read-write|required|target|user-invalid|valid|visited)\b/gi

export const CSS_PSEUDO_ELEMENT_PATTERN =
  /::[a-z-]+(?:\([^)]*\))?|:(?:after|before|first-letter|first-line)\b/gi

export const CSS_RUNTIME_ATTRIBUTE_PATTERN =
  /\[(?:data-srl-condition-active|open|checked|disabled|aria-expanded)(?:\s*[*^$|~]?=\s*(?:"[^"]*"|'[^']*'|[^\]]+))?\]/gi

export function collectWorkshopCssSelectors(nodes: WorkshopCssNode[], output: string[]): void {
  nodes.forEach((node) => {
    if (node.type === 'rule' && Array.isArray(node.selectors)) output.push(...node.selectors)
    if (Array.isArray(node.rules)) collectWorkshopCssSelectors(node.rules, output)
  })
}

export function stripBalancedPseudoFunctions(selector: string): string {
  let result = ''
  for (let index = 0; index < selector.length; index += 1) {
    if (selector[index] !== ':') {
      result += selector[index]
      continue
    }
    const nameMatch = selector.slice(index).match(/^:([a-z-]+)\(/i)
    if (!nameMatch) {
      result += selector[index]
      continue
    }
    let cursor = index + nameMatch[0].length
    let depth = 1
    let quote = ''
    for (; cursor < selector.length && depth > 0; cursor += 1) {
      const character = selector[cursor]!
      if (quote) {
        if (character === quote && selector[cursor - 1] !== '\\') quote = ''
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        continue
      }
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
    }
    index = cursor - 1
  }
  return result
}

export function cssSelectorProbe(selector: string): string {
  return stripBalancedPseudoFunctions(selector)
    .replace(CSS_PSEUDO_ELEMENT_PATTERN, '')
    .replace(CSS_DYNAMIC_PSEUDO_PATTERN, '')
    .replace(CSS_RUNTIME_ATTRIBUTE_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function selectorTargetsRoot(
  fragment: DocumentFragment,
  root: Element,
  selector: string,
): boolean {
  try {
    if (root.matches(selector)) return true
    return Array.from(fragment.querySelectorAll(selector)).some(
      (element) =>
        (element === root || root.contains(element)) &&
        element.tagName !== 'STYLE' &&
        !element.closest('style'),
    )
  } catch {
    return false
  }
}

export function collectCssSelectorsTargetMarkupIssues(fragment: DocumentFragment): string[] {
  const issues: string[] = []
  const contentNodes = Array.from(fragment.childNodes).filter((node) => {
    if (node.nodeType === 3) return Boolean(node.textContent?.trim())
    if (node.nodeType === 8) return false
    return !(node instanceof Element && node.tagName === 'STYLE')
  })
  if (contentNodes.length !== 1 || !(contentNodes[0] instanceof Element)) {
    issues.push('模板必须只有一个状态栏根容器；<style> 之外不能出现并列根节点或散落文字')
    return issues
  }
  const root = contentNodes[0]
  const rootClasses = Array.from(root.classList)
  if (!rootClasses.length) {
    issues.push('状态栏根容器必须设置独有 class，用于限制全部 CSS 作用域')
    return issues
  }
  const selectors: string[] = []
  for (const style of Array.from(fragment.querySelectorAll('style'))) {
    try {
      const stylesheet = parse(style.textContent ?? '', {
        silent: false,
      }) as unknown as WorkshopCssNode
      collectWorkshopCssSelectors(stylesheet.stylesheet?.rules ?? [], selectors)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '未知 CSS 语法错误'
      issues.push(`模板内联 CSS 无法解析：${detail}`)
    }
  }
  for (const selector of selectors) {
    const hasRootScope = rootClasses.some((className) =>
      new RegExp(`\\.${escapeRegex(className)}(?![\\w-])`).test(selector),
    )
    if (!hasRootScope) {
      issues.push(`CSS 选择器没有限制在状态栏根 class 下：${selector}`)
      continue
    }
    if (selectorTargetsRoot(fragment, root, selector)) continue
    const probe = cssSelectorProbe(selector)
    if (probe && selectorTargetsRoot(fragment, root, probe)) continue
    issues.push(`CSS 选择器在实际模板中没有目标：${selector}`)
  }
  return issues
}

export function collectSafeFieldContractIssues(fields: StatusField[]): string[] {
  const issues: string[] = []
  for (const field of fields) {
    if (/[<>\r\n]/.test(field.label))
      issues.push(`字段名“${field.label}”包含状态块保留字符，请移除尖括号或换行`)
    if (/[<>\r\n]/.test(field.example))
      issues.push(`字段“${field.label}”的示例值必须是单行纯文本，不能包含尖括号标签`)
    const unsafeSegment = field.path
      .split('.')
      .map((segment) => segment.trim().toLocaleLowerCase())
      .find((segment) => UNSAFE_PATH_SEGMENTS.has(segment))
    if (unsafeSegment) issues.push(`字段“${field.label}”的变量路径包含保留名称：${unsafeSegment}`)
  }
  return issues
}

export function hasWorkshopTextureLayer(template: string): boolean {
  const gradientCount = template.match(/(?:linear|radial|conic)-gradient\s*\(/gi)?.length ?? 0
  return (
    /repeating-(?:linear|radial|conic)-gradient\s*\(/i.test(template) ||
    /(?:radial|conic)-gradient\s*\(/i.test(template) ||
    gradientCount >= 2 ||
    /(?:background|mix)-blend-mode\s*:/i.test(template) ||
    /background-image\s*:\s*url\s*\(/i.test(template)
  )
}

export function normalizeWorkshopLocalSvgReferences(template: string): string {
  return template.replace(
    /url\(\s*(['"]?)%23([a-z_][\w.-]*)\1\s*\)/gi,
    (_match, _quote: string, id: string) => `url("#${id}")`,
  )
}

export function assertSafeTemplate(
  template: string,
  fields: StatusField[],
  interactions: WorkshopInteraction[],
  blocks: WorkshopBlock[],
  imageUrls: string[],
  fontUrls: string[],
  textStyles: WorkshopTextStyleRequirement[],
  conditionRules: WorkshopConditionRule[],
  textureRequired = false,
): void {
  const issues = collectSafeFieldContractIssues(fields)
  const structurallyInvalidControlIds = new Set<string>()
  if (/<\s+[!/a-z]/i.test(template) || /<\/\s+[a-z]/i.test(template)) {
    issues.push('模板包含畸形 HTML 标签；标签名必须紧跟 < 或 </，禁止写成 < img、< div 或 </ div>')
  }
  if (!/<(?:section|div|article)\b/i.test(template))
    issues.push('AI 返回的模板没有状态栏 HTML 容器')
  if (
    /<(?:script|iframe|object|embed|html|head|body|base|link|meta|audio|video|source|track)\b/i.test(
      template,
    )
  )
    issues.push('模板包含脚本、iframe 或完整网页标签，不能作为稳定的酒馆消息状态栏')
  if (/\son\w+\s*=/i.test(template)) issues.push('模板包含内联事件，不能作为静态状态栏')
  if (/javascript\s*:|expression\s*\(|-moz-binding\s*:/i.test(template))
    issues.push('模板包含可执行 CSS/URL，不能作为静态状态栏')
  if (/@import\b/i.test(template)) {
    issues.push('模板禁止使用 @import；外部字体必须使用 HTTPS @font-face 直链')
  }
  if (/\bposition\s*:\s*fixed\b/i.test(template))
    issues.push('模板禁止使用 position: fixed，以免脱离酒馆消息楼层')
  if (textureRequired && !hasWorkshopTextureLayer(template)) {
    issues.push(
      '用户明确要求了纹理，但模板只有实色、单层线性渐变或阴影；请在状态栏根容器或伪元素中加入可见且低对比的 CSS 纹理层，例如 repeating/radial/conic gradient、多层渐变或 HTTPS 纹理图片',
    )
  }
  if (
    /\b(?:width|height|min-width|max-width|min-height|max-height|top|right|bottom|left)\s*:\s*-?\d+(?:\.\d+)?\s*\/\s*-?\d/i.test(
      template,
    )
  )
    issues.push('模板包含浏览器无法执行的尺寸除法；请改成合法长度、百分比或 calc()')
  const cleanTemplateUrl = (value: string): string => value.replace(/[;,]+$/, '')
  const externalResourceScanTemplate = template.replace(
    /\sxmlns(?::[\w-]+)?\s*=\s*(['"])http:\/\/www\.w3\.org\/2000\/svg\1/gi,
    '',
  )
  const unsafeRemoteUrl = Array.from(
    externalResourceScanTemplate.matchAll(/(?:https?:|data:|blob:|file:|ftp:)[^\s"'<>\\)]*/gi),
    (match) => cleanTemplateUrl(match[0]),
  ).find((url) => !/^https:\/\//i.test(url))
  if (unsafeRemoteUrl) {
    issues.push(
      `模板资源协议只允许 HTTPS 外链；data:、blob: 等内嵌协议不允许使用：${unsafeRemoteUrl.slice(0, 100)}`,
    )
  }
  const fragment = (() => {
    if (typeof document === 'undefined') return undefined
    const parsed = document.createElement('template')
    parsed.innerHTML = template
    return parsed.content
  })()
  const cssImageUrls = new Set(
    Array.from(template.matchAll(/url\(\s*(['"]?)(https:\/\/[^)'"\s]+)\1\s*\)/gi), (match) =>
      normalizeApprovedResourceUrl(match[2] ?? ''),
    ),
  )
  const elementImageUrls = new Set(
    fragment
      ? Array.from(
          fragment.querySelectorAll('img[src]'),
          (image) => image.getAttribute('src') ?? '',
        )
      : Array.from(
          template.matchAll(/<img\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi),
          (match) => match[1],
        ),
  )
  const cssUrls = Array.from(
    template.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi),
    (match) => match[2] ?? '',
  )
  const unsafeCssUrl = cssUrls.find((url) => !/^https:\/\//i.test(url) && !/^#[\w-]+$/.test(url))
  if (unsafeCssUrl)
    issues.push(`模板 CSS url() 只允许 HTTPS 外链或页内片段：${unsafeCssUrl.slice(0, 100)}`)
  const unsafeElementImage = Array.from(elementImageUrls).find((url) => !/^https:\/\//i.test(url))
  if (unsafeElementImage)
    issues.push(`模板图片 src 只允许 HTTPS 外链：${unsafeElementImage.slice(0, 100)}`)
  const elementImageUrlSet = new Set(Array.from(elementImageUrls).map(normalizeApprovedResourceUrl))
  const missingImageUrl = imageUrls.find((url) => {
    const normalizedUrl = normalizeApprovedResourceUrl(url)
    return !elementImageUrlSet.has(normalizedUrl) && !cssImageUrls.has(normalizedUrl)
  })
  if (missingImageUrl) {
    issues.push(
      `模板没有把图片直链写入合法的 <img src="…"> 或 CSS url(…)：${missingImageUrl.slice(0, 100)}`,
    )
  }
  const missingFontUrl = fontUrls.find((url) => !template.includes(url))
  if (missingFontUrl) issues.push(`模板没有使用你指定的字体直链：${missingFontUrl.slice(0, 100)}`)
  if (fontUrls.length && !/@font-face\b/i.test(template))
    issues.push('你选择了自定义字体，但 AI 模板没有生成 @font-face')
  fields.forEach((_field, index) => {
    const placeholder = `{{field_${index + 1}}}`
    const occurrenceCount = template.split(placeholder).length - 1
    if (occurrenceCount === 0) issues.push(`模板漏掉了第 ${index + 1} 个字段占位符`)
    if (occurrenceCount > 1)
      issues.push(
        `第 ${index + 1} 个字段占位符出现了 ${occurrenceCount} 次；每个字段必须且只能出现一次`,
      )
  })
  if (fragment) {
    for (const element of Array.from(fragment.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (/{{field_\d+}}/.test(attribute.value)) {
          issues.push(
            `字段占位符不能写入 ${element.tagName.toLowerCase()} 的 ${attribute.name} 属性；只能放在可见文本节点中`,
          )
        }
      }
    }
    const visiblePlaceholderIndexes = new Set<number>()
    const walker = document.createTreeWalker(fragment, 4)
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text
      if (textNode.parentElement?.closest('style')) continue
      for (const match of textNode.data.matchAll(/{{field_(\d+)}}/g)) {
        visiblePlaceholderIndexes.add(Number(match[1]))
      }
    }
    fields.forEach((_field, index) => {
      if (!visiblePlaceholderIndexes.has(index + 1)) {
        issues.push(`第 ${index + 1} 个字段占位符必须位于可见文本节点中`)
      }
    })
  }
  if (
    interactions.includes('collapsible') &&
    (!/<details\b/i.test(template) || !/<summary\b/i.test(template))
  ) {
    issues.push('你选择了折叠分组，但 AI 模板没有使用 details / summary')
  }
  if (
    interactions.includes('motion') &&
    (!/@keyframes\b/i.test(template) ||
      !/@media\s*\(prefers-reduced-motion:\s*reduce\)/i.test(template))
  ) {
    issues.push('你选择了短时动效，但 AI 模板缺少动效或“减少动态效果”兼容')
  }
  if (
    interactions.includes('theme-toggle') &&
    (!/<input\b[^>]*type\s*=\s*["']checkbox["']/i.test(template) || !/:checked\b/i.test(template))
  ) {
    issues.push('你选择了日夜切换，但 AI 模板缺少 checkbox 与 :checked 的无脚本结构')
  }
  if (
    interactions.includes('tabs') &&
    (!/<input\b[^>]*type\s*=\s*["']radio["']/i.test(template) || !/:checked\b/i.test(template))
  ) {
    issues.push('你选择了分页标签，但 AI 模板缺少 radio 与 :checked 的无脚本结构')
  }
  const missingBlock = blocks.find((block) => !template.includes(`data-srl-block="${block}"`))
  if (missingBlock) issues.push(`AI 模板漏掉了组件积木：${missingBlock}`)
  if (blocks.includes('image-banner') && !imageUrls.length)
    issues.push('你选择了图片横幅积木，但还没有添加可写入成品的 HTTPS 图片直链')
  if (
    blocks.includes('character-tabs') &&
    (!/<input\b[^>]*type\s*=\s*["']radio["']/i.test(template) || !/:checked\b/i.test(template))
  )
    issues.push('多角色切换积木没有生成可操作的 radio + :checked 分页')
  if (fragment && (interactions.includes('tabs') || blocks.includes('character-tabs'))) {
    const radios = Array.from(fragment.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    const invalidRadio = radios.find((radio) => {
      const label = radio.nextElementSibling
      return !radio.id || label?.tagName !== 'LABEL' || label.getAttribute('for') !== radio.id
    })
    if (invalidRadio) {
      if (invalidRadio.id) structurallyInvalidControlIds.add(invalidRadio.id)
      issues.push(
        '分页 radio 必须各自紧邻对应的 <label for="同一 id">，确保 input:checked + label 在真实酒馆中能够命中',
      )
    }
    const ids = radios.map((radio) => radio.id)
    if (new Set(ids).size !== ids.length) issues.push('分页 radio 的 id 必须唯一')
    if (radios.length > 1) {
      const names = new Set(radios.map((radio) => radio.name).filter(Boolean))
      if (names.size !== 1 || radios.some((radio) => !radio.name))
        issues.push('同一组分页 radio 必须使用同一个非空 name，确保标签互斥切换')
    }
    if (radios.filter((radio) => radio.checked).length !== 1)
      issues.push('分页 radio 必须且只能有一个默认 checked，确保首次显示一个面板')
  }
  if (fragment && interactions.includes('theme-toggle')) {
    const checkboxes = Array.from(
      fragment.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    )
    const invalidCheckbox = checkboxes.find((checkbox) => {
      const label = checkbox.nextElementSibling
      return !checkbox.id || label?.tagName !== 'LABEL' || label.getAttribute('for') !== checkbox.id
    })
    if (invalidCheckbox) {
      if (invalidCheckbox.id) structurallyInvalidControlIds.add(invalidCheckbox.id)
      issues.push(
        '主题 checkbox 必须紧邻对应的 <label for="同一 id">，确保 input:checked + label 在真实酒馆中能够命中',
      )
    }
  }
  if (
    blocks.includes('long-collapse') &&
    (!/<details\b/i.test(template) || !/<summary\b/i.test(template))
  )
    issues.push('长栏折叠积木没有生成可操作的 details / summary')
  const missingTextStyle = textStyles.find(
    (style) => !template.includes(`data-srl-text-style="${style.id}"`),
  )
  if (missingTextStyle) issues.push(`AI 模板漏掉了自定义文字样式：${missingTextStyle.label}`)
  const missingCondition = conditionRules.find(
    (rule) => !template.includes(`data-srl-condition="${rule.id}"`),
  )
  if (missingCondition) issues.push(`AI 模板漏掉了条件样式目标：${missingCondition.fieldLabel}`)
  if (!/<style\b/i.test(template)) issues.push('AI 返回的模板缺少内联 <style>')
  if (fragment) {
    const selectorIssues = collectCssSelectorsTargetMarkupIssues(fragment)
    const cascadingSelectorIssues = selectorIssues.filter((issue) =>
      Array.from(structurallyInvalidControlIds).some((id) => issue.includes(`#${id}`)),
    )
    issues.push(...selectorIssues.filter((issue) => !cascadingSelectorIssues.includes(issue)))
    if (cascadingSelectorIssues.length) {
      issues.push(
        `交互控件 DOM 结构不成立；已省略 ${cascadingSelectorIssues.length} 条由该错误连带失效的 CSS 选择器，请先让 input、label 与受控面板的兄弟层级匹配。`,
      )
    }
  }
  if (issues.length) throw new WorkshopValidationError(issues)
}
