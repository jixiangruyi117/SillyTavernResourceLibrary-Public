import { toRaw } from 'vue'
import { strToU8, zipSync } from 'fflate'
import {
  EXTERNAL_APP_PERMISSION,
  EXTERNAL_APP_RUNTIME_MODE,
  EXTERNAL_APP_SCHEMA_VERSION,
  EXTERNAL_APP_SDK_VERSION,
  externalAppDataId,
  getExternalAppPermissionLevel,
  getGrantedExternalAppPermissions,
  type ExternalAppPreview,
  type ExternalAppManifest,
  type ExternalAppPermission,
  type ExternalAppPermissionAuditEntry,
  type ExternalAppRuntimeMode,
  type ExternalAppDataRecord,
  type ExternalAppHealth,
  type InstalledExternalAppSummary,
  type InstalledExternalApp,
} from '../types/ExternalApp'
import type { ExternalAppStorageAdapter } from '../storage/ExternalAppStorageAdapter'
import {
  type ExternalAppInstallInput,
  readText,
  normalizeManifest,
  fingerprintFiles,
  filesFromInput,
} from './ExternalAppPackage'
import {
  iconDataUrl,
  buildRuntimeHtml,
  inspectCompatibility,
  RUNTIME_BRIDGE_MARKER,
} from './ExternalAppRuntime'

const MAX_APP_DATA_VALUE_BYTES = 100 * 1024

const MAX_APP_DATA_BYTES = 1024 * 1024

const MAX_DIAGNOSTIC_LENGTH = 500

import { TEXT_ENCODER } from './ExternalAppPackage'

function normalizeDataKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 120 || key.includes('\u0000')) throw new Error('APP 存储键无效')
  return key
}

function cloneJsonValue(value: unknown): unknown {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new Error('APP 存储内容必须是可序列化数据')
  }
  if (encoded === undefined) throw new Error('APP 存储内容必须是可序列化数据')
  if (TEXT_ENCODER.encode(encoded).byteLength > MAX_APP_DATA_VALUE_BYTES) {
    throw new Error('单条 APP 存储内容超过限制')
  }
  return JSON.parse(encoded) as unknown
}

function byteLength(value: unknown): number {
  return TEXT_ENCODER.encode(JSON.stringify(value)).byteLength
}

export class ExternalAppService {
  private readonly storage: ExternalAppStorageAdapter

  constructor(storage: ExternalAppStorageAdapter) {
    this.storage = storage
  }

  async list(): Promise<InstalledExternalAppSummary[]> {
    return this.storage.list()
  }

  async exportPortableState(): Promise<{
    apps: InstalledExternalApp[]
    data: ExternalAppDataRecord[]
  }> {
    const summaries = await this.storage.list()
    const apps = (await Promise.all(summaries.map((app) => this.storage.get(app.id)))).filter(
      (app): app is InstalledExternalApp => Boolean(app),
    )
    const dataAppIds = this.storage.listDataAppIds
      ? await this.storage.listDataAppIds()
      : apps.map((app) => app.id)
    const data = (await Promise.all(dataAppIds.map((appId) => this.storage.listData(appId)))).flat()
    return { apps, data }
  }

