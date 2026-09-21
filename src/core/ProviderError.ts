export type ProviderErrorCategory =
  'network' | 'auth' | 'rate_limit' | 'request' | 'server' | 'response_parse'

export interface ProviderError {
  provider: string
  category: ProviderErrorCategory
  httpStatus?: number
  message: string
  detail?: string
  retryable: boolean
  requestId?: string
}

export function isRetryableProviderCategory(category: ProviderErrorCategory): boolean {
  return category === 'network' || category === 'rate_limit' || category === 'server'
}
