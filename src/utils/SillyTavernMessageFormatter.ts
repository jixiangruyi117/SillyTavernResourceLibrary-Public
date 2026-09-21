import { parse, stringify } from '@adobe/css-tools'
import createDOMPurify from 'dompurify'
import showdown from 'showdown'

import {
  findRenderCompatibilityFrontendBlocks,
  isRenderCompatibilityFrontendPre,
} from './RenderCompatibilityFrontend'

const STYLE_ELEMENT_PATTERN = /<style>([\s\S]+?)<\/style>/gim
const ENCODED_STYLE_PATTERN = /<custom-style>([\s\S]+?)<\/custom-style>/gm
const EXECUTABLE_MARKUP_PATTERN = /<script\b|\son[a-z]+\s*=|javascript\s*:/i
const MESSAGE_SELECTOR_PREFIX = '.mes_text '

interface CssDeclaration {
  value?: string
}

interface CssRuleNode {
  selectors?: string[]
  declarations?: CssDeclaration[]
  rules?: CssRuleNode[]
  type?: string
}

export interface SillyTavernMessageFormatOptions {
  allowExternalMedia?: boolean
}

export interface SillyTavernCoreMessageFormatResult {
  html: string
  usedMarkdown: boolean
  blockedScripts: boolean
}

export interface SillyTavernMessageFormatResult extends SillyTavernCoreMessageFormatResult {
  frontendBlockCount: number
  frontendBlocks: string[]
  standaloneFrontendDocument: false
}

function createSingleUnderscoreExtension(): showdown.ShowdownExtension[] {
  const protectedElement = '<(?:code|style)(?:\\s+[^>]*)?>[\\s\\S]*?<\\/(?:code|style)>'
  const emphasizedText = '\\b(?<!_)_(?!_)(.*?)(?<!_)_(?!_)\\b'
  return [
    {
      type: 'output',
      regex: new RegExp(`(${protectedElement})|${emphasizedText}`, 'gi'),
      replace(match: string, protectedContent: string, content: string) {
        return protectedContent || !content ? match : `<em>${content}</em>`
      },
    },
  ]
}

function createMessageMarkdownConverter(): showdown.Converter {
  const options: showdown.ConverterOptions = {
    emoji: true,
    tables: true,
    underline: true,
    strikethrough: true,
    simpleLineBreaks: true,
    parseImgDimensions: true,
    literalMidWordUnderscores: true,
    disableForced4SpacesIndentedSublists: true,
    extensions: [createSingleUnderscoreExtension()],
  }
  return new showdown.Converter(options)
}

const markdownConverter = createMessageMarkdownConverter()
const purifier = typeof window === 'undefined' ? undefined : createDOMPurify(window)
let permitExternalMedia = false

function normalizeMessageClassNames(value: string): string {
  const preservedPrefixes = ['fa-', 'note-']
  return value
    .split(' ')
    .map((className) => {
      if (
        className === 'monospace' ||
        preservedPrefixes.some((prefix) => className.startsWith(prefix))
      ) {
        return className
      }
      return `custom-${className}`
    })
    .join(' ')
}

function replaceUnknownElementLineBreaks(node: Element): void {
  node.innerHTML = node.innerHTML.trim()
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  const multilineNodes: Text[] = []
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const textNode = current as Text
    if (textNode.data.includes('\n') && !textNode.parentElement?.closest('pre')) {
      multilineNodes.push(textNode)
    }
  }

  for (const textNode of multilineNodes) {
    const fragment = document.createDocumentFragment()
    const lines = textNode.data.split('\n')
    lines.forEach((line, index) => {
      if (line) fragment.append(document.createTextNode(line))
      if (index + 1 < lines.length) fragment.append(document.createElement('br'))
    })
    textNode.replaceWith(fragment)
  }
}

function isExternalUrl(value: string): boolean {
  const hasNetworkScheme = value.includes('://') || value.startsWith('//')
  return hasNetworkScheme && !value.startsWith(window.location.origin)
}