  async importPortableState(value: {
    apps: InstalledExternalApp[]
    data: ExternalAppDataRecord[]
  }): Promise<void> {
    const apps = Array.isArray(value?.apps) ? value.apps : []
    for (const app of apps) {
      const manifest = normalizeManifest(app?.manifest)
      if (!app.runtimeHtml || typeof app.runtimeHtml !== 'string') continue
      await this.storage.save({
        id: manifest.id,
        manifest,
        runtimeHtml: app.runtimeHtml,
        ...(app.packageFiles ? { packageFiles: app.packageFiles } : {}),
        ...(app.iconDataUrl ? { iconDataUrl: app.iconDataUrl } : {}),
        allowedPermissions: getGrantedExternalAppPermissions(app),
        grantedPermissions: [],
        packageFingerprint: app.packageFingerprint,
        runtimeMode: app.runtimeMode ?? EXTERNAL_APP_RUNTIME_MODE.ISOLATED,
        persistentPermissionGrants: [],
        permissionAudit: [],
        enabled: false,
        installedAt: Number.isFinite(app.installedAt) ? app.installedAt : Date.now(),
        updatedAt: Number.isFinite(app.updatedAt) ? app.updatedAt : Date.now(),
      })
    }
    for (const record of Array.isArray(value?.data) ? value.data : []) {
      if (!record || typeof record.appId !== 'string' || typeof record.key !== 'string') continue
      await this.storage.setData({
        id: externalAppDataId(record.appId, record.key),
        appId: record.appId,
        key: record.key,
        value: cloneJsonValue(record.value),
        updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
      })
    }
  }

  async get(id: string): Promise<InstalledExternalApp | undefined> {
    const app = await this.storage.get(id)
    if (!app?.packageFiles || app.runtimeHtml.includes(RUNTIME_BRIDGE_MARKER)) return app

    // 已安装 APP 会保存隔离运行时；升级宿主桥接后，从原始包无损重建一次，避免要求用户重装。
    const migrated: InstalledExternalApp = {
      ...app,
      runtimeHtml: buildRuntimeHtml(
        app.packageFiles,
        app.manifest,
        app.runtimeMode ?? EXTERNAL_APP_RUNTIME_MODE.ISOLATED,
      ),
    }
    await this.storage.save(migrated)
    return migrated
  }

  async inspect(input: File | readonly File[]): Promise<ExternalAppPreview> {
    const packageFiles = await filesFromInput(input)
    const previous = await this.storage.getSummary(packageFiles.manifest.id)
    const requestedPermissions = packageFiles.manifest.permissions ?? []
    const packageFingerprint =
      packageFiles.fingerprint ?? (await fingerprintFiles(packageFiles.files))
    // Keep only the requested runtime mode, releasing the previous large string on switches.
    let cachedMode: ExternalAppRuntimeMode | undefined
    let cachedHtml = ''
    const runtime = (mode: ExternalAppRuntimeMode) => {
      if (cachedMode !== mode) {
        cachedHtml = buildRuntimeHtml(packageFiles.files, packageFiles.manifest, mode)
        cachedMode = mode
      }
      return cachedHtml
    }
    const compatibility = [
      ...new Map(
        Object.entries(packageFiles.files)
          .filter(([path]) => /\.(?:html?|js|css)$/i.test(path))
          .flatMap(([path, bytes]) => inspectCompatibility(readText(bytes, path)))
          .map((notice) => [notice.code, notice]),
      ).values(),
    ]
    return {
      manifest: packageFiles.manifest,
      get runtimeHtml() {
        return runtime(EXTERNAL_APP_RUNTIME_MODE.ISOLATED)
      },
      get compatibleRuntimeHtml() {
        return runtime(EXTERNAL_APP_RUNTIME_MODE.TRUSTED_COMPATIBLE)
      },
      sourceKind: packageFiles.sourceKind,
      packageFingerprint,
      requestedPermissions,
      permissionLevel: getExternalAppPermissionLevel(requestedPermissions),
      requiresReauthorization: Boolean(
        previous &&
        (previous.packageFingerprint !== packageFingerprint ||
          requestedPermissions.some(
            (permission) => !getGrantedExternalAppPermissions(previous).includes(permission),
          )),
      ),
      compatibility,
      packageBytes: Object.values(packageFiles.files).reduce(
        (total, bytes) => total + bytes.byteLength,
        0,
      ),
      packageFiles: packageFiles.files,
      iconDataUrl: iconDataUrl(packageFiles.files, packageFiles.manifest),
    }
  }

