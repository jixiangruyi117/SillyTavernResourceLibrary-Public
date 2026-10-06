import type { Resource } from '../types/Resource'
import { RESOURCE_TYPE } from '../types/Resource'
import { asText, pushFieldDiff, stableJson } from './ResourceDiffShared'
import type { EntryDiff, FieldDiff } from './ResourceDiffShared'
import { isRecord } from './UnknownValue'
export interface NormalizedHelperScript {
  key: string
  name: string
  folder: string
  info: string
  enabled: boolean
  buttons: string[]
  dataCount: number
  exportData: boolean
  exportButtons: boolean
  content: string
}

function readHelperScript(
  value: unknown,
  index: number,
  folder = '',
): NormalizedHelperScript | undefined {
  if (!isRecord(value) || typeof value.content !== 'string') return undefined
  const hasTypedShape = value.type === 'script'
  const hasLegacyShape =
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (typeof value.info === 'string' || Array.isArray(value.buttons))
  if (!hasTypedShape && !hasLegacyShape) return undefined

  const button = isRecord(value.button) ? value.button : undefined
  const buttons = Array.isArray(button?.buttons)
    ? button.buttons
    : Array.isArray(value.buttons)
      ? value.buttons
      : []
  const exportWith = isRecord(value.export_with) ? value.export_with : undefined
  const name = asText(value.name) || `脚本 ${index + 1}`
  return {
    key: `${folder.toLocaleLowerCase()}::${name.toLocaleLowerCase()}`,
    name,
    folder,
    info: asText(value.info),
    enabled: value.enabled !== false,
    buttons: buttons
      .filter(isRecord)
      .map((item) => asText(item.name))
      .filter(Boolean),
    dataCount: isRecord(value.data) ? Object.keys(value.data).length : 0,
    exportData: exportWith?.data !== false,
    exportButtons: exportWith?.button !== false,
    content: value.content,
  }
}

export function readHelperScripts(
  value: unknown,
  resourceType: Resource['type'],
): NormalizedHelperScript[] {
  if (resourceType !== RESOURCE_TYPE.SCRIPT && resourceType !== RESOURCE_TYPE.PRESET) return []
  const scripts: NormalizedHelperScript[] = []
  const visit = (item: unknown, index: number, folder = ''): void => {
    if (!isRecord(item)) return
    if (item.type === 'folder' && Array.isArray(item.scripts)) {
      const folderName = asText(item.name) || `文件夹 ${index + 1}`
      item.scripts.forEach((script, scriptIndex) => visit(script, scriptIndex, folderName))
      return
    }
    const script = readHelperScript(item, index, folder)
    if (script) scripts.push(script)
  }
  const visitList = (items: unknown[]): void => items.forEach((item, index) => visit(item, index))

  if (Array.isArray(value)) {
    visitList(value)
  } else if (isRecord(value)) {
    visit(value, 0)
    if (value.type !== 'folder' && Array.isArray(value.scripts)) visitList(value.scripts)
    const scriptSettings = isRecord(value.script) ? value.script : undefined
    if (Array.isArray(scriptSettings?.scripts)) visitList(scriptSettings.scripts)
    const extensions = isRecord(value.extensions) ? value.extensions : undefined
    const helper = isRecord(extensions?.tavern_helper) ? extensions.tavern_helper : undefined
    if (Array.isArray(helper?.scripts)) visitList(helper.scripts)
  }

  const occurrences = new Map<string, number>()
  return scripts.map((script) => {
    const occurrence = occurrences.get(script.key) ?? 0
    occurrences.set(script.key, occurrence + 1)
    return occurrence ? { ...script, key: `${script.key}#${occurrence + 1}` } : script
  })
}

function helperScriptDetails(
  oldScript: NormalizedHelperScript | undefined,
  newScript: NormalizedHelperScript | undefined,
): FieldDiff[] {
  const fields: FieldDiff[] = []
  const add = (label: string, oldText: string, newText: string): void => {
    pushFieldDiff(fields, label, oldText, newText)
  }
  add('所在文件夹', oldScript?.folder ?? '', newScript?.folder ?? '')
  add('脚本说明', oldScript?.info ?? '', newScript?.info ?? '')
  add(
    '启用状态',
    oldScript ? (oldScript.enabled ? '启用' : '停用') : '',
    newScript ? (newScript.enabled ? '启用' : '停用') : '',
  )
  add('按钮', oldScript?.buttons.join('、') ?? '', newScript?.buttons.join('、') ?? '')
  add(
    '脚本数据',
    oldScript ? `${oldScript.dataCount} 项` : '',
    newScript ? `${newScript.dataCount} 项` : '',
  )
  add(
    '导出设置',
    oldScript
      ? `${oldScript.exportData ? '包含' : '不含'}脚本数据 · ${oldScript.exportButtons ? '包含' : '不含'}按钮`
      : '',
    newScript
      ? `${newScript.exportData ? '包含' : '不含'}脚本数据 · ${newScript.exportButtons ? '包含' : '不含'}按钮`
      : '',
  )

  if (oldScript && newScript && oldScript.content !== newScript.content) {
    fields.push({
      label: '脚本代码',
      status: 'changed',
      oldText: '旧版代码',
      newText: '新版代码有修改（原文可展开查看）',
    })
  } else if (!oldScript && newScript) {
    fields.push({
      label: '脚本代码',
      status: 'added',
      oldText: '',
      newText: '已添加（原文默认收起）',
    })
  } else if (oldScript && !newScript) {
    fields.push({
      label: '脚本代码',
      status: 'removed',
      oldText: '已移除',
      newText: '',
    })
  }
  return fields
}

export function diffHelperScripts(
  oldScripts: NormalizedHelperScript[],
  newScripts: NormalizedHelperScript[],
): EntryDiff[] {
  const oldByKey = new Map(oldScripts.map((script) => [script.key, script]))
  const newByKey = new Map(newScripts.map((script) => [script.key, script]))
  const diffs: EntryDiff[] = []
  for (const script of newScripts) {
    const previous = oldByKey.get(script.key)
    if (!previous) {
      diffs.push({
        key: `script:${script.key}`,
        label: `${script.folder ? `${script.folder} · ` : ''}${script.name}`,
        status: 'added',
        details: helperScriptDetails(undefined, script),
      })
    } else if (stableJson(previous) !== stableJson(script)) {
      diffs.push({
        key: `script:${script.key}`,
        label: `${script.folder ? `${script.folder} · ` : ''}${script.name}`,
        status: 'changed',
        details: helperScriptDetails(previous, script),
      })
    }
  }
  for (const script of oldScripts) {
    if (!newByKey.has(script.key)) {
      diffs.push({
        key: `script:${script.key}`,
        label: `${script.folder ? `${script.folder} · ` : ''}${script.name}`,
        status: 'removed',
        details: helperScriptDetails(script, undefined),
      })
    }
  }
  return diffs
}
