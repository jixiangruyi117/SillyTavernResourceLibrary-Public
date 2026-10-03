import { describe, expect, it } from 'vitest'
import type { OfficialAppBuildCatalog } from '../types/OfficialApp'
import { getOfficialAppShellFiles } from './OfficialAppBuildCatalog'

describe('official APP build catalog', () => {
  it('reads one package object per APP and collects shared shell files', () => {
    const catalog: OfficialAppBuildCatalog = {
      schemaVersion: 1,
      shellVersion: 'srl-test',
      hostApiVersion: 1,
      apps: {
        draw: {
          shellVersion: 'srl-test',
          hostApiVersion: 1,
          appContentHash: 'a'.repeat(64),
          appContentRevision: 1,
          hostFiles: [
            { path: '/assets/shared.js', size: 42, sha256: 'b'.repeat(64), bundled: true },
          ],
          url: '/official-apps/srl-test/draw.srlapp',
          sha256: 'c'.repeat(64),
          downloadBytes: 100,
          installedBytes: 142,
          entry: '/assets/draw.js',
        },
      },
    }
    expect(getOfficialAppShellFiles(catalog)).toEqual({
      '/assets/shared.js': { size: 42, sha256: 'b'.repeat(64) },
    })
  })

  it('rejects conflicting shared file entries', () => {
    const catalog: OfficialAppBuildCatalog = {
      schemaVersion: 1,
      shellVersion: 'srl-test',
      hostApiVersion: 1,
      apps: {
        draw: {
          shellVersion: 'srl-test',
          hostApiVersion: 1,
          appContentHash: 'a'.repeat(64),
          appContentRevision: 1,
          hostFiles: [
            { path: '/assets/shared.js', size: 42, sha256: 'b'.repeat(64), bundled: true },
          ],
          url: '/official-apps/srl-test/draw.srlapp',
          sha256: 'c'.repeat(64),
          downloadBytes: 100,
          installedBytes: 142,
          entry: '/assets/draw.js',
        },
        stitch: {
          shellVersion: 'srl-test',
          hostApiVersion: 1,
          appContentHash: 'd'.repeat(64),
          appContentRevision: 1,
          hostFiles: [
            { path: '/assets/shared.js', size: 42, sha256: 'e'.repeat(64), bundled: true },
          ],
          url: '/official-apps/srl-test/stitch.srlapp',
          sha256: 'f'.repeat(64),
          downloadBytes: 100,
          installedBytes: 142,
          entry: '/assets/stitch.js',
        },
      },
    }
    expect(() => getOfficialAppShellFiles(catalog)).toThrow('冲突文件')
  })
})
