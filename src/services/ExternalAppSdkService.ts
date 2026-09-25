import {
  chatCharacterSummary,
  chatCharacterThumbnail,
  resolveChatCharacter,
} from './ChatReaderCharacter'
import { isRecord } from '../utils/UnknownValue'
import { ChatReaderService } from './ChatReaderService'
import { OPAQUE_PREVIEW_DOCUMENT_URL } from '../utils/OpaquePreviewDocument'
import type { ResourceService } from './ResourceService'
import type { ExternalAppResourceUpdate } from './ResourceService'
import type { ExternalAppService } from './ExternalAppService'
import {
  EXTERNAL_APP_PERMISSION,
  EXTERNAL_APP_SDK_VERSION,
  getExternalAppPermissionLevel,
  getGrantedExternalAppPermissions,
  type ExternalAppPermission,
} from '../types/ExternalApp'
import {
  RESOURCE_TYPE,
  type Resource,
  type ResourceSummary,
  type ResourceType,
} from '../types/Resource'

const MAX_PAGE_SIZE = 50
const MAX_RESOURCE_DATA_BYTES = 512 * 1024
const textEncoder = new TextEncoder()

export interface ExternalAppResourceSnapshot {
  apiVersion: 'srl-resource@1'
  id: string
  type: ResourceType
  name: string
  description: string
  tags: string[]
  favorite: boolean
  categoryIds: string[]
  relatedResourceIds: string[]
  revision: number
  format: string
  formatVersion: number
  chatCharacter?: { id: string; name: string; hash: string }
  messageCount?: number
  data?: Record<string, unknown>
}

export interface ExternalAppResourceListResult {
  items: ExternalAppResourceSnapshot[]
  total: number
  nextOffset: number | null
}

export interface ExternalAppResourceUpdateRequest {
  id: string
  name?: string
  description?: string
  tags?: string[]
  favorite?: boolean
  categoryIds?: string[]
}

export interface ExternalAppResourceUpdatePreview {
  resource: ExternalAppResourceSnapshot
  changes: Array<{ field: string; before: unknown; after: unknown }>
}

function normalizeResourceId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > 160) throw new Error('资源 ID 无效')
  return id
}

function normalizeTypes(value: unknown): ResourceType[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('资源类型筛选必须是数组')
  const supported = new Set<ResourceType>(Object.values(RESOURCE_TYPE))
  const types = Array.from(
    new Set(value.filter((item): item is ResourceType => typeof item === 'string')),
  )
  if (types.some((type) => !supported.has(type))) throw new Error('资源类型筛选包含不支持的类型')
  return types
}

function normalizedInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max)
    throw new Error('分页参数无效')
  return value
}

function normalizeOptionalText(
  value: unknown,
  field: '名称' | '说明',
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`资源${field}必须是文本`)
  if (value.length > maxLength) throw new Error(`资源${field}不能超过 ${maxLength} 个字符`)
  return value
}

function normalizeOptionalStrings(
  value: unknown,
  field: string,
  maxItems: number,
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`资源${field}必须是文本数组`)
  if (value.length > maxItems) throw new Error(`资源${field}不能超过 ${maxItems} 项`)
  return value
}

function normalizeUpdateRequest(payload: unknown): ExternalAppResourceUpdateRequest {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('资源更新参数无效')
  const input = payload as Record<string, unknown>
  const request: ExternalAppResourceUpdateRequest = { id: normalizeResourceId(input.id) }
  const name = normalizeOptionalText(input.name, '名称', 160)
  const description = normalizeOptionalText(input.description, '说明', 20_000)
  const tags = normalizeOptionalStrings(input.tags, '标签', 100)
  const categoryIds = normalizeOptionalStrings(input.categoryIds, '分类', 100)
  if (name !== undefined) request.name = name
  if (description !== undefined) request.description = description
  if (tags !== undefined) request.tags = tags
  if (categoryIds !== undefined) request.categoryIds = categoryIds
  if (input.favorite !== undefined) {
    if (typeof input.favorite !== 'boolean') throw new Error('收藏状态必须是 true 或 false')
    request.favorite = input.favorite
  }
  if (
    request.name === undefined &&
    request.description === undefined &&
    request.tags === undefined &&
    request.favorite === undefined &&
    request.categoryIds === undefined
  ) {
    throw new Error('请至少提供一项要更新的资源字段')
  }
  return request
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(metadata)
  if (json === undefined || textEncoder.encode(json).byteLength > MAX_RESOURCE_DATA_BYTES)
    throw new Error('该资源可供 APP 读取的数据过大')
  return JSON.parse(json) as Record<string, unknown>
}

