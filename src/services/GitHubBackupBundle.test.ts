import { describe, expect, it } from 'vitest'

import {
  GITHUB_PART_SIZE,
  GITHUB_AVERAGE_PART_SIZE,
  GITHUB_MIN_PART_SIZE,
  bundleManifestName,
  createGitHubBundle,
  parseGitHubBundleManifest,
} from './GitHubBackupBundle'

describe('GitHubBackupBundle', () => {
  it('keeps every provider part below the GitHub request size limit', () => {
    expect(GITHUB_PART_SIZE).toBe(32 * 1024 * 1024)
    expect(GITHUB_MIN_PART_SIZE).toBe(8 * 1024 * 1024)
    expect(GITHUB_AVERAGE_PART_SIZE).toBe(16 * 1024 * 1024)
    expect(GITHUB_PART_SIZE).toBeLessThan(100 * 1024 * 1024)
  })

  it('splits a backup into independently verifiable ordered parts', async () => {
    const source = new Blob(['abcdefghijklmnop'])
    const { blobs, manifest } = await createGitHubBundle(source, 'backup.zip', 5)

    expect(blobs.map((part) => part.size)).toEqual([5, 5, 5, 1])
    expect(manifest.parts).toHaveLength(4)
    expect(manifest.parts[0]?.name).toMatch(/^srl-chunk--sha256-[a-f0-9]{64}$/)
    expect(manifest.version).toBe(2)
    expect(manifest.totalSize).toBe(source.size)
    expect(parseGitHubBundleManifest(manifest)).toEqual(manifest)
    expect(bundleManifestName('backup.zip')).toBe('backup.zip.srlbundle.json')
  })

  it('reuses content-addressed names for identical chunks across snapshots', async () => {
    const first = await createGitHubBundle(new Blob(['abcdefgh']), 'first.zip', 4)
    const second = await createGitHubBundle(new Blob(['abcdefgh']), 'second.zip', 4)

    expect(second.manifest.parts.map((part) => part.name)).toEqual(
      first.manifest.parts.map((part) => part.name),
    )
  })

  it('reuses unchanged CDC chunks when only a local range of a large resource changes', async () => {
    const originalBytes = new Uint8Array(40 * 1024 * 1024)
    const changedBytes = originalBytes.slice()
    changedBytes.fill(0x7f, 35 * 1024 * 1024, 35 * 1024 * 1024 + 64 * 1024)

    const first = await createGitHubBundle(new Blob([originalBytes]), 'large.bin')
    const second = await createGitHubBundle(new Blob([changedBytes]), 'large.bin')
    const previous = new Set(first.manifest.parts.map((part) => part.name))
    const reused = second.manifest.parts.filter((part) => previous.has(part.name))
    const changed = second.manifest.parts.filter((part) => !previous.has(part.name))

    expect(reused.length).toBeGreaterThan(0)
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.length).toBeLessThan(second.manifest.parts.length)
    expect(changed.reduce((total, part) => total + part.size, 0)).toBeLessThan(changedBytes.length)
  })

  it('可复用外层已经计算过的整包哈希，避免上传前重复扫描大文件', async () => {
    const knownHash = 'a'.repeat(64)
    const { manifest } = await createGitHubBundle(
      new Blob(['abcdefgh']),
      'backup.zip',
      4,
      knownHash,
    )

    expect(manifest.totalSha256).toBe(knownHash)
  })

  it('rejects an incomplete or forged manifest', () => {
    expect(() =>
      parseGitHubBundleManifest({ format: 'srl-github-backup-bundle', version: 1, parts: [] }),
    ).toThrow('格式不受支持')
  })

  it('allows repeated content references but rejects inconsistent total sizes', async () => {
    const { manifest } = await createGitHubBundle(new Blob(['123456']), 'backup.zip', 3)

    expect(() =>
      parseGitHubBundleManifest({ ...manifest, parts: [manifest.parts[0], manifest.parts[0]] }),
    ).not.toThrow()
    expect(() => parseGitHubBundleManifest({ ...manifest, totalSize: 99 })).toThrow('总大小不一致')
  })
})
