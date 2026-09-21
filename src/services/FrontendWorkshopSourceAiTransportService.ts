import type {
  MainApiCompletionResult,
  MainApiConfig,
  MainApiMessage,
  MainApiRequestOptions,
  MainApiTokenUsage,
} from './MainApiService'
import { MAX_MAIN_API_REQUEST_TIMEOUT_MS } from './MainApiService'
import type {
  FrontendWorkshopSourceAiReceipt,
  FrontendWorkshopSourceAiRequestOptions,
} from '../types/FrontendWorkshopSourceAiReceipt'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type { FrontendWorkshopSourceAiContextBundle } from '../utils/FrontendWorkshopSourceAiContext'
import type { FrontendWorkshopSourceAiReferenceImage } from '../utils/FrontendWorkshopSourceAiContext'
import {
  assertFrontendWorkshopSourceAiContextCurrent,
  parseFrontendWorkshopSourceAiProposal,
  type FrontendWorkshopSourceAiProposal,
} from '../utils/FrontendWorkshopSourceAiProposal'

export interface FrontendWorkshopSourceAiCompletionTransport {
  completeWithUsage(
    messages: MainApiMessage[],
    override?: Partial<MainApiConfig>,
    options?: MainApiRequestOptions,
  ): Promise<MainApiCompletionResult>
}

export interface FrontendWorkshopSourceAiTransportResult {
  rawText: string
  usage: MainApiTokenUsage
  proposal: FrontendWorkshopSourceAiProposal
  providerReasoning?: string
}

function normalizedProposalText(rawText: string): string {
  const trimmed = rawText.trim()
  const fenced = trimmed.match(/^```(?:json)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```$/iu)
  return fenced?.[1]?.trim() ?? trimmed
}

/**
 * S6-B transport owner. It reuses the application's existing MainApi transport and validates the
 * returned proposal, but deliberately has no dependency on SourceDocumentService, PatchService or
 * HistoryService. Current project/revision/Source-lineage identity is checked before provider I/O,
 * and a successful result is still only an untrusted-but-validated proposal for S7.
 */
export class FrontendWorkshopSourceAiTransportService {
  private readonly mainApi: FrontendWorkshopSourceAiCompletionTransport

  constructor(mainApi: FrontendWorkshopSourceAiCompletionTransport) {
    this.mainApi = mainApi
  }

  async requestProposal(
    source: FrontendWorkshopSourceDocument,
    bundle: FrontendWorkshopSourceAiContextBundle,
    override?: Partial<MainApiConfig>,
    options?: FrontendWorkshopSourceAiRequestOptions,
    referenceImages: readonly FrontendWorkshopSourceAiReferenceImage[] = [],
  ): Promise<FrontendWorkshopSourceAiTransportResult> {
    assertFrontendWorkshopSourceAiContextCurrent(source, bundle)

    const messages: MainApiMessage[] = bundle.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    const userMessage = messages.at(-1)
    if (userMessage?.role === 'user' && referenceImages.length > 0) {
      userMessage.content = [
        { type: 'text', text: String(userMessage.content) },
        ...referenceImages.map((image) => ({ type: 'image' as const, dataUrl: image.dataUrl })),
      ]
    }
    const receipt: FrontendWorkshopSourceAiReceipt = {
      id: crypto.randomUUID(),
      rawText: '',
      status: 'receiving',
    }
    const publish = () => options?.onReceipt?.({ ...receipt }, bundle)
    publish()
    try {
      const completion = await this.mainApi.completeWithUsage(messages, override, {
        ...options,
        // Full-source generation with reasoning can exceed the general API's two-minute default.
        // Keep explicit caller deadlines and cancellation; never retry a paid request here.
        timeoutMs: options?.timeoutMs ?? MAX_MAIN_API_REQUEST_TIMEOUT_MS,
        onText: (text) => {
          receipt.rawText = text
          publish()
          options?.onText?.(text)
        },
      })
      receipt.rawText = completion.text
      receipt.usage = completion.usage
      receipt.finishReason = completion.finishReason
      publish()
      if (completion.finishReason === 'incomplete')
        throw new Error('AI 数据流提前结束，已保留收到的原文，未应用修改。')
      if (completion.finishReason === 'length' || completion.finishReason === 'max_tokens') {
        throw new Error(
          'AI 回复达到输出长度上限，修改内容可能不完整，未应用。请提高主 API 的输出上限或缩小本次修改范围后重新生成。',
        )
      }
      const proposal = parseFrontendWorkshopSourceAiProposal(
        normalizedProposalText(completion.text),
        source,
        bundle,
      )
      receipt.status = 'complete'
      publish()
      return {
        rawText: completion.text,
        usage: completion.usage,
        proposal,
        ...(completion.reasoning ? { providerReasoning: completion.reasoning } : {}),
      }
    } catch (error) {
      receipt.status = options?.signal?.aborted ? 'interrupted' : 'invalid'
      receipt.error = error instanceof Error ? error.message : 'AI 回复接收失败'
      publish()
      throw error
    }
  }
}
