import { TextEncoder } from 'node:util'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { addedDiffText, scanBuffer, scanGitIncremental, scanText } from './SecretScan.mjs'

describe('SecretScan', () => {
  it('scans only added lines, preserving real lines beginning with plus', () => {
    const diff = [
      '--- a/config',
      '+++ b/config',
      '@@ -1 +1 @@',
      '-old-value',
      '+new-value',
      '++operator',
    ].join('\n')
    expect(addedDiffText(diff)).toBe('new-value\n+operator')
  })
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

  it('scans untracked archive bytes without decoding the zip before inspection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'srl-secret-scan-'))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: directory })
      execFileSync(
        'git',
        [
          '-c',
          'user.name=SecretScan Test',
          '-c',
          'user.email=secret-scan-test@users.noreply.github.com',
          'commit',
          '--allow-empty',
          '--quiet',
          '-m',
          'baseline',
        ],
        { cwd: directory },
      )
      const baseline = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: directory,
        encoding: 'utf8',
      }).trim()
      const archive = zipSync({
        'config.json': new TextEncoder().encode(
          `githubToken="ghp_${'Ab3dEf6hJk9mNp2qRs5uVw8xYz1aBc4d'}"`,
        ),
      })
      writeFileSync(join(directory, 'release.srlapp'), archive)

      const result = scanGitIncremental(baseline, [], directory)

      expect(result.findings).toContain('release.srlapp!/config.json: GitHub token')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
