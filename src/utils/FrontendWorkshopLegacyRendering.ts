import {
  type StatusField,
  type WorkshopDataMode,
  type WorkshopConditionOperator,
  type WorkshopConditionRule,
  type FrontendWorkshopArtifact,
  type WorkshopSampleIssue,
} from '../types/FrontendWorkshopLegacy'
import {
  escapeRegex,
  escapeHtml,
  setPath,
  getPath,
  unwrapMvuValue,
  applyTavernRegex,
} from './FrontendWorkshopLegacyValues'
import { assertSafeTemplate } from './FrontendWorkshopLegacyValidation'

export function buildFindRegex(fields: StatusField[], dataMode: WorkshopDataMode): string {
  if (dataMode === 'mvu') {
    return `/<StatusPlaceHolder\\s*\\/\\s*>|<StatusPlaceHolder>\\s*<\\/StatusPlaceHolder>/gi`
  }
  const lines = fields
    .map(
      (field) =>
        `${escapeRegex(field.label)}[ \\t]*[：:][ \\t]*([^\\r\\n<]*?\\S[^\\r\\n<]*?)[ \\t]*(?=\\r?\\n|<\\/StatusPlaceHolder>)`,
    )
    .join('\\s*(?:\\r?\\n)+\\s*')
  return `/<StatusPlaceHolder>\\s*${lines}\\s*<\\/StatusPlaceHolder>/s`
}

export function buildPrompt(fields: StatusField[], dataMode: WorkshopDataMode): string {
  if (dataMode === 'mvu') {
    return `【MVU 状态栏占位协议｜必须执行】
本条目只负责显示状态栏，不替代角色卡现有的 [InitVar]、变量更新规则或 <UpdateVariable> 协议。
每次回复时，先正常完成正文并按角色卡原有 MVU 规则输出变量更新；然后在回复末尾原样输出且只输出一次：
<StatusPlaceHolder/>

不要使用 Markdown 代码围栏，不要改标签名，不要在占位符内部填写字段。`
  }
  const body = fields.map((field) => `${field.label}: [${field.label}当前值]`).join('\n')
  return `【状态栏输出协议｜必须执行】
每次回复时，先正常完成正文；然后在回复末尾原样输出且只输出一次下面的状态块。
不要使用 Markdown 代码围栏，不要改标签名，不要增删字段，不要调整字段顺序。
外层开标签 <StatusPlaceHolder> 与闭标签 </StatusPlaceHolder> 必须完整保留；下面的纯文本限制只作用于冒号后的字段值，不作用于这两个外层标签。
每个字段值只能占一行；若值未知，填“未知”，不得留空。字段值只能填写单行纯文本，不要在字段值内部嵌入 HTML/XML 标签或其他尖括号标记。

<StatusPlaceHolder>
${body}
</StatusPlaceHolder>`
}

export function buildMvuSample(fields: StatusField[]): string {
  const statData: Record<string, unknown> = {}
  fields.forEach((field) => setPath(statData, field.path, [field.example, '校样用更新条件']))
  return JSON.stringify({ stat_data: statData }, null, 2)
}

export function conditionStyle(rule: WorkshopConditionRule): string {
  return [
    rule.color ? `color:${rule.color}!important` : '',
    rule.background ? `background:${rule.background}!important` : '',
  ]
    .filter(Boolean)
    .join(';')
}

export function appendConditionStyles(
  template: string,
  conditionRules: WorkshopConditionRule[],
): string {
  const styles = conditionRules
    .map((rule) => {
      const declarations = conditionStyle(rule)
      return declarations
        ? `[data-srl-condition="${rule.id}"][data-srl-condition-active="true"]{${declarations}}`
        : ''
    })
    .filter(Boolean)
    .join('')
  return styles ? `${template}\n<style>${styles}</style>` : template
}

export function bindMvuConditions(
  template: string,
  conditionRules: WorkshopConditionRule[],
): string {
  let result = appendConditionStyles(template, conditionRules)
  for (const rule of conditionRules) {
    result = result.replace(
      `data-srl-condition="${rule.id}"`,
      `data-srl-condition="${rule.id}" data-srl-condition-active="<%= __srlCompare(${JSON.stringify(rule.fieldPath)}, ${JSON.stringify(rule.operator)}, ${JSON.stringify(rule.value)}) ? 'true' : 'false' %>"`,
    )
  }
  return result
}

