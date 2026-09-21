/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { OfficialAppService } from './OfficialAppService'
import { hashBytes } from './HashService'
import type { OfficialAppPackageStorage } from '../storage/OfficialAppPackageStorage'
import type { InstalledOfficialApp, OfficialAppId, OfficialAppPackage } from '../types/OfficialApp'

describe('official APP package lifecycle', () => {
  let records: Map<OfficialAppId, InstalledOfficialApp>
  let files: Map<string, Uint8Array>
  let storage: OfficialAppPackageStorage
  const clearData = vi.fn(async () => {})
  const clearStyles = vi.fn(async () => {})
  beforeEach(() => {
    records = new Map()
    files = new Map()
    clearData.mockClear()
    clearStyles.mockClear()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (
          _name: string,
          optionsOrAction: unknown,
          action?: (lock: object) => Promise<unknown>,
        ) => (action ? action({}) : (optionsOrAction as () => Promise<unknown>)()),
      },
    })
    storage = {
      list: async () => [...records.values()],
      save: async (app) => {
        records.set(app.id, app)
      },
      remove: async (id) => {
        records.delete(id)
      },
      hasFile: async (path, size) => files.get(path)?.length === size,
      writeFile: async (path, data) => {
        files.set(path, data)
      },
      deleteFile: async (path) => {
        files.delete(path)
      },
    }
  })
  async function fixture(id: OfficialAppId = 'draw', mutate?: (app: OfficialAppPackage) => void) {
    const payload = new TextEncoder().encode('export default {}')
    const app: OfficialAppPackage = {
      schemaVersion: 1,
      shellVersion: 'test-shell',
      id,
      entry: `/assets/${id}-123.js`,
      styles: [],
      files: [],
    }
    for (const path of [app.entry, '/assets/shared-123.js'])
      app.files.push({ path, size: payload.length, sha256: await hashBytes(payload) })
    mutate?.(app)
    const archive = Object.fromEntries(app.files.map((file) => [file.path.slice(1), payload]))
    archive['manifest.json'] = new TextEncoder().encode(JSON.stringify(app))
    const bytes = zipSync(archive)
    const descriptor = {
      url: `/official-apps/test-shell/${id}.srlapp`,
      sha256: await hashBytes(bytes),
      downloadBytes: bytes.length,
      entry: `/assets/${id}-123.js`,
    }
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('catalog.json')
        ? new Response(
            JSON.stringify({
              schemaVersion: 1,
              shellVersion: 'test-shell',
              apps: { [id]: descriptor },
            }),
          )
        : new Response(new Uint8Array(bytes).buffer),
    )
    const service = new OfficialAppService(
      storage,
      'test-shell',
      { [id]: descriptor.entry },
      fetcher,
      'https://library.test',
      clearData,
      clearStyles,
    )
    return { service, fetcher, app, bytes }
  }
  it('installs verified program bytes, retains user data on uninstall, then reinstalls', async () => {
    const { service } = await fixture()
    await service.install('draw')
    expect(await service.ready('draw')).toBe(true)
    expect(files.size).toBe(2)
    expect(await service.uninstall('draw', false)).toBeGreaterThan(0)
    expect(files.size).toBe(0)
    expect(records.size).toBe(0)
    expect(clearData).not.toHaveBeenCalled()
    expect(clearStyles).not.toHaveBeenCalled()
    await service.install('draw')
    expect(await service.ready('draw')).toBe(true)
  })
  it('deletes styles only with a separate explicit choice, including an already uninstalled APP', async () => {
    const { service } = await fixture()
    await service.install('draw')
    await service.uninstall('draw', true)
    expect(clearStyles).not.toHaveBeenCalled()
    await service.uninstall('draw', true, true)
    expect(clearStyles).toHaveBeenCalledExactlyOnceWith('draw')
    await expect(service.uninstall('draw', false, true)).rejects.toThrow('同时选择')
  })
  it('clears a selected APP data without uninstalling its verified program files', async () => {
    const { service } = await fixture()
    await service.install('draw')
    await service.clearAppData('draw', true)
    expect(clearData).toHaveBeenCalledExactlyOnceWith('draw')
    expect(clearStyles).toHaveBeenCalledExactlyOnceWith('draw')
    expect(await service.ready('draw')).toBe(true)
    expect(files.size).toBe(2)
    expect(records.has('draw')).toBe(true)
  })
  it('refuses APP data cleanup while the APP is in use', async () => {
    const { service } = await fixture()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (
          _name: string,
          optionsOrAction: unknown,
          action?: (lock: object | null) => Promise<unknown>,
        ) => (action ? action(null) : (optionsOrAction as () => Promise<unknown>)()),
      },
    })
    await expect(service.clearAppData('draw')).rejects.toThrow('正在使用')
    expect(clearData).not.toHaveBeenCalled()
  })
  it('keeps shared files until the last owner is removed and clears only the selected app data', async () => {
    const draw = await fixture('draw')
    const stitch = await fixture('stitch')
    await draw.service.install('draw')
    await stitch.service.install('stitch')
    await draw.service.uninstall('draw', true)
    expect(clearData).toHaveBeenCalledExactlyOnceWith('draw')
    expect(files.has('/assets/draw-123.js')).toBe(false)
    expect(await stitch.service.ready('stitch')).toBe(true)
    await stitch.service.uninstall('stitch', false)
    expect(files.size).toBe(0)
  })
  it('rejects corrupt download bytes before writing anything', async () => {
    const { service, fetcher } = await fixture()
    const original = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (input, init) => {
      const response = await original(input, init)
      if (String(input).endsWith('.srlapp')) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        bytes[0] ^= 1
        return new Response(bytes)
      }
      return response
    })
    await expect(service.install('draw')).rejects.toThrow('校验失败')
    expect(files.size).toBe(0)
  })
  it.each(['wrong-version', 'unsafe-path', 'bad-file-hash'])(
    'rejects %s without touching a previous installation',
    async (reason) => {
      const { service } = await fixture('draw', (app) => {
        if (reason === 'wrong-version') app.shellVersion = 'other'
        if (reason === 'unsafe-path') app.files[1]!.path = '/assets/../escape.js'
        if (reason === 'bad-file-hash') app.files[1]!.sha256 = 'f'.repeat(64)
      })
      files.set('/assets/existing.js', new Uint8Array([1]))
      await expect(service.install('draw')).rejects.toThrow()
      expect([...files.keys()]).toEqual(['/assets/existing.js'])
      expect(records.size).toBe(0)
    },
  )
  it('rolls back newly staged files on storage failure', async () => {
    const { service } = await fixture()
    storage.save = async () => {
      throw new Error('quota')
    }
    await expect(service.install('draw')).rejects.toThrow('quota')
    expect(files.size).toBe(0)
    expect(records.size).toBe(0)
  })
  it('keeps an intact installed APP ready when only the shell version changes', async () => {
    const { service } = await fixture()
    await service.install('draw')
    const installed = records.get('draw')!
    records.set('draw', { ...installed, shellVersion: 'previous-shell' })
    expect(await service.ready('draw')).toBe(true)
  })

  it('detects missing or truncated installed files instead of reporting ready', async () => {
    const { service } = await fixture()
    await service.install('draw')
    files.set('/assets/draw-123.js', new Uint8Array([1]))
    expect(await service.ready('draw')).toBe(false)
    await service.install('draw')
    expect(await service.ready('draw')).toBe(true)
  })
})
