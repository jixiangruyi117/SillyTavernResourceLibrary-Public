import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const BRIDGE_DIR = resolve(process.cwd(), 'workers/discord-source-bridge')
const WORKER_SOURCE = resolve(BRIDGE_DIR, 'src/index.ts')
const WRANGLER_CONFIG = resolve(BRIDGE_DIR, 'wrangler.example.jsonc')
const WORKER_PACKAGE = resolve(BRIDGE_DIR, 'package.json')

function parseJsonc(source: string): Record<string, unknown> {
  const withoutComments = source.replace(/^\s*\/\/.*$/gmu, '')
  const normalized = withoutComments.replace(/,\s*([}\]])/gu, '$1')
  return JSON.parse(normalized) as Record<string, unknown>
}

describe('Discord Bridge Worker contract', () => {
  it('bundles the isolated Worker entry with the root toolchain', async () => {
    const result = await build({
      entryPoints: [WORKER_SOURCE],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      logLevel: 'silent',
    })

    expect(result.outputFiles).toHaveLength(1)
    const output = result.outputFiles?.[0]?.text ?? ''
    expect(output.length).toBeGreaterThan(1_000)
    expect(output).toContain('X-Signature-Ed25519')
    expect(output).toContain('/interactions')
  })

  it('keeps D1 deploy config self-provisioning', async () => {
    const config = parseJsonc(await readFile(WRANGLER_CONFIG, 'utf8'))
    const databases = config.d1_databases as Array<Record<string, unknown>>

    expect(config.main).toBe('src/index.ts')
    expect(databases).toHaveLength(1)
    expect(databases[0]).toMatchObject({
      binding: 'DB',
      database_name: 'srl-discord-source-handoff',
      migrations_dir: 'migrations',
    })
    expect(databases[0]?.database_id).toBeUndefined()
  })

  it('keeps signature, one-time handoff, bot metadata and fixed command contract', async () => {
    const [source, packageText] = await Promise.all([
      Promise.all(
        [
          'index.ts',
          'DiscordWorkerHttp.ts',
          'DiscordSourceProtocol.ts',
          'DiscordSourceCapture.ts',
          'DiscordSourceReader.ts',
        ].map((name) => readFile(resolve(BRIDGE_DIR, 'src', name), 'utf8')),
      ).then((parts) => parts.join('\n')),
      readFile(WORKER_PACKAGE, 'utf8'),
    ])
    const workerPackage = JSON.parse(packageText) as {
      scripts?: Record<string, string>
      cloudflare?: { bindings?: Record<string, unknown> }
    }

    expect(source).toContain('X-Signature-Ed25519')
    expect(source).toContain('X-Signature-Timestamp')
    expect(source).toContain('consumed_at IS NULL')
    expect(source).toContain('保存到资源库')
    expect(source).toContain('authorBot')
    expect(source).toContain('message.webhook_id')
    expect(source).toContain('if (interaction.type === 1) {\n    return json({ type: 1 })')
    expect(source).not.toMatch(
      /if \(interaction\.type === 1\) \{[\s\S]{0,200}registerMessageCommand/u,
    )
    expect(source).not.toContain('self-bot')
    expect(workerPackage.scripts?.['db:migrate']).toBe(
      'wrangler d1 migrations apply srl-discord-source-handoff --remote',
    )
    expect(workerPackage.cloudflare?.bindings).toHaveProperty('DISCORD_APPLICATION_ID')
    expect(workerPackage.cloudflare?.bindings).toHaveProperty('DISCORD_PUBLIC_KEY')
    expect(workerPackage.cloudflare?.bindings).toHaveProperty('DISCORD_BOT_TOKEN')
  })
})