function toSnapshot(
  resource: ResourceSummary | Resource,
  includeData = false,
): ExternalAppResourceSnapshot {
  return {
    apiVersion: 'srl-resource@1',
    id: resource.id,
    type: resource.type,
    name: resource.name,
    description: resource.description,
    tags: [...resource.tags],
    favorite: resource.favorite,
    categoryIds: Array.isArray(resource.categoryIds)
      ? [...resource.categoryIds]
      : resource.categoryId
        ? [resource.categoryId]
        : [],
    relatedResourceIds: Array.isArray(resource.relatedResourceIds)
      ? [...resource.relatedResourceIds]
      : [],
    revision: resource.updatedAt,
    format: typeof resource.metadata.format === 'string' ? resource.metadata.format : 'unknown',
    formatVersion:
      typeof resource.metadata.parserVersion === 'number' ? resource.metadata.parserVersion : 1,
    ...(resource.type === RESOURCE_TYPE.CHAT
      ? {
          messageCount: Number(resource.metadata.messageCount) || 0,
          chatCharacter: chatCharacterSummary(resource.metadata),
        }
      : {}),
    ...(includeData ? { data: cloneMetadata(resource.metadata) } : {}),
  }
}

export class ExternalAppSdkService {
  private readonly externalApps: ExternalAppService
  private readonly resources: ResourceService

  constructor(externalApps: ExternalAppService, resources: ResourceService) {
    this.externalApps = externalApps
    this.resources = resources
  }

  async capabilities(appId: string): Promise<{
    apiVersion: typeof EXTERNAL_APP_SDK_VERSION
    permissions: ExternalAppPermission[]
    permissionLevel: string
  }> {
    const app = await this.externalApps.get(appId)
    if (!app?.enabled) throw new Error('APP 已被禁用')
    const permissions = getGrantedExternalAppPermissions(app)
    return {
      apiVersion: EXTERNAL_APP_SDK_VERSION,
      permissions,
      permissionLevel: getExternalAppPermissionLevel(permissions),
    }
  }

  async list(appId: string, payload: unknown): Promise<ExternalAppResourceListResult> {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    const options =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const types = normalizeTypes(options.types)
    const offset = normalizedInteger(options.offset, 0, 100_000)
    const limit = normalizedInteger(options.limit, 25, MAX_PAGE_SIZE)
    const matches = (await this.resources.listResourceListSummaries()).filter(
      (resource) => !types || types.includes(resource.type),
    )
    const items = matches.slice(offset, offset + limit).map((resource) => toSnapshot(resource))
    return {
      items,
      total: matches.length,
      nextOffset: offset + items.length < matches.length ? offset + items.length : null,
    }
  }

