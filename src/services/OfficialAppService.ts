import { hashBytes, hashBlob } from './HashService'

async function hashPackageBytes(bytes: Uint8Array): Promise<string> {
  return bytes.byteLength > 4 * 1024 * 1024
    ? hashBlob(new Blob([new Uint8Array(bytes).buffer]))
    : hashBytes(bytes)
}
import { unzipPackage, MAX_PACKAGE_BYTES } from './ExternalAppPackage'
import type { OfficialAppPackageStorage } from '../storage/OfficialAppPackageStorage'
import {
  isOfficialAppId,
  type InstalledOfficialApp,
  type OfficialAppCatalog,
  type OfficialAppId,
  type OfficialAppPackage,
} from '../types/OfficialApp'

const safeAsset = (value: unknown): value is string =>
  typeof value === 'string' && /^\/assets\/[A-Za-z0-9_.-]+$/u.test(value) && !value.includes('..')
const safeHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)

export class OfficialAppService {
  private readonly storage: OfficialAppPackageStorage
  private readonly shellVersion: string
  private readonly expectedEntries: Record<string, string>
  private readonly fetcher: typeof fetch
  private readonly origin: string
  private readonly clearData: (id: OfficialAppId) => Promise<void>
  private readonly clearStyles: (id: OfficialAppId) => Promise<void>
  constructor(
    storage: OfficialAppPackageStorage,
    shellVersion: string,
    expectedEntries: Record<string, string>,
    fetcher: typeof fetch,
    origin: string,
    clearData: (id: OfficialAppId) => Promise<void>,
    clearStyles: (id: OfficialAppId) => Promise<void> = async () => {},
  ) {
    this.storage = storage
    this.shellVersion = shellVersion
    this.expectedEntries = expectedEntries
    this.fetcher = fetcher
    this.origin = origin
    this.clearData = clearData
    this.clearStyles = clearStyles
  }

  list(): Promise<InstalledOfficialApp[]> {
    return this.storage.list()
  }

  async ready(id: OfficialAppId): Promise<boolean> {
    const app = (await this.list()).find((app) => app.id === id)
    // 已安装 APP 以自身已校验的文件清单为可运行真值。资源库壳版本变化本身不强迫重下；
    // 只有入口合同变化或实际文件缺失时才需要更新该 APP。
    if (!app || app.entry !== this.expectedEntries[id]) return false
    for (const file of app.files)
      if (!(await this.storage.hasFile(file.path, file.size, file.bundled))) return false
    return true
  }

  async catalog(): Promise<OfficialAppCatalog> {
    const response = await this.fetcher(
      new URL(`/official-apps/${this.shellVersion}/catalog.json`, this.origin),
      { cache: 'no-store' },
    )
    if (!response.ok) throw new Error('无法获取官方 APP 列表，请检查网络后重试')
    const catalog = (await response.json()) as OfficialAppCatalog
    if (catalog.schemaVersion !== 1 || catalog.shellVersion !== this.shellVersion || !catalog.apps)
      throw new Error('APP 列表与资源库版本不匹配，请更新资源库')
    return catalog
  }

  private validate(value: unknown, id: OfficialAppId): OfficialAppPackage {
    const app = value as OfficialAppPackage
    if (
      !app ||
      app.schemaVersion !== 1 ||
      app.id !== id ||
      !isOfficialAppId(app.id) ||
      app.shellVersion !== this.shellVersion ||
      app.entry !== this.expectedEntries[id]
    )
      throw new Error('APP 安装包与当前资源库版本不匹配')
    if (
      !Array.isArray(app.files) ||
      !app.files.length ||
      app.files.length > 100 ||
      !Array.isArray(app.styles) ||
      !app.styles.every(safeAsset)
    )
      throw new Error('APP 文件清单无效')
    const paths = new Set<string>()
    let total = 0
    for (const file of app.files) {
      if (
        !safeAsset(file.path) ||
        paths.has(file.path) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > 25 * 1024 * 1024 ||
        !safeHash(file.sha256) ||
        (file.bundled !== undefined && typeof file.bundled !== 'boolean')
      )
        throw new Error('APP 文件清单无效')
      paths.add(file.path)
      total += file.size
    }
    if (
      total > 100 * 1024 * 1024 ||
      !paths.has(app.entry) ||
      app.files.find((file) => file.path === app.entry)?.bundled
    )
      throw new Error('APP 文件清单不完整或过大')
    return app
  }

