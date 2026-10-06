import { isRetryableProviderCategory } from '../core/ProviderError'
import type {
  FrontendWorkshopImageProvider,
  FrontendWorkshopImageGenerationDiagnostic,
  FrontendWorkshopImageGenerationErrorCategory,
} from '../types/ImageGeneration'

export class FrontendWorkshopImageGenerationError extends Error {
  readonly diagnostic: FrontendWorkshopImageGenerationDiagnostic

  constructor(message: string, diagnostic: FrontendWorkshopImageGenerationDiagnostic) {
    super(message)
    this.name = 'FrontendWorkshopImageGenerationError'
    this.diagnostic = diagnostic
  }
}

export async function responseError(response: Response): Promise<string> {
  const body = await response.text()
  if (!body) return `HTTP ${response.status}`
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.message || parsed.message || body.slice(0, 500)
  } catch {
    return body.slice(0, 500)
  }
}

export function imageGenerationErrorCategory(
  status: number,
): FrontendWorkshopImageGenerationErrorCategory {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status === 400 || status === 422) return 'request'
  if (status >= 500) return 'server'
  return 'response_parse'
}

function providerErrorMessage(
  provider: FrontendWorkshopImageProvider,
  category: FrontendWorkshopImageGenerationErrorCategory,
  status?: number,
): string {
  const label =
    provider === 'novelai' ? 'NovelAI' : provider === 'openai' ? 'OpenAI' : '第三方兼容接口'
  if (category === 'network') return `${label} 请求未能到达服务端，请检查网络、CORS、DNS 或 TLS。`
  if (category === 'auth') return `${label} 拒绝了凭据或当前权限。`
  if (category === 'rate_limit') return `${label} 当前受限流或额度限制。`
  if (category === 'request')
    return `${label} 拒绝了当前模型或请求参数${status ? `（HTTP ${status}）` : ''}。`
  if (category === 'server')
    return `${label} 返回 HTTP ${status ?? 500}；请求已到达服务端，但生成失败。`
  return `${label} 返回了无法解析的结果${status ? `（HTTP ${status}）` : ''}。`
}

function reportProviderDiagnostic(diagnostic: FrontendWorkshopImageGenerationDiagnostic): void {
  if (!import.meta.env.DEV) return
  console.warn('[FrontendWorkshopImageGeneration]', diagnostic)
}

export function createProviderError(
  provider: FrontendWorkshopImageProvider,
  endpoint: string,
  model: string,
  parameters: Record<string, string | number | boolean>,
  category: FrontendWorkshopImageGenerationErrorCategory,
  options: {
    httpStatus?: number
    statusText?: string
    responseContentType?: string
    responseBody?: string
    requestId?: string
  } = {},
): FrontendWorkshopImageGenerationError {
  const baseMessage = providerErrorMessage(provider, category, options.httpStatus)
  const message =
    category === 'response_parse' && options.responseBody
      ? `${baseMessage} ${options.responseBody}`
      : baseMessage
  const diagnostic: FrontendWorkshopImageGenerationDiagnostic = {
    provider,
    endpoint,
    model,
    category,
    message,
    detail: options.responseBody,
    retryable: isRetryableProviderCategory(category),
    parameters,
    ...options,
  }
  reportProviderDiagnostic(diagnostic)
  return new FrontendWorkshopImageGenerationError(diagnostic.message, diagnostic)
}
