import type { FrontendWorkshopSourceAiRequestOptions } from '../types/FrontendWorkshopSourceAiReceipt'
import type { MainApiConfig } from './MainApiService'
import {
  buildFrontendWorkshopSourceAiContext,
  type FrontendWorkshopSourceAiContextBundle,
  type FrontendWorkshopSourceAiContextInput,
  type FrontendWorkshopSourceAiHostReference,
} from '../utils/FrontendWorkshopSourceAiContext'
import type { FrontendWorkshopSourceAiTransportResult } from './FrontendWorkshopSourceAiTransportService'
import { validateHostReferenceVersion } from './FrontendWorkshopSourceAiHostReferenceOnlineReader'

export const FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLUTION_REQUESTS = 16
export const FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLUTION_REFERENCES = 32
export const FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_ID_TEXT_UNITS = 256
export const FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_TITLE_TEXT_UNITS = 512
export const FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLVER_CONTENT_TEXT_UNITS = 250_000
export const FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLVER_TOTAL_TEXT_UNITS = 1_000_000

export interface FrontendWorkshopSourceAiHostReferenceResolutionEntry {
  request: string
  references: readonly FrontendWorkshopSourceAiHostReference[]
  error?: 'unavailable'
}

export interface FrontendWorkshopSourceAiHostReferenceResolutionOptions {
  signal?: AbortSignal
  online?: FrontendWorkshopSourceAiContextInput['hostResearch']
  onLookup?: FrontendWorkshopSourceAiRequestOptions['onLookup']
}

export interface FrontendWorkshopSourceAiHostReferenceResolver {
  resolve(
    requests: readonly string[],
    options?: FrontendWorkshopSourceAiHostReferenceResolutionOptions,
  ): Promise<readonly FrontendWorkshopSourceAiHostReferenceResolutionEntry[]>
}

export interface FrontendWorkshopSourceAiProposalTransport {
  requestProposal(
    source: FrontendWorkshopSourceAiContextInput['source'],
    bundle: FrontendWorkshopSourceAiContextBundle,
    override?: Partial<MainApiConfig>,
    options?: FrontendWorkshopSourceAiRequestOptions,
    referenceImages?: FrontendWorkshopSourceAiContextInput['referenceImages'],
  ): Promise<FrontendWorkshopSourceAiTransportResult>
}

export interface FrontendWorkshopSourceAiHostReferenceAttempt {
  bundle: FrontendWorkshopSourceAiContextBundle
  result: FrontendWorkshopSourceAiTransportResult
}

export type FrontendWorkshopSourceAiHostReferenceBlockedReason =
  | 'unresolved'
  | 'context-truncated'
  | 'additional-provider-consent-required'
  | 'research-budget-exhausted'
  | 'research-no-progress'
  | 'research-failed'

export type FrontendWorkshopSourceAiHostReferenceOrchestrationResult =
  | {
      status: 'completed'
      attempts: readonly FrontendWorkshopSourceAiHostReferenceAttempt[]
      resolvedReferences: readonly FrontendWorkshopSourceAiHostReference[]
    }
  | {
      status: 'needs-host-reference'
      attempts: readonly FrontendWorkshopSourceAiHostReferenceAttempt[]
      resolvedReferences: readonly FrontendWorkshopSourceAiHostReference[]
      unresolvedRequests: readonly string[]
      retryExhausted: boolean
      blockedReason: FrontendWorkshopSourceAiHostReferenceBlockedReason
    }

interface ValidatedResolution {
  resolvedReferences: FrontendWorkshopSourceAiHostReference[]
  unresolvedRequests: string[]
  lookupFailed?: boolean
}

function uniqueRequests(requests: readonly string[]): string[] {
  const unique: string[] = []
  for (const request of requests) {
    if (typeof request !== 'string' || !request.trim()) {
      throw new Error('Host Reference request 非法')
    }
    if (!unique.includes(request)) unique.push(request)
  }
  if (unique.length > FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLUTION_REQUESTS) {
    throw new Error('Host Reference request 数量超出 resolver 上限')
  }
  return unique
}

