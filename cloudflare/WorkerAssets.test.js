import { expect, it } from 'vitest'
import { finalizeStaticAssetResponse } from './WorkerAssets.js'

it('missing modules return real uncached 404s instead of an invalid recovery module', async () => {
  const response = finalizeStaticAssetResponse(
    new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } }),
    '/assets/missing-module.js',
  )
  expect(response.status).toBe(404)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('content-type')).toContain('text/plain')
  expect(await response.text()).not.toContain('location.replace')
})

it('valid modules are served unchanged', () => {
  const response = new Response('export const value = 1', {
    headers: { 'content-type': 'application/javascript' },
  })
  expect(finalizeStaticAssetResponse(response, '/assets/module.js')).toBe(response)
})
