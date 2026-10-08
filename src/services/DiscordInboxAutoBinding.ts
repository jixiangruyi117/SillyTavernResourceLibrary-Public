import type { CommunitySourceService } from './CommunitySourceService'
import { noticeCenter } from '../core/NoticeCenter'
import { notifyNativeDiscordAutoBinding } from './NativeDiscordInboxService'
import type { DiscordInboxAutomationSettings } from './DiscordInboxAutomationSettings'
import type { CommunitySource, CommunitySourceAutoBindCandidate } from '../types/CommunitySource'
import type { ResourceListSummary } from '../types/Resource'

type AutoBindingRule = NonNullable<
  import('../types/CommunitySource').ResourceSourceBinding['autoBindingRule']
>

const INITIAL_SCAN_LIMIT = 5
const FUTURE_SCAN_LIMIT = 5

const incomingBindingBatches = new Set<symbol>()
const deferredPostScans = new Map<string, string>()
let deferredBackfill = false

/** Keep save-time/late-enabled scans from observing a partially imported Web cohort. */
export function beginIncomingCardBindingBatch(): (discard?: boolean) => void {
  const token = Symbol('incoming-card-binding-batch')
  incomingBindingBatches.add(token)
  return (discard = false) => {
    incomingBindingBatches.delete(token)
    if (discard && !incomingBindingBatches.size) {
      deferredPostScans.clear()
      deferredBackfill = false
    }
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

function normalizeAuthor(value: string): string {
  // Discord exports may prepend the platform marker to a creator label ("dc老鼠药").
  return normalize(value)
    .replace(/^dc\s*/iu, '')
    .trim()
}

function authorLabel(content: string): string | undefined {
  const match = content.match(/(?:^|\n)\s*(?:作者|author)\s*[:：]\s*([^\r\n]+)/iu)
  const value = match?.[1]?.trim()
  return value ? normalizeAuthor(value) : undefined
}

function isCharacterCard(resource: ResourceListSummary): boolean {
  return resource.type === 'characterCard'
}

function isPngCard(resource: ResourceListSummary): boolean {
  return isCharacterCard(resource) && /\.png$/iu.test(resource.fileName)
}

function uniqueCards(resources: readonly ResourceListSummary[]): ResourceListSummary[] {
  const seen = new Set<string>()
  return resources.filter((resource) => {
    if (!isCharacterCard(resource) || !resource.id || seen.has(resource.id)) return false
    seen.add(resource.id)
    return true
  })
}

function ruleMatches(
  source: CommunitySource,
  starterContent: string,
  resources: readonly ResourceListSummary[],
  settings: DiscordInboxAutomationSettings,
): { rule: 'same-name' | 'same-author'; matches: ResourceListSummary[] } | undefined {
  const text = normalize(`${source.title ?? ''}\n${starterContent}`)
  const nameMatches = settings.bindSameName
    ? resources.filter((resource) => {
        const name = normalize(resource.name)
        return name.length > 0 && text.includes(name)
      })
    : []
  if (nameMatches.length) return { rule: 'same-name', matches: nameMatches }

  if (settings.bindSameAuthor) {
    const postAuthor = authorLabel(starterContent)
    if (postAuthor) {
      const authorMatches = resources.filter((resource) => {
        const creator = normalizeAuthor(
          typeof resource.metadata.creator === 'string' ? resource.metadata.creator : '',
        )
        return Boolean(creator && creator === postAuthor)
      })
      if (authorMatches.length) return { rule: 'same-author', matches: authorMatches }
    }
  }
  return undefined
}

function reviewCandidates(
  rule: 'same-name' | 'same-author',
  matches: readonly ResourceListSummary[],
): CommunitySourceAutoBindCandidate[] {
  return matches.map((resource) => ({
    resourceId: resource.id,
    resourceName: resource.name,
    rule,
    reason:
      rule === 'same-name'
        ? `角色卡名“${resource.name}”出现在帖子标题或首楼`
        : `帖子作者与角色卡作者“${resource.metadata.creator}”一致`,
  }))
}

async function bindUniqueMatch(
  communitySources: CommunitySourceService,
  source: CommunitySource,
  rule: 'same-name' | 'same-author' | 'next-png',
  resource: ResourceListSummary,
): Promise<{ resourceId: string; rule: AutoBindingRule }> {
  const ruleLabel = rule === 'same-name' ? '同名' : rule === 'same-author' ? '同作者' : '后续 PNG'
  await communitySources.bindSource(
    resource.id,
    source.id,
    `自动关联：${ruleLabel} · ${resource.name}`,
    rule,
  )
  noticeCenter.push({
    id: `discord-auto-binding:${source.id}:${resource.id}`,
    type: 'success',
    persistent: true,
    message: `帖子“${source.title?.trim() || '未命名帖子'}”已绑定角色卡“${resource.name || '未命名角色卡'}”`,
  })
  await notifyNativeDiscordAutoBinding(
    source.title?.trim() || '未命名帖子',
    resource.name || '未命名角色卡',
    { sourceId: source.id, resourceId: resource.id },
  )
  return { resourceId: resource.id, rule }
}

async function settleRuleMatches(
  communitySources: CommunitySourceService,
  source: CommunitySource,
  match: ReturnType<typeof ruleMatches>,
): Promise<{ resourceId: string; rule: AutoBindingRule } | undefined> {
  if (!match) return undefined
  if (match.matches.length === 1)
    return bindUniqueMatch(communitySources, source, match.rule, match.matches[0]!)
  const previous = source.autoBindScan ?? {
    version: 1 as const,
    status: 'review' as const,
    scannedResourceIds: [],
    futureResourceIds: [],
  }
  await communitySources.updateAutoBindScan(source.id, {
    ...previous,
    status: 'review',
    reviewCandidates: reviewCandidates(match.rule, match.matches),
  })
  await communitySources.updateAutomationPendingPng(source.id, false)
  return undefined
}

export async function markPostForNextPng(
  communitySources: CommunitySourceService,
  sourceId: string,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return
  const source = await communitySources.getSourceForAutomation(sourceId)
  if (!source || source.autoBindScan?.reviewCandidates?.length) return
  await communitySources.updateAutomationPendingPng(sourceId, true)
}

/** Save-time scan: inspect only the five newest distinct current character-card resources. */
export async function autoBindPostToRecentCard(
  communitySources: CommunitySourceService,
  resourceService: { listRecentCharacterCards(limit: number): Promise<ResourceListSummary[]> },
  source: CommunitySource,
  starterContent: string,
  settings: DiscordInboxAutomationSettings,
): Promise<{ resourceId: string; rule: AutoBindingRule } | undefined> {
  if (!settings.bindSameName && !settings.bindSameAuthor) return undefined
  if ((await communitySources.getSourceUsage(source.id)).length) return undefined
  if (incomingBindingBatches.size) {
    deferredPostScans.set(source.id, starterContent)
    return undefined
  }
  const cards = await communitySources.listUnboundResources(
    uniqueCards(await resourceService.listRecentCharacterCards(INITIAL_SCAN_LIMIT)),
  )
  if (incomingBindingBatches.size) {
    deferredPostScans.set(source.id, starterContent)
    return undefined
  }
  const match = ruleMatches(source, starterContent, cards, settings)
  const settled = await settleRuleMatches(communitySources, source, match)
  if (settled) return settled
  if (match) return undefined

  await communitySources.updateAutoBindScan(source.id, {
    version: 1,
    status: 'scanning',
    scannedResourceIds: cards.map((card) => card.id),
    futureResourceIds: [],
  })
  return undefined
}

/** When a name/author rule is enabled late, backfill untracked posts against the last five cards. */
export async function autoBindPendingPostsToRecentCards(
  communitySources: CommunitySourceService,
  resourceService: { listRecentCharacterCards(limit: number): Promise<ResourceListSummary[]> },
  settings: DiscordInboxAutomationSettings,
): Promise<Array<{ sourceId: string; resourceId: string; rule: AutoBindingRule }>> {
  if (!settings.bindSameName && !settings.bindSameAuthor) return []
  if (incomingBindingBatches.size) {
    deferredBackfill = true
    return []
  }
  const cards = await communitySources.listUnboundResources(
    uniqueCards(await resourceService.listRecentCharacterCards(INITIAL_SCAN_LIMIT)),
  )
  const claimed = new Set<string>()
  const pending = await communitySources.listUnboundForAutomation(100, true)
  if (incomingBindingBatches.size) {
    deferredBackfill = true
    return []
  }
  const bindings: Array<{ sourceId: string; resourceId: string; rule: AutoBindingRule }> = []

  for (const { source, starter } of pending) {
    const previous = source.autoBindScan
    if (previous?.status === 'review' || previous?.reviewCandidates?.length) continue

    const available = cards.filter((card) => !claimed.has(card.id))
    const match = ruleMatches(source, starter?.content ?? '', available, settings)
    const bound = await settleRuleMatches(communitySources, source, match)
    if (bound) {
      bindings.push({ sourceId: source.id, ...bound })
      claimed.add(bound.resourceId)
      continue
    }
    if (match) continue

    const scanned = new Set(previous?.scannedResourceIds ?? [])
    for (const card of available) scanned.add(card.id)
    await communitySources.updateAutoBindScan(source.id, {
      version: 1,
      status: previous?.status === 'exhausted' ? 'exhausted' : 'scanning',
      scannedResourceIds: [...scanned],
      futureResourceIds: previous?.futureResourceIds ?? [],
    })
  }
  return bindings
}

/** Resume only scans deferred by an in-progress cohort; manually bound posts stay untouched. */
export async function flushDeferredPostBindings(
  communitySources: CommunitySourceService,
  resourceService: { listRecentCharacterCards(limit: number): Promise<ResourceListSummary[]> },
  settings: DiscordInboxAutomationSettings,
): Promise<Array<{ sourceId: string; resourceId: string; rule: AutoBindingRule }>> {
  if (incomingBindingBatches.size) return []
  if (deferredBackfill) {
    const bindings = await autoBindPendingPostsToRecentCards(
      communitySources,
      resourceService,
      settings,
    )
    deferredBackfill = false
    deferredPostScans.clear()
    return bindings
  }
  if (!deferredPostScans.size) return []
  const bindings: Array<{ sourceId: string; resourceId: string; rule: AutoBindingRule }> = []
  for (const [id, starterContent] of deferredPostScans) {
    const source = await communitySources.getSourceForAutomation(id)
    if (
      !source ||
      source.autoBindScan?.status === 'review' ||
      (await communitySources.getSourceUsage(id)).length
    ) {
      deferredPostScans.delete(id)
      continue
    }
    const binding = await autoBindPostToRecentCard(
      communitySources,
      resourceService,
      source,
      starterContent,
      settings,
    )
    if (binding) bindings.push({ sourceId: source.id, ...binding })
    deferredPostScans.delete(id)
  }
  return bindings
}

/**
 * Reconcile one completed import batch. Duplicate files, alternate containers and historical
 * versions resolve to the same current resource ID and therefore never consume scan progress.
 */
export async function autoBindIncomingCardBatch(
  communitySources: CommunitySourceService,
  incomingResources: readonly ResourceListSummary[],
  settings: DiscordInboxAutomationSettings,
): Promise<Array<{ sourceId: string; resourceId: string; rule: AutoBindingRule }>> {
  const batch = await communitySources.listUnboundResources(uniqueCards(incomingResources))
  if (!batch.length) return []
  const pending = await communitySources.listUnboundForAutomation(100)
  const results: Array<{ sourceId: string; resourceId: string; rule: AutoBindingRule }> = []
  const claimedResourceIds = new Set<string>()

  // Older pending posts receive FIFO resources before newer posts.
  pending.sort((left, right) => left.source.createdAt - right.source.createdAt)
  for (const { source, starter } of pending) {
    const starterContent = starter?.content ?? ''
    const scan = source.autoBindScan
    if (scan?.status === 'review' || scan?.reviewCandidates?.length) continue
    if (!scan && !source.autoBindPendingPng) continue

    const alreadyScanned = new Set(scan?.scannedResourceIds ?? [])
    // A delayed background batch must not match a post saved after these resources entered the library.
    const newCards = batch.filter(
      (resource) =>
        !alreadyScanned.has(resource.id) &&
        !claimedResourceIds.has(resource.id) &&
        (resource.versionImportedAt ?? resource.createdAt) >= source.createdAt,
    )
    if (!newCards.length) continue

    const futureSeen = scan?.futureResourceIds ?? []
    const futureSeenIds = new Set(futureSeen)
    const remaining = Math.max(0, FUTURE_SCAN_LIMIT - futureSeenIds.size)
    const cardsForNameAuthor =
      scan?.status === 'scanning'
        ? newCards.filter((resource) => !futureSeenIds.has(resource.id)).slice(0, remaining)
        : []

    // Name matching always gets the whole newly imported logical batch before author matching.
    const match = ruleMatches(source, starterContent, cardsForNameAuthor, settings)
    const bound = await settleRuleMatches(communitySources, source, match)
    if (bound) {
      results.push({ sourceId: source.id, ...bound })
      claimedResourceIds.add(bound.resourceId)
      continue
    }
    if (match) continue

    // The next-PNG rule is intentionally last and only consumes resources arriving after this post.
    if (settings.bindNextPng && source.autoBindPendingPng) {
      const nextPng = newCards.find((resource) => isPngCard(resource))
      if (nextPng) {
        const result = await bindUniqueMatch(communitySources, source, 'next-png', nextPng)
        claimedResourceIds.add(nextPng.id)
        results.push({ sourceId: source.id, ...result })
        continue
      }
    }

    if (cardsForNameAuthor.length) {
      const nextFuture = [...futureSeen, ...cardsForNameAuthor.map((resource) => resource.id)]
      const nextScan = {
        version: 1 as const,
        status:
          nextFuture.length >= FUTURE_SCAN_LIMIT ? ('exhausted' as const) : ('scanning' as const),
        scannedResourceIds: [
          ...new Set([
            ...(scan?.scannedResourceIds ?? []),
            ...cardsForNameAuthor.map((resource) => resource.id),
          ]),
        ],
        futureResourceIds: nextFuture,
      }
      await communitySources.updateAutoBindScan(source.id, nextScan)
    }
  }
  return results
}

/** Compatibility for single-resource callers; batch import owners should use the batch API. */
export async function autoBindIncomingCard(
  communitySources: CommunitySourceService,
  resource: ResourceListSummary,
  settings: DiscordInboxAutomationSettings,
): Promise<{ sourceId: string; rule: AutoBindingRule } | undefined> {
  const [result] = await autoBindIncomingCardBatch(communitySources, [resource], settings)
  return result ? { sourceId: result.sourceId, rule: result.rule } : undefined
}
