import type { AppDatabase } from '../database/AppDatabase'
import {
  OFFICIAL_APP_ASSET_CACHE,
  type InstalledOfficialApp,
  type OfficialAppId,
} from '../types/OfficialApp'
import type { OfficialAppPackageStorage } from './OfficialAppPackageStorage'
import { isCapacitorApp } from '../utils/CapacitorDetection'

const PREFIX = 'official-app:'
function requirePath(path: string): string {
  if (!/^\/assets\/[A-Za-z0-9_.-]+$/u.test(path) || path.includes('..'))
    throw new Error('APP 文件路径无效')
  return 'official-apps' + path
}
function mimeType(path: string): string {
  if (path.endsWith('.js')) return 'text/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.wasm')) return 'application/wasm'
  if (path.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

export class InstalledOfficialAppStorage implements OfficialAppPackageStorage {
  private readonly database: AppDatabase
  constructor(database: AppDatabase) {
    this.database = database
  }
  async list(): Promise<InstalledOfficialApp[]> {
    return (await this.database.settings.where('id').startsWith(PREFIX).toArray()).map(
      (row) => row.value as InstalledOfficialApp,
    )
  }
  async save(app: InstalledOfficialApp): Promise<void> {
    await this.database.settings.put({ id: PREFIX + app.id, value: app, updatedAt: Date.now() })
  }
  async remove(id: OfficialAppId): Promise<void> {
    await this.database.settings.delete(PREFIX + id)
  }
  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const nativePath = requirePath(path)
    if (isCapacitorApp()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      // The native bridge takes base64. Limit each bridge message instead of expanding a whole package.
      const chunkSize = 192 * 1024
      for (let offset = 0; offset < bytes.length || offset === 0; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize)
        let binary = ''
        for (const value of chunk) binary += String.fromCharCode(value)
        const options = {
          path: nativePath + '.part',
          directory: Directory.Data,
          data: btoa(binary),
        }
        if (offset === 0) await Filesystem.writeFile({ ...options, recursive: true })
        else await Filesystem.appendFile(options)
      }
      await Filesystem.rename({
        from: nativePath + '.part',
        to: nativePath,
        directory: Directory.Data,
      })
      return
    }
    await (
      await caches.open(OFFICIAL_APP_ASSET_CACHE)
    ).put(
      path,
      new Response(new Uint8Array(bytes).buffer, {
        headers: { 'Content-Type': mimeType(path), 'Content-Length': String(bytes.length) },
      }),
    )
  }
  async hasFile(path: string, size: number, bundled = false): Promise<boolean> {
    const nativePath = requirePath(path)
    if (isCapacitorApp()) {
      if (bundled) return true
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      try {
        return (
          (await Filesystem.stat({ path: nativePath, directory: Directory.Data })).size === size
        )
      } catch {
        return false
      }
    }
    const response = await (await caches.open(OFFICIAL_APP_ASSET_CACHE)).match(path)
    return Boolean(response && Number(response.headers.get('Content-Length')) === size)
  }
  async deleteFile(path: string, bundled = false): Promise<void> {
    const nativePath = requirePath(path)
    if (isCapacitorApp()) {
      if (bundled) return
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      for (const target of [nativePath, nativePath + '.part']) {
        let exists = false
        try {
          await Filesystem.stat({ path: target, directory: Directory.Data })
          exists = true
        } catch {
          /* absent */
        }
        if (exists) await Filesystem.deleteFile({ path: target, directory: Directory.Data })
      }
    } else {
      // Older releases may have cached the same hashed file in the general offline cache.
      for (const name of bundled ? [OFFICIAL_APP_ASSET_CACHE] : await caches.keys())
        await (await caches.open(name)).delete(path)
    }
  }
}
