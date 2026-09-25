/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbExternalAppStorage } from '../storage/IndexedDbExternalAppStorage'
import { ExternalAppService } from './ExternalAppService'

const databases: AppDatabase[] = []

function createService(name: string): ExternalAppService {
  const database = new AppDatabase(name)
  databases.push(database)
  return new ExternalAppService(new IndexedDbExternalAppStorage(database))
}

function createPackage(
  manifest: Record<string, unknown>,
  extraFiles: Record<string, Uint8Array | string> = {},
): File {
  const archive = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'index.html': strToU8(
      '<!doctype html><html><head><link rel="stylesheet" href="app.css"></head><body><img src="images/logo.svg"><script src="app.js"></script></body></html>',
    ),
    'app.css': strToU8('.logo { background: url("images/logo.svg"); }'),
    'app.js': strToU8('window.appLoaded = true'),
    'images/logo.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    ...Object.fromEntries(
      Object.entries(extraFiles).map(([path, value]) => [
        path,
        typeof value === 'string' ? strToU8(value) : value,
      ]),
    ),
  })
  return new File([archive], 'memo.srlapp', { type: 'application/zip' })
}

const manifest = {
  schemaVersion: 1,
  id: 'com.example.memo',
  name: '离线备忘',
  version: '1.0.0',
  entry: 'index.html',
  permissions: ['app.storage'],
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = opened.map((database) => database.name)
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('ExternalAppService', () => {
  it('keeps reader data through promotion and backs it up separately from third-party code', async () => {
    const id = 'com.srl.duleme'
    const service = createService(`reader-${crypto.randomUUID()}`)
    await service.install(createPackage({ ...manifest, id }))
    await service.setData(id, 'chat:rain', { note: '留住这一楼', marks: [{ floor: 2, reply: 1 }] })
    await service.install(createPackage({ ...manifest, id, version: '2.0.0' }))
    expect(await service.getData(id, 'chat:rain')).toMatchObject({ note: '留住这一楼' })
    expect(await service.list()).toEqual([])
    expect(await service.exportPortableState()).toEqual({ apps: [], data: [] })
    const data = await service.exportReaderData()
    const restored = createService(`reader-restore-${crypto.randomUUID()}`)
    await restored.importReaderData(data)
    await restored.install(createPackage({ ...manifest, id }))
    expect(await restored.getData(id, 'chat:rain')).toEqual(data[0]!.value)
  })
  it('restores exported apps disabled and without their former grants', async () => {
    const source = createService(`external-export-${crypto.randomUUID()}`)
    await source.install(createPackage(manifest))
    await source.setData(manifest.id, 'note', { text: 'backup me' })
    const target = createService(`external-import-${crypto.randomUUID()}`)

    await target.importPortableState(await source.exportPortableState())

    expect(await target.get(manifest.id)).toMatchObject({ enabled: false, grantedPermissions: [] })
    await expect(target.getData(manifest.id, 'note')).rejects.toThrow('本地存储权限')
  })

  it('inspects a self-contained package without persisting it before confirmation', async () => {
    const service = createService(`external-app-${crypto.randomUUID()}`)

    const preview = await service.inspect(createPackage(manifest))

    expect(preview.manifest.name).toBe('离线备忘')
    expect(preview.runtimeHtml).toContain("connect-src 'none'")
    expect(preview.runtimeHtml).toContain("for (const name of ['localStorage', 'sessionStorage'])")
    expect(preview.runtimeHtml.indexOf('const createMemoryStorage')).toBeLessThan(
      preview.runtimeHtml.indexOf('window.appLoaded = true'),
    )
    expect(preview.runtimeHtml).toContain('diagnostics.splice(0).forEach')
    expect(preview.runtimeHtml).toContain("Object.defineProperty(navigator, 'locks'")
    expect(preview.runtimeHtml).toContain("exitFullscreen: () => request('ui.exitFullscreen'")
    expect(preview.runtimeHtml).toContain("setTitle: (title) => request('ui.title'")
    expect(preview.runtimeHtml).toContain('files: Object.freeze({')
    expect(preview.runtimeHtml).toContain('SRL_RUNTIME_BRIDGE_V3')
    expect(preview.runtimeHtml).toContain("'srl:host-hold-start'")
    expect(preview.runtimeHtml).toContain('HOLD_MOVE_TOLERANCE_PX = 18')
    expect(preview.runtimeHtml).toContain("window.addEventListener('pointermove'")
    expect(preview.runtimeHtml).toContain("window.addEventListener('touchmove'")
    expect(preview.runtimeHtml).toContain("window.addEventListener('touchend'")
    expect(preview.runtimeHtml).toContain("window.addEventListener('blur', endHostHoldGesture")
    expect(preview.runtimeHtml).not.toContain(
      "window.addEventListener('pointercancel', () => sendHostHoldSignal('srl:host-hold-end'",
    )
    expect(await service.get(manifest.id)).toBeUndefined()
  })

  it('refreshes an installed package runtime when the host bridge changes', async () => {
    const database = new AppDatabase(`external-runtime-migration-${crypto.randomUUID()}`)
    databases.push(database)
    const storage = new IndexedDbExternalAppStorage(database)
    const service = new ExternalAppService(storage)
    const installed = await service.install(createPackage(manifest))
    await storage.save({
      ...installed,
      runtimeHtml: '<!doctype html><html><body><!-- SRL_RUNTIME_BRIDGE_V2 -->legacy</body></html>',
    })

    const migrated = await service.get(manifest.id)

    expect(migrated?.runtimeHtml).toContain('SRL_RUNTIME_BRIDGE_V3')
    expect((await storage.get(manifest.id))?.runtimeHtml).toContain('srl:host-hold-start')
  })

  it('installs a Vue-reactive preview as plain IndexedDB data', async () => {
    const service = createService(`external-reactive-preview-${crypto.randomUUID()}`)
    const preview = reactive(await service.inspect(createPackage(manifest)))

    await expect(service.install(preview)).resolves.toMatchObject({ id: manifest.id })
  })

  it('accepts a package with a static asset larger than 5 MiB within the new package budget', async () => {
    const service = createService(`external-large-asset-${crypto.randomUUID()}`)
    const largeAsset = new Uint8Array(6 * 1024 * 1024)

    const preview = await service.inspect(
      createPackage(manifest, { 'images/hero.webp': largeAsset }),
    )

    expect(preview.manifest.id).toBe(manifest.id)
  })

  it('turns a single HTML page into a local APP and preserves its trusted compatibility runtime', async () => {
    const service = createService(`external-html-${crypto.randomUUID()}`)
    const html = new File(
      [
        '<!doctype html><html><head><script src="https://cdn.example/app.js"></script></head><body><img src="https://images.example/card.png"></body></html>',
      ],
      '我的工具.html',
      { type: 'text/html' },
    )

    const preview = await service.inspect(html)

    expect(preview.sourceKind).toBe('html')
    expect(preview.manifest.id).toMatch(/^local\./)
    expect(preview.runtimeHtml).not.toContain('cdn.example')
    expect(preview.compatibleRuntimeHtml).toContain('https://cdn.example/app.js')
    expect(preview.compatibleRuntimeHtml).toContain('connect-src https:')

    const installed = await service.install(preview, 'trustedCompatible')
    expect(installed.runtimeMode).toBe('trustedCompatible')
    expect(installed.runtimeHtml).toContain('https://images.example/card.png')
    expect(installed.packageFiles?.['我的工具.html']).toBeDefined()
    const exported = await service.exportPackage(installed.id)
    const contents = unzipSync(new Uint8Array(await exported.arrayBuffer()))
    expect(contents['我的工具.html']).toBeDefined()
    expect(contents['manifest.json']).toBeDefined()
  })

  it('creates a standard editable template package with app metadata', async () => {
    const service = createService(`external-template-${crypto.randomUUID()}`)

    const template = service.createTemplatePackage()
    const preview = await service.inspect(template)

    expect(preview.manifest.icon).toBe('icon.svg')
    expect(preview.manifest.splashColor).toBe('#237f87')
    expect(preview.manifest.orientation).toBe('auto')
    expect(preview.packageFiles['app.js']).toBeDefined()
  })

  it('records and revokes a persistent runtime permission without granting undeclared access', async () => {
    const service = createService(`external-permission-${crypto.randomUUID()}`)
    const installed = await service.install(
      createPackage({
        ...manifest,
        schemaVersion: 2,
        apiVersion: 'srl-app-api@1',
        permissionLevel: 'selectedRead',
        permissions: ['resources.selected.read'],
      }),
    )

    await service.grantPersistentPermission(installed.id, 'resources.selected.read')
    await service.recordPermissionDecision(installed.id, {
      permission: 'resources.selected.read',
      method: 'resources.pick',
      decision: 'always',
      summary: '用户选择资源后读取。',
    })

    expect(await service.hasPersistentPermission(installed.id, 'resources.selected.read')).toBe(
      true,
    )
    expect((await service.get(installed.id))?.permissionAudit).toHaveLength(1)
    await expect(
      service.grantPersistentPermission(installed.id, 'resources.write'),
    ).rejects.toThrow('未在清单中声明')
    await service.revokePersistentPermission(installed.id)
    expect(await service.hasPersistentPermission(installed.id, 'resources.selected.read')).toBe(
      false,
    )
  })

  it('installs a self-contained package and persists app-local data across service instances', async () => {
    const name = `external-app-${crypto.randomUUID()}`
    const first = createService(name)
    const installed = await first.install(createPackage(manifest))

    expect(installed.enabled).toBe(true)
    expect(installed.runtimeHtml).toContain("connect-src 'none'")
    expect(installed.runtimeHtml).toContain('window.srlApp')
    expect(installed.runtimeHtml).toContain("update: (change) => request('resources.update'")
    expect(installed.runtimeHtml).not.toContain('drafts.create')
    expect(installed.runtimeHtml).toContain('data:image/svg+xml;base64,')
    expect(installed.runtimeHtml).not.toContain('src="app.js"')

    await first.setData(installed.id, 'draft', { text: 'hello' })

    const second = createService(name)
    expect(await second.getData(installed.id, 'draft')).toEqual({ text: 'hello' })

    await second.setEnabled(installed.id, false)
    expect((await second.get(installed.id))?.enabled).toBe(false)
    await second.uninstall(installed.id)
    expect(await second.get(installed.id)).toBeUndefined()

    const third = createService(name)
    const reinstalled = await third.install(createPackage(manifest))
    expect(await third.getData(reinstalled.id, 'draft')).toEqual({ text: 'hello' })
    await third.clearData(reinstalled.id)
    expect(await third.getData(reinstalled.id, 'draft')).toBeNull()
  })

  it('keeps runtime HTML out of the list result and reports bounded per-app storage health', async () => {
    const service = createService(`external-health-${crypto.randomUUID()}`)
    const installed = await service.install(createPackage(manifest))

    const summary = (await service.list())[0]
    expect(summary).toBeDefined()
    expect('runtimeHtml' in summary!).toBe(false)

    await service.setData(installed.id, 'draft', { text: 'saved locally' })
    const health = await service.getHealth(installed.id)
    expect(health.packageBytes).toBeGreaterThan(0)
    expect(health.dataBytes).toBeGreaterThan(0)
    expect(health.dataEntries).toBe(1)
    expect(health.dataLimitBytes).toBe(1024 * 1024)

    await service.recordRuntimeError(installed.id, new Error('startup failed'))
    expect((await service.getHealth(installed.id)).lastError).toBe('startup failed')
    expect((await service.getHealth(installed.id)).consecutiveFailures).toBe(1)
  })

  it('only clears crash history after a healthy SDK connection and disables the failing app at three errors', async () => {
    const service = createService(`external-watchdog-${crypto.randomUUID()}`)
    const installed = await service.install(createPackage(manifest))

    await service.recordRuntimeError(installed.id, 'first')
    await service.recordLaunch(installed.id)
    expect((await service.getHealth(installed.id)).consecutiveFailures).toBe(1)
    await service.recordRuntimeError(installed.id, 'second')
    const health = await service.recordRuntimeError(installed.id, 'third')

    expect(health?.disabledByWatchdog).toBe(true)
    expect((await service.get(installed.id))?.enabled).toBe(false)
    await service.setEnabled(installed.id, true)
    await service.recordHealthyLaunch(installed.id)
    expect((await service.getHealth(installed.id)).consecutiveFailures).toBe(0)
  })

  it('reports browser persistence and worker requirements before installation', async () => {
    const service = createService(`external-preflight-${crypto.randomUUID()}`)
    const html = new File(
      [
        '<!doctype html><script>indexedDB.open("app"); navigator.serviceWorker.register("sw.js"); localStorage.getItem("x"); fetch("/api")</script>',
      ],
      '检查.html',
      { type: 'text/html' },
    )

    const preview = await service.inspect(html)

    expect(preview.compatibility.map((notice) => notice.code)).toEqual(
      expect.arrayContaining([
        'isolated-persistence',
        'worker',
        'session-storage',
        'external-or-absolute-path',
        'viewport',
      ]),
    )
    expect(preview.packageBytes).toBeGreaterThan(0)
  })

  it('rejects unsupported permissions before an app reaches the runtime', async () => {
    const service = createService(`external-app-${crypto.randomUUID()}`)

    await expect(
      service.install(
        createPackage({
          ...manifest,
          permissions: ['app.storage', 'resources.read'],
        }),
      ),
    ).rejects.toThrow('APP 声明了暂不支持的权限')
  })

  it('rejects a package whose declared icon is missing', async () => {
    const service = createService(`external-missing-icon-${crypto.randomUUID()}`)

    await expect(
      service.inspect(
        createPackage({
          ...manifest,
          schemaVersion: 2,
          apiVersion: 'srl-app-api@1',
          permissionLevel: 'isolated',
          icon: 'missing.svg',
          permissions: [],
        }),
      ),
    ).rejects.toThrow('图标文件')
  })

  it('does not expose app storage without an explicit storage permission', async () => {
    const service = createService(`external-app-${crypto.randomUUID()}`)
    const installed = await service.install(
      createPackage({ ...manifest, id: 'com.example.no-storage', permissions: [] }),
    )

    await expect(service.removeData(installed.id, 'draft')).rejects.toThrow('本地存储权限')
  })

  it('clears persisted runtime permission grants when an upgraded package changes', async () => {
    const name = `external-app-${crypto.randomUUID()}`
    const service = createService(name)
    await service.install(createPackage(manifest))
    const upgrade = createPackage({
      ...manifest,
      schemaVersion: 2,
      apiVersion: 'srl-app-api@1',
      permissionLevel: 'selectedRead',
      version: '1.1.0',
      permissions: ['app.storage', 'resources.selected.read'],
    })

    const preview = await service.inspect(upgrade)
    expect(preview.requiresReauthorization).toBe(true)
    expect(preview.permissionLevel).toBe('selectedRead')
    await service.grantPersistentPermission(manifest.id, 'app.storage')
    const installed = await service.install(upgrade)
    expect(installed.grantedPermissions).toEqual([])
    expect(installed.persistentPermissionGrants).toEqual([])
    expect((await createService(name).get(installed.id))?.persistentPermissionGrants).toEqual([])
  })

  it('changes permissions and enabled state without rewriting the large runtime record', async () => {
    const name = `external-metadata-${crypto.randomUUID()}`
    const database = new AppDatabase(name)
    databases.push(database)
    const service = new ExternalAppService(new IndexedDbExternalAppStorage(database))
    const installed = await service.install(
      createPackage(manifest, { 'large.js': new Uint8Array(6 * 1024 * 1024) }),
    )
    const putRuntime = vi.spyOn(database.externalAppRuntimes, 'put')

    await service.grantPersistentPermission(installed.id, 'app.storage')
    await service.setEnabled(installed.id, false)
    await service.recordPermissionDecision(installed.id, {
      permission: 'app.storage',
      method: 'storage.get',
      decision: 'always',
      summary: 'test',
    })

    expect(putRuntime).not.toHaveBeenCalled()
    expect((await service.get(installed.id))?.persistentPermissionGrants).toEqual(['app.storage'])
  })
})
