import type { ArchivePortableSelection } from '../types/Backup'
import type { CloudBackupContentSelection } from '../types/CloudBackup'
import {
  RESOURCE_TYPE,
  RESOURCE_TYPE_LABELS,
  type ResourceSummary,
  type ResourceType,
} from '../types/Resource'

export const BACKUP_SCOPE_REGISTRY_VERSION = 1

export type BackupScopeGroupId = 'tavernResources' | 'manualResources' | 'extraContent'
export type BackupScopeId =
  | 'resource.characterCard'
  | 'resource.greeting'
  | 'resource.chat'
  | 'resource.worldBook'
  | 'resource.userPersona'
  | 'resource.beautification'
  | 'resource.regex'
  | 'resource.preset'
  | 'resource.quickReply'
  | 'resource.script'
  | 'resource.plugin'
  | 'resource.other'
  | 'resource.extraStory'
  | 'resource.pocketPhone'
  | 'resource.secret'
  | 'extra.communitySources'
  | 'extra.externalApps'
  | 'extra.chatReader'
  | 'extra.aiTaggingState'
  | 'extra.stitchWork'
  | 'extra.appearance'
  | 'extra.generalPreferences'
  | 'extra.characterDraw'
  | 'extra.cloudBackup'
  | 'extra.credentials'
  | 'extra.plaintextSecretCopy'

export interface BackupScopeDefinition {
  id: BackupScopeId
  group: BackupScopeGroupId
  label: string
  description: string
  resourceType?: ResourceType
  sensitive?: boolean
  privacyWarning?: boolean
  defaultLocal: boolean
  defaultCloud: boolean
}

export const BACKUP_SCOPE_GROUPS: ReadonlyArray<{
  id: BackupScopeGroupId
  label: string
  description: string
}> = [
  { id: 'tavernResources', label: '酒馆资源', description: '角色卡、正则、美化、世界书和常用资源' },
  { id: 'manualResources', label: '手动添加资源', description: '番外、小手机和密钥等独立资源' },
  { id: 'extraContent', label: '额外资源', description: '社区内容、APP 数据、设置与工作草稿' },
]

const resourceScope = (
  id: BackupScopeId,
  resourceType: ResourceType,
  group: BackupScopeGroupId,
): BackupScopeDefinition => ({
  id,
  group,
  label: RESOURCE_TYPE_LABELS[resourceType],
  description: `${RESOURCE_TYPE_LABELS[resourceType]}资源及其文件内容`,
  resourceType,
  sensitive: resourceType === RESOURCE_TYPE.SECRET,
  defaultLocal: resourceType !== RESOURCE_TYPE.SECRET,
  defaultCloud: resourceType !== RESOURCE_TYPE.SECRET,
})

export const BACKUP_SCOPE_REGISTRY: ReadonlyArray<BackupScopeDefinition> = [
  resourceScope('resource.characterCard', RESOURCE_TYPE.CHARACTER_CARD, 'tavernResources'),
  resourceScope('resource.chat', RESOURCE_TYPE.CHAT, 'tavernResources'),
  resourceScope('resource.greeting', RESOURCE_TYPE.GREETING, 'tavernResources'),
  resourceScope('resource.worldBook', RESOURCE_TYPE.WORLD_BOOK, 'tavernResources'),
  resourceScope('resource.userPersona', RESOURCE_TYPE.USER_PERSONA, 'tavernResources'),
  resourceScope('resource.beautification', RESOURCE_TYPE.BEAUTIFICATION, 'tavernResources'),
  resourceScope('resource.regex', RESOURCE_TYPE.REGEX, 'tavernResources'),
  resourceScope('resource.preset', RESOURCE_TYPE.PRESET, 'tavernResources'),
  resourceScope('resource.quickReply', RESOURCE_TYPE.QUICK_REPLY, 'tavernResources'),
  resourceScope('resource.script', RESOURCE_TYPE.SCRIPT, 'tavernResources'),
  resourceScope('resource.plugin', RESOURCE_TYPE.PLUGIN, 'tavernResources'),
  resourceScope('resource.other', RESOURCE_TYPE.OTHER, 'tavernResources'),
  resourceScope('resource.extraStory', RESOURCE_TYPE.EXTRA_STORY, 'manualResources'),
  resourceScope('resource.pocketPhone', RESOURCE_TYPE.POCKET_PHONE, 'manualResources'),
  {
    ...resourceScope('resource.secret', RESOURCE_TYPE.SECRET, 'manualResources'),
    description: '密钥资源原件保持加密；明文副本必须单独确认',
  },
  {
    id: 'extra.communitySources',
    group: 'extraContent',
    label: 'Discord 社区内容',
    description: '帖子正文、评论和已保存附件，可能包含个人信息',
    privacyWarning: true,
    defaultLocal: true,
    defaultCloud: false,
  },
  {
    id: 'extra.externalApps',
    group: 'extraContent',
    label: '第三方 APP 数据',
    description: 'APP 清单、本地数据和权限状态，恢复后保持禁用',
    privacyWarning: true,
    defaultLocal: false,
    defaultCloud: false,
  },
  {
    id: 'extra.chatReader',
    group: 'extraContent',
    label: '读了么阅读数据',
    description: '阅读进度、备注、收藏、回复选择和角色阅读外观；聊天原件请同时选择聊天记录',
    defaultLocal: true,
    defaultCloud: true,
  },
  {
    id: 'extra.aiTaggingState',
    group: 'extraContent',
    label: 'AI 标签工作区',
    description: '标签草稿与撤销记录',
    defaultLocal: false,
    defaultCloud: false,
  },
  {
    id: 'extra.stitchWork',
    group: 'extraContent',
    label: '预设缝合工作区',
    description: '缝合草稿与检查点',
    defaultLocal: false,
    defaultCloud: false,
  },
  {
    id: 'extra.appearance',
    group: 'extraContent',
    label: '外观与 CSS',
    description: '主题、排版、自定义 CSS 与预设',
    defaultLocal: true,
    defaultCloud: true,
  },
  {
    id: 'extra.generalPreferences',
    group: 'extraContent',
    label: '常用偏好',
    description: '预览安全、导入偏好、搜索历史和快照数量',
    defaultLocal: true,
    defaultCloud: true,
  },
  {
    id: 'extra.characterDraw',
    group: 'extraContent',
    label: '抽了么记录',
    description: '累计次数、遇见记录和名字显示偏好',
    defaultLocal: true,
    defaultCloud: true,
  },
  {
    id: 'extra.cloudBackup',
    group: 'extraContent',
    label: '云备份配置',
    description: 'Provider、目录、频率和保护选项，不包含凭据',
    defaultLocal: true,
    defaultCloud: true,
  },
  {
    id: 'extra.credentials',
    group: 'extraContent',
    label: '应用凭据',
    description: 'API Key、GitHub Token、WebDAV 密码和 Bot Token',
    sensitive: true,
    defaultLocal: false,
    defaultCloud: false,
  },
  {
    id: 'extra.plaintextSecretCopy',
    group: 'extraContent',
    label: '明文密钥副本',
    description: '可直接读取的密钥字段，必须单独确认',
    sensitive: true,
    defaultLocal: false,
    defaultCloud: false,
  },
]