function removeBlockedExternalMedia(node: Element): void {
  if (permitExternalMedia) return
  const mediaTags = new Set(['AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'EMBED', 'OBJECT', 'IMG'])
  if (!mediaTags.has(node.tagName)) return

  const candidates = ['src', 'data'].flatMap((attribute) => {
    const value = node.getAttribute(attribute)
    return value ? [value] : []
  })
  const srcset = node.getAttribute('srcset')
  if (srcset) {
    candidates.push(...srcset.split(',').map((part) => part.trim().split(/\s+/, 1)[0] ?? ''))
  }
  if (candidates.some(isExternalUrl)) node.remove()
}

purifier?.addHook('afterSanitizeAttributes', (node) => {
  if (!('target' in node)) return
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener')
})

purifier?.addHook('uponSanitizeAttribute', (_node, attribute, config) => {
  if (!(config as Record<string, unknown>).MESSAGE_SANITIZE) return
  if (attribute.attrName === 'class' && attribute.attrValue) {
    attribute.attrValue = normalizeMessageClassNames(attribute.attrValue)
  }
})

purifier?.addHook('uponSanitizeElement', (node, _data, config) => {
  if (!(config as Record<string, unknown>).MESSAGE_SANITIZE) return
  if (node instanceof window.HTMLUnknownElement) replaceUnknownElementLineBreaks(node)
  if (node instanceof window.Element) removeBlockedExternalMedia(node)
})

function prefixClassSelector(part: string): string {
  return part.replace(/\.([\w-]+)/g, (token, className: string) => {
    return className.startsWith('custom-') ? token : `.custom-${className}`
  })
}

function normalizeSelector(selector: string): string {
  const nestedSelectorFunctions = /:(has|not|where|is|matches|any)\(([^)]+)\)/g
  const nestedNormalized = selector.replace(
    nestedSelectorFunctions,
    (_token, functionName: string, body: string) =>
      `:${functionName}(${prefixClassSelector(body)})`,
  )
  return nestedNormalized.split(/\s+/).map(prefixClassSelector).join(' ')
}

function transformStyleTree(root: CssRuleNode, allowExternalMedia: boolean): void {
  const queue: CssRuleNode[] = [root]
  while (queue.length) {
    const node = queue.shift()
    if (!node) continue

    if (node.selectors) {
      node.selectors = node.selectors.map(
        (selector) => MESSAGE_SELECTOR_PREFIX + normalizeSelector(selector),
      )
    }
    if (!allowExternalMedia && node.declarations) {
      node.declarations = node.declarations.filter(
        (declaration) =>
          typeof declaration.value !== 'string' || !declaration.value.includes('://'),
      )
    }
    if (node.rules) {
      node.rules = node.rules.filter((child) => child.type !== 'import')
      queue.push(...node.rules)
    }
  }
}

export function scopeSillyTavernMessageStyles(
  source: string,
  options: SillyTavernMessageFormatOptions = {},
): string {
  return source.replace(STYLE_ELEMENT_PATTERN, (_element, cssText: string) => {
    try {
      const ast = parse(cssText)
      if (ast.stylesheet) {
        transformStyleTree(ast.stylesheet as CssRuleNode, options.allowExternalMedia === true)
      }
      return `<style>${stringify(ast)}</style>`
    } catch (error) {
      return `CSS ERROR: ${String(error)}`
    }
  })
}

function protectStyles(source: string): string {
  return source.replace(
    STYLE_ELEMENT_PATTERN,
    (_element, cssText: string) => `<custom-style>${encodeURIComponent(cssText)}</custom-style>`,
  )
}

function restoreStyles(source: string, options: SillyTavernMessageFormatOptions): string {
  return source.replace(ENCODED_STYLE_PATTERN, (_element, encodedCss: string) => {
    try {
      const cssText = decodeURIComponent(encodedCss).replaceAll('<br/>', '')
      return scopeSillyTavernMessageStyles(`<style>${cssText}</style>`, options)
    } catch (error) {
      return `CSS ERROR: ${String(error)}`
    }
  })
}

function sanitizeMessage(source: string, options: SillyTavernMessageFormatOptions): string {
  const protectedSource = protectStyles(source)
  if (!purifier) {
    const conservativeFallback = protectedSource
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript\s*:/gi, '')
    return restoreStyles(conservativeFallback, options)
  }

  permitExternalMedia = options.allowExternalMedia === true
  try {
    const result = purifier.sanitize(protectedSource, {
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      RETURN_TRUSTED_TYPE: false,
      MESSAGE_SANITIZE: true,
      ADD_TAGS: ['custom-style'],
    } as Parameters<typeof purifier.sanitize>[1])
    return restoreStyles(String(result), options)
  } finally {
    permitExternalMedia = false
  }
}

