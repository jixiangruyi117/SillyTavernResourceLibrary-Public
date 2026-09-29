/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../database/AppDatabase'
import { hashBytes } from '../services/HashService'
import { InstalledOfficialAppStorage } from './InstalledOfficialAppStorage'

describe('installed official APP storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('checks cached file hashes only when explicitly requested', async () => {
    const goodBytes = new TextEncoder().encode('export default 1')
    let storedBytes = goodBytes
    const cache = {
      match: vi.fn(
        async () =>
          new Response(new Uint8Array(storedBytes).buffer, {
            headers: { 'Content-Length': String(storedBytes.length) },
          }),
      ),
    }
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
    const storage = new InstalledOfficialAppStorage({} as AppDatabase)
    const expectedHash = await hashBytes(goodBytes)

    expect(await storage.hasFileHash('/assets/app.js', goodBytes.length, expectedHash)).toBe(true)
    storedBytes = new Uint8Array(goodBytes.length).fill(0)
    expect(await storage.hasFileHash('/assets/app.js', goodBytes.length, expectedHash)).toBe(false)
    expect(await storage.hasFile('/assets/app.js', goodBytes.length)).toBe(true)
  })
})