  async install(id: OfficialAppId): Promise<void> {
    // Locks also serialize mutations from other open tabs sharing the same installation.
    return navigator.locks.request('srl-official-app-install', async () => {
      const download = (await this.catalog()).apps[id]
      if (
        !download ||
        !safeHash(download.sha256) ||
        download.entry !== this.expectedEntries[id] ||
        !Number.isSafeInteger(download.downloadBytes) ||
        download.downloadBytes <= 0 ||
        download.downloadBytes > MAX_PACKAGE_BYTES
      )
        throw new Error('APP 下载信息无效，请更新资源库')
      const url = new URL(download.url, this.origin)
      if (
        url.origin !== this.origin ||
        !url.pathname.startsWith(`/official-apps/${this.shellVersion}/`) ||
        !url.pathname.endsWith('.srlapp')
      )
        throw new Error('APP 下载来源无效')
      const response = await this.fetcher(url, { cache: 'no-store' })
      if (!response.ok || !response.body) throw new Error('APP 下载失败，请检查网络后重试')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          length += value.byteLength
          if (length > download.downloadBytes) {
            await reader.cancel()
            throw new Error('APP 下载大小不匹配')
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      if (length !== download.downloadBytes) throw new Error('APP 下载不完整')
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      chunks.length = 0
      if ((await hashPackageBytes(bytes)) !== download.sha256) throw new Error('APP 下载校验失败')
      const files = await unzipPackage(bytes.buffer)
      if (!files['manifest.json'] || files['manifest.json'].length > 128 * 1024)
        throw new Error('APP 缺少文件清单')
      const app = this.validate(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json'])),
        id,
      )
      if (Object.keys(files).length !== app.files.length + 1) throw new Error('APP 包含未声明文件')
      for (const file of app.files) {
        const data = files[file.path.slice(1)]
        if (!data || data.length !== file.size || (await hashPackageBytes(data)) !== file.sha256)
          throw new Error('APP 文件校验失败')
      }
      const previous = await this.list()
      const protectedPaths = new Set(previous.flatMap((app) => app.files.map((file) => file.path)))
      const written: string[] = []
      try {
        for (const file of app.files) {
          if (await this.storage.hasFile(file.path, file.size, file.bundled)) continue
          written.push(file.path)
          await this.storage.writeFile(file.path, files[file.path.slice(1)]!)
        }
        await this.storage.save({ ...app, installedAt: Date.now() })
      } catch (error) {
        for (const path of written)
          if (!protectedPaths.has(path))
            await this.storage.deleteFile(
              path,
              app.files.find((file) => file.path === path)?.bundled,
            )
        throw error
      }
      const retained = new Set(
        (await this.list()).flatMap((app) => app.files.map((file) => file.path)),
      )
      for (const old of previous.filter((app) => app.id === id))
        for (const file of old.files)
          if (!retained.has(file.path)) await this.storage.deleteFile(file.path, file.bundled)
    })
  }

  async uninstall(id: OfficialAppId, deleteData: boolean, deleteStyles = false): Promise<number> {
    if (deleteStyles && !deleteData) throw new Error('删除局部样式需同时选择清除 APP 数据')
    return navigator.locks.request(
      `srl-official-app-use:${id}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error('其他页面正在使用这个 APP，请关闭后再卸载')
        return navigator.locks.request('srl-official-app-install', async () => {
          const installed = await this.list()
          const app = installed.find((app) => app.id === id)
          if (deleteData) await this.clearData(id)
          if (deleteStyles) await this.clearStyles(id)
          if (!app) return 0
          const retained = new Set(
            installed
              .filter((other) => other.id !== id)
              .flatMap((other) => other.files.map((file) => file.path)),
          )
          let freed = 0
          for (const file of app.files)
            if (!retained.has(file.path)) {
              await this.storage.deleteFile(file.path, file.bundled)
              if (!file.bundled) freed += file.size
            }
          await this.storage.remove(id)
          return freed
        })
      },
    )
  }

  async clearAppData(id: OfficialAppId, deleteStyles = false): Promise<void> {
    return navigator.locks.request(
      `srl-official-app-use:${id}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error('其他页面正在使用这个 APP，请关闭后再清理数据')
        return navigator.locks.request('srl-official-app-install', async () => {
          await this.clearData(id)
          if (deleteStyles) await this.clearStyles(id)
        })
      },
    )
  }
}
