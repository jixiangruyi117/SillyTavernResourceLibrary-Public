import { isRecord } from '../utils/UnknownValue'

/** Portable opening set. It carries no replacement character identity or world book. */
export interface GreetingResourceDocument {
  format: 'srl-greeting'
  version: 1
  name: string
  first_mes: string
  alternate_greetings: string[]
  companion_scripts: Record<string, unknown>[]
}

export function parseGreetingResource(value: unknown): GreetingResourceDocument {
  if (!isRecord(value) || value.format !== 'srl-greeting' || value.version !== 1)
    throw new Error('不支持的开场白资源格式')
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.first_mes !== 'string' ||
    !value.first_mes.trim() ||
    !Array.isArray(value.alternate_greetings) ||
    !value.alternate_greetings.every((text) => typeof text === 'string' && text.trim()) ||
    !Array.isArray(value.companion_scripts)
  )
    throw new Error('开场白资源缺少名称、主正文、备用列表或配套脚本列表')
  const scripts = value.companion_scripts.map((script) => {
    if (
      !isRecord(script) ||
      script.type !== 'script' ||
      typeof script.name !== 'string' ||
      typeof script.content !== 'string'
    )
      throw new Error('开场白配套脚本格式不完整')
    return { ...script, enabled: false }
  })
  return {
    format: 'srl-greeting',
    version: 1,
    name: value.name,
    first_mes: value.first_mes,
    alternate_greetings: [...value.alternate_greetings] as string[],
    companion_scripts: scripts,
  }
}
