import {
  buildStaticAssetRequest,
  DEPLOY_VERSION,
  finalizeStaticAssetResponse,
  FORCE_REFRESH_HTML,
} from './WorkerAssets.js'
import { handleBridge } from './WorkerBridge.js'
import { handleCloudProxy, markCloudProxyResponse } from './WorkerCloudProxy.js'
import { json, originIsAllowed, withAppSecurityHeaders, withCors } from './WorkerHttp.js'

export { BridgeSession } from './BridgeSession.js'

async function handleApi(request, env, pathname) {
  if (pathname.startsWith('/api/bridge/')) return handleBridge(request, env, pathname)
  if (pathname.startsWith('/api/cloud/'))
    return markCloudProxyResponse(await handleCloudProxy(request, env, pathname))
  return json({ code: 'NOT_FOUND', message: '接口不存在' }, 404)
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url)
      const { pathname } = url

      if (!originIsAllowed(request, env))
        return json({ code: 'ORIGIN_REJECTED', message: '请求来源未获允许' }, 403)

      if (
        pathname === '/api/force-refresh' ||
        (pathname === '/' && url.searchParams.has('asset-recovery'))
      ) {
        return new Response(FORCE_REFRESH_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      }

      if (pathname === '/api/relaunch') {
        const currentIndex = await env.ASSETS.fetch(
          new Request(new URL('/', request.url), {
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache' },
          }),
        )
        const relaunchHtml = (await currentIndex.text()).replace(
          '</head>',
          '<script>try{history.replaceState(null,"","/")}catch(e){}</script></head>',
        )
        return withCors(
          withAppSecurityHeaders(
            new Response(relaunchHtml, {
              status: currentIndex.status,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'CDN-Cache-Control': 'no-store',
              },
            }),
            '/',
          ),
          request,
          env,
        )
      }

      if (pathname === '/api/version')
        return json({ deployedAt: Date.now(), version: DEPLOY_VERSION }, 200, {
          'Cache-Control': 'no-store',
        })

      if (pathname.startsWith('/api/')) {
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'access-control-allow-origin': url.origin,
              'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
              'access-control-allow-headers': 'content-type,authorization,x-srl-content-length',
              'access-control-max-age': '86400',
              vary: 'Origin',
            },
          })
        }
        const response = await handleApi(request, env, pathname)
        return withCors(response, request, env)
      }

      const response = finalizeStaticAssetResponse(
        await env.ASSETS.fetch(buildStaticAssetRequest(request, pathname)),
        pathname,
      )
      if (pathname === '/sw.js' || /^\/workbox-[a-z0-9]+\.js$/i.test(pathname)) {
        const headers = new Headers(response.headers)
        headers.set('Cache-Control', 'no-cache')
        return withCors(
          new Response(response.body, { status: response.status, headers }),
          request,
          env,
        )
      }
      return withCors(withAppSecurityHeaders(response, pathname), request, env)
    } catch (error) {
      console.error('[SRL Worker]', error)
      return withCors(json({ code: 'SERVER_ERROR', message: '服务暂时不可用' }, 500), request, env)
    }
  },
}

export {
  buildStaticAssetRequest,
  DEPLOY_VERSION,
  finalizeStaticAssetResponse,
} from './WorkerAssets.js'
export {
  buildCloudProxyRequestHeaders,
  buildCloudProxyResponseHeaders,
  markCloudProxyResponse,
} from './WorkerCloudProxy.js'
export { withCors } from './WorkerHttp.js'