  async install(
    input: ExternalAppInstallInput,
    runtimeMode: ExternalAppRuntimeMode = EXTERNAL_APP_RUNTIME_MODE.ISOLATED,
  ): Promise<InstalledExternalApp> {
    const preview = 'packageFingerprint' in input ? input : await this.inspect(input)
    const manifest = normalizeManifest(preview.manifest)
    const now = Date.now()
    const previous = await this.storage.getSummary(manifest.id)
    const packageUnchanged = previous?.packageFingerprint === preview.packageFingerprint
    const installed: InstalledExternalApp = {
      id: manifest.id,
      // 安装预览会经过 Vue 的响应式状态；写入 IndexedDB 前必须还原为可结构化克隆的普通对象。
      manifest,
      runtimeHtml:
        runtimeMode === EXTERNAL_APP_RUNTIME_MODE.TRUSTED_COMPATIBLE
          ? preview.compatibleRuntimeHtml
          : preview.runtimeHtml,
      ...(preview.packageFiles
        ? {
            packageFiles: Object.fromEntries(
              Object.entries(preview.packageFiles).map(([path, contents]) => [
                path,
                toRaw(contents),
              ]),
            ),
          }
        : {}),
      ...(preview.iconDataUrl ? { iconDataUrl: preview.iconDataUrl } : {}),
      allowedPermissions: Array.from(
        new Set(preview.allowedPermissions ?? preview.requestedPermissions),
      ),
      grantedPermissions: [],
      packageFingerprint: preview.packageFingerprint,
      runtimeMode,
      persistentPermissionGrants: packageUnchanged
        ? (previous?.persistentPermissionGrants ?? [])
        : [],
      permissionAudit: packageUnchanged ? (previous?.permissionAudit ?? []) : [],
      health: {
        ...(packageUnchanged ? previous?.health : undefined),
        packageBytes: preview.packageBytes,
        dataBytes: previous?.health?.dataBytes ?? 0,
        dataLimitBytes: MAX_APP_DATA_BYTES,
        dataEntries: previous?.health?.dataEntries ?? 0,
        consecutiveFailures: packageUnchanged ? (previous?.health?.consecutiveFailures ?? 0) : 0,
      },
      enabled: previous?.enabled ?? true,
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
    }
    await this.storage.save(installed)
    return installed
  }

  async updateSourceFile(id: string, path: string, source: string): Promise<InstalledExternalApp> {
    const app = await this.storage.get(id)
    if (!app?.packageFiles) throw new Error('这个 APP 没有可编辑的原始文件')
    if (path === 'manifest.json' || !/\.(?:html?|css|js|mjs|json)$/i.test(path))
      throw new Error('当前只允许编辑 HTML、CSS、JavaScript 和 JSON 文本文件')
    if (!(path in app.packageFiles)) throw new Error('未找到要编辑的 APP 文件')
    const encoded = TEXT_ENCODER.encode(source)
    if (encoded.byteLength > 512 * 1024) throw new Error('单个源码文件不能超过 512 KiB')
    const packageFiles = { ...app.packageFiles, [path]: encoded }
    const packageFingerprint = await fingerprintFiles(packageFiles)
    const runtimeMode = app.runtimeMode ?? EXTERNAL_APP_RUNTIME_MODE.ISOLATED
    const runtimeHtml = buildRuntimeHtml(packageFiles, app.manifest, runtimeMode)
    const updated: InstalledExternalApp = {
      ...app,
      packageFiles,
      packageFingerprint,
      runtimeHtml,
      persistentPermissionGrants: [],
      permissionAudit: [],
      health: {
        ...(app.health ?? {
          packageBytes: 0,
          dataBytes: 0,
          dataLimitBytes: MAX_APP_DATA_BYTES,
          dataEntries: 0,
          consecutiveFailures: 0,
        }),
        packageBytes: Object.values(packageFiles).reduce(
          (total, bytes) => total + bytes.byteLength,
          0,
        ),
        consecutiveFailures: 0,
      },
      updatedAt: Date.now(),
    }
    await this.storage.save(updated)
    return updated
  }

