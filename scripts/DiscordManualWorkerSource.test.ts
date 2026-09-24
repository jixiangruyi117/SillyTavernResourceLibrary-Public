import { describe, expect, it } from 'vitest'
import { buildDiscordManualWorkerSource } from './DiscordManualWorkerSource'

describe('Discord manual deployment bundle', () => {
  it('loads independently and preserves the setup authentication gate after schema initialization', async () => {
    const source = await buildDiscordManualWorkerSource()
    expect(source).not.toMatch(/^import\s/mu)
    expect(source).toContain('CREATE TABLE IF NOT EXISTS handoffs')
    const { default: worker } = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    )
    const statements: string[] = []
    const env = {
      DB: {
        prepare(sql: string) {
          statements.push(sql)
          return { run: async () => ({ success: true }) }
        },
      },
    }
    const response = await worker.fetch(
      new Request('https://bridge.example/source/read', { method: 'POST' }),
      env,
      {},
    )
    expect(response.status).toBe(401)
    expect(statements).toHaveLength(2)
    const again = await worker.fetch(
      new Request('https://bridge.example/source/read', { method: 'POST' }),
      env,
      {},
    )
    expect(again.status).toBe(401)
    expect(statements).toHaveLength(2)
  })
})
