import { hashBytes, hashBlob } from './HashService'
import { OFFICIAL_APP_HOST_API_VERSION } from '../core/OfficialAppHostApi'
import { LEGACY_OFFICIAL_APP_CONTENT_REVISION } from '../core/OfficialAppContentRevision'

async function hashPackageBytes(bytes: Uint8Array): Promise<string> {
  return bytes.byteLength > 4 * 1024 * 1024
    ? hashBlob(new Blob([new Uint8Array(bytes).buffer]))
    : hashBytes(bytes)
}
import { unzipPackage, MAX_PACKAGE_BYTES } from './ExternalAppPackage'
import type { OfficialAppPackageStorage } from '../storage/OfficialAppPackageStorage'
import {
  isOfficialAppId,
  OFFICIAL_APP_IDS,
  type InstalledOfficialApp,
  type OfficialAppCatalog,
  type OfficialAppDownload,
  type OfficialAppFile,
  type OfficialAppId,
  type OfficialAppPackage,
  type OfficialAppUpdateInfo,
} from '../types/OfficialApp'

const safeAsset = (value: unknown): value is string =>
  typeof value === 'string' && /^\/assets\/[A-Za-z0-9_.-]+$/u.test(value) && !value.includes('..')
const safeHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)

function withoutPendingCleanupFiles(app: InstalledOfficialApp): InstalledOfficialApp {
  const result = { ...app }
  delete result.pendingCleanupFiles
  return result
}

