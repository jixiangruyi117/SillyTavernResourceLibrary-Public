import type { Resource, ResourceSummary } from '../types/Resource'
import type { CloudBackupConfig } from '../types/CloudBackup'
import { parsePersonalResource, type PersonalResourceDocument } from '../types/PersonalResource'

export interface PersonalResourceSelection {
  extraStory?: boolean
  pocketPhone?: boolean
  secret?: boolean
  resourceIds?: string[]
}
export interface PlainSecretCopy {
  contentHash: string
  document: PersonalResourceDocument
}

export function includePersonalResource(
  resource: Pick<ResourceSummary, 'type'>,
  selection?: PersonalResourceSelection,
): boolean {
  if (resource.type === 'extraStory') return selection?.extraStory !== false
  if (resource.type === 'pocketPhone') return selection?.pocketPhone !== false
  if (resource.type === 'secret') return selection?.secret === true
  return true
}

export async function plaintextSecretCopies(
  resources: readonly Resource[],
  password: string,
): Promise<PlainSecretCopy[]> {
  const { secretResourceService } = await import('./SecretResourceService')
  const copies: PlainSecretCopy[] = []
  for (const resource of resources) {
    if (resource.type !== 'secret') continue
    if (resource.originalBlob.size > 2 * 1024 * 1024) throw new Error('密钥资源超过大小限制')
    const document = parsePersonalResource(JSON.parse(await resource.originalBlob.text()))
    const fields = await secretResourceService.reveal(document, password)
    copies.push({
      contentHash: resource.contentHash,
      document: { ...document, fields, protected: undefined },
    })
  }
  return copies
}

async function grantId(config: CloudBackupConfig): Promise<string> {
  const target =
    config.provider === 'github'
      ? ['github', config.owner.trim().toLowerCase(), config.repository.trim().toLowerCase()]
      : [
          'webdav',
          config.baseUrl.trim().replace(/\/+$/, ''),
          config.username.trim().toLowerCase(),
          config.folder.trim().replace(/^\/+|\/+$/g, '') || 'SRL-Backups',
        ]
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(target))),
  )
  return `personal-export.${Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('')}`
}
export async function savePlainSecretExportGrant(
  config: CloudBackupConfig,
  password: string,
): Promise<void> {
  const { localCredentialStore } = await import('./LocalCredentialStore')
  await localCredentialStore.save(await grantId(config), password)
}
export async function readPlainSecretExportGrant(config: CloudBackupConfig): Promise<string> {
  const { localCredentialStore } = await import('./LocalCredentialStore')
  return localCredentialStore.read(await grantId(config))
}
export async function clearPlainSecretExportGrant(config: CloudBackupConfig): Promise<void> {
  const { localCredentialStore } = await import('./LocalCredentialStore')
  await localCredentialStore.clear(await grantId(config))
}

export async function cloudPlainSecretCopies(
  config: CloudBackupConfig,
  resources: import('./ResourceService').ResourceService,
): Promise<PlainSecretCopy[]> {
  const password = await readPlainSecretExportGrant(config)
  if (!password)
    throw new Error('当前备份目标尚未授权明文密钥副本，请在设置中确认，或关闭明文副本保留加密备份')
  const copies: PlainSecretCopy[] = []
  for (const summary of await resources.listSummaries()) {
    if (summary.type !== 'secret' || summary.metadata.cloudBackupExcluded === true) continue
    const resource = await resources.get(summary.id)
    if (resource) copies.push(...(await plaintextSecretCopies([resource], password)))
  }
  if (new TextEncoder().encode(JSON.stringify(copies)).length > 2 * 1024 * 1024)
    throw new Error('明文密钥副本超过 2 MB；请关闭明文副本，仍可完整备份加密原件')
  return copies
}

export function selectCloudResources(
  resources: ResourceSummary[],
  selection?: PersonalResourceSelection,
): ResourceSummary[] {
  const selectedIds = selection?.resourceIds ? new Set(selection.resourceIds) : undefined
  return resources.filter(
    (resource) =>
      resource.metadata.cloudBackupExcluded !== true &&
      (!selectedIds || selectedIds.has(resource.id)) &&
      includePersonalResource(resource, selection),
  )
}