  async updatePresentation(id: string, name: string, iconDataUrl?: string): Promise<void> {
    const normalizedName = name.trim()
    if (!normalizedName || normalizedName.length > 80)
      throw new Error('APP 名称必须为 1 到 80 个字符')
    if (iconDataUrl && iconDataUrl.length > 2 * 1024 * 1024) throw new Error('APP 图标数据过大')
    await this.storage.mutateMetadata(id, (app) => ({
      manifest: { ...app.manifest, name: normalizedName },
      ...(iconDataUrl !== undefined ? { iconDataUrl } : {}),
      updatedAt: Date.now(),
    }))
  }

  async setAllowedPermissions(
    id: string,
    permissions: readonly ExternalAppPermission[],
  ): Promise<void> {
    await this.storage.mutateMetadata(id, (app) => {
      const requested = new Set(app.manifest.permissions ?? [])
      const allowed = Array.from(new Set(permissions)).filter((permission) =>
        requested.has(permission),
      )
      return {
        allowedPermissions: allowed,
        persistentPermissionGrants: (app.persistentPermissionGrants ?? []).filter((permission) =>
          allowed.includes(permission),
        ),
        updatedAt: Date.now(),
      }
    })
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!(await this.storage.getSummary(id))) throw new Error('未找到该 APP')
    await this.storage.setEnabled(id, enabled)
  }

  async uninstall(id: string): Promise<void> {
    await this.storage.delete(id)
  }

  async clearData(appId: string): Promise<void> {
    const app = await this.storage.getSummary(appId)
    if (!app) throw new Error('APP 不存在或已卸载')
    await this.storage.clearData(appId)
    await this.updateHealth(appId, { dataBytes: 0, dataEntries: 0 })
  }

  async hasPermission(appId: string, permission: ExternalAppPermission): Promise<boolean> {
    const app = await this.storage.getSummary(appId)
    return Boolean(app?.enabled && getGrantedExternalAppPermissions(app).includes(permission))
  }

  async hasPersistentPermission(
    appId: string,
    permission: ExternalAppPermission,
  ): Promise<boolean> {
    const app = await this.storage.getSummary(appId)
    return Boolean(app?.enabled && app.persistentPermissionGrants?.includes(permission))
  }

  async grantPersistentPermission(appId: string, permission: ExternalAppPermission): Promise<void> {
    await this.storage.mutateMetadata(appId, (app) => {
      if (!app.enabled) throw new Error('APP 已被禁用')
      if (!(app.manifest.permissions ?? []).includes(permission))
        throw new Error('APP 未在清单中声明此权限')
      if (!getGrantedExternalAppPermissions(app).includes(permission))
        throw new Error('此权限未在安装时授权')
      return {
        persistentPermissionGrants: Array.from(
          new Set([...(app.persistentPermissionGrants ?? []), permission]),
        ),
        updatedAt: Date.now(),
      }
    })
  }

  async revokePersistentPermission(
    appId: string,
    permission?: ExternalAppPermission,
  ): Promise<void> {
    await this.storage.mutateMetadata(appId, (app) => ({
      persistentPermissionGrants: permission
        ? (app.persistentPermissionGrants ?? []).filter((item) => item !== permission)
        : [],
      updatedAt: Date.now(),
    }))
  }

  async recordPermissionDecision(
    appId: string,
    entry: Omit<ExternalAppPermissionAuditEntry, 'createdAt'>,
  ): Promise<void> {
    await this.storage.mutateMetadata(appId, (app) => ({
      permissionAudit: [{ ...entry, createdAt: Date.now() }, ...(app.permissionAudit ?? [])].slice(
        0,
        50,
      ),
      updatedAt: Date.now(),
    }))
  }

  async exportPackage(appId: string): Promise<File> {
    const app = await this.storage.get(appId)
    if (!app) throw new Error('APP 不存在或已卸载')
    return this.packageFile(app.manifest, app.packageFiles, app.runtimeHtml)
  }

  async exportPreviewPackage(preview: ExternalAppPreview): Promise<File> {
    return this.packageFile(preview.manifest, preview.packageFiles, preview.runtimeHtml)
  }

  createTemplatePackage(): File {
    const files: Record<string, Uint8Array> = {
      'index.html': TEXT_ENCODER.encode(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>我的 SRL APP</title><link rel="stylesheet" href="app.css"></head>
<body><main><h1>我的 SRL APP</h1><p id="status">正在连接 SRL…</p><button id="save">保存示例数据</button></main><script src="app.js"></script></body></html>`),
      'app.css': TEXT_ENCODER.encode(
        'body{margin:0;padding:24px;font:16px system-ui;color:#15343a;background:#f5fbfb}main{max-width:520px;margin:auto;padding:24px;border-radius:18px;background:#fff;box-shadow:0 10px 32px #1f6f7722}button{min-height:44px;padding:0 16px;border:0;border-radius:12px;color:#fff;background:#237f87;font:inherit}',
      ),
      'app.js': TEXT_ENCODER.encode(
        `(async()=>{await window.srlApp.ready();document.querySelector('#status').textContent='已连接 SRL';document.querySelector('#save').onclick=async()=>{await window.srlApp.storage.set('example',{savedAt:Date.now()});await window.srlApp.notify('示例数据已保存')}})()`,
      ),
      'icon.svg': TEXT_ENCODER.encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="#237f87"/><circle cx="48" cy="48" r="22" fill="#fff" opacity=".9"/></svg>',
      ),
    }
    const manifest: ExternalAppManifest = {
      schemaVersion: EXTERNAL_APP_SCHEMA_VERSION,
      apiVersion: EXTERNAL_APP_SDK_VERSION,
      id: 'com.example.my-srl-app',
      name: '我的 SRL APP',
      version: '1.0.0',
      entry: 'index.html',
      description: '可直接修改并导入的最小第三方 APP 模板。',
      icon: 'icon.svg',
      splashColor: '#237f87',
      orientation: 'auto',
      immersive: false,
      permissions: [EXTERNAL_APP_PERMISSION.STORAGE],
    }
    return this.packageFile(
      manifest,
      files,
      files['index.html'] ? readText(files['index.html'], 'index.html') : '',
    )
  }

  private packageFile(
    manifestValue: ExternalAppManifest,
    packageFiles: Record<string, Uint8Array> | undefined,
    fallbackHtml: string,
  ): File {
    const manifest = JSON.stringify(manifestValue, null, 2)
    const archive = zipSync({
      ...(packageFiles ?? {}),
      'manifest.json': strToU8(manifest),
      ...(packageFiles?.[manifestValue.entry]
        ? {}
        : { [manifestValue.entry]: strToU8(fallbackHtml) }),
    })
    return new File([archive], `${manifestValue.id}-${manifestValue.version}.srlapp`, {
      type: 'application/zip',
    })
  }

  async getData(appId: string, keyValue: unknown): Promise<unknown> {
    const key = normalizeDataKey(keyValue)
    if (!(await this.hasPermission(appId, EXTERNAL_APP_PERMISSION.STORAGE))) {
      throw new Error('该 APP 未获得本地存储权限')
    }
    return (await this.storage.getData(appId, key))?.value ?? null
  }

  async setData(appId: string, keyValue: unknown, value: unknown): Promise<void> {
    const key = normalizeDataKey(keyValue)
    if (!(await this.hasPermission(appId, EXTERNAL_APP_PERMISSION.STORAGE))) {
      throw new Error('该 APP 未获得本地存储权限')
    }
    const normalized = cloneJsonValue(value)
    const existing = await this.storage.listData(appId)
    const nextSize = TEXT_ENCODER.encode(JSON.stringify(normalized)).byteLength
    const retainedSize = existing
      .filter((record) => record.key !== key)
      .reduce(
        (total, record) => total + TEXT_ENCODER.encode(JSON.stringify(record.value)).byteLength,
        0,
      )
    if (retainedSize + nextSize > MAX_APP_DATA_BYTES)
      throw new Error('APP 本地存储总量超过 1 MiB 限制')
    await this.storage.setData({
      id: externalAppDataId(appId, key),
      appId,
      key,
      value: normalized,
      updatedAt: Date.now(),
    })
    await this.updateHealth(appId, {
      dataBytes: retainedSize + nextSize,
      dataEntries: existing.some((record) => record.key === key)
        ? existing.length
        : existing.length + 1,
    })
  }

  async removeData(appId: string, keyValue: unknown): Promise<void> {
    const key = normalizeDataKey(keyValue)
    if (!(await this.hasPermission(appId, EXTERNAL_APP_PERMISSION.STORAGE))) {
      throw new Error('该 APP 未获得本地存储权限')
    }
    await this.storage.deleteData(appId, key)
    const remaining = await this.storage.listData(appId)
    await this.updateHealth(appId, {
      dataBytes: remaining.reduce((total, record) => total + byteLength(record.value), 0),
      dataEntries: remaining.length,
    })
  }

  async getHealth(appId: string): Promise<ExternalAppHealth> {
    const app = await this.storage.getSummary(appId)
    if (!app) throw new Error('APP 不存在或已卸载')
    const data = await this.storage.listData(appId)
    const derived = {
      packageBytes: app.health?.packageBytes ?? 0,
      dataBytes: data.reduce((total, record) => total + byteLength(record.value), 0),
      dataLimitBytes: MAX_APP_DATA_BYTES,
      dataEntries: data.length,
      lastLaunchedAt: app.health?.lastLaunchedAt,
      lastErrorAt: app.health?.lastErrorAt,
      lastError: app.health?.lastError,
      consecutiveFailures: app.health?.consecutiveFailures ?? 0,
    }
    await this.updateHealth(appId, derived)
    return derived
  }

  async recordLaunch(appId: string): Promise<void> {
    await this.updateHealth(appId, {
      lastLaunchedAt: Date.now(),
    })
  }

  async recordHealthyLaunch(appId: string): Promise<void> {
    await this.updateHealth(appId, {
      consecutiveFailures: 0,
      lastError: undefined,
      lastErrorAt: undefined,
      disabledByWatchdog: false,
    })
  }

  async recordRuntimeError(appId: string, error: unknown): Promise<ExternalAppHealth | undefined> {
    const app = await this.storage.getSummary(appId)
    if (!app) return undefined
    const message = (error instanceof Error ? error.message : String(error))
      .trim()
      .slice(0, MAX_DIAGNOSTIC_LENGTH)
    const health = await this.updateHealth(appId, {
      lastError: message || 'APP 运行异常',
      lastErrorAt: Date.now(),
      consecutiveFailures: (app.health?.consecutiveFailures ?? 0) + 1,
    })
    if (health.consecutiveFailures >= 3) {
      health.disabledByWatchdog = true
      await this.storage.updateMetadata(appId, { health, enabled: false, updatedAt: Date.now() })
    }
    return health
  }

  private async updateHealth(
    appId: string,
    changes: Partial<ExternalAppHealth>,
  ): Promise<ExternalAppHealth> {
    const current = await this.storage.getSummary(appId)
    if (!current) throw new Error('APP 不存在或已卸载')
    const health: ExternalAppHealth = {
      packageBytes: current.health?.packageBytes ?? 0,
      dataBytes: current.health?.dataBytes ?? 0,
      dataLimitBytes: MAX_APP_DATA_BYTES,
      dataEntries: current.health?.dataEntries ?? 0,
      consecutiveFailures: current.health?.consecutiveFailures ?? 0,
      ...current.health,
      ...changes,
    }
    await this.storage.updateMetadata(appId, { health, updatedAt: Date.now() })
    return health
  }
}