export function buildMvuReplacement(
  fields: StatusField[],
  htmlTemplate: string,
  conditionRules: WorkshopConditionRule[],
): string {
  const boundTemplate = fields.reduce(
    (result, field, index) =>
      result.replaceAll(
        `{{field_${index + 1}}}`,
        `<%- __srlEscape(__srlRead(${JSON.stringify(field.path)})) %>`,
      ),
    bindMvuConditions(htmlTemplate, conditionRules),
  )
  return `<%
if (typeof runType === 'undefined' || runType === 'render') {
  const __srlMessageId = typeof message_id === 'number' ? message_id : 'latest';
  const __srlGet = (target, path) => {
    const segments = String(path).split('.').map(segment => segment.trim()).filter(Boolean);
    if (segments.some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment.toLowerCase()))) return undefined;
    let cursor = target;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== 'object') return undefined;
      cursor = cursor[segment];
    }
    return cursor;
  };
  let __srlVariables = {};
  try {
    const __srlHelper = typeof window !== 'undefined' ? window.TavernHelper : undefined;
    if (__srlHelper && typeof __srlHelper.getVariables === 'function') {
      __srlVariables = __srlHelper.getVariables({ type: 'message', message_id: __srlMessageId }) ?? {};
    }
  } catch (_error) {
    __srlVariables = {};
  }
  const __srlDisplay = __srlVariables.display_data ?? {};
  const __srlState = __srlVariables.stat_data ?? {};
  const __srlRead = path => {
    const displayValue = __srlGet(__srlDisplay, path);
    const rawValue = displayValue === undefined ? __srlGet(__srlState, path) : displayValue;
    if (Array.isArray(rawValue)) return rawValue[0] ?? '未知';
    return rawValue ?? '未知';
  };
  const __srlEscape = value => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  const __srlCompare = (path, operator, expected) => {
    const actual = __srlRead(path);
    const numericActual = Number(actual);
    const numericExpected = Number(expected);
    if (operator === 'gt') return Number.isFinite(numericActual) && numericActual > numericExpected;
    if (operator === 'gte') return Number.isFinite(numericActual) && numericActual >= numericExpected;
    if (operator === 'lt') return Number.isFinite(numericActual) && numericActual < numericExpected;
    if (operator === 'lte') return Number.isFinite(numericActual) && numericActual <= numericExpected;
    if (operator === 'neq') return String(actual) !== String(expected);
    if (operator === 'contains') return String(actual).includes(String(expected));
    return String(actual) === String(expected);
  };
%>
${boundTemplate}
<% } %>`
}

export function conditionMatches(
  actual: unknown,
  operator: WorkshopConditionOperator,
  expected: string,
) {
  const value = unwrapMvuValue(actual)
  const numericValue = Number(value)
  const numericExpected = Number(expected)
  if (operator === 'gt') return Number.isFinite(numericValue) && numericValue > numericExpected
  if (operator === 'gte') return Number.isFinite(numericValue) && numericValue >= numericExpected
  if (operator === 'lt') return Number.isFinite(numericValue) && numericValue < numericExpected
  if (operator === 'lte') return Number.isFinite(numericValue) && numericValue <= numericExpected
  if (operator === 'neq') return String(value) !== expected
  if (operator === 'contains') return String(value).includes(expected)
  return String(value) === expected
}

export function renderWorkshopPreview(artifact: FrontendWorkshopArtifact, sample: string): string {
  if ((artifact.dataMode ?? 'reply') === 'reply' || !artifact.htmlTemplate) {
    return applyTavernRegex(artifact.regex, sample || artifact.sampleOutput)
  }
  let variables: Record<string, unknown>
  try {
    variables = JSON.parse(sample || artifact.sampleOutput) as Record<string, unknown>
  } catch {
    throw new Error('MVU 校样数据不是有效 JSON，请检查逗号、引号和括号')
  }
  const displayData =
    variables.display_data && typeof variables.display_data === 'object'
      ? (variables.display_data as Record<string, unknown>)
      : {}
  const statData =
    variables.stat_data && typeof variables.stat_data === 'object'
      ? (variables.stat_data as Record<string, unknown>)
      : {}
  let rendered = artifact.fields.reduce((result, field, index) => {
    const displayValue = getPath(displayData, field.path)
    const value = displayValue === undefined ? getPath(statData, field.path) : displayValue
    return result.replaceAll(`{{field_${index + 1}}}`, escapeHtml(unwrapMvuValue(value)))
  }, artifact.htmlTemplate)
  const conditionRules = artifact.conditionRules ?? []
  for (const rule of conditionRules) {
    const displayValue = getPath(displayData, rule.fieldPath)
    const value = displayValue === undefined ? getPath(statData, rule.fieldPath) : displayValue
    const active = conditionMatches(value, rule.operator, rule.value)
    rendered = rendered.replace(
      `data-srl-condition="${rule.id}"`,
      `data-srl-condition="${rule.id}" data-srl-condition-active="${active ? 'true' : 'false'}"`,
    )
  }
  return appendConditionStyles(rendered, conditionRules)
}

