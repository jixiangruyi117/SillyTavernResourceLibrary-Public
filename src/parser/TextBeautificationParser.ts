import type { ParsedResource } from '../types/Import'
import { RESOURCE_TYPE } from '../types/Resource'
import type { ResourceParser } from './ResourceParser'

export const TEXT_BEAUTIFICATION_PARSER_VERSION = 1

const CSS_RULE_PATTERN = /(?:^|})\s*[^@{}][^{}]{0,240}\{[^{}]*:[^{}]*\}/gms
const CSS_DECLARATION_PATTERN = /(?:^|[;{])\s*[-\w]+\s*:\s*[^;{}]+/g
const CSS_COLOR_PATTERN = /#[\da-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/gi

function readDisplayName(content: string, fallbackName: string): string {
  const annotatedName = content.match(
    /\/\*\s*(?:@name|name|名称)\s*[:：]\s*([^\r\n*]{1,100})\s*\*\//i,
  )?.[1]
  return annotatedName?.trim() || fallbackName
}

function summarizeCss(content: string): {
  selectorCount: number
  declarationCount: number
  customPropertyCount: number
  colors: string[]
  hasImport: boolean
  hasExternalAssets: boolean
} {
  const colors = Array.from(
    new Set((content.match(CSS_COLOR_PATTERN) ?? []).map((value) => value.trim())),
  ).slice(0, 16)
  return {
    selectorCount: content.match(CSS_RULE_PATTERN)?.length ?? 0,
    declarationCount: content.match(CSS_DECLARATION_PATTERN)?.length ?? 0,
    customPropertyCount: content.match(/--[-\w]+\s*:/g)?.length ?? 0,
    colors,
    hasImport: /@import\s/i.test(content),
    hasExternalAssets: /url\s*\(/i.test(content),
  }
}

export class TextBeautificationParser implements ResourceParser {
  supports(file: File): boolean {
    const name = file.name.toLocaleLowerCase()
    return file.type === 'text/css' || name.endsWith('.css') || name.endsWith('.txt')
  }

  async parse(file: File): Promise<ParsedResource> {
    const content = await file.text()
    if (!content.trim()) throw new Error('美化文件内容为空')

    const summary = summarizeCss(content)
    const isTextFile = file.name.toLocaleLowerCase().endsWith('.txt')
    const hasStrongCssShape = summary.selectorCount > 0 && summary.declarationCount > 0
    if (!hasStrongCssShape) {
      throw new Error(
        isTextFile ? 'TXT 内容不像 CSS 美化片段，未自动归类' : 'CSS 文件中未找到可预览的样式规则',
      )
    }

    const fallbackName = file.name.replace(/\.(?:css|txt)$/i, '')
    const sourceLabel = isTextFile ? 'TXT 中的 CSS 美化片段' : 'CSS 美化片段'
    return {
      type: RESOURCE_TYPE.BEAUTIFICATION,
      name: readDisplayName(content, fallbackName),
      description: `${sourceLabel} · ${summary.selectorCount} 个规则 · ${summary.declarationCount} 项声明`,
      metadata: {
        format: isTextFile ? 'text' : 'css',
        parserVersion: TEXT_BEAUTIFICATION_PARSER_VERSION,
        detectedVariant: 'customCss',
        itemCount: summary.selectorCount,
        cssSummary: summary,
        beautificationPreview: {
          colors: summary.colors,
          customCssLength: content.length,
        },
      },
    }
  }
}
