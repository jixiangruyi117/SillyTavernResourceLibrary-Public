import { Capacitor, registerPlugin } from '@capacitor/core'
import { withAbort } from '../utils/Abortable'

interface NativeMainApi {
  request(options: {
    requestId: string
    url: string
    headers: Record<string, string>
    body: string
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>
  cancel(options: { requestId: string }): Promise<void>
}
const native = registerPlugin<NativeMainApi>('NativeMainApi')

export function mainApiCancellationNotice(): string {
  return Capacitor.getPlatform() === 'android' && !Capacitor.isPluginAvailable('NativeMainApi')
    ? '当前旧版 APK 已停止等待，原生连接可能仍在运行；更新 APK 后可同时关闭连接。'
    : ''
}

/** Only opt-in complete-text requests use this transport; streaming keeps its existing owner. */
export async function requestMainApiText(
  url: string,
  init: RequestInit,
  cancellableNative = false,
): Promise<Response> {
  init.signal?.throwIfAborted()
  if (
    !cancellableNative ||
    Capacitor.getPlatform() !== 'android' ||
    !Capacitor.isPluginAvailable('NativeMainApi')
  )
    return withAbort(fetch(url, init), init.signal ?? undefined)
  const requestId = crypto.randomUUID()
  const abort = () => {
    void native.cancel({ requestId }).catch(() => undefined)
  }
  // Start registration before subscribing so an early cancel cannot precede request creation.
  const request = native.request({
    requestId,
    url,
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    body: String(init.body ?? ''),
  })
  init.signal?.addEventListener('abort', abort, { once: true })
  if (init.signal?.aborted) abort()
  try {
    const response = await withAbort(request, init.signal ?? undefined)
    init.signal?.throwIfAborted()
    return new Response([204, 205, 304].includes(response.status) ? null : response.body, {
      status: response.status,
      headers: response.headers,
    })
  } finally {
    init.signal?.removeEventListener('abort', abort)
  }
}