function boundedReference(
  value: FrontendWorkshopSourceAiHostReference,
  total: { textUnits: number },
): FrontendWorkshopSourceAiHostReference {
  if (!value || typeof value !== 'object') {
    throw new Error('Host Reference resolver 返回非法 reference')
  }
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    value.id.length > FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_ID_TEXT_UNITS
  ) {
    throw new Error('Host Reference resolver reference id 非法')
  }
  if (
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_TITLE_TEXT_UNITS
  ) {
    throw new Error('Host Reference resolver reference title 非法')
  }
  if (
    typeof value.content !== 'string' ||
    !value.content.trim() ||
    value.content.length >
      FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLVER_CONTENT_TEXT_UNITS
  ) {
    throw new Error('Host Reference resolver reference content 非法或超出上限')
  }
  total.textUnits += value.id.length + value.title.length + value.content.length
  if (total.textUnits > FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLVER_TOTAL_TEXT_UNITS) {
    throw new Error('Host Reference resolver 总文本超出上限')
  }
  return { id: value.id, title: value.title, content: value.content }
}

function addReference(
  map: Map<string, FrontendWorkshopSourceAiHostReference>,
  reference: FrontendWorkshopSourceAiHostReference,
): void {
  const existing = map.get(reference.id)
  if (!existing) {
    map.set(reference.id, reference)
    return
  }
  if (existing.title !== reference.title || existing.content !== reference.content) {
    throw new Error(`Host Reference id 冲突：${reference.id}`)
  }
}

function validateResolution(
  requests: readonly string[],
  entries: readonly FrontendWorkshopSourceAiHostReferenceResolutionEntry[],
): ValidatedResolution {
  if (!Array.isArray(entries)) throw new Error('Host Reference resolver 必须返回数组')
  const requested = new Set(requests)
  const seen = new Set<string>()
  const references = new Map<string, FrontendWorkshopSourceAiHostReference>()
  const total = { textUnits: 0 }
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.request !== 'string' ||
      !requested.has(entry.request)
    ) {
      throw new Error('Host Reference resolver 返回非法 resolution entry')
    }
    if (seen.has(entry.request)) {
      throw new Error(`Host Reference resolver 重复返回 request：${entry.request}`)
    }
    seen.add(entry.request)
    if (!Array.isArray(entry.references)) {
      throw new Error(`Host Reference resolver references 非法：${entry.request}`)
    }
    for (const value of entry.references) {
      if (references.size >= FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLUTION_REFERENCES) {
        throw new Error('Host Reference resolver reference 数量超出上限')
      }
      addReference(references, boundedReference(value, total))
    }
  }
  return {
    resolvedReferences: [...references.values()],
    ...(entries.some((entry) => entry.error === 'unavailable') ? { lookupFailed: true } : {}),
    unresolvedRequests: requests.filter(
      (request) => !entries.find((entry) => entry.request === request)?.references.length,
    ),
  }
}

function mergeReferences(
  existing: readonly FrontendWorkshopSourceAiHostReference[] | undefined,
  resolved: readonly FrontendWorkshopSourceAiHostReference[],
): FrontendWorkshopSourceAiHostReference[] {
  const merged = new Map<string, FrontendWorkshopSourceAiHostReference>()
  for (const reference of existing ?? []) addReference(merged, { ...reference })
  for (const reference of resolved) addReference(merged, { ...reference })
  return [...merged.values()]
}

function snapshotContextData<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (Array.isArray(value)) {
    const existing = seen.get(value)
    if (existing) return existing as T
    const clone: unknown[] = []
    seen.set(value, clone)
    for (const item of value) clone.push(snapshotContextData(item, seen))
    return clone as T
  }
  if (value && typeof value === 'object') {
    const object = value as object
    const existing = seen.get(object)
    if (existing) return existing as T
    const clone: Record<string, unknown> = {}
    seen.set(object, clone)
    for (const [key, item] of Object.entries(value)) {
      clone[key] = snapshotContextData(item, seen)
    }
    return clone as T
  }
  return value
}

