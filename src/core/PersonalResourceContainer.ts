import { appDatabase } from './AppDatabaseInstance'
import { resourceService } from './AppContainer'
import { IndexedDbRestoreStagingStore } from '../storage/IndexedDbRestoreStagingStore'
import { PersonalResourceService } from '../services/PersonalResourceService'
export const personalResourceService = new PersonalResourceService(
  resourceService,
  new IndexedDbRestoreStagingStore(appDatabase),
)

export async function restorePlainSecretCopies(
  copies: import('../services/PersonalResourceBackup').PlainSecretCopy[],
): Promise<void> {
  if (!Array.isArray(copies) || !copies.length) return
  const { confirmAction } = await import('../composables/UseConfirmDialog')
  if (
    !(await confirmAction({
      title: '恢复明文密钥副本',
      message: `备份包含 ${copies.length} 张密钥卡的明文副本。是否使用本机查看密码重新加密保存？取消则只保留已恢复的加密原件。`,
      confirmLabel: '重新加密保存',
    }))
  )
    return
  const { secretResourceService } = await import('../services/SecretResourceService')
  const { requestSecretPassword } = await import('../composables/UseSecretPasswordPrompt')
  if (!(await secretResourceService.hasPassword()))
    throw new Error('加密原件已保留；请先在总设置中设置统一密码，再恢复明文副本')
  const password = await requestSecretPassword('输入总设置中的统一密码。取消不影响加密原件恢复。')
  if (!password) return
  const { parsePersonalResource } = await import('../types/PersonalResource')
  const summaries = await resourceService.listSummaries()
  const prepared = []
  for (const copy of copies) {
    const document = parsePersonalResource(copy.document)
    if (document.kind !== 'secret') throw new Error('明文密钥副本类型无效')
    const target = summaries.find(
      (resource) => resource.type === 'secret' && resource.contentHash === copy.contentHash,
    )
    if (!target) continue
    const resource = await resourceService.get(target.id)
    if (!resource) continue
    prepared.push({ resource, document: await secretResourceService.protect(document, password) })
  }
  for (const item of prepared)
    await personalResourceService.save(item.document, new Map(), item.resource)
}
