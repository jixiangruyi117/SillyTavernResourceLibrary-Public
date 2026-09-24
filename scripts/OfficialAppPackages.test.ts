import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { reuseReleasedOfficialAppPackage } from './OfficialAppPackages'

const files = {
  'manifest.json': strToU8('{"shellVersion":"srl-test"}'),
  'assets/app.js': strToU8('export const value=1'),
}
const released = zipSync(files, { mtime: new Date('2020-01-01T00:00:00Z') })
const metadata = {
  url: '/official-apps/srl-test/app.srlapp',
  sha256: createHash('sha256').update(released).digest('hex'),
  downloadBytes: released.length,
}

describe('released official APP rebuilds', () => {
  it('reuses the exact released ZIP when only a rebuild timestamp would differ', () => {
    const rebuilt = zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') })
    expect(rebuilt).not.toEqual(released)
    expect(reuseReleasedOfficialAppPackage(released, files, metadata)).toBe(released)
  })
  it('refuses changed code under the same released build ID', () => {
    expect(() =>
      reuseReleasedOfficialAppPackage(
        released,
        { ...files, 'assets/app.js': strToU8('export const value=2') },
        metadata,
      ),
    ).toThrow('new buildId')
  })
  it('refuses changes to the file graph or manifest', () => {
    expect(() =>
      reuseReleasedOfficialAppPackage(
        released,
        { ...files, 'assets/new.js': strToU8('new') },
        metadata,
      ),
    ).toThrow('new buildId')
    expect(() =>
      reuseReleasedOfficialAppPackage(
        released,
        { ...files, 'manifest.json': strToU8('{}') },
        metadata,
      ),
    ).toThrow('new buildId')
  })
  it('does not reuse a corrupt archive or an incorrect catalog digest', () => {
    expect(() => reuseReleasedOfficialAppPackage(released.subarray(1), files, metadata)).toThrow(
      'verification',
    )
    expect(() =>
      reuseReleasedOfficialAppPackage(released, files, { ...metadata, sha256: '0'.repeat(64) }),
    ).toThrow('verification')
  })
})
