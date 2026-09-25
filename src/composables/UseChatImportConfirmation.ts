import { chooseAction } from './UseConfirmDialog'
import type { ResourceService } from '../services/ResourceService'
import type { ImportOptions } from '../types/ResourceOperations'
import { RESOURCE_TYPE } from '../types/Resource'
import { readChatArchive } from '../services/TavernChatArchiveCodec.mjs'
import { hashBlob } from '../services/HashService'

/** All receive/file-import entrances share this choice before any resource is written. */
export async function confirmChatImports(
  files: File[],
  resources: ResourceService,
): Promise<ImportOptions | null> {
  const archives = files.filter((file) => /\.srlchat$/i.test(file.name))
  if (!archives.length) return {}
  const options: ImportOptions = { chatCharacterBindings: {}, saveChatCharacterHashes: [] }
  for (const file of archives) {
    const { card, chat, avatar } = await readChatArchive(file)
    const hash = await hashBlob(card)
    if (Object.hasOwn(options.chatCharacterBindings!, hash)) continue
    const match = await resources.findByContentHash(hash)
    const existing = match?.type === RESOURCE_TYPE.CHARACTER_CARD ? match : undefined
    const choice = await chooseAction({
      centered: true,
      title: existing ? '确认聊天所属角色' : '导入聊天记录',
      message: existing
        ? `聊天：${chat.name}\n酒馆角色文件：${avatar}\n\n资源库已有：${existing.name}\n文件：${existing.fileName}\n标识：${existing.id}\n\n随附卡与这张卡的文件内容完全一致。确认使用这张卡关联聊天吗？同批次此角色的聊天会采用相同选择。`
        : `聊天：${chat.name}\n角色文件：${avatar}\n\n没有找到内容完全一致的已有卡。默认将头像和阅读正则随聊天保存，不新增独立角色卡。同批次此角色的聊天会采用相同选择。`,
      confirmLabel: existing ? '使用这张卡' : '只保存聊天',
      alternativeLabel: existing ? '使用聊天自带资料' : '同时保存角色卡',
      cancelLabel: '取消导入',
    })
    if (choice === 'cancel') return null
    options.chatCharacterBindings![hash] = existing && choice === 'confirm' ? existing.id : null
    if (!existing && choice === 'alternative') options.saveChatCharacterHashes!.push(hash)
  }
  return options
}