  async get(appId: string, resourceId: unknown): Promise<ExternalAppResourceSnapshot> {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ)
    const resource = await this.resources.get(normalizeResourceId(resourceId))
    if (!resource) throw new Error('资源不存在或已被删除')
    return toSnapshot(resource, true)
  }

  async readChat(appId: string, payload: unknown) {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ)
    const input = (payload ?? {}) as Record<string, unknown>
    const textOnly = input.textOnly === true
    if (
      !textOnly &&
      input.interactive === true &&
      (await this.externalApps.get(appId))?.runtimeMode !== 'trustedCompatible'
    )
      throw new Error('交互状态栏需要信任兼容模式')
    if (!textOnly && input.remote === true) {
      await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.NETWORK_HTTPS)
      if ((await this.externalApps.get(appId))?.runtimeMode !== 'trustedCompatible')
        throw new Error('远程资源需要信任兼容模式')
    }
    const reader = new ChatReaderService(this.resources)
    const id = normalizeResourceId(input.id)
    const page = await reader.read(
      id,
      normalizedInteger(input.offset, 0, 10_000_000),
      normalizedInteger(input.limit, 20, 50),
      { hideUser: input.hideUser === true, backward: input.backward === true },
    )
    const chat = await reader.getChat(id)
    const character = await resolveChatCharacter(chat, this.resources)
    const card = character.card
    const names = Array.isArray(chat.metadata.chatUserNames) ? chat.metadata.chatUserNames : []
    const userName =
      typeof input.userName === 'string' && input.userName.trim()
        ? input.userName.trim().slice(0, 160)
        : names.length === 1 && typeof names[0] === 'string'
          ? names[0]
          : undefined
    const {
      chatRenderInput,
      transformChatInputs,
      formatChatResult,
      chatRegexProfileRules,
      archivedChatSnapshot,
      interactiveChatFrontend,
      selectChatReply,
    } = await import('./ChatReaderRendering')
    let extraRules: unknown[] = []
    let presetRules: unknown[] = []
    const sourceErrors: string[] = []
    if (typeof chat.metadata.chatDisplayRegexId === 'string') {
      const regex = await this.resources.get(chat.metadata.chatDisplayRegexId)
      if (regex?.type === RESOURCE_TYPE.REGEX && regex.originalBlob.size <= 2 * 1024 * 1024) {
        const data: unknown = JSON.parse(await regex.originalBlob.text())
        if (isRecord(data)) {
          if (Array.isArray(data.global)) extraRules = data.global
          if (Array.isArray(data.preset)) presetRules = data.preset
        }
      } else sourceErrors.push('随附显示正则不存在或超过 2 MiB，未加载；可在显示正则中替换来源')
    }
    const regexContext = isRecord(chat.metadata.chatRegexContext)
      ? chat.metadata.chatRegexContext
      : {}
    const ruleOverrides = isRecord(input.ruleOverrides)
      ? Object.fromEntries(
          Object.entries(input.ruleOverrides)
            .slice(0, 384)
            .filter((pair): pair is [string, boolean] => typeof pair[1] === 'boolean'),
        )
      : {}
    const renderOptions = {
      regex: input.regex !== false,
      userName,
      extraRules,
      presetRules,
      regexContext,
      ruleOverrides,
      characterRules: undefined as unknown[] | undefined,
    }
    const regexSources: Record<string, { id: string; name: string }> = {}
    if (isRecord(input.regexSources)) {
      for (const scope of ['global', 'preset', 'character'] as const) {
        if (!input.regexSources[scope]) continue
        const resource = await this.resources.get(normalizeResourceId(input.regexSources[scope]))
        if (!resource) throw new Error('所选正则来源已不存在，请在显示正则中恢复随附来源')
        const expectedType =
          scope === 'preset'
            ? RESOURCE_TYPE.PRESET
            : scope === 'character'
              ? RESOURCE_TYPE.CHARACTER_CARD
              : RESOURCE_TYPE.REGEX
        if (resource.type !== expectedType && resource.type !== RESOURCE_TYPE.REGEX)
          throw new Error('所选资源类型不适用于这组正则')
        const { readChatRegexSource } = await import('./ChatReaderRendering')
        const rules = await readChatRegexSource(resource, scope)
        regexSources[scope] = { id: resource.id, name: resource.name }
        if (scope === 'global') renderOptions.extraRules = rules
        else if (scope === 'preset') {
          renderOptions.presetRules = rules
          renderOptions.regexContext = { ...renderOptions.regexContext, presetEnabled: true }
        } else {
          renderOptions.characterRules = rules
          renderOptions.regexContext = { ...renderOptions.regexContext, characterEnabled: true }
        }
      }
    }
    const regexRules = await chatRegexProfileRules(
      card,
      renderOptions,
      isRecord(input.profileRuleOverrides) ? input.profileRuleOverrides : {},
    )
    renderOptions.ruleOverrides = Object.fromEntries(
      regexRules.map((rule) => [rule.key, rule.enabled]),
    )
    const replyOverrides = isRecord(input.replyOverrides) ? input.replyOverrides : {}
    const selectedMessages = page.messages.map((entry) =>
      selectChatReply(entry, replyOverrides[String(entry.index)]),
    )
    const inputs = selectedMessages.map((entry) => chatRenderInput(entry, card, renderOptions))
    const results = await transformChatInputs(inputs)
    const panelTheme =
      input.panelAppearance === 'reader'
        ? input.theme === 'night'
          ? 'night'
          : input.theme === 'green'
            ? 'green'
            : 'paper'
        : undefined
    const messages = []
    const panelColor = document.createElement('span').style
    if (input.panelAppearance === 'reader' && typeof input.panelInk === 'string')
      panelColor.color = input.panelInk
    let responseBytes = 0
    let nextOffset = page.nextOffset
    for (const [index, entry] of selectedMessages.entries()) {
      const result = results[index]!
      const source = result.contents[0] ?? entry.message.mes
      const rendered = formatChatResult(
        source,
        input.remote === true,
        input.blendPanels !== false,
        panelTheme,
        textOnly,
      )
      const snapshot = archivedChatSnapshot(entry, page.total)
      const interactiveFrontends: string[] = []
      if (!textOnly && input.interactive === true)
        for (const frontend of rendered.formatted.frontendBlocks)
          interactiveFrontends.push(
            await interactiveChatFrontend(
              frontend,
              input.remote === true,
              snapshot,
              panelColor.color ||
                (input.blendPanels === false
                  ? undefined
                  : input.theme === 'night'
                    ? '#d0d3c6'
                    : '#26382f'),
              input.theme === 'night' ? 'dark' : 'light',
              panelTheme,
            ),
          )
      const renderedEntry = {
        ...entry,
        archivedSwipeId: Number(page.messages[index]!.message.swipe_id) || 0,
        displaySource: source,
        hiddenByRules:
          result.emptyCauses
            ?.filter((cause) => cause.contentIndex === 0)
            .map((cause) => ({ key: cause.id, name: cause.name })) || [],
        html: rendered.html,
        frontends: rendered.frontends,
        interactiveFrontends,
        snapshot,
        frontendCount: rendered.frontendCount,
        errors: [...sourceErrors, ...(inputs[index]?.diagnostics || []), ...result.errors],
      }
      const bytes = textEncoder.encode(JSON.stringify(renderedEntry)).length
      if (messages.length && responseBytes + bytes > 8 * 1024 * 1024) {
        nextOffset = entry.index
        break
      }
      if (bytes > 8 * 1024 * 1024)
        throw new Error(`第 ${entry.index + 1} 楼渲染内容过大，请使用精简模式或关闭正则`)
      responseBytes += bytes
      messages.push(renderedEntry)
    }
    // Warm only the next adjacent floor's pure regex projection. No media/script documents are built.
    if (input.prefetch === true && page.nextOffset !== null) {
      void reader
        .read(id, page.nextOffset, 1, { hideUser: input.hideUser === true })
        .then((neighbor) =>
          transformChatInputs(
            neighbor.messages.map((entry) =>
              chatRenderInput(
                selectChatReply(entry, replyOverrides[String(entry.index)]),
                card,
                renderOptions,
              ),
            ),
          ),
        )
        .catch(() => undefined) // Speculative work; entering that floor reports errors through normal readChat.
    }
    let replyDiff
    if (Array.isArray(input.compareReplies)) {
      if (input.compareReplies.length !== 2 || !page.messages[0])
        throw new Error('请选择两条回复比较')
      const variants = input.compareReplies.map((value) =>
        selectChatReply(page.messages[0]!, value),
      )
      const projections = await transformChatInputs(
        variants.map((entry) => chatRenderInput(entry, card, renderOptions)),
      )
      const text = projections.map((result) => {
        const rendered = formatChatResult(result.contents[0] || '', false)
        const template = document.createElement('template')
        template.innerHTML = rendered.html
        template.content
          .querySelectorAll('[data-chat-frontend],script,style')
          .forEach((el) => el.remove())
        template.content
          .querySelectorAll('p,br,div,li')
          .forEach((el) => el.append(document.createTextNode('\n')))
        return (template.content.textContent || '').trim().slice(0, 30000)
      })
      const { diffLines } = await import('../utils/ResourceDiff')
      replyDiff = {
        lines: diffLines(text[0]!, text[1]!),
        errors: projections.flatMap((result) => result.errors),
        limit: 30000,
      }
    }
    return {
      ...page,
      nextOffset,
      messages,
      regexRules,
      regexSources,
      replyDiff,
      presetName: regexContext.presetName,
      previewDocumentUrl: OPAQUE_PREVIEW_DOCUMENT_URL,
      userNames: names,
      characterId: character!.id,
    }
  }

  async searchChat(appId: string, payload: unknown) {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ)
    const input = (payload ?? {}) as Record<string, unknown>
    if (typeof input.query !== 'string') throw new Error('请输入搜索词')
    return new ChatReaderService(this.resources).search(
      normalizeResourceId(input.id),
      input.query,
      normalizedInteger(input.offset, 0, 10_000_000),
    )
  }

  async chatChapters(appId: string, payload: unknown) {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ)
    const input = (payload ?? {}) as Record<string, unknown>
    return new ChatReaderService(this.resources).chapters(
      normalizeResourceId(input.id),
      normalizedInteger(input.offset, 0, 10_000_000),
    )
  }

  async chatVariables(appId: string, payload: unknown) {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ)
    const input = (payload ?? {}) as Record<string, unknown>
    return new ChatReaderService(this.resources).variableReview(
      normalizeResourceId(input.id),
      normalizedInteger(input.floor, 0, 10_000_000),
      isRecord(input.replyOverrides) ? input.replyOverrides : {},
    )
  }

  async readerStyle(appId: string, payload: unknown) {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ)
    const input = (payload ?? {}) as Record<string, unknown>
    if (
      input.fonts === true &&
      input.remote === true &&
      (await this.externalApps.get(appId))?.runtimeMode !== 'trustedCompatible'
    )
      throw new Error('请先使用兼容模式，再加载外部字体')
    const resource = await this.resources.get(normalizeResourceId(input.id))
    if (!resource || resource.type !== RESOURCE_TYPE.BEAUTIFICATION)
      throw new Error('请选择资源库中的美化')
    if (resource.originalBlob.size > 256 * 1024)
      throw new Error('美化文件超过 256 KiB，请先提取聊天区域的 CSS')
    const source = await resource.originalBlob.text()
    let css = source
    let theme: Record<string, unknown> = {}
    if (resource.metadata.format !== 'css' && resource.metadata.format !== 'text') {
      const parsed: unknown = JSON.parse(source)
      if (
        !isRecord(parsed) ||
        (parsed.custom_css !== undefined && typeof parsed.custom_css !== 'string')
      )
        throw new Error('美化不含可用的聊天 CSS')
      theme = parsed
      css = typeof parsed.custom_css === 'string' ? parsed.custom_css : ''
    }
    const { chatReaderCss, chatReaderFonts } = await import('./ChatReaderRendering')
    return {
      name: resource.name,
      css: chatReaderCss(css, theme),
      fonts: input.fonts === true ? await chatReaderFonts(css, input.remote === true) : undefined,
    }
  }

  async bindChat(appId: string, payload: unknown): Promise<void> {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_WRITE)
    const input = (payload ?? {}) as Record<string, unknown>
    await new ChatReaderService(this.resources).bind(
      normalizeResourceId(input.id),
      normalizeResourceId(input.characterId),
    )
  }

  async thumbnail(appId: string, resourceId: unknown): Promise<Blob | null> {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_LIBRARY_READ)
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ)
    const resource = await this.resources.get(normalizeResourceId(resourceId))
    if (!resource) return null
    if (resource.type === RESOURCE_TYPE.CHAT)
      return chatCharacterThumbnail(resource.metadata) ?? null
    if (resource.type !== RESOURCE_TYPE.CHARACTER_CARD) return null
    // Only a bounded raster thumbnail is exposed, never the original PNG/card payload.
    const blob = resource.thumbnailBlob
    return blob && blob.size <= 512 * 1024 && /^image\/(png|jpeg|webp)$/.test(blob.type)
      ? blob
      : null
  }

  async listPickable(appId: string, payload: unknown): Promise<ExternalAppResourceSnapshot[]> {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_SELECTED_READ)
    const options =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const types = normalizeTypes(options.types)
    return (await this.resources.listSummaries())
      .filter((resource) => !types || types.includes(resource.type))
      .map((resource) => toSnapshot(resource))
  }

  async getPicked(appId: string, resourceId: unknown): Promise<ExternalAppResourceSnapshot> {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_SELECTED_READ)
    const resource = await this.resources.get(normalizeResourceId(resourceId))
    if (!resource) throw new Error('资源不存在或已被删除')
    const includeData = await this.externalApps.hasPermission(
      appId,
      EXTERNAL_APP_PERMISSION.RESOURCES_CONTENT_READ,
    )
    return toSnapshot(resource, includeData)
  }

  async update(appId: string, payload: unknown): Promise<ExternalAppResourceSnapshot> {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_WRITE)
    const request = normalizeUpdateRequest(payload)
    const update: ExternalAppResourceUpdate = {
      resourceId: request.id,
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.description === undefined ? {} : { description: request.description }),
      ...(request.tags === undefined ? {} : { tags: request.tags }),
      ...(request.favorite === undefined ? {} : { favorite: request.favorite }),
      ...(request.categoryIds === undefined ? {} : { categoryIds: request.categoryIds }),
    }
    return toSnapshot(await this.resources.updateExternalAppResource(update))
  }

  async describeUpdate(appId: string, payload: unknown): Promise<ExternalAppResourceUpdatePreview> {
    await this.requirePermission(appId, EXTERNAL_APP_PERMISSION.RESOURCES_WRITE)
    const request = normalizeUpdateRequest(payload)
    const resource = await this.resources.get(request.id)
    if (!resource) throw new Error('资源不存在或已被删除')
    const current = toSnapshot(resource)
    const fields: Array<keyof Omit<ExternalAppResourceUpdateRequest, 'id'>> = [
      'name',
      'description',
      'tags',
      'favorite',
      'categoryIds',
    ]
    const changes = fields.flatMap((field) => {
      const after = request[field]
      if (after === undefined) return []
      const before = current[field]
      return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field, before, after }]
    })
    return { resource: current, changes }
  }

  private async requirePermission(appId: string, permission: ExternalAppPermission): Promise<void> {
    if (!(await this.externalApps.hasPermission(appId, permission)))
      throw new Error('该 APP 未获得此资源库权限')
  }
}