export interface BackupSelectionTreeState {
  resourceIds: Set<string>
  scopes: Set<BackupScopeId>
}

export function createDefaultBackupSelection(
  resources: readonly ResourceSummary[],
  mode: 'local' | 'cloud',
): BackupSelectionTreeState {
  const selectedResourceTypes = new Set(
    BACKUP_SCOPE_REGISTRY.filter((scope) =>
      mode === 'local' ? scope.defaultLocal : scope.defaultCloud,
    )
      .map((scope) => scope.resourceType)
      .filter((type): type is ResourceType => Boolean(type)),
  )
  return {
    resourceIds: new Set(
      resources
        .filter((resource) => selectedResourceTypes.has(resource.type))
        .map((resource) => resource.id),
    ),
    scopes: new Set(
      BACKUP_SCOPE_REGISTRY.filter((scope) =>
        mode === 'local' ? scope.defaultLocal : scope.defaultCloud,
      ).map((scope) => scope.id),
    ),
  }
}

export function scopeForResource(
  resource: Pick<ResourceSummary, 'type'>,
): BackupScopeDefinition | undefined {
  return BACKUP_SCOPE_REGISTRY.find((scope) => scope.resourceType === resource.type)
}

export function toArchivePortableSelection(
  state: BackupSelectionTreeState,
): ArchivePortableSelection {
  return {
    personalResources: {
      extraStory: state.scopes.has('resource.extraStory'),
      pocketPhone: state.scopes.has('resource.pocketPhone'),
      secret: state.scopes.has('resource.secret'),
    },
    plaintextSecretCopy: state.scopes.has('extra.plaintextSecretCopy'),
    appearance: state.scopes.has('extra.appearance'),
    cloudBackup: state.scopes.has('extra.cloudBackup'),
    characterDraw: state.scopes.has('extra.characterDraw'),
    generalPreferences: state.scopes.has('extra.generalPreferences'),
    mainApiProfiles: state.scopes.has('extra.credentials'),
    aiTaggingState: state.scopes.has('extra.aiTaggingState'),
    externalApps: state.scopes.has('extra.externalApps'),
    chatReader: state.scopes.has('extra.chatReader'),
    stitchWork: state.scopes.has('extra.stitchWork'),
    communitySources: state.scopes.has('extra.communitySources'),
  }
}

export function toCloudContentSelection(
  state: BackupSelectionTreeState,
): CloudBackupContentSelection {
  return {
    personalResources: {
      extraStory: state.scopes.has('resource.extraStory'),
      pocketPhone: state.scopes.has('resource.pocketPhone'),
      secret: state.scopes.has('resource.secret'),
    },
    plaintextSecretCopy: state.scopes.has('extra.plaintextSecretCopy'),
    credentials: state.scopes.has('extra.credentials'),
    aiTaggingState: state.scopes.has('extra.aiTaggingState'),
    externalApps: state.scopes.has('extra.externalApps'),
    chatReader: state.scopes.has('extra.chatReader'),
    stitchWork: state.scopes.has('extra.stitchWork'),
    resourceIds: [...state.resourceIds],
    communitySources: state.scopes.has('extra.communitySources'),
    appearance: state.scopes.has('extra.appearance'),
    cloudBackup: state.scopes.has('extra.cloudBackup'),
    characterDraw: state.scopes.has('extra.characterDraw'),
    generalPreferences: state.scopes.has('extra.generalPreferences'),
  }
}

export function registeredBackupScopeIds(): Set<string> {
  return new Set(BACKUP_SCOPE_REGISTRY.map((scope) => scope.id))
}
