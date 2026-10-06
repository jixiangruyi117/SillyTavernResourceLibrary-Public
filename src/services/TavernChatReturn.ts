import { resolveChatCharacter } from './ChatReaderCharacter'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { isRecord } from '../utils/UnknownValue'
import type { ResourceService } from './ResourceService'
import type { TavernResourceItem } from './TavernBridgeProtocol'

export interface ChatReturnPlan {
  avatar: string
  targetLabel: string
  regexFile?: File
}

export async function prepareChatReturn(
  chat: Resource,
  resources: Pick<ResourceService, 'get'>,
  inventory: TavernResourceItem[] | undefined,
  includeRegex: boolean,
): Promise<ChatReturnPlan> {
  const card = await resolveChatCharacter(chat, resources)
  const source = isRecord(chat.metadata.tavernChatSource) ? chat.metadata.tavernChatSource : {}
  const avatar =
    typeof source.avatar === 'string' && source.cardHash === card.contentHash
      ? source.avatar
      : card.fileName
  // eslint-disable-next-line no-control-regex -- reject unsafe wire filenames
  if (avatar.length > 255 || !/^[^\\/\u0000-\u001f]+\.png$/iu.test(avatar))
    throw new Error('聊天尚无有效的酒馆头像文件标识')
  const target = inventory?.find(
    (item) => item.kind === 'character' && item.id === `character:${avatar}`,
  )
  // Filename is only a candidate. The caller must display this exact target for confirmation.
  if (inventory && !target)
    throw new Error(`酒馆中找不到“${avatar}”，请先恢复对应角色卡并刷新目录；未自动改绑同名角色`)
  const plan: ChatReturnPlan = { avatar, targetLabel: `${target?.name ?? card.name}（${avatar}）` }
  if (!includeRegex) return plan
  const data = card.card
  const body = isRecord(data.data) ? data.data : data
  const extensions = isRecord(body.extensions) ? body.extensions : {}
  const rules: unknown[] = Array.isArray(extensions.regex_scripts)
    ? [...extensions.regex_scripts]
    : []
  if (typeof chat.metadata.chatDisplayRegexId === 'string') {
    const extra = await resources.get(chat.metadata.chatDisplayRegexId)
    if (!extra || extra.type !== RESOURCE_TYPE.REGEX || extra.originalBlob.size > 2 * 1024 * 1024)
      throw new Error('聊天配套正则缺失或超过大小限制，可改为只导入聊天记录')
    const parsed: unknown = JSON.parse(await extra.originalBlob.text())
    if (isRecord(parsed))
      rules.unshift(
        ...(Array.isArray(parsed.global) ? parsed.global : []),
        ...(Array.isArray(parsed.preset) ? parsed.preset : []),
      )
  }
  if (rules.length)
    plan.regexFile = new File(
      [
        JSON.stringify({
          sourceAvatar: avatar,
          chatCompanion: true,
          scoped: rules.filter(isRecord).map((rule) => ({ ...rule, disabled: true })),
        }),
      ],
      '聊天配套正则.json',
      { type: 'application/json' },
    )
  return plan
}