async function officialAppContentHash(
  files: Array<{ path: string; size: number; sha256: string; bundled?: boolean }>,
  assetMode: 'host' | 'self-contained' = 'host',
): Promise<string> {
  const ownedFiles = files
    .filter((file) => assetMode === 'self-contained' || !file.bundled)
    .map(({ path, size, sha256 }) => [path, size, sha256] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return hashBytes(new TextEncoder().encode(JSON.stringify(ownedFiles)))
}

export class OfficialAppService {
  private readonly runtimeEntry?: string
  private readonly storage: OfficialAppPackageStorage
  private readonly hostApiVersion: number
  private readonly getShellFiles: () => Promise<Record<string, { size: number; sha256: string }>>
  private readonly fetcher: typeof fetch
  private readonly origin: string
  private readonly clearData: (id: OfficialAppId) => Promise<void>
  private readonly clearStyles: (id: OfficialAppId) => Promise<void>

  private withExclusiveAppUse<T>(
    id: OfficialAppId,
    action: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return navigator.locks.request(
      `srl-official-app-use:${id}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error(`其他页面正在使用这个 APP，请关闭后再${action}`)
        return callback()
      },
    )
  }

  constructor(
    storage: OfficialAppPackageStorage,
    _shellVersion: string,
    fetcher: typeof fetch,
    origin: string,
    clearData: (id: OfficialAppId) => Promise<void>,
    clearStyles: (id: OfficialAppId) => Promise<void> = async () => {},
    hostApiVersion = OFFICIAL_APP_HOST_API_VERSION,
    getShellFiles: () => Promise<
      Record<string, { size: number; sha256: string }>
    > = async () => ({}),
    runtimeEntry?: string,
  ) {
    this.storage = storage
    this.runtimeEntry = runtimeEntry
    this.hostApiVersion = hostApiVersion
    this.getShellFiles = getShellFiles
    this.fetcher = fetcher
    this.origin = origin
    this.clearData = clearData
    this.clearStyles = clearStyles
  }

  list(): Promise<InstalledOfficialApp[]> {
    return this.storage.list()
  }

  async ready(id: OfficialAppId): Promise<boolean> {
    return Boolean(await this.getReadyPackage(id))
  }

  async getReadyPackage(id: OfficialAppId): Promise<InstalledOfficialApp | undefined> {
    return navigator.locks.request('srl-official-app-install', { mode: 'shared' }, async () => {
      const app = (await this.list()).find((app) => app.id === id)
      if (!app || !(await this.isReadyForPackage(app))) return undefined
      return app
    })
  }

  private async isReadyForPackage(app: InstalledOfficialApp): Promise<boolean> {
    if ((app.hostApiVersion ?? 1) !== this.hostApiVersion) return false
    const hostFiles = this.requiredHostFiles(app)
    // Legacy self-contained packages lost their shared-file markers at installation.
    // File presence cannot prove that their Vue instance is the shell's instance.
    if (!hostFiles) return false
    if (this.runtimeEntry !== undefined && app.runtimeEntry !== this.runtimeEntry) return false
    if (
      app.appContentHash &&
      (!safeHash(app.appContentHash) ||
        app.appContentHash !== (await officialAppContentHash(app.files, app.assetMode ?? 'host')))
    )
      return false
    const ownedFiles = app.files.filter(
      (file) => app.assetMode === 'self-contained' || !file.bundled,
    )
    if (this.storage.hasFiles) {
      if (!(await this.storage.hasFiles(ownedFiles))) return false
    } else {
      for (const file of ownedFiles)
        if (!(await this.storage.hasFile(file.path, file.size))) return false
    }
    if (this.runtimeEntry !== undefined) return true
    return this.matchesHostFiles(
      app.hostApiVersion ?? 1,
      hostFiles,
      hostFiles.length ? await this.getShellFiles() : {},
    )
  }

  private requiredHostFiles(app: OfficialAppPackage): OfficialAppFile[] | undefined {
    if (app.hostFiles !== undefined) {
      if (!Array.isArray(app.hostFiles) || !app.hostFiles.length) return undefined
      const declared = new Map(app.files.map((file) => [file.path, file]))
      if (
        !app.hostFiles.every((file) => {
          const packed = file && declared.get(file.path)
          return packed && packed.size === file.size && packed.sha256 === file.sha256
        })
      )
        return undefined
      if (
        app.runtimeEntry !== undefined &&
        !app.hostFiles.some((file) => file.path === app.runtimeEntry)
      )
        return undefined
      return app.hostFiles
    }
    return app.assetMode === 'self-contained' ? undefined : app.files.filter((file) => file.bundled)
  }

  async catalog(): Promise<OfficialAppCatalog> {
    const response = await this.fetcher(
      new URL(`/official-apps/api-${this.hostApiVersion}/catalog.json`, this.origin),
      { cache: 'no-store' },
    )
    if (!response.ok) throw new Error('无法获取官方 APP 列表，请检查网络后重试')
    const catalog = (await response.json()) as OfficialAppCatalog
    if (
      catalog.schemaVersion !== 1 ||
      catalog.hostApiVersion !== this.hostApiVersion ||
      !catalog.apps
    )
      throw new Error('没有适用于当前资源库接口的 APP 版本，请更新资源库')
    return catalog
  }

  async availableUpdates(): Promise<Partial<Record<OfficialAppId, OfficialAppUpdateInfo>>> {
    const catalog = await this.catalog()
    return navigator.locks.request('srl-official-app-install', { mode: 'shared' }, async () => {
      const installed = await this.list()
      const installedById = new Map(installed.map((app) => [app.id, app]))
      const updates: Partial<Record<OfficialAppId, OfficialAppUpdateInfo>> = {}
      for (const id of OFFICIAL_APP_IDS) {
        const app = installedById.get(id)
        if (!app) continue
        const latest = await this.latestCompatibleDownload(
          (catalog.apps[id] ?? []).filter(
            (candidate) =>
              safeHash(candidate.appContentHash) &&
              Number.isSafeInteger(candidate.appContentRevision) &&
              candidate.appContentRevision >= LEGACY_OFFICIAL_APP_CONTENT_REVISION,
          ),
        )
        if (!latest) continue
        const currentRevision = app.appContentRevision ?? LEGACY_OFFICIAL_APP_CONTENT_REVISION
        // Only an explicit host contract mismatch justifies a compatibility update.
        // Missing local package files or a missing shell asset affects readiness,
        // but must not be presented as a new APP version when its content revision is unchanged.
        const requiresHostUpdate = (app.hostApiVersion ?? 1) !== this.hostApiVersion
        const requiresAssetRepair = !requiresHostUpdate && !(await this.isReadyForPackage(app))
        if (
          currentRevision >= latest.appContentRevision &&
          !requiresHostUpdate &&
          !requiresAssetRepair
        )
          continue
        updates[id] = {
          currentVersion: String(currentRevision),
          latestVersion: String(latest.appContentRevision),
          latestShellVersion: latest.shellVersion,
          requiresHostUpdate,
          requiresAssetRepair,
        }
      }
      return updates
    })
  }

  private matchesHostFiles(
    candidateApiVersion: number,
    hostFiles: unknown,
    shellFiles: Record<string, { size: number; sha256: string }>,
  ): boolean {
    if (candidateApiVersion !== this.hostApiVersion || !Array.isArray(hostFiles)) return false
    return hostFiles.every((file) => {
      if (!safeAsset(file.path) || !Number.isSafeInteger(file.size) || !safeHash(file.sha256))
        return false
      const available = shellFiles[file.path]
      return available?.size === file.size && available.sha256 === file.sha256
    })
  }

  private async latestCompatibleDownload(
    candidates: OfficialAppDownload[],
  ): Promise<OfficialAppDownload | undefined> {
    const sorted = [...candidates].sort(
      (left, right) =>
        right.appContentRevision - left.appContentRevision ||
        right.shellVersion.localeCompare(left.shellVersion, undefined, { numeric: true }),
    )
    let shellFiles: Record<string, { size: number; sha256: string }> | undefined
    for (const candidate of sorted) {
      if (candidate.assetMode === 'self-contained' && !candidate.hostFiles?.length) continue
      if (this.runtimeEntry !== undefined) {
        if (
          candidate.runtimeEntry === this.runtimeEntry &&
          Array.isArray(candidate.hostFiles) &&
          candidate.hostFiles.some((file) => file.path === this.runtimeEntry) &&
          candidate.hostApiVersion === this.hostApiVersion
        )
          return candidate
        continue
      }
      if (this.matchesHostFiles(candidate.hostApiVersion, candidate.hostFiles, {})) return candidate
      if (candidate.hostApiVersion !== this.hostApiVersion || !Array.isArray(candidate.hostFiles))
        continue
      shellFiles ??= await this.getShellFiles()
      if (this.matchesHostFiles(candidate.hostApiVersion, candidate.hostFiles, shellFiles))
        return candidate
    }
    return undefined
  }

  private validate(value: unknown, id: OfficialAppId, expectedEntry: string): OfficialAppPackage {
    const app = value as OfficialAppPackage
    if (
      !app ||
      app.schemaVersion !== 1 ||
      app.id !== id ||
      !isOfficialAppId(app.id) ||
      typeof app.shellVersion !== 'string' ||
      (app.hostApiVersion ?? 1) !== this.hostApiVersion ||
      (app.assetMode !== undefined &&
        app.assetMode !== 'host' &&
        app.assetMode !== 'self-contained') ||
      (app.appContentHash !== undefined && !safeHash(app.appContentHash)) ||
      (app.appContentRevision !== undefined &&
        (!Number.isSafeInteger(app.appContentRevision) ||
          app.appContentRevision < LEGACY_OFFICIAL_APP_CONTENT_REVISION)) ||
      app.entry !== expectedEntry ||
      !safeAsset(app.entry)
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
    if (!this.requiredHostFiles(app))
      throw new Error('APP 缺少有效的共享运行时清单，请下载兼容版本')
    if (this.runtimeEntry !== undefined && app.runtimeEntry !== this.runtimeEntry)
      throw new Error('APP 的 Vue 运行时与当前资源库不兼容，请下载兼容版本')
    return app
  }

  async install(id: OfficialAppId): Promise<void> {
    // Locks also serialize mutations from other open tabs sharing the same installation.
    return this.withExclusiveAppUse(id, '更新', () =>
      navigator.locks.request('srl-official-app-install', async () => {
        const candidates = (await this.catalog()).apps[id]
        const download = await this.latestCompatibleDownload(candidates ?? [])
        if (
          !download ||
          typeof download.shellVersion !== 'string' ||
          !safeHash(download.sha256) ||
          !safeHash(download.appContentHash) ||
          !Number.isSafeInteger(download.appContentRevision) ||
          download.appContentRevision < LEGACY_OFFICIAL_APP_CONTENT_REVISION ||
          !safeAsset(download.entry) ||
          !Number.isSafeInteger(download.downloadBytes) ||
          download.downloadBytes <= 0 ||
          download.downloadBytes > MAX_PACKAGE_BYTES
        )
          throw new Error('APP 下载信息无效，请更新资源库')
        const url = new URL(download.url, this.origin)
        const packagePath = url.pathname.startsWith('/official-apps/')
          ? url.pathname.slice('/official-apps/'.length)
          : ''
        if (
          url.origin !== this.origin ||
          !packagePath ||
          !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.srlapp$/u.test(packagePath) ||
          packagePath.split('/').some((segment) => segment === '.' || segment === '..')
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
          download.entry,
        )
        if (Object.keys(files).length !== app.files.length + 1)
          throw new Error('APP 包含未声明文件')
        for (const file of app.files) {
          const data = files[file.path.slice(1)]
          if (!data || data.length !== file.size || (await hashPackageBytes(data)) !== file.sha256)
            throw new Error('APP 文件校验失败')
        }
        if (app.assetMode !== download.assetMode)
          throw new Error('APP 安装包资源模式与下载清单不匹配')
        const appContentHash = await officialAppContentHash(app.files, app.assetMode ?? 'host')
        if (
          appContentHash !== download.appContentHash ||
          app.appContentHash !== appContentHash ||
          (app.appContentRevision ?? LEGACY_OFFICIAL_APP_CONTENT_REVISION) !==
            download.appContentRevision
        )
          throw new Error('APP 内容指纹或更新修订号与清单不匹配')
        const hostFiles = this.requiredHostFiles(app)!
        if (
          this.runtimeEntry === undefined &&
          !this.matchesHostFiles(
            app.hostApiVersion ?? 1,
            hostFiles,
            hostFiles.length ? await this.getShellFiles() : {},
          )
        )
          throw new Error('APP 的共享运行时与当前资源库不兼容，请下载兼容版本')
        const previous = await this.list()
        const previousFilesByPath = new Map(
          previous.flatMap((installed) =>
            installed.files.map((file) => [file.path, file] as const),
          ),
        )
        for (const file of app.files) {
          const old = previousFilesByPath.get(file.path)
          if (old && (old.size !== file.size || old.sha256 !== file.sha256))
            throw new Error('APP 更新包复用了不同内容的文件路径，已保留当前版本')
        }
        const protectedPaths = new Set(
          previous.flatMap((app) => app.files.map((file) => file.path)),
        )
        const written: string[] = []
        // Self-contained packages own all bytes, including assets that happen to
        // share a URL with this shell. Persist each one for Web and APK runtimes.
        const installedFiles = app.files.map((file) =>
          app.assetMode === 'self-contained' ? { ...file, bundled: false } : file,
        )
        const installed: InstalledOfficialApp = {
          ...app,
          files: installedFiles,
          appContentHash,
          appContentRevision: download.appContentRevision,
          installedAt: Date.now(),
        }
        try {
          for (const file of installedFiles) {
            if (await this.storage.hasFileHash(file.path, file.size, file.sha256, file.bundled))
              continue
            written.push(file.path)
            await this.storage.writeFile(file.path, files[file.path.slice(1)]!)
            if (!(await this.storage.hasFileHash(file.path, file.size, file.sha256, file.bundled)))
              throw new Error('APP 文件写入后的校验失败，当前版本未切换')
          }
          const currentPaths = new Set([
            ...app.files.map((file) => file.path),
            ...previous
              .filter((installedApp) => installedApp.id !== id)
              .flatMap((installedApp) => installedApp.files.map((file) => file.path)),
          ])
          const cleanupByPath = new Map<string, OfficialAppFile>()
          for (const old of previous.filter((installedApp) => installedApp.id === id)) {
            for (const file of [...old.files, ...(old.pendingCleanupFiles ?? [])])
              if (!currentPaths.has(file.path)) cleanupByPath.set(file.path, file)
          }
          const cleanupFiles = [...cleanupByPath.values()]
          const nextRecord = cleanupFiles.length
            ? { ...installed, pendingCleanupFiles: cleanupFiles }
            : installed
          await this.storage.save(nextRecord)

          const pendingCleanupFiles: OfficialAppFile[] = []
          for (const file of cleanupFiles) {
            try {
              await this.storage.deleteFile(file.path, file.bundled)
            } catch {
              pendingCleanupFiles.push(file)
            }
          }
          if (cleanupFiles.length) {
            const cleanupRecord = pendingCleanupFiles.length
              ? { ...installed, pendingCleanupFiles }
              : withoutPendingCleanupFiles(nextRecord)
            // The committed record already contains a retry list, so a failed cleanup
            // metadata write is safe and the next install can retry idempotently.
            try {
              await this.storage.save(cleanupRecord)
            } catch {
              // Keep the original persisted retry list.
            }
          }
        } catch (error) {
          const rollbackCleanup = new Map<string, OfficialAppFile>()
          for (const path of written) {
            if (protectedPaths.has(path)) continue
            const file = installedFiles.find((candidate) => candidate.path === path)
            try {
              await this.storage.deleteFile(path, file?.bundled)
            } catch {
              if (file) rollbackCleanup.set(path, file)
            }
          }
          const previousApp = previous.find((installedApp) => installedApp.id === id)
          if (previousApp && rollbackCleanup.size) {
            const pendingByPath = new Map(
              (previousApp.pendingCleanupFiles ?? []).map((file) => [file.path, file] as const),
            )
            for (const [path, file] of rollbackCleanup) pendingByPath.set(path, file)
            try {
              await this.storage.save({
                ...previousApp,
                pendingCleanupFiles: [...pendingByPath.values()],
              })
            } catch {
              // Preserve the original update error; untracked staging files are harmless
              // and the installed record continues to identify the usable old package.
            }
          }
          throw error
        }
      }),
    )
  }

  async uninstall(id: OfficialAppId, deleteData: boolean, deleteStyles = false): Promise<number> {
    if (deleteStyles && !deleteData) throw new Error('删除局部样式需同时选择清除 APP 数据')
    return this.withExclusiveAppUse(id, '卸载', () =>
      navigator.locks.request('srl-official-app-install', async () => {
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
        const uninstallFiles = new Map(
          [...app.files, ...(app.pendingCleanupFiles ?? [])].map((file) => [file.path, file]),
        )
        for (const file of uninstallFiles.values())
          if (!retained.has(file.path)) {
            await this.storage.deleteFile(file.path, file.bundled)
            if (!file.bundled) freed += file.size
          }
        await this.storage.remove(id)
        return freed
      }),
    )
  }

  async clearAppData(id: OfficialAppId, deleteStyles = false): Promise<void> {
    return this.withExclusiveAppUse(id, '清理数据', () =>
      navigator.locks.request('srl-official-app-install', async () => {
        await this.clearData(id)
        if (deleteStyles) await this.clearStyles(id)
      }),
    )
  }
}
