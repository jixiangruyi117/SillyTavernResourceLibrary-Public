import {
  EXTERNAL_APP_PERMISSION,
  getGrantedExternalAppPermissions,
  type ExternalAppPermission,
  type ExternalAppTool,
  type ExternalAppToolDescriptor,
  type ExternalAppToolSchema,
  type InstalledExternalAppSummary,
} from '../types/ExternalApp'

export const EXTERNAL_APP_TOOLS_API = 'srl-app-tools@1'
export const MAX_CUSTOM_TOOL_JSON = 16_000
const NAME = /^[a-z][a-z0-9_]{0,47}$/u
const unsafeKey = (key: string) => ['__proto__', 'prototype', 'constructor'].includes(key)
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown, limit: number, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit)
    throw new Error(`${label}无效`)
  return value.trim()
}
/** Deliberately bounded JSON Schema subset; unsupported keywords are rejected, never ignored. */
function schema(value: unknown, depth = 0, budget = { nodes: 0 }): ExternalAppToolSchema {
  if (!object(value) || depth > 5 || ++budget.nodes > 80) throw new Error('工具参数格式过于复杂')
  const keys = [
    'type',
    'description',
    'properties',
    'required',
    'additionalProperties',
    'items',
    'enum',
    'maxLength',
    'maxItems',
  ]
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error('工具参数含不支持的格式字段')
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(String(value.type)))
    throw new Error('工具参数类型不支持')
  const result: ExternalAppToolSchema = { type: value.type as ExternalAppToolSchema['type'] }
  if (value.description !== undefined) result.description = text(value.description, 300, '参数说明')
  if (result.type === 'object') {
    if (!object(value.properties) || value.additionalProperties !== false)
      throw new Error('对象参数需声明 properties 和 additionalProperties:false')
    const entries = Object.entries(value.properties)
    if (
      entries.length > 30 ||
      entries.some(([key]) => !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/u.test(key) || unsafeKey(key))
    )
      throw new Error('参数名称或数量无效')
    result.properties = Object.fromEntries(
      entries.map(([key, item]) => [key, schema(item, depth + 1, budget)]),
    )
    if (
      !Array.isArray(value.required) ||
      value.required.some(
        (key) => typeof key !== 'string' || !Object.hasOwn(result.properties!, key),
      ) ||
      new Set(value.required).size !== value.required.length
    )
      throw new Error('required 必须列出已有参数且不能重复')
    result.required = value.required as string[]
    result.additionalProperties = false
  } else if (
    ['properties', 'required', 'additionalProperties'].some((key) => value[key] !== undefined)
  )
    throw new Error('只有对象参数可声明属性')
  if (result.type === 'array') {
    result.items = schema(value.items, depth + 1, budget)
    if (value.maxItems !== undefined && typeof value.maxItems !== 'number')
      throw new Error('maxItems 必须是数字')
    result.maxItems = value.maxItems === undefined ? 50 : (value.maxItems as number)
    if (!Number.isSafeInteger(result.maxItems) || result.maxItems < 0 || result.maxItems > 100)
      throw new Error('数组参数上限为100项')
  } else if (value.items !== undefined || value.maxItems !== undefined)
    throw new Error('只有数组参数可声明 items/maxItems')
  if (result.type === 'string') {
    if (value.maxLength !== undefined && typeof value.maxLength !== 'number')
      throw new Error('maxLength 必须是数字')
    result.maxLength = value.maxLength === undefined ? 4000 : (value.maxLength as number)
    if (
      !Number.isSafeInteger(result.maxLength) ||
      result.maxLength < 0 ||
      result.maxLength > MAX_CUSTOM_TOOL_JSON
    )
      throw new Error('字符串参数长度上限无效')
  } else if (value.maxLength !== undefined) throw new Error('只有字符串参数可声明 maxLength')
  if (value.enum !== undefined) {
    if (
      ['object', 'array'].includes(result.type) ||
      !Array.isArray(value.enum) ||
      !value.enum.length ||
      value.enum.length > 30 ||
      value.enum.some((item) => !matchesType(result.type, item))
    )
      throw new Error('工具枚举值无效')
    result.enum = value.enum as ExternalAppToolSchema['enum']
    if (JSON.stringify(result.enum).length > 4000) throw new Error('工具枚举值过长')
  }
  return result
}
export function normalizeExternalAppTools(
  value: unknown,
  permissions: ExternalAppPermission[],
): ExternalAppTool[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 12) throw new Error('一个 APP 最多声明12个自定义工具')
  const names = new Set<string>()
  return value.map((item: unknown) => {
    if (!object(item)) throw new Error('工具声明必须是对象')
    if (
      Object.keys(item).some(
        (key) =>
          ![
            'name',
            'title',
            'description',
            'version',
            'apiVersion',
            'permissions',
            'parameters',
          ].includes(key),
      )
    )
      throw new Error('工具声明含未知字段')
    const name = text(item.name, 48, '工具名称')
    if (!NAME.test(name) || names.has(name))
      throw new Error('工具名称须唯一，使用小写字母、数字和下划线')
    names.add(name)
    const version = text(item.version, 80, '工具版本')
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version))
      throw new Error('工具版本须为 x.y.z')
    const apiVersion = text(item.apiVersion, 80, '工具接口版本')
    if (!/^srl-app-tools@\d+$/u.test(apiVersion)) throw new Error('工具接口版本无效')
    if (
      !Array.isArray(item.permissions) ||
      item.permissions.some(
        (permission) => !permissions.includes(permission as ExternalAppPermission),
      )
    )
      throw new Error('工具权限须属于 APP 已声明的权限')
    const parameters = schema(item.parameters)
    if (parameters.type !== 'object') throw new Error('工具顶层参数须为对象')
    return {
      name,
      title: text(item.title, 80, '工具标题'),
      description: text(item.description, 500, '工具说明'),
      version,
      apiVersion,
      permissions: [...new Set(item.permissions)] as ExternalAppPermission[],
      parameters,
    }
  })
}
function matchesType(type: ExternalAppToolSchema['type'], value: unknown): boolean {
  return type === 'object'
    ? object(value)
    : type === 'array'
      ? Array.isArray(value)
      : type === 'integer'
        ? Number.isSafeInteger(value)
        : type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : typeof value === type
}
export function validateExternalAppToolArguments(
  tool: ExternalAppTool,
  encoded: string,
): Record<string, unknown> {
  if (encoded.length > MAX_CUSTOM_TOOL_JSON) throw new Error('工具参数超过16000字符')
  const value: unknown = JSON.parse(encoded)
  function visit(spec: ExternalAppToolSchema, item: unknown): void {
    if (
      !matchesType(spec.type, item) ||
      (spec.enum && !spec.enum.includes(item as string | number | boolean))
    )
      throw new Error('工具参数不符合已声明的格式')
    if (spec.type === 'object') {
      const data = item as Record<string, unknown>
      if (
        Object.keys(data).some((key) => !Object.hasOwn(spec.properties!, key) || unsafeKey(key)) ||
        spec.required!.some((key) => !Object.hasOwn(data, key))
      )
        throw new Error('工具参数缺少必填项或含额外字段')
      Object.entries(data).forEach(([key, child]) => visit(spec.properties![key]!, child))
    } else if (spec.type === 'array') {
      if ((item as unknown[]).length > spec.maxItems!) throw new Error('工具数组参数超过上限')
      ;(item as unknown[]).forEach((child) => visit(spec.items!, child))
    } else if (spec.type === 'string' && (item as string).length > spec.maxLength!)
      throw new Error('工具字符串参数超过上限')
  }
  visit(tool.parameters, value)
  return value as Record<string, unknown>
}
export function readExternalAppToolResult(encoded: unknown): unknown {
  if (typeof encoded !== 'string' || encoded.length > MAX_CUSTOM_TOOL_JSON)
    throw new Error('工具结果必须是最多16000字符的 JSON')
  try {
    const value: unknown = JSON.parse(encoded)
    const stack = [{ value, depth: 0 }]
    let nodes = 0
    while (stack.length) {
      const current = stack.pop()!
      if (current.depth > 10 || ++nodes > 4000) throw new Error('complex')
      if (current.value && typeof current.value === 'object')
        for (const child of Object.values(current.value))
          stack.push({ value: child, depth: current.depth + 1 })
    }
    return value
  } catch {
    throw new Error('工具返回的 JSON 无效或过于复杂，未向模型发送原始内容')
  }
}
export function describeExternalAppTools(
  app: InstalledExternalAppSummary,
): ExternalAppToolDescriptor[] {
  const allowed = getGrantedExternalAppPermissions(app)
  return (app.manifest.tools ?? []).map((tool) => {
    const unavailableReason = !app.enabled
      ? 'APP 已停用'
      : app.runtimeMode === 'trustedCompatible'
        ? '自定义工具需标准隔离模式；请在扩展管理切换模式，源码和数据保留'
        : tool.apiVersion !== EXTERNAL_APP_TOOLS_API
          ? '工具需要不同版本的宿主接口，源码保留，请更新宿主或工具'
          : !app.packageFingerprint
            ? '安装缺少完整性指纹，请重新安装原包'
            : tool.permissions.some((permission) => !allowed.includes(permission))
              ? '工具所需权限未在安装时允许'
              : undefined
    return {
      ...tool,
      id: `${app.id}/${tool.name}`,
      appId: app.id,
      appName: app.manifest.name,
      fingerprint: app.packageFingerprint ?? '',
      available: !unavailableReason,
      ...(unavailableReason ? { unavailableReason } : {}),
    }
  })
}
/** Installed SDK permission checks remain authoritative; this narrows requests during a tool call. */
export function customToolMethodPermissions(method: string): ExternalAppPermission[] {
  if (method.startsWith('storage.')) return [EXTERNAL_APP_PERMISSION.STORAGE]
  if (method === 'resources.pick') return [EXTERNAL_APP_PERMISSION.RESOURCES_SELECTED_READ]
  if (method === 'resources.update') return [EXTERNAL_APP_PERMISSION.RESOURCES_WRITE]
  if (method === 'chat.bind')
    return [EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ, EXTERNAL_APP_PERMISSION.RESOURCES_WRITE]
  if (method === 'resources.list') return [EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ]
  if (method.startsWith('resources.') || method.startsWith('chat.'))
    return [
      EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ,
      EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ,
    ]
  if (method.startsWith('files.')) return [EXTERNAL_APP_PERMISSION.FILES_IMPORT_EXPORT]
  if (method === 'device.vibrate') return [EXTERNAL_APP_PERMISSION.DEVICE_HAPTICS]
  return []
}
