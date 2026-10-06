import buildInfo from '../build-info.json' with { type: 'json' }

// 单一 BuildInfo 由发布脚本递增，客户端 fetch /api/version 与此比对。
export const DEPLOY_VERSION = buildInfo.workerDeployVersion

// 缓存清理页由 Worker 直接返回，不经过静态资源。旧 SW 已排除 /api/...，
// 清理完成后进入同样排除于旧 SW 的 /api/relaunch，由该端点直出当前应用壳。
// 不能立即回到 /，因为 unregister 后当前标签页仍可能短暂受旧 SW 控制。
export const FORCE_REFRESH_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SRL 缓存清理</title><style>*,*::before,*::after{box-sizing:border-box;margin:0}body{display:grid;place-items:center;min-height:100vh;min-height:100dvh;padding:24px;background:#101b17;color:#edf1ed;font:15px/1.6 system-ui,sans-serif}main{width:min(100%,400px);padding:28px;border:1px solid #557b6d;background:#15251f;box-shadow:0 24px 70px #0007}h1{margin:0 0 .5rem;font:500 22px/1.2 Georgia,serif}p{margin:.8rem 0;color:#b9c9c2;font-size:13px}#status{min-height:60px;padding:14px;border-left:3px solid #91c7b2;background:#0c1713;margin:1rem 0;white-space:pre-wrap}</style></head><body><main><h1>清理缓存</h1><p>正在注销 Service Worker 并清空页面缓存，<strong>不会删除角色卡等本地资源</strong>。</p><div id="status">处理中…</div></main><script>(function(){var s=document.getElementById("status");var next="/api/relaunch?asset-recovery=${DEPLOY_VERSION}";var sw=("serviceWorker" in navigator)?navigator.serviceWorker.getRegistrations().then(function(r){return Promise.all(r.map(function(x){return x.unregister()}))}):Promise.resolve();var cache=("caches" in window)?caches.keys().then(function(k){return Promise.all(k.map(function(x){return caches.delete(x)}))}):Promise.resolve();Promise.all([sw,cache]).then(function(){s.textContent="完成，正在重新打开资源库…";setTimeout(function(){location.replace(next)},700)}).catch(function(){s.textContent="部分缓存未能自动清理，正在绕过旧缓存…";setTimeout(function(){location.replace(next)},1200)})})()</script></body></html>`

export function finalizeStaticAssetResponse(response, pathname) {
  const contentType = response.headers.get('content-type') ?? ''
  if (pathname.startsWith('/assets/') && contentType.includes('text/html')) {
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    // 伪造 200 恢复模块会在命名导出链接阶段失败，脚本根本没有机会执行；
    // 真实 404 交给入口/面板的加载边界处理，也避免坏响应进入 SW 运行缓存。
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    return new Response(
      'Static asset is no longer available. Refresh to load the latest version.',
      {
        status: 404,
        headers,
      },
    )
  }
  if (contentType.includes('text/html')) {
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    headers.set('CDN-Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  }
  return response
}

export function buildStaticAssetRequest(request, pathname) {
  if (request.method !== 'GET' || (pathname !== '/' && pathname !== '/index.html')) {
    return request
  }
  const versionedUrl = new URL(request.url)
  versionedUrl.searchParams.set('__srl_deploy', DEPLOY_VERSION)
  return new Request(versionedUrl, request)
}
