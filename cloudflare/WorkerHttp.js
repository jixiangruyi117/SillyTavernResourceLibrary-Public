export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

export async function readBody(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export function allowedOrigins(env, requestUrl) {
  return new Set([new URL(requestUrl).origin])
}

export function withCors(response, request, env) {
  // A WebSocket upgrade response carries an HTTP 101 status. Reconstructing it
  // with `new Response()` is invalid in the Workers runtime, and WebSocket
  // connections do not use CORS response headers.
  if (response.webSocket) return response
  const origin = request.headers.get('origin')
  if (!origin || !allowedOrigins(env, request.url).has(origin)) return response
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.append('vary', 'Origin')
  return new Response(response.body, { status: response.status, headers })
}

export function withAppSecurityHeaders(response, pathname) {
  if (pathname.startsWith('/api/')) return response
  const headers = new Headers(response.headers)
  headers.set('cross-origin-opener-policy', 'same-origin-allow-popups')
  return new Response(response.body, { status: response.status, headers })
}

export function originIsAllowed(request, env) {
  const origin = request.headers.get('origin')
  return !origin || allowedOrigins(env, request.url).has(origin)
}