const QUOTE_PAIRS = [
  ['"', '"'],
  ['“', '”'],
  ['«', '»'],
  ['「', '」'],
  ['『', '』'],
  ['＂', '＂'],
] as const

function wrapDialogueQuotes(source: string): string {
  const protectedOrQuoted = new RegExp(
    [
      '<style>[\\s\\S]*?<\\/style>',
      '```[\\s\\S]*?```',
      '~~~[\\s\\S]*?~~~',
      '``[\\s\\S]*?``',
      '`[\\s\\S]*?`',
      ...QUOTE_PAIRS.map(([left, right]) => `${left}.*?${right}`),
    ].join('|'),
    'gim',
  )
  return source.replace(protectedOrQuoted, (match) => {
    const pair = QUOTE_PAIRS.find(
      ([left, right]) => match.startsWith(left) && match.endsWith(right),
    )
    return pair ? `<q>${match}</q>` : match
  })
}

function protectAttributeQuotes(source: string): string {
  return source.replace(/<([^>]+)>/g, (_tag, contents: string) => {
    return `<${contents.replaceAll('"', '\ufffe')}>`
  })
}

function transformCodeElements(source: string, transform: (code: string) => string): string {
  return source.replace(/<code(.*)>[\s\S]*?<\/code>/g, (code) => transform(code))
}

function renderMarkdown(source: string): string {
  let prepared = protectAttributeQuotes(source)
  prepared = wrapDialogueQuotes(prepared).replaceAll('\ufffe', '"')
  prepared = prepared.replaceAll('\\begin{align*}', '$$').replaceAll('\\end{align*}', '$$')

  let html = markdownConverter.makeHtml(prepared)
  html = transformCodeElements(html, (code) => code.replaceAll('\n', '\u0000'))
  html = html.replaceAll('\u0000', '\n').trim()
  return transformCodeElements(html, (code) => code.replaceAll('&amp;', '&'))
}

export function formatSillyTavernCoreMessage(
  source: string,
  options: SillyTavernMessageFormatOptions = {},
): SillyTavernCoreMessageFormatResult {
  if (!source) return { html: '', usedMarkdown: false, blockedScripts: false }
  const rendered = renderMarkdown(source)
  return {
    html: sanitizeMessage(rendered, options),
    usedMarkdown: true,
    blockedScripts: EXECUTABLE_MARKUP_PATTERN.test(rendered),
  }
}

export function formatSillyTavernMessage(
  source: string,
  options: SillyTavernMessageFormatOptions = {},
): SillyTavernMessageFormatResult {
  const core = formatSillyTavernCoreMessage(source, options)
  const frontend = findRenderCompatibilityFrontendBlocks(core.html)
  return {
    ...core,
    html: frontend.html,
    frontendBlockCount: frontend.blocks.length,
    frontendBlocks: frontend.blocks,
    standaloneFrontendDocument: false,
  }
}

export {
  isRenderCompatibilityFrontendPre as isTavernHelperFrontendContent,
  findRenderCompatibilityFrontendBlocks as wrapTavernHelperFrontendBlocks,
}
