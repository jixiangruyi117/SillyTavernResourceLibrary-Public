import {
  analyzeResourceLink,
  getResourceLinkRiskBadges,
  normalizeResourceLinks,
  RESOURCE_INSTALL_TARGET,
  RESOURCE_INSTALL_TARGET_LABELS,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_PURPOSE_LABELS,
  RESOURCE_TYPE,
  type ResourceLink,
  type ResourceType,
} from '../types/Resource'
import { type GitHubResourceInspection } from './GitHubResourceInspector'

export function safeLinkFileName(value: string): string {
  const normalized = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 120)
  return `${normalized || '外部链接资源'}.srl-link.json`
}

export function linkResourceType(link: ResourceLink): ResourceType {
  switch (link.installTarget) {
    case RESOURCE_INSTALL_TARGET.SILLYTAVERN_EXTENSION:
      return RESOURCE_TYPE.PLUGIN
    case RESOURCE_INSTALL_TARGET.TAVERN_HELPER_SCRIPT:
    case RESOURCE_INSTALL_TARGET.STSCRIPT:
      return RESOURCE_TYPE.SCRIPT
    case RESOURCE_INSTALL_TARGET.REGEX:
      return RESOURCE_TYPE.REGEX
    case RESOURCE_INSTALL_TARGET.THEME:
      return RESOURCE_TYPE.BEAUTIFICATION
    default:
      return RESOURCE_TYPE.OTHER
  }
}

export function linkResourceName(
  link: ResourceLink,
  inspection?: GitHubResourceInspection,
): string {
  if (inspection?.name) return inspection.name
  if (link.label.trim()) return link.label.trim()
  if (link.github) return `${link.github.owner}/${link.github.repo}`
  try {
    const parsed = new URL(link.url)
    const pathName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) ?? '')
    return pathName || parsed.hostname.replace(/^www\./, '')
  } catch {
    return '外部链接资源'
  }
}

export function linkResourceDescription(
  link: ResourceLink,
  inspection?: GitHubResourceInspection,
): string {
  const purpose = RESOURCE_LINK_PURPOSE_LABELS[link.purpose ?? RESOURCE_LINK_PURPOSE.SOURCE_POST]
  const target =
    RESOURCE_INSTALL_TARGET_LABELS[link.installTarget ?? RESOURCE_INSTALL_TARGET.NONE] ?? '不安装'
  const version = link.versionRef ? ` · ${link.versionRef.kind}:${link.versionRef.value}` : ''
  const structural = `链接型资源 · ${purpose} · ${target}${version}。`
  if (!inspection) return `${structural}尚未读取远端内容；资源库不安装、不执行。`
  if (inspection.status === 'unavailable') {
    return `${structural}${inspection.warning ?? '远端内容暂时无法读取。'}资源库不安装、不执行。`
  }
  const manifestDetails = inspection.manifest
    ? [
        inspection.manifest.version ? `版本 ${inspection.manifest.version}` : '',
        inspection.manifest.author ? `作者 ${inspection.manifest.author}` : '',
        inspection.manifest.minimumClientVersion
          ? `最低 SillyTavern ${inspection.manifest.minimumClientVersion}`
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const evidence = inspection.evidence.length ? `识别依据：${inspection.evidence.join('、')}。` : ''
  return [
    structural,
    inspection.summary ? `功能说明：${inspection.summary}` : '仓库没有提供可读取的功能说明。',
    manifestDetails ? `${manifestDetails}。` : '',
    inspection.archived ? '仓库已归档。' : '',
    evidence,
    '资源库只读取公开说明，不安装、不执行。',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2400)
}

export function linkResourceTags(
  link: ResourceLink,
  inspection?: GitHubResourceInspection,
): string[] {
  return normalizeTags([
    '外部链接',
    link.type === 'github' ? 'GitHub' : '',
    link.installTarget === RESOURCE_INSTALL_TARGET.SILLYTAVERN_EXTENSION ? '扩展插件' : '',
    link.installTarget === RESOURCE_INSTALL_TARGET.TAVERN_HELPER_SCRIPT ? '酒馆助手脚本' : '',
    link.installTarget === RESOURCE_INSTALL_TARGET.STSCRIPT ? 'STscript' : '',
    getResourceLinkRiskBadges(link).includes('可执行内容') ? '可执行内容' : '',
    link.versionRef?.kind === 'commit' || link.versionRef?.kind === 'release' ? '固定版本' : '',
    inspection?.status === 'identified' ? '内容已识别' : '',
    inspection?.status === 'described' ? '说明已读取' : '',
    inspection?.archived ? '已归档' : '',
    ...(inspection?.topics.slice(0, 6) ?? []),
  ])
}

export function createResourceLinkDraftFromUrl(
  url: string,
  createdAt: number,
): ResourceLink | undefined {
  const analysis = analyzeResourceLink(url)
  if (!analysis.url || !analysis.type) return undefined
  return normalizeResourceLinks([
    {
      id:
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `resource-link-${createdAt}`,
      label: '',
      url: analysis.url,
      type: analysis.type,
      purpose: analysis.purpose,
      installTarget: analysis.installTarget,
      trustMode: analysis.trustMode,
      versionRef: analysis.versionRef,
      github: analysis.github,
      createdAt,
    },
  ])[0]
}

export function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)))
}
