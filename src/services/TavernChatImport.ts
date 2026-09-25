import { createImageThumbnail } from '../utils/createImageThumbnail'
import type { ResourceParserRegistry } from '../parser/ResourceParser'
import type { ImportOptions } from '../types/ResourceOperations'
import type { ImportResult } from '../types/Import'
import { RESOURCE_TYPE, getRelatedResourceIds, type Resource } from '../types/Resource'
import type { ResourceService } from './ResourceService'
import { readChatArchive } from './TavernChatArchiveCodec.mjs'
import { ChatReaderService } from './ChatReaderService'
import { hashBlob } from './HashService'
import { isRecord } from '../utils/UnknownValue'
import { chatCharacterThumbnailData, chatCharacterSummary } from './ChatReaderCharacter'

function resourceOf(result: ImportResult): Resource {
  if (result.status === 'failed') throw new Error(result.message)
  if (result.status === 'versionCandidate') throw new Error('配套角色卡需要确认版本')
  return result.resource
}

/** Archive framing only; parsing, persistence and relationships use their existing owners. */
export async function importTavernChat(
  file: File,
  resources: ResourceService,
  parser: ResourceParserRegistry,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const { card, chat, avatar, displayRules, presetRules, regexContext, hasRegexSnapshot } =
    await readChatArchive(file)
  // Validate both before the first write. A filename or chat speaker never proves card identity.
  const cardParsed = await parser.parse(card)
  const chatParsed = await parser.parse(chat)
  if (cardParsed.type !== RESOURCE_TYPE.CHARACTER_CARD || chatParsed.type !== RESOURCE_TYPE.CHAT)
    throw new Error('聊天传输包必须包含可识别的 PNG 角色卡和 JSONL 聊天原件')
  const cardHash = await hashBlob(card)
  const chatHash = await hashBlob(chat)
  const summaries = await resources.listResourceListSummaries()
  const saveCharacter =
    options.saveChatCharacter === true ||
    options.saveChatCharacterHashes?.includes(cardHash) === true
  const chosenId = options.chatCharacterBindings?.[cardHash]
  const exact = summaries.find(
    (r) =>
      r.type === RESOURCE_TYPE.CHARACTER_CARD &&
      r.contentHash === cardHash &&
      (chosenId ? r.id === chosenId : saveCharacter && chosenId !== null),
  )
  if (chosenId && !exact) throw new Error('待关联角色卡已变更，请重新确认后导入')
  let character = exact ? await resources.get(exact.id) : undefined
  const extractedResources: Resource[] = []
  if (!character && saveCharacter) {
    const cardResult = await resources.importPreparedFile(card, cardParsed, {
      allowContentDuplicate: true,
    })
    character = resourceOf(cardResult)
    if (cardResult.status === 'imported') extractedResources.push(character)
  }
  if (character && (await hashBlob(character.originalBlob)) !== cardHash)
    throw new Error('配套角色卡保存校验失败，聊天尚未绑定')
  const parsedCard = isRecord(cardParsed.metadata.card) ? cardParsed.metadata.card : {}
  const body = isRecord(parsedCard.data) ? parsedCard.data : parsedCard
  const extensions = isRecord(body.extensions) ? body.extensions : {}
  const companion = {
    hash: cardHash,
    name: cardParsed.name,
    avatar,
    card: {
      name: cardParsed.name,
      extensions: {
        regex_scripts: Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : [],
      },
    },
    thumbnail: await chatCharacterThumbnailData(
      character?.thumbnailBlob ??
        (await createImageThumbnail(card, { maxEdge: 480, quality: 0.75 })),
    ),
  }
  const characterIds = new Set(
    summaries.filter((r) => r.type === RESOURCE_TYPE.CHARACTER_CARD).map((r) => r.id),
  )
  const candidates = summaries.filter(
    (r) => r.type === RESOURCE_TYPE.CHAT && r.contentHash === chatHash,
  )
  const bound = candidates.find((r) => {
    const ids = getRelatedResourceIds(r).filter((id) => characterIds.has(id))
    return character
      ? ids.length === 1 && ids[0] === character.id
      : ids.length === 0 && chatCharacterSummary(r.metadata)?.hash === cardHash
  })
  const unbound = candidates.find(
    (r) =>
      !getRelatedResourceIds(r).some((id) => characterIds.has(id)) &&
      (!chatCharacterSummary(r.metadata) || chatCharacterSummary(r.metadata)?.hash === cardHash),
  )
  const existing = bound ?? unbound
  const original = existing ? await resources.get(existing.id) : undefined
  // Identical bytes belonging to a different character get a separate resource, never a rebind.
  const result: ImportResult = original
    ? {
        status: 'duplicate',
        fileName: file.name,
        resource: original,
        reclassified: false,
        message: '相同聊天已存在，已核对所属角色',
      }
    : await resources.importPreparedFile(
        chat,
        {
          ...chatParsed,
          description: `${chatParsed.metadata.messageCount} 楼 · ${cardParsed.name}`,
          metadata: {
            ...chatParsed.metadata,
            chatCharacter: companion,
            tavernChatSource: { avatar, chatName: chat.name, cardHash },
          },
        },
        { allowContentDuplicate: true },
      )
  const imported = resourceOf(result)
  await resources.updateMetadata(imported.id, {
    chatCharacter: companion,
    tavernChatSource: { avatar, chatName: chat.name, cardHash },
  })
  if (!bound && character) await new ChatReaderService(resources).bind(imported.id, character.id)
  if (displayRules.length || presetRules.length) {
    const regexFile = new File(
      [
        JSON.stringify({
          sourceName: `${cardParsed.name} · 聊天显示正则`,
          ...(displayRules.length ? { global: displayRules } : {}),
          preset: presetRules,
        }),
      ],
      '聊天显示正则.json',
      { type: 'application/json' },
    )
    const parsedRegex = await parser.parse(regexFile)
    let regexResult = await resources.importPreparedFile(regexFile, parsedRegex)
    let regex = resourceOf(regexResult)
    if (!(await resources.get(regex.id))) {
      regexResult = await resources.importPreparedFile(regexFile, parsedRegex, {
        allowContentDuplicate: true,
      })
      regex = resourceOf(regexResult)
    }
    const savedRegex = await resources.get(regex.id)
    if (!savedRegex || (await hashBlob(savedRegex.originalBlob)) !== (await hashBlob(regexFile)))
      throw new Error('聊天显示正则保存校验失败，请保留酒馆原件后重试')
    if (regexResult.status === 'imported') extractedResources.push(regex)
    await resources.updateMetadata(imported.id, { chatDisplayRegexId: regex.id })
  } else if (hasRegexSnapshot) {
    await resources.updateMetadata(imported.id, { chatDisplayRegexId: null })
  }
  if (hasRegexSnapshot)
    await resources.updateMetadata(imported.id, { chatRegexContext: regexContext })
  const saved = await resources.get(imported.id)
  if (
    !saved ||
    (await hashBlob(saved.originalBlob)) !== chatHash ||
    (character
      ? !getRelatedResourceIds(saved).includes(character.id)
      : chatCharacterSummary(saved.metadata)?.hash !== cardHash)
  )
    throw new Error('聊天入库或角色关联校验失败，请保留酒馆原件并重试')
  if (result.status !== 'imported' && result.status !== 'duplicate') return result
  return {
    ...result,
    fileName: file.name,
    resource: saved,
    extractedResources,
  }
}
