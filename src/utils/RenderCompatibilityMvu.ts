import YAML from 'yaml'

import { replacePreviewMacros } from './RichContentPreview'
import { isRecord } from './UnknownValue'

export interface RenderCompatibilityMvuData extends Record<string, unknown> {
  initialized_lorebooks: Record<string, unknown[]>
  stat_data: Record<string, unknown>
  display_data: Record<string, unknown>
  delta_data: Record<string, unknown>
  schema: RenderCompatibilityMvuSchemaNode
}

export interface RenderCompatibilityMvuSchemaNode {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'any'
  properties?: Record<string, RenderCompatibilityMvuSchemaNode>
  elementType?: RenderCompatibilityMvuSchemaNode
  required?: boolean
  extensible?: boolean
  recursiveExtensible?: boolean
}

export interface RenderCompatibilityMvuPreviewState {
  recognized: boolean
  swipesData: Record<string, unknown>[]
  errors: string[]
  unsupportedOpeningUpdates: string[]
}

export interface RenderCompatibilityMvuPreviewInput {
  characterData?: Record<string, unknown>
  greetings: string[]
  charName?: string
  userName?: string
}

const INITVAR_BLOCK = /<initvar>(?:\s*```[^\n]*\n)?([\s\S]*?)(?:\n```\s*)?<\/initvar>/gi
const UPDATE_BLOCK = /<UpdateVariable\b[^>]*>([\s\S]*?)<\/UpdateVariable>/gi
const UPDATE_COMMAND =
  /_\.(set|add|assign|insert|remove|unset|delete)\s*\(([^;\r\n]*)\)\s*;\s*(?:\/\/([^\r\n]*))?/gi

function clone<T>(value: T): T {
  return structuredClone(value)
}

function mergePreviewData(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = clone(value)
    } else if (isRecord(value)) {
      const current = isRecord(target[key]) ? target[key] : {}
      mergePreviewData(current, value)
      target[key] = current
    } else target[key] = value
  }
}

function unwrapInitvar(value: string): string {
  const trimmed = value.trim()
  const xml = [...trimmed.matchAll(INITVAR_BLOCK)]
  if (xml.length) return xml.map((match) => match[1] ?? '').join('\n')
  const fenced = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/)
  return fenced?.[1] ?? trimmed
}

function parseInitvar(
  value: string,
  context: { charName?: string; userName?: string },
): Record<string, unknown> {
  const source = replacePreviewMacros(unwrapInitvar(value), context)
  const parsed = YAML.parseDocument(source, { merge: true }).toJS() as unknown
  if (!isRecord(parsed)) throw new TypeError('InitVar root must be an object')
  return parsed
}

function schemaFor(
  value: unknown,
  oldSchema?: RenderCompatibilityMvuSchemaNode,
  parentRecursiveExtensible = false,
  preserveMetadata = false,
): RenderCompatibilityMvuSchemaNode {
  if (Array.isArray(value)) {
    const metaIndex = value.findIndex(
      (item) => isRecord(item) && item.$arrayMeta === true && isRecord(item.$meta),
    )
    const meta = metaIndex >= 0 ? (value[metaIndex] as Record<string, unknown>).$meta : undefined
    if (metaIndex >= 0) value.splice(metaIndex, 1)
    const oldArray = oldSchema?.type === 'array' ? oldSchema : undefined
    const recursiveExtensible = oldArray?.recursiveExtensible === true || parentRecursiveExtensible
    return {
      type: 'array',
      extensible:
        (isRecord(meta) && meta.extensible === true) ||
        oldArray?.extensible === true ||
        parentRecursiveExtensible,
      recursiveExtensible,
      elementType: value.length
        ? schemaFor(value[0], oldArray?.elementType, recursiveExtensible)
        : (oldArray?.elementType ?? { type: 'any' }),
    }
  }
  if (isRecord(value)) {
    const meta = isRecord(value.$meta) ? value.$meta : undefined
    const oldObject = oldSchema?.type === 'object' ? oldSchema : undefined
    const extensible =
      oldObject?.extensible === true ||
      meta?.extensible === true ||
      meta?.recursiveExtensible === true ||
      parentRecursiveExtensible
    const recursiveExtensible =
      oldObject?.recursiveExtensible === true ||
      meta?.recursiveExtensible === true ||
      parentRecursiveExtensible
    if (!preserveMetadata) delete value.$meta
    return {
      type: 'object',
      extensible,
      recursiveExtensible,
      properties: Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== '$meta')
          .map(([key, item]) => {
            const previous = oldObject?.properties?.[key]
            const requiredByDefault = !extensible
            const requiredByMeta = Array.isArray(meta?.required) && meta.required.includes(key)
            const required =
              previous?.required === undefined
                ? requiredByDefault || requiredByMeta
                : previous.required
            return [
              key,
              {
                ...schemaFor(item, previous, extensible && recursiveExtensible),
                required,
              },
            ]
          }),
      ),
    }
  }
  if (typeof value === 'string') return { type: 'string' }
  if (typeof value === 'number') return { type: 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  return { type: 'any' }
}