export function detectFrontendWorkshopSourceHostReferenceRequests(
  input: FrontendWorkshopSourceAiContextInput,
): string[] {
  const text = `${input.instruction}\n${input.source.authorSource}`.toLocaleLowerCase('en-US')
  const requests: string[] = []
  const add = (request: string) => {
    if (!requests.includes(request)) requests.push(request)
  }
  if (
    /getvariables|replacevariables|updatevariableswith|insertvariables|deletevariable|变量|stat_data/.test(
      text,
    )
  ) {
    add('variables api')
  }
  if (/\bmvu\b|stat_data|waitglobalinitialized|getmvudata|replacemvudata/.test(text)) {
    add('mvu')
    add('globals')
  }
  if (/eventon|eventonce|eventemit|message_swiped|message_updated|监听|事件/.test(text)) {
    add('host events')
  }
  if (/getchatmessages|setchatmessages|setchatmessage|swipe|greeting|开场白|聊天消息/.test(text)) {
    add('chat messages')
    add('swipe api')
  }
  if (/getiframename|getcurrentmessageid|getmessageid|getscriptid|iframe/.test(text)) {
    add('runtime identity')
  }
  if (/getcharacter|getchardata|getcurrentcharacter|角色数据/.test(text)) add('character')
  if (/triggerslash|stscript|斜杠/.test(text)) add('stscript')
  if (/worldbook|lorebook|世界书/.test(text)) add('worldbook')
  if (/\bgenerate\s*\(|generateraw|stopgenerationbyid|请求生成|调用酒馆模型/.test(text))
    add('generation api')
  return requests.slice(0, FRONTEND_WORKSHOP_SOURCE_AI_MAX_HOST_REFERENCE_RESOLUTION_REQUESTS)
}

/**
 * Default orchestration performs local reference detection/resolution before the provider call.
 * Additional calls require the request's explicit research budget. Offline callers keep the
 * single-call contract. Every attempt uses the same Source/checkpoint and the existing transport.
 */
export class FrontendWorkshopSourceAiHostReferenceService {
  private readonly transport: FrontendWorkshopSourceAiProposalTransport
  private readonly resolver: FrontendWorkshopSourceAiHostReferenceResolver

  constructor(
    transport: FrontendWorkshopSourceAiProposalTransport,
    resolver: FrontendWorkshopSourceAiHostReferenceResolver,
  ) {
    this.transport = transport
    this.resolver = resolver
  }

  async resolveRequestedReferences(
    requests: readonly string[],
    options?: FrontendWorkshopSourceAiHostReferenceResolutionOptions,
  ): Promise<ValidatedResolution> {
    const unique = uniqueRequests(requests)
    if (!unique.length) return { resolvedReferences: [], unresolvedRequests: [] }
    const entries = await this.resolver.resolve(unique, options)
    const result = validateResolution(unique, entries)
    for (const entry of entries)
      options?.onLookup?.({
        request: entry.request,
        status: entry.error ? 'unavailable' : entry.references.length ? 'found' : 'not-found',
        sources: entry.references.map((reference) => {
          try {
            const info = JSON.parse(reference.content)
            return {
              title: reference.title,
              url: info.sourceUrl,
              version: info.version,
              lines: info.lines,
              cached: reference.cached,
            }
          } catch {
            return { title: reference.title }
          }
        }),
      })
    return result
  }

  async request(
    input: FrontendWorkshopSourceAiContextInput,
    override?: Partial<MainApiConfig>,
    options?: FrontendWorkshopSourceAiRequestOptions,
  ): Promise<FrontendWorkshopSourceAiHostReferenceOrchestrationResult> {
    const initialInput = snapshotContextData(input)
    const research = initialInput.hostResearch
    if (
      research &&
      (!Number.isSafeInteger(research.maxAdditionalRequests) || research.maxAdditionalRequests < 0)
    ) {
      throw new Error('额外调用 AI 次数请填写 0 或正整数')
    }
    if (research) {
      validateHostReferenceVersion(research.tavernHelperVersion)
      validateHostReferenceVersion(research.sillyTavernVersion)
    }
    const localRequests =
      initialInput.mode === 'plan' ||
      (research &&
        (research.tavernHelperVersion !== '4.9.3' || research.sillyTavernVersion !== '1.18.0'))
        ? []
        : uniqueRequests(detectFrontendWorkshopSourceHostReferenceRequests(initialInput))
    let resolvedReferences: FrontendWorkshopSourceAiHostReference[] = []
    if (localRequests.length) {
      const localResolution = await this.resolveRequestedReferences(localRequests, {
        signal: options?.signal,
        onLookup: options?.onLookup,
      })
      resolvedReferences = localResolution.resolvedReferences
    }
    const enrichedInput: FrontendWorkshopSourceAiContextInput = {
      ...initialInput,
      hostReferences: mergeReferences(initialInput.hostReferences, resolvedReferences),
    }
    const bundle = buildFrontendWorkshopSourceAiContext(enrichedInput)
    if (bundle.diagnostics.hostReferenceTruncated && initialInput.mode !== 'plan') {
      return {
        status: 'needs-host-reference',
        attempts: [],
        resolvedReferences,
        unresolvedRequests: localRequests,
        retryExhausted: false,
        blockedReason: 'context-truncated',
      }
    }
    const result = await this.transport.requestProposal(
      enrichedInput.source,
      bundle,
      override ? { ...override } : undefined,
      options ? { ...options } : undefined,
      enrichedInput.referenceImages,
    )
    const attempts: FrontendWorkshopSourceAiHostReferenceAttempt[] = [{ bundle, result }]
    // Planning is read-only. Missing implementation references must not turn a usable
    // design conversation into an extra paid research loop. Work mode verifies them.
    if (initialInput.mode === 'plan') return { status: 'completed', attempts, resolvedReferences }
    if (research) {
      return this.continueResearch(enrichedInput, attempts, resolvedReferences, override, options)
    }
    const additionalRequests = uniqueRequests(result.proposal.hostReferenceRequests)
    if (!additionalRequests.length) {
      return { status: 'completed', attempts, resolvedReferences }
    }

    const resolution = await this.resolveRequestedReferences(additionalRequests, {
      signal: options?.signal,
      onLookup: options?.onLookup,
    })
    return {
      status: 'needs-host-reference',
      attempts,
      resolvedReferences: mergeReferences(resolvedReferences, resolution.resolvedReferences),
      unresolvedRequests: resolution.unresolvedRequests.length
        ? resolution.unresolvedRequests
        : additionalRequests,
      retryExhausted: false,
      blockedReason: 'additional-provider-consent-required',
    }
  }

  private async continueResearch(
    input: FrontendWorkshopSourceAiContextInput,
    attempts: FrontendWorkshopSourceAiHostReferenceAttempt[],
    initialReferences: FrontendWorkshopSourceAiHostReference[],
    override?: Partial<MainApiConfig>,
    options?: FrontendWorkshopSourceAiRequestOptions,
  ): Promise<FrontendWorkshopSourceAiHostReferenceOrchestrationResult> {
    const research = input.hostResearch!
    let references = initialReferences
    const searched = new Set<string>()
    const blocked = (
      reason: FrontendWorkshopSourceAiHostReferenceBlockedReason,
      requests: string[],
    ) => ({
      status: 'needs-host-reference' as const,
      attempts,
      resolvedReferences: references,
      unresolvedRequests: requests,
      retryExhausted: reason === 'research-budget-exhausted',
      blockedReason: reason,
    })
    while (true) {
      options?.signal?.throwIfAborted()
      const latest = attempts[attempts.length - 1]!
      const requests = uniqueRequests(latest.result.proposal.hostReferenceRequests)
      if (!requests.length) return { status: 'completed', attempts, resolvedReferences: references }
      if (attempts.length > research.maxAdditionalRequests) {
        return blocked('research-budget-exhausted', requests)
      }
      const fresh = requests.filter(
        (request) => !searched.has(request.normalize('NFKC').trim().toLowerCase()),
      )
      if (!fresh.length) return blocked('research-no-progress', requests)
      fresh.forEach((request) => searched.add(request.normalize('NFKC').trim().toLowerCase()))
      try {
        const resolution = await this.resolveRequestedReferences(fresh, {
          signal: options?.signal,
          onLookup: options?.onLookup,
          online: research,
        })
        options?.signal?.throwIfAborted()
        const existing = mergeReferences(input.hostReferences, references)
        const merged = mergeReferences(existing, resolution.resolvedReferences)
        if (merged.length === existing.length) {
          return blocked(
            resolution.lookupFailed ? 'research-failed' : 'research-no-progress',
            requests,
          )
        }
        const nextInput = {
          ...input,
          hostReferences: merged,
          conversation: [
            ...(input.conversation ?? []),
            {
              role: 'assistant' as const,
              content: JSON.stringify(latest.result.proposal),
            },
            {
              role: 'user' as const,
              content: `资料查询已结束。未查到的请求：${resolution.unresolvedRequests.join('、') || '无'}。根据新增资料继续原任务，不编造缺失接口；仍缺关键资料时提出不同的具体请求。`,
            },
          ],
        }
        const nextBundle = buildFrontendWorkshopSourceAiContext(nextInput)
        if (nextBundle.diagnostics.hostReferenceTruncated)
          return blocked('context-truncated', requests)
        references = mergeReferences(references, resolution.resolvedReferences)
        const nextResult = await this.transport.requestProposal(
          input.source,
          nextBundle,
          override,
          options,
          input.referenceImages,
        )
        attempts.push({ bundle: nextBundle, result: nextResult })
      } catch (error) {
        options?.signal?.throwIfAborted()
        if (error instanceof Error && error.name === 'AbortError') throw error
        // A failed follow-up must not discard the already received, validated reply.
        return blocked('research-failed', requests)
      }
    }
  }
}
