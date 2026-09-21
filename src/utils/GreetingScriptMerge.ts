import { mapTavernHelperScriptTrees } from './TavernHelperScriptParser'
import { isRecord } from './UnknownValue'

export interface GreetingScriptChoice {
  mode: 'add' | 'replace-all' | 'replace-selected'
  removeKeys: string[]
}
export interface GreetingScriptItem {
  key: string
  name: string
  content: string
  identical: boolean
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  )
}
// Names, IDs and enabled state do not change script code/configuration identity.
function identity(raw: Record<string, unknown>): string {
  const {
    id: _id,
    name: _name,
    enabled: _enabled,
    info: _info,
    type: _type,
    script: _script,
    folder: _folder,
    export_with: _export,
    data: _data,
    button: _button,
    buttons: _buttons,
    ...config
  } = raw
  return JSON.stringify(
    stable({
      ...config,
      content: String(raw.content ?? raw.script ?? '').trim(),
      data: isRecord(raw.data) ? raw.data : {},
      button: isRecord(raw.button)
        ? { enabled: true, buttons: [], ...raw.button }
        : { enabled: true, buttons: Array.isArray(raw.buttons) ? raw.buttons : [] },
    }),
  )
}
function settings(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (isRecord(value)) return value
  if (
    Array.isArray(value) &&
    value.every(
      (entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string',
    )
  )
    return Object.fromEntries(value)
  throw new Error('酒馆助手脚本配置格式无法安全合并，请检查原配置')
}
function mapSettings(
  value: unknown,
  key: string,
  visit: Parameters<typeof mapTavernHelperScriptTrees>[1],
): unknown {
  const record = settings(value)
  if (record.scripts === undefined) return value
  if (!Array.isArray(record.scripts)) throw new Error('酒馆助手脚本列表格式不正确')
  const scripts = mapTavernHelperScriptTrees(record.scripts, visit, key)
  return Array.isArray(value)
    ? value.map((entry) => (entry[0] === 'scripts' ? ['scripts', scripts] : entry))
    : { ...record, scripts }
}
function visitCard(
  data: Record<string, unknown>,
  visit: Parameters<typeof mapTavernHelperScriptTrees>[1],
) {
  if (Array.isArray(data.scripts))
    data.scripts = mapTavernHelperScriptTrees(data.scripts, visit, 'scripts')
  if (data.script !== undefined && typeof data.script !== 'string')
    data.script = mapSettings(data.script, 'script', visit)
  const ext = isRecord(data.extensions) ? data.extensions : {}
  if (ext.tavern_helper !== undefined)
    ext.tavern_helper = mapSettings(ext.tavern_helper, 'helper', visit)
  if (Array.isArray(ext.TavernHelper_scripts))
    ext.TavernHelper_scripts = mapTavernHelperScriptTrees(ext.TavernHelper_scripts, visit, 'legacy')
}
export function inspectGreetingScripts(
  card: Record<string, unknown>,
  incoming: Record<string, unknown>[],
): GreetingScriptItem[] {
  const copy = structuredClone(card)
  const data = isRecord(copy.data) ? copy.data : copy
  const items: GreetingScriptItem[] = []
  visitCard(data, (script, raw, key) => {
    items.push({
      key,
      name: script.name,
      content: script.content,
      identical: incoming.some((item) => identity(item) === identity(raw)),
    })
    return true
  })
  return items
}
export function mergeGreetingScripts(
  data: Record<string, unknown>,
  incoming: Record<string, unknown>[],
  choice: GreetingScriptChoice = { mode: 'add', removeKeys: [] },
): void {
  if (!incoming.length) return
  if (!['add', 'replace-all', 'replace-selected'].includes(choice.mode))
    throw new Error('请选择脚本处理方式')
  const current = inspectGreetingScripts(data, incoming)
  if (
    choice.mode === 'replace-selected' &&
    (!choice.removeKeys.length ||
      choice.removeKeys.some((key) => !current.some((item) => item.key === key && !item.identical)))
  )
    throw new Error('请重新选择需要替换的旧脚本')
  const kept: Record<string, unknown>[] = []
  visitCard(data, (_script, raw, key) => {
    const same = incoming.some((item) => identity(item) === identity(raw))
    const keep =
      same ||
      choice.mode === 'add' ||
      (choice.mode === 'replace-selected' && !choice.removeKeys.includes(key))
    if (keep) kept.push(raw)
    return keep
  })
  const added: Record<string, unknown>[] = []
  for (const script of incoming) {
    if ([...kept, ...added].some((item) => identity(item) === identity(script))) continue
    if ([...kept, ...added].some((item) => item.id && item.id === script.id))
      throw new Error('新旧脚本编号相同但内容不同，请选择替换对应旧脚本')
    added.push({ ...script, enabled: false })
  }
  const ext = isRecord(data.extensions) ? data.extensions : {}
  const helper = ext.tavern_helper
  const record = settings(helper)
  const scripts = [...(Array.isArray(record.scripts) ? record.scripts : []), ...added]
  ext.tavern_helper = Array.isArray(helper)
    ? [...helper.filter((entry) => entry[0] !== 'scripts'), ['scripts', scripts]]
    : { ...record, scripts }
  data.extensions = ext
}