function schemaAt(
  schema: RenderCompatibilityMvuSchemaNode,
  path: string,
): RenderCompatibilityMvuSchemaNode | undefined {
  let current: RenderCompatibilityMvuSchemaNode | undefined = schema
  for (const part of pathParts(path)) {
    if (!current) return undefined
    current = /^\d+$/u.test(part)
      ? current.type === 'array'
        ? current.elementType
        : undefined
      : current.type === 'object'
        ? current.properties?.[part]
        : undefined
  }
  return current
}

function pathParts(path: string): string[] {
  return path
    .replace(
      /\[(?:'([^']*)'|"([^"]*)"|(\d+))\]/g,
      (_match, single, double, index) => `.${single ?? double ?? index}`,
    )
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
}

function readPath(root: Record<string, unknown>, path: string): unknown {
  return pathParts(path).reduce<unknown>(
    (value, part) => (isRecord(value) || Array.isArray(value) ? value[part as never] : undefined),
    root,
  )
}

function hasPath(root: Record<string, unknown>, path: string): boolean {
  const parts = pathParts(path)
  if (!parts.length) return true
  let value: unknown = root
  for (const part of parts) {
    if ((!isRecord(value) && !Array.isArray(value)) || !(part in value)) return false
    value = value[part as never]
  }
  return true
}

function writeExistingPath(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = pathParts(path)
  if (!parts.length) return false
  let target: Record<string, unknown> | unknown[] = root
  for (const part of parts.slice(0, -1)) {
    const next: unknown = target[part as never]
    if (!isRecord(next) && !Array.isArray(next)) return false
    target = next
  }
  target[parts.at(-1) as never] = value as never
  return true
}

function writeOutputPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = pathParts(path)
  if (!parts.length) {
    root[''] = value
    return
  }
  let target: Record<string, unknown> | unknown[] = root
  for (const [index, part] of parts.slice(0, -1).entries()) {
    const nextPart = parts[index + 1] ?? ''
    const current: unknown = target[part as never]
    if (!isRecord(current) && !Array.isArray(current)) {
      target[part as never] = (/^\d+$/u.test(nextPart) ? [] : {}) as never
    }
    target = target[part as never] as Record<string, unknown> | unknown[]
  }
  target[parts.at(-1) as never] = value as never
}

function parseCommandValue(value: string): unknown {
  return YAML.parseDocument(value.trim(), { merge: true }).toJS()
}

function isValueWithDescription(value: unknown): value is [unknown, string] {
  return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string'
}

function displayValue(value: unknown): string {
  return (JSON.stringify(value) ?? String(value)).replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/u, '$1')
}

function displayChange(oldValue: unknown, newValue: unknown, reason: string): string {
  return `${displayValue(oldValue)}->${displayValue(newValue)} ${reason ? `(${reason})` : ''}`
}

function writeChange(
  data: RenderCompatibilityMvuData,
  path: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string,
): void {
  const display = displayChange(oldValue, newValue, reason)
  writeOutputPath(data.display_data, path, display)
  writeOutputPath(data.delta_data, path, display)
}

