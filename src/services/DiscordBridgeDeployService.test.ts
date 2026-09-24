import { describe, expect, it } from 'vitest'

import {
  buildDiscordBridgeManualSource,
  DISCORD_BRIDGE_DEPLOY_URL,
  DISCORD_BRIDGE_PUBLIC_REPOSITORY_URL,
} from './DiscordBridgeDeployService'

describe('DiscordBridgeDeployService', () => {
  it('targets the isolated public Bridge repository for one-click deploy', () => {
    expect(DISCORD_BRIDGE_PUBLIC_REPOSITORY_URL).toBe(
      'https://github.com/jixiangruyi117/SillyTavern-SRL-Discord-Bridge',
    )
    expect(DISCORD_BRIDGE_DEPLOY_URL).toContain('https://deploy.workers.cloudflare.com/?url=')
  })

  it('adds idempotent D1 initialization for the browser-paste variant', () => {
    const source = `interface Env { DB: D1Database }\nexport default {\n  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {\n    return new Response('ok')\n  },\n}\n`
    const result = buildDiscordBridgeManualSource(source)
    expect(result).toContain('CREATE TABLE IF NOT EXISTS handoffs')
    expect(result).toContain('CREATE INDEX IF NOT EXISTS idx_handoffs_expires_at')
    expect(result).toContain('await ensureManualSchema(env)')
  })

  it('preserves the authenticated source-read route in the browser-paste variant', () => {
    const source = `interface Env { DB: D1Database; DISCORD_BOT_TOKEN: string }\nexport default {\n  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {\n    const url = new URL(request.url)\n    if (url.pathname === '/source/read' && request.method === 'POST') {\n      const header = request.headers.get('Authorization') ?? ''\n      if (header !== \`Bearer \${env.DISCORD_BOT_TOKEN}\`) return new Response('unauthorized', { status: 401 })\n      return new Response('ok')\n    }\n    return new Response(String(Boolean(ctx)))\n  },\n}\n`
    const result = buildDiscordBridgeManualSource(source)
    expect(result).toContain("url.pathname === '/source/read'")
    expect(result).toContain("request.headers.get('Authorization')")
    expect(result).toContain('await ensureManualSchema(env)')
    expect(result.match(/async fetch\(/gu)).toHaveLength(1)
    expect(result.indexOf('await ensureManualSchema(env)')).toBeLessThan(
      result.indexOf("url.pathname === '/source/read'"),
    )
  })

  it('fails loudly instead of silently generating stale manual code', () => {
    expect(() => buildDiscordBridgeManualSource('export default {}')).toThrow(
      'Discord Bridge 源码结构已变化',
    )
  })
})
