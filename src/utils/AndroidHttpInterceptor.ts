const CAPACITOR_HTTP_INTERCEPTOR_PATH = '/_capacitor_http_interceptor_'

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Android 的全局 CapacitorHttp 会把跨域 fetch 的 response.url 改写为应用内拦截地址。
 * 预览资源仍须以真正的远端地址为基准解析 CSS 相对路径；网页响应保持原样。
 */
export function resolveAndroidHttpResponseUrl(requestUrl: string, responseUrl: string): string {
  if (!responseUrl) return requestUrl
  try {
    const intercepted = new URL(responseUrl)
    if (intercepted.pathname !== CAPACITOR_HTTP_INTERCEPTOR_PATH) return responseUrl
    const original = intercepted.searchParams.get('u')
    return original && isHttpUrl(original) ? original : requestUrl
  } catch {
    return requestUrl
  }
}