function splitCommandArgs(source: string): string[] {
  const args: string[] = []
  let current = ''
  let quote = ''
  let escaped = false
  let depth = 0
  for (const character of source) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote) {
      current += character
      escaped = true
      continue
    }
    if (quote) {
      current += character
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }
    if ('[{('.includes(character)) depth += 1
    if (']})'.includes(character)) depth -= 1
    if (character === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim()) args.push(current.trim())
  return args
}

function writeCommandDisplay(
  data: RenderCompatibilityMvuData,
  path: string,
  display: string,
): void {
  writeOutputPath(data.display_data, path, display)
  writeOutputPath(data.delta_data, path, display)
}

function removePath(root: Record<string, unknown>, path: string): boolean {
  const parts = pathParts(path)
  if (!parts.length) return false
  let target: Record<string, unknown> | unknown[] = root
  for (const part of parts.slice(0, -1)) {
    const next: unknown = target[part as never]
    if (!isRecord(next) && !Array.isArray(next)) return false
    target = next
  }
  const key = parts.at(-1) as string
  if (Array.isArray(target) && /^\d+$/u.test(key)) {
    const index = Number(key)
    if (index < 0 || index >= target.length) return false
    target.splice(index, 1)
    return true
  }
  if (!(key in target)) return false
  delete target[key as never]
  return true
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function applyOpeningUpdates(
  greeting: string,
  data: RenderCompatibilityMvuData,
  ignoreMissingRemovals = false,
): string[] {
  const unsupported: string[] = []
  for (const block of greeting.matchAll(UPDATE_BLOCK)) {
    const source = block[1] ?? ''
    let matched = false
    for (const command of source.matchAll(UPDATE_COMMAND)) {
      matched = true
      const operation = command[1]?.toLowerCase()
      const args = splitCommandArgs(command[2] ?? '')
      const reason = command[3]?.trim() ?? ''
      let path: string
      try {
        const parsedPath = parseCommandValue(args[0] ?? '')
        if (typeof parsedPath !== 'string') throw new TypeError('path')
        path = parsedPath
      } catch {
        unsupported.push(command[0])
        continue
      }

      if (operation === 'set' || operation === 'add') {
        if (path && !hasPath(data.stat_data, path)) {
          unsupported.push(command[0])
          continue
        }
        const oldValue = path ? readPath(data.stat_data, path) : clone(data.stat_data)
        let operand: unknown
        try {
          operand = parseCommandValue(args.at(-1) ?? '')
        } catch {
          unsupported.push(command[0])
          continue
        }

        if (operation === 'set') {
          if (!path && !isRecord(operand)) {
            unsupported.push(command[0])
            continue
          }
          if (isValueWithDescription(oldValue) && !Array.isArray(oldValue[0])) {
            const previousValue = clone(oldValue[0])
            const nextValue =
              typeof oldValue[0] === 'number' && operand !== null ? Number(operand) : operand
            const next = clone(oldValue)
            next[0] = nextValue
            writeExistingPath(data.stat_data, path, next)
            writeChange(data, path, previousValue, nextValue, reason)
            continue
          }
          const nextValue =
            typeof oldValue === 'number' && typeof operand === 'string' && operand !== null
              ? Number(operand)
              : operand
          if (path) writeExistingPath(data.stat_data, path, nextValue)
          else data.stat_data = clone(operand as Record<string, unknown>)
          writeChange(data, path, oldValue, nextValue, reason)
          continue
        }

        const isVwd = isValueWithDescription(oldValue) && typeof oldValue[0] === 'number'
        const numericValue = isVwd ? oldValue[0] : oldValue
        if (typeof numericValue !== 'number' || typeof operand !== 'number') {
          unsupported.push(command[0])
          continue
        }
        const nextValue = Number.parseFloat((numericValue + operand).toPrecision(12))
        if (isVwd) {
          const next = clone(oldValue)
          next[0] = nextValue
          writeExistingPath(data.stat_data, path, next)
        } else writeExistingPath(data.stat_data, path, nextValue)
        writeChange(data, path, numericValue, nextValue, reason)
        continue
      }

      if (operation === 'assign' || operation === 'insert') {
        if (!hasPath(data.stat_data, path)) {
          unsupported.push(command[0])
          continue
        }
        const collection = path ? readPath(data.stat_data, path) : data.stat_data
        const targetSchema = schemaAt(data.schema, path)
        if ((!Array.isArray(collection) && !isRecord(collection)) || args.length < 2) {
          unsupported.push(command[0])
          continue
        }
        if (Array.isArray(collection) && targetSchema?.extensible !== true) {
          unsupported.push(command[0])
          continue
        }
        let display: string
        try {
          if (args.length === 2) {
            const value = parseCommandValue(args[1])
            if (Array.isArray(collection)) {
              collection.push(clone(value))
              display = `ASSIGNED ${JSON.stringify(value)} into array '${path}' ${reason ? `(${reason})` : ''}`
            } else {
              if (targetSchema?.extensible !== true || !isRecord(value)) {
                unsupported.push(command[0])
                continue
              }
              mergePreviewData(collection, value)
              display = `MERGED object ${JSON.stringify(value)} into object '${path}' ${reason ? `(${reason})` : ''}`
            }
          } else {
            const key = parseCommandValue(args[1])
            const value = parseCommandValue(args[2])
            if (Array.isArray(collection)) {
              if (typeof key !== 'number' && key !== '-') {
                unsupported.push(command[0])
                continue
              }
              const index = key === '-' ? collection.length : key
              collection.splice(index, 0, clone(value))
              display = `ASSIGNED ${JSON.stringify(value)} into '${path}' at index ${key === '-' || key === -1 ? 'tail' : key} ${reason ? `(${reason})` : ''}`
            } else {
              const property = String(key)
              if (targetSchema?.extensible === false && !targetSchema.properties?.[property]) {
                unsupported.push(command[0])
                continue
              }
              collection[property] = clone(value)
              display = `ASSIGNED key '${property}' with value ${JSON.stringify(value)} into object '${path}' ${reason ? `(${reason})` : ''}`
            }
          }
        } catch {
          unsupported.push(command[0])
          continue
        }
        writeCommandDisplay(data, path, display)
        continue
      }

      if (!hasPath(data.stat_data, path)) {
        if (ignoreMissingRemovals && ['remove', 'unset', 'delete'].includes(String(operation))) {
          continue
        }
        unsupported.push(command[0])
        continue
      }
      const parts = pathParts(path)
      let targetPath = path
      let target = readPath(data.stat_data, path)
      let key: unknown
      if (args.length === 1) {
        key = parts.at(-1)
        targetPath = parts.slice(0, -1).join('.')
        target = targetPath ? readPath(data.stat_data, targetPath) : data.stat_data
      } else {
        try {
          key = parseCommandValue(args[1])
        } catch {
          unsupported.push(command[0])
          continue
        }
      }
      const targetSchema = schemaAt(data.schema, targetPath)
      if (Array.isArray(target)) {
        if (args.length > 1 && targetSchema?.extensible !== true) {
          unsupported.push(command[0])
          continue
        }
        const index =
          typeof key === 'number' || (args.length === 1 && /^\d+$/u.test(String(key)))
            ? Number(key)
            : target.findIndex((item) => equalValue(item, key))
        if (index < 0 || index >= target.length) {
          if (ignoreMissingRemovals) continue
          unsupported.push(command[0])
          continue
        }
        target.splice(index, 1)
        writeCommandDisplay(
          data,
          path,
          `REMOVED item from '${targetPath || path}'${args.length === 1 ? ` at index ${index}` : ''} ${reason ? `(${reason})` : ''}`,
        )
        continue
      }
      if (!isRecord(target)) {
        unsupported.push(command[0])
        continue
      }
      const targetKeys = Object.keys(target)
      const property = typeof key === 'number' ? targetKeys[key] : String(key)
      if (
        !property ||
        !(property in target) ||
        (operation !== 'delete' && targetSchema?.properties?.[property]?.required)
      ) {
        if (ignoreMissingRemovals && property && !(property in target)) continue
        unsupported.push(command[0])
        continue
      }
      if (args.length === 1) removePath(data.stat_data, path)
      else delete target[property]
      writeCommandDisplay(
        data,
        path,
        args.length === 1
          ? `REMOVED path '${path}' ${reason ? `(${reason})` : ''}`
          : `REMOVED key '${property}' from object '${path}' ${reason ? `(${reason})` : ''}`,
      )
    }
    if (!matched && source.trim()) unsupported.push(source.trim())
    const other = source.match(/_\.(move)\s*\(/gi)
    if (other) unsupported.push(...other)
  }
  return unsupported
}

function embeddedEntries(characterData?: Record<string, unknown>): {
  bookName: string
  entries: Record<string, unknown>[]
} {
  const book = isRecord(characterData?.character_book) ? characterData.character_book : undefined
  const rawEntries = book?.entries
  const entries = Array.isArray(rawEntries)
    ? rawEntries
    : isRecord(rawEntries)
      ? Object.values(rawEntries)
      : []
  return {
    bookName:
      typeof book?.name === 'string' && book.name.trim() ? book.name.trim() : '角色内嵌世界书',
    entries: entries.filter(isRecord),
  }
}

export function hasRenderCompatibilityMvuSource(
  characterData: Record<string, unknown> | undefined,
  _greetings: string[],
): boolean {
  return embeddedEntries(characterData).entries.some((entry) => {
    const label = typeof entry.comment === 'string' ? entry.comment : entry.name
    return typeof label === 'string' && label.toLowerCase().includes('[initvar]')
  })
}

export function buildRenderCompatibilityMvuPreviewState(
  input: RenderCompatibilityMvuPreviewInput,
): RenderCompatibilityMvuPreviewState {
  const errors: string[] = []
  const unsupportedOpeningUpdates: string[] = []
  const context = {
    charName: input.charName?.trim() || '角色',
    userName: input.userName?.trim() || '用户',
  }
  const { bookName, entries } = embeddedEntries(input.characterData)
  const base: Record<string, unknown> = {}
  const initializedEntries: unknown[] = []
  let parsedCount = 0

  for (const [index, entry] of entries.entries()) {
    const label = typeof entry.comment === 'string' ? entry.comment : entry.name
    if (typeof label !== 'string' || !label.toLowerCase().includes('[initvar]')) continue
    if (typeof entry.content !== 'string') continue
    try {
      mergePreviewData(base, parseInitvar(entry.content, context))
      initializedEntries.push(label)
      parsedCount += 1
    } catch (error) {
      errors.push(`embedded initvar ${index + 1}: ${String(error)}`)
    }
  }

  if (parsedCount === 0) {
    return {
      recognized: false,
      swipesData: input.greetings.map(() => ({})),
      errors,
      unsupportedOpeningUpdates,
    }
  }

  const swipesData = input.greetings.map((greeting, index) => {
    let statData = clone(base)
    let openingOverride = false
    const override: Record<string, unknown> = {}
    for (const match of greeting.matchAll(INITVAR_BLOCK)) {
      try {
        mergePreviewData(override, parseInitvar(match[0], context))
        openingOverride = true
        parsedCount += 1
      } catch (error) {
        errors.push(`opening ${index + 1} initvar: ${String(error)}`)
      }
    }
    if (openingOverride) statData = override
    const schema = schemaFor(statData, undefined, false, true)
    const data: RenderCompatibilityMvuData = {
      initialized_lorebooks: { [bookName]: openingOverride ? [] : clone(initializedEntries) },
      stat_data: statData,
      display_data: clone(statData),
      delta_data: {},
      schema,
    }
    const unsupported = applyOpeningUpdates(greeting, data)
    // MVU beta initializes every opening swipe, then the current greeting is handled once more
    // through MESSAGE_RECEIVED. This makes additive commands run twice only for swipe 0.
    if (index === 0) unsupported.push(...applyOpeningUpdates(greeting, data, true))
    for (const item of unsupported) {
      if (!unsupportedOpeningUpdates.includes(item)) unsupportedOpeningUpdates.push(item)
    }
    data.schema = schemaFor(data.stat_data, data.schema, false, true)
    return data
  })

  return {
    recognized: true,
    swipesData,
    errors,
    unsupportedOpeningUpdates,
  }
}