export function annotateInspectableMarkup(template: string, fields: StatusField[]): string {
  let result = template
  let summaryIndex = 0
  result = result.replace(/<summary\b/gi, () => {
    summaryIndex += 1
    return `<summary data-srl-inspect="summary:${summaryIndex}" data-srl-inspect-label="折叠标题 ${summaryIndex}"`
  })
  let imageIndex = 0
  result = result.replace(/<img\b/gi, () => {
    imageIndex += 1
    return `<img data-srl-inspect="image:${imageIndex}" data-srl-inspect-label="图片 ${imageIndex}"`
  })
  fields.forEach((field, index) => {
    const placeholder = `{{field_${index + 1}}}`
    result = result.replaceAll(
      placeholder,
      `<span data-srl-inspect="field:${index + 1}" data-srl-inspect-label="${escapeHtml(field.label)}">${placeholder}</span>`,
    )
  })
  return result
}

export function renderWorkshopInspectablePreview(
  artifact: FrontendWorkshopArtifact,
  sample: string,
): string {
  const htmlTemplate = annotateInspectableMarkup(artifact.htmlTemplate, artifact.fields)
  const inspectable =
    artifact.dataMode === 'mvu'
      ? { ...artifact, htmlTemplate }
      : {
          ...artifact,
          htmlTemplate,
          regex: {
            ...artifact.regex,
            replaceString: artifact.fields.reduce(
              (result, _field, index) =>
                result.replaceAll(`{{field_${index + 1}}}`, `$${index + 1}`),
              htmlTemplate,
            ),
          },
        }
  return renderWorkshopPreview(inspectable, sample)
}

export function inspectWorkshopSample(
  artifact: FrontendWorkshopArtifact,
  sample: string,
): WorkshopSampleIssue[] {
  try {
    assertSafeTemplate(
      artifact.htmlTemplate,
      artifact.fields,
      artifact.interactions ?? [],
      artifact.blocks ?? [],
      artifact.imageUrls ?? [],
      artifact.fontUrls ?? [],
      artifact.textStyles ?? [],
      artifact.conditionRules ?? [],
    )
  } catch (cause) {
    return [
      {
        severity: 'error',
        message: `当前版本模板无效：${cause instanceof Error ? cause.message : '请重新生成后再导出'}`,
      },
    ]
  }
  const value = sample || artifact.sampleOutput
  if (artifact.dataMode !== 'mvu') {
    const rendered = applyTavernRegex(artifact.regex, value)
    if (rendered === value)
      return [
        {
          severity: 'error',
          message: '状态块未匹配：可能缺少字段、字段顺序变化或根标签不完整。',
        },
      ]
    const issues: WorkshopSampleIssue[] =
      value.length > 4000
        ? [{ severity: 'warning', message: '测试文本超过 4000 字，低性能手机上可能显得拥挤。' }]
        : []
    artifact.fields.forEach((field) => {
      const fieldValue =
        value.match(
          new RegExp(`${escapeRegex(field.label)}[ \\t]*[：:][ \\t]*([^\\r\\n<]*)`),
        )?.[1] ?? ''
      if (fieldValue.length > 120)
        issues.push({
          severity: 'warning',
          message: `${field.label} 超过 120 字，请检查折行与高度。`,
        })
      if (
        (field.kind === 'number' || field.kind === 'percent') &&
        !/^-?\d+(?:\.\d+)?%?$/.test(fieldValue.trim())
      )
        issues.push({
          severity: 'warning',
          message: `${field.label} 预期为数值，当前测试值无法解析。`,
        })
    })
    return issues
  }
  let variables: Record<string, unknown>
  try {
    variables = JSON.parse(value) as Record<string, unknown>
  } catch {
    return [{ severity: 'error', message: 'MVU 测试数据不是有效 JSON。' }]
  }
  const displayData =
    variables.display_data && typeof variables.display_data === 'object'
      ? (variables.display_data as Record<string, unknown>)
      : {}
  const statData =
    variables.stat_data && typeof variables.stat_data === 'object'
      ? (variables.stat_data as Record<string, unknown>)
      : {}
  return artifact.fields.flatMap((field) => {
    const displayValue = getPath(displayData, field.path)
    const rawValue = displayValue === undefined ? getPath(statData, field.path) : displayValue
    if (rawValue === undefined)
      return [{ severity: 'warning' as const, message: `缺少变量路径：${field.path}` }]
    const actualValue = unwrapMvuValue(rawValue)
    if (
      (field.kind === 'number' || field.kind === 'percent') &&
      typeof actualValue !== 'number' &&
      !/^-?\d+(?:\.\d+)?%?$/.test(String(actualValue))
    ) {
      return [
        {
          severity: 'warning' as const,
          message: `${field.path} 预期为数值，当前是 ${Array.isArray(actualValue) ? '数组' : typeof actualValue}。`,
        },
      ]
    }
    return []
  })
}
