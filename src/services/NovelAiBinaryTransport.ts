import { getCapacitorPlatform } from '../utils/CapacitorDetection'

export type NovelAiTransport = 'browser-fetch' | 'capacitor-original-fetch'

/** Only the NovelAI generation caller uses this adapter; other native HTTP stays patched. */
export async function requestNovelAiBinary(
  request: typeof fetch,
  endpoint: string,
  init: RequestInit,
): Promise<{ response: Response; novelAiTransport: NovelAiTransport }> {
  let fetchImpl = request
  let novelAiTransport: NovelAiTransport = 'browser-fetch'
  if (getCapacitorPlatform() === 'android') {
    // Capacitor 8.4.2 native-bridge.js saves this before patching window.fetch.
    // Its patched POST defaults to native TEXT; use the saved WebView fetch so
    // binary and AbortSignal stay in the browser, without a native string round trip.
    const nativeWindow = window as Window & { CapacitorWebFetch?: typeof fetch }
    if (typeof nativeWindow.CapacitorWebFetch !== 'function') {
      // Never silently fall back to the text-converting bridge (or retry a paid POST).
      throw new Error('NovelAI Android 原始 WebView fetch 不可用')
    }
    fetchImpl = nativeWindow.CapacitorWebFetch.bind(nativeWindow)
    novelAiTransport = 'capacitor-original-fetch'
  }
  console.info('[NovelAI transport]', `novelAiTransport=${novelAiTransport}`)
  return { response: await fetchImpl(endpoint, init), novelAiTransport }
}
