export const DISCORD_BRIDGE_PUBLIC_REPOSITORY_URL =
  'https://github.com/jixiangruyi117/SillyTavern-SRL-Discord-Bridge'

export const DISCORD_BRIDGE_DEPLOY_URL = `https://deploy.workers.cloudflare.com/?url=${encodeURIComponent(
  DISCORD_BRIDGE_PUBLIC_REPOSITORY_URL,
)}`

const MANUAL_SCHEMA_HELPER = `
let manualSchemaReady: Promise<void> | undefined

function ensureManualSchema(env: Env): Promise<void> {
  manualSchemaReady ??= (async () => {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS handoffs (token_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)',
    ).run()
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_handoffs_expires_at ON handoffs (expires_at)',
    ).run()
  })()
  return manualSchemaReady
}
`

const FETCH_SIGNATURE =
  'async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {'

/**
 * Dashboard / Quick Editor users do not have Wrangler migrations. Keep the public Worker source
 * as the single owner, then derive a browser-paste variant by adding one idempotent D1 schema gate.
 */
export function buildDiscordBridgeManualSource(workerSource: string): string {
  if (!workerSource.includes(FETCH_SIGNATURE)) {
    throw new Error('Discord Bridge 源码结构已变化，无法生成浏览器部署版')
  }
  const exportMarker = '\nexport default {'
  if (!workerSource.includes(exportMarker)) {
    throw new Error('Discord Bridge 源码缺少默认入口')
  }

  const withHelper = workerSource.replace(exportMarker, `${MANUAL_SCHEMA_HELPER}${exportMarker}`)
  return withHelper.replace(
    FETCH_SIGNATURE,
    `${FETCH_SIGNATURE}\n    await ensureManualSchema(env)`,
  )
}
