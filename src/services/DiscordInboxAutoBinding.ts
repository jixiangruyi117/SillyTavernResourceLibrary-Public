import type { CommunitySourceService } from './CommunitySourceService'
import type { DiscordInboxAutomationSettings } from './DiscordInboxAutomationSettings'
import type { ResourceListSummary } from '../types/Resource'

type AutoBindingRule = NonNullable<
  import('../types/CommunitySource').ResourceSourceBinding['autoBindingRule']
>

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

function authorLabel(content: string): string | undefined {
  const match = content.match(/(?:^|\n)\s*(?:作者|author)\s*[:：]\s*([^\r\n]+)/iu)
  const value = match?.[1]?.trim()
  return value ? normalize(value) : undefined
}

function isPngCard(resource: ResourceListSummary): boolean {
  return resource.type === 'characterCard' && /\.png$/iu.test(resource.fileName)
}

export async function markPostForNextPng(
  communitySources: CommunitySourceService,
  sourceId: string,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return
  const source = await communitySources.getSourceForAutomation(sourceId)
  if (!source) return
  await communitySources.updateAutomationPendingPng(sourceId, true)
}

/** Match an automatically saved cloud post against a bounded window of recent local cards. */
export async function autoBindPostToRecentCard(
  communitySources: CommunitySourceService,
  resourceService: { listRecentCharacterCards(limit: number): Promise<ResourceListSummary[]> },
  source: { id: string; title?: string },
  starterContent: string,
  settings: DiscordInboxAutomationSettings,
): Promise<{ resourceId: string; rule: AutoBindingRule } | undefined> {
  if (!settings.bindSameName && !settings.bindSameAuthor) return undefined
  const cards = await resourceService.listRecentCharacterCards(10)
  const postText = normalize(`${source.title ?? ''}\n${starterContent}`)
  const postAuthor = authorLabel(starterContent)
  const rules: Array<{ enabled: boolean; rule: AutoBindingRule }> = [
    { enabled: settings.bindSameName, rule: 'same-name' },
    { enabled: settings.bindSameAuthor, rule: 'same-author' },
  ]
  for (const { enabled, rule } of rules) {
    if (!enabled) continue
    const matches = cards.filter((card) => {
      if (rule === 'same-name') {
        const name = normalize(card.name)
        return name.length > 0 && postText.includes(name)
      }
      const creator = normalize(
        typeof card.metadata.creator === 'string' ? card.metadata.creator : '',
      )
      return Boolean(postAuthor && creator && postAuthor === creator)
    })
    if (matches.length > 1) return undefined
    const card = matches[0]
    if (!card) continue
    const ruleLabel = rule === 'same-name' ? '同名' : '同作者'
    await communitySources.bindSource(
      card.id,
      source.id,
      `自动关联：${ruleLabel} · ${card.name}`,
      rule,
    )
    return { resourceId: card.id, rule }
  }
  return undefined
}

/** Binds only one unambiguous cloud-arrived card to one of the five newest unbound posts. */
export async function autoBindIncomingCard(
  communitySources: CommunitySourceService,
  resource: ResourceListSummary,
  settings: DiscordInboxAutomationSettings,
): Promise<{ sourceId: string; rule: AutoBindingRule } | undefined> {
  if (resource.type !== 'characterCard') return undefined
  const pending = await communitySources.listUnboundForAutomation(5)
  const sources = pending.map(({ source, starter }) => ({ source, starter }))
  const rules: Array<{ enabled: boolean; rule: AutoBindingRule }> = [
    { enabled: settings.bindSameName, rule: 'same-name' },
    { enabled: settings.bindSameAuthor, rule: 'same-author' },
    { enabled: settings.bindNextPng && isPngCard(resource), rule: 'next-png' },
  ]
  const cardName = normalize(resource.name)
  const creator = normalize(
    typeof resource.metadata.creator === 'string' ? resource.metadata.creator : '',
  )
  for (const { enabled, rule } of rules) {
    if (!enabled) continue
    let matching: typeof sources = []
    if (rule === 'same-name' && cardName) {
      matching = sources.filter(({ source, starter }) => {
        const body = `${source.title ?? ''}\n${starter?.content ?? ''}`
        return normalize(body).includes(cardName)
      })
    } else if (rule === 'same-author' && creator) {
      matching = sources.filter(({ starter }) =>
        starter ? authorLabel(starter.content) === creator : false,
      )
    } else if (rule === 'next-png') {
      matching = sources.filter(({ source }) => source.autoBindPendingPng === true)
      // A queued post consumes the next PNG in arrival order (oldest pending first).
      matching = matching.slice(-1)
    }
    if (matching.length > 1) return undefined
    if (!matching.length) continue
    const source = matching[0]!.source
    if (rule === 'next-png') await communitySources.updateAutomationPendingPng(source.id, false)
    const ruleLabel = rule === 'same-name' ? '同名' : rule === 'same-author' ? '同作者' : '后续 PNG'
    await communitySources.bindSource(
      resource.id,
      source.id,
      `自动关联：${ruleLabel} · ${resource.name}`,
      rule,
    )
    return { sourceId: source.id, rule }
  }
  return undefined
}
