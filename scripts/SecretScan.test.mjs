import { TextEncoder } from 'node:util'
import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { scanBuffer, scanText } from './SecretScan.mjs'

describe('SecretScan', () => {
  it('detects high-confidence credential formats', () => {
    const discordToken = `${'MTIzNDU2Nzg5MDEyMzQ1Njc4'}.${'a'.repeat(6)}.${'b'.repeat(28)}`
    const githubToken = `ghp_${'Ab3dEf6hJk9mNp2qRs5uVw8xYz1aBc4d'}`
    const bearer = `Authorization: Bearer ${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'}`
    const privateKey = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
    const rsaPrivateKey = ['-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'].join('')
    const cloudflareToken = `CLOUDFLARE_API_TOKEN=${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'}`

    expect(scanText(discordToken)).toContain('Discord bot token')
    expect(scanText(githubToken)).toContain('GitHub token')
    expect(scanText(bearer)).toContain('Bearer credential')
    expect(scanText(privateKey)).toContain('private key')
    expect(scanText(rsaPrivateKey)).toContain('private key')
    expect(scanText(cloudflareToken)).toContain('Cloudflare API credential')
    expect(scanText(`API_KEY="${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'}"`)).toContain(
      'hard-coded API credential',
    )
  })

  it('does not flag user configuration, placeholders, URLs, or public IDs', () => {
    const safeText = [
      'Authorization: Bearer user-owned-token',
      'CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_should_be_replaced',
      'https://example.workers.dev',
      'database_id: 12345678-1234-1234-1234-123456789012',
      'Discord Application ID: 123456789012345678',
      'apiKey: example-placeholder-value',
    ].join('\n')

    expect(scanText(safeText)).toEqual([])
  })

  it('inspects text resources nested inside release archives', () => {
    const zip = zipSync({
      'config/.dev.vars': new TextEncoder().encode(
        `DISCORD_BOT_TOKEN=${'MTIzNDU2Nzg5MDEyMzQ1Njc4'}.${'a'.repeat(6)}.${'b'.repeat(28)}`,
      ),
    })

    expect(scanBuffer(zip, 'release.srlapp')).toContain(
      'release.srlapp!/config/.dev.vars: Discord bot token',
    )
  })
})
